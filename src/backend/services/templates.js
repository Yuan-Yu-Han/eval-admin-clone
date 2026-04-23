function inferStructureTargetField(stage = {}) {
  const key = String(stage.key || '').toLowerCase();
  const name = String(stage.name || '').toLowerCase();
  const label = String(stage.case_field_label || '').toLowerCase();
  const text = `${key} ${name} ${label}`;
  if (text.includes('intent') || text.includes('意图')) return 'intent';
  if (text.includes('intermediate') || text.includes('中间调用')) return 'intermediate_calls';
  if (text.includes('param') || text.includes('参数') || text.includes('inputconditionretention')) return 'arguments';
  if (text.includes('function') || text.includes('工具') || text.includes('函数') || text.includes('invocation')) return 'function_name';
  return 'function_name';
}

function normalizeStage(stage = {}) {
  const next = { ...stage };
  if (next.eval_type === 'structure_match') {
    next.target_field = String(next.target_field || inferStructureTargetField(next)).trim();
    if (next.method === 'json_path_exists') {
      delete next.case_field_label;
    } else if (!next.case_field_label) {
      next.case_field_label = '期望值';
    }
  }
  return next;
}

export function createTemplatesService(deps) {
  const {
    bodyJson,
    customTemplates,
    defaultTemplatesForProject,
    inProject,
    now,
    id,
    persistTemplates
  } = deps;

  function normalizeTemplate(template, ctx) {
    const projectId = ctx.projectId;
    const templateId = String(template.templateId || template.template_id || id('template')).trim();
    return {
      ...template,
      templateId,
      projectId,
      projectIds: Array.from(new Set([...(template.projectIds || []), projectId])),
      category: template.category || 'custom',
      source: 'db',
      name: template.name || templateId,
      summary: template.summary || '',
      stages: Array.isArray(template.stages) ? template.stages.map(normalizeStage) : [],
      updatedAt: now(),
      createdAt: template.createdAt || now()
    };
  }

  function list(ctx) {
    const scopedAll = customTemplates.filter((item) => inProject(item, ctx));
    const scopedCustom = scopedAll.filter((item) => !item.deleted);
    const customIds = new Set(scopedAll.map((item) => item.templateId));
    return scopedCustom.concat((defaultTemplatesForProject(ctx.projectId) || []).filter((item) => !customIds.has(item.templateId)));
  }

  async function upsert(req, ctx) {
    const payload = await bodyJson(req);
    const next = normalizeTemplate(payload, ctx);
    next.deleted = false;
    const index = customTemplates.findIndex((item) => item.templateId === next.templateId && inProject(item, ctx));
    if (index >= 0) customTemplates[index] = { ...customTemplates[index], ...next };
    else customTemplates.unshift(next);
    if (persistTemplates) await persistTemplates();
    return next;
  }

  async function remove(path, ctx) {
    const targetId = decodeURIComponent(path.split('/')[2] || '');
    const before = customTemplates.length;
    let removed = false;
    for (let i = customTemplates.length - 1; i >= 0; i--) {
      if (customTemplates[i].templateId === targetId && inProject(customTemplates[i], ctx)) {
        customTemplates.splice(i, 1);
        removed = true;
      }
    }
    if (!removed) {
      customTemplates.unshift({
        templateId: targetId,
        projectId: ctx.projectId,
        projectIds: [ctx.projectId],
        deleted: true,
        source: 'db',
        updatedAt: now(),
        createdAt: now()
      });
      removed = true;
    }
    if (customTemplates.length !== before || removed) {
      if (persistTemplates) await persistTemplates();
    }
    return { deleted: removed };
  }

  return { list, upsert, remove };
}
