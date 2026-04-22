export function createCasesService(deps) {
  const {
    cases,
    bodyJson,
    bodyText,
    inProject,
    isAdminProject,
    normalizeCase,
    pushRegressionAudit,
    now,
    id,
    groups,
    uidFromTier,
    turnCsvCells,
    CASE_IMPORT_COLUMNS,
    generationSchemaForProject,
    CASE_SOURCES,
    CASE_RISK_LEVELS,
    persistCases
  } = deps;

  return {
    list(ctx) {
      return cases.filter((item) => inProject(item, ctx)).map((item) => normalizeCase(item));
    },
    exportRows(ctx, filters = {}) {
      const scoped = cases.filter((item) => {
        if (!inProject(item, ctx)) return false;
        if (filters.group && item.groupName !== filters.group) return false;
        if (filters.source && item.source !== filters.source) return false;
        if (filters.onlyRegression && !item.regression) return false;
        return true;
      });
      return [
        CASE_IMPORT_COLUMNS,
        ...scoped.map((item) => caseSchemaCsvRow(normalizeCase(item)))
      ];
    },
    async bulk(req, ctx) {
      const payload = await bodyJson(req);
      const targetIds = new Set(payload.caseIds || []);
      let changed = 0;
      cases.forEach((item, idx) => {
        if (!targetIds.has(item.id) || !inProject(item, ctx)) return;
        let next = { ...item };
        if (typeof payload.enabled === 'boolean') next.enabled = payload.enabled;
        if (typeof payload.regression === 'boolean' && next.regression !== payload.regression) {
          next.regression = payload.regression;
          next = pushRegressionAudit(next, payload.regression ? 'regression-approved' : 'regression-removed', payload.actor || 'manual-ui');
        }
        if (typeof payload.regressionCandidate === 'boolean' && next.regressionCandidate !== payload.regressionCandidate) {
          next.regressionCandidate = payload.regressionCandidate;
          next = pushRegressionAudit(next, payload.regressionCandidate ? 'candidate-added' : 'candidate-removed', payload.actor || 'manual-ui');
        }
        if (payload.source && CASE_SOURCES.includes(payload.source)) next.source = payload.source;
        if (payload.riskLevel && CASE_RISK_LEVELS.includes(payload.riskLevel)) next.riskLevel = payload.riskLevel;
        next.updatedAt = now();
        cases[idx] = normalizeCase(next);
        changed++;
      });
      if (changed > 0 && persistCases) await persistCases();
      return { changed };
    },
    async regressionByCaseIds(req, ctx) {
      const payload = await bodyJson(req);
      const ids = new Set((payload.caseIds || []).map((v) => String(v)));
      const actor = payload.actor || 'run-review-ui';
      const flag = payload.regression !== false;
      let changed = 0;
      cases.forEach((item, idx) => {
        if (!ids.has(String(item.caseId)) || !inProject(item, ctx) || Boolean(item.regression) === Boolean(flag)) return;
        let next = { ...item, regression: Boolean(flag), updatedAt: now() };
        next = pushRegressionAudit(next, flag ? 'regression-approved' : 'regression-removed', actor, {
          note: payload.note || '来自 Run 结果界面勾选'
        });
        cases[idx] = normalizeCase(next);
        changed++;
      });
      if (changed > 0 && persistCases) await persistCases();
      return { changed };
    },
    async create(req, ctx) {
      const payload = await bodyJson(req);
      const doc = normalizeCase({ ...payload, projectId: isAdminProject(ctx) ? payload.projectId : ctx.projectId, id: id('case'), updatedAt: now() });
      cases.unshift(doc);
      if (persistCases) await persistCases();
      return doc;
    },
    async importCsv(req, ctx) {
      const raw = await bodyText(req);
      const csv = extractCsvText(raw, req.headers['content-type'] || '');
      const rows = parseCsvRows(csv).filter((row) => row.some((cell) => String(cell || '').trim()));
      if (rows.length < 2) return { imported: 0 };
      const header = rows[0].map((cell) => String(cell || '').trim());
      const schema = generationSchemaForProject ? generationSchemaForProject(ctx) : null;
      const docs = rows.slice(1)
        .filter((row) => String(row[0] || '').trim() !== '# 是否启用(true/false)')
        .map((row) => rowToCaseDoc({ row, header, schema, ctx }))
        .filter(Boolean)
        .map((doc) => normalizeCase({
          ...doc,
          id: id('case'),
          source: 'manual',
          createdAt: now(),
          updatedAt: now()
        }));
      docs.reverse().forEach((doc) => cases.unshift(doc));
      if (docs.length && persistCases) await persistCases();
      return { imported: docs.length };
    },
    async byPath(req, path, ctx) {
      const method = req.method || 'GET';
      const parts = path.split('/').filter(Boolean);
      const targetId = decodeURIComponent(parts[1] || '');
      const index = cases.findIndex((item) => item.id === targetId);
      if (index < 0 || !inProject(cases[index], ctx)) return null;
      if (method === 'GET' && parts.length === 2) return cases[index];
      if (method === 'PATCH' && parts[2] === 'regression-flags') {
        const payload = await bodyJson(req);
        let next = { ...cases[index] };
        const actor = payload.actor || 'manual-ui';
        if (typeof payload.regressionCandidate === 'boolean' && next.regressionCandidate !== payload.regressionCandidate) {
          next.regressionCandidate = payload.regressionCandidate;
          next = pushRegressionAudit(next, payload.regressionCandidate ? 'candidate-added' : 'candidate-removed', actor, { note: payload.note || '' });
        }
        if (typeof payload.regression === 'boolean' && next.regression !== payload.regression) {
          next.regression = payload.regression;
          next = pushRegressionAudit(next, next.regression ? 'regression-approved' : 'regression-removed', actor, { note: payload.note || '' });
        }
        next.updatedAt = now();
        cases[index] = normalizeCase(next);
        if (persistCases) await persistCases();
        return cases[index];
      }
      if (method === 'PUT') {
        const payload = await bodyJson(req);
        let next = { ...cases[index], ...payload, id: cases[index].id, updatedAt: now() };
        const actor = payload.actor || 'manual-ui';
        if (Boolean(cases[index].regressionCandidate) !== Boolean(next.regressionCandidate)) next = pushRegressionAudit(next, next.regressionCandidate ? 'candidate-added' : 'candidate-removed', actor);
        if (Boolean(cases[index].regression) !== Boolean(next.regression)) next = pushRegressionAudit(next, next.regression ? 'regression-approved' : 'regression-removed', actor);
        cases[index] = normalizeCase(next);
        if (persistCases) await persistCases();
        return cases[index];
      }
      if (method === 'DELETE') {
        cases.splice(index, 1);
        if (persistCases) await persistCases();
        return true;
      }
      return undefined;
    },
    groupNames(ctx) {
      return groups(ctx);
    },
    async deleteGroup(groupName, ctx) {
      let removed = 0;
      for (let i = cases.length - 1; i >= 0; i--) {
        if (cases[i].groupName === groupName && inProject(cases[i], ctx)) {
          cases.splice(i, 1);
          removed++;
        }
      }
      if (removed > 0 && persistCases) await persistCases();
      return removed;
    },
    generateUserId(tier) {
      return uidFromTier(tier || 'FULL');
    }
  };
}

function extractCsvText(raw, contentType) {
  if (!/^multipart\/form-data/i.test(contentType)) return stripBom(raw);
  const boundary = /boundary=([^;]+)/i.exec(contentType)?.[1];
  if (!boundary) return stripBom(raw);
  const part = raw.split(`--${boundary}`).find((item) => /name="file"/.test(item)) || '';
  const body = part.split(/\r?\n\r?\n/).slice(1).join('\n\n');
  return stripBom(body.replace(/\r?\n--$/, '').trim());
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text || '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function rowValue(row, header, key) {
  const idx = header.indexOf(key);
  return idx >= 0 ? row[idx] : '';
}

function parseJsonObject(text, fallback = {}) {
  try {
    const parsed = JSON.parse(String(text || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function listValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(/[|,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function caseSchemaCsvRow(item) {
  const inputs = [
    item.input1 || item.payload?.dialogueText || item.turns?.[0]?.userInput || '',
    item.input2 || item.turns?.[1]?.userInput || '',
    item.input3 || item.turns?.[2]?.userInput || ''
  ];
  return [
    item.enabled ? 'true' : 'false',
    item.caseId,
    item.name,
    item.groupName,
    item.tags || '',
    item.userId || '',
    ...inputs,
    item.eval_type_1 || '',
    item.expected_arg_1 || '',
    item.judge_prompt_id_1 || '',
    item.eval_type_2 || '',
    item.expected_arg_2 || '',
    item.judge_prompt_id_2 || '',
    item.eval_type_3 || '',
    item.expected_arg_3 || '',
    item.judge_prompt_id_3 || ''
  ];
}

function schemaEvalSlots(doc) {
  return [1, 2, 3].map((n) => ({
    index: n,
    evalType: doc[`eval_type_${n}`],
    expectedArg: doc[`expected_arg_${n}`],
    judgePromptId: doc[`judge_prompt_id_${n}`]
  })).filter((slot) => slot.evalType || slot.expectedArg || slot.judgePromptId);
}

function canonicalEvalType(value) {
  if (value === 'tool_call' || value === 'param_match') return 'structure_match';
  if (value === 'reply_match') return 'text_match';
  return value || '';
}

function schemaCompatTurns(doc) {
  const turns = [doc.input1, doc.input2, doc.input3]
    .map((input, idx) => String(input || '').trim() ? { turnIndex: idx + 1, userInput: input } : null)
    .filter(Boolean);
  if (!turns.length) return [];
  const target = turns[turns.length - 1];
  const slots = schemaEvalSlots(doc);
  const toolSlot = slots.find((slot) => canonicalEvalType(slot.evalType) === 'structure_match');
  const replySlot = slots.find((slot) => canonicalEvalType(slot.evalType) === 'text_match');
  const judgeSlot = slots.find((slot) => canonicalEvalType(slot.evalType) === 'llm_judge');
  if (toolSlot) {
    const toolArg = parseJsonObject(toolSlot.expectedArg, {});
    target.expectedTool = toolArg.tool || toolSlot.expectedArg || '';
    target.expectedArgs = toolArg.args ?? toolArg;
  }
  if (replySlot) {
    const replyArg = parseJsonObject(replySlot.expectedArg, {});
    target.replyContains = Array.isArray(replyArg.contains) ? replyArg.contains : listValue(replySlot.expectedArg);
    target.replyNotContains = Array.isArray(replyArg.notContains) ? replyArg.notContains : [];
  }
  if (judgeSlot) {
    const judgeArg = parseJsonObject(judgeSlot.expectedArg, {});
    target.judgePrompt = judgeSlot.judgePromptId || judgeArg.criteria || '';
    target.judgeThreshold = judgeArg.threshold ?? '';
  }
  return turns;
}

function schemaVoicePayload(doc) {
  const slots = schemaEvalSlots(doc);
  const structureSlots = slots.filter((slot) => canonicalEvalType(slot.evalType) === 'structure_match');
  const structureSlot = structureSlots[0];
  const paramSlot = structureSlots[1];
  const expectedTicket = parseJsonObject(structureSlot?.expectedArg, {});
  const paramArg = parseJsonObject(paramSlot?.expectedArg, {});
  if (Array.isArray(paramArg.missingFields)) expectedTicket.missingFields = paramArg.missingFields;
  return {
    dialogueText: doc.input1 || '',
    expectedTicket,
    assertions: {},
    noiseTags: listValue(doc.tags)
  };
}

function rowToCaseDoc({ row, header, schema, ctx }) {
  const caseId = rowValue(row, header, 'case_id').trim();
  if (!caseId || caseId.startsWith('#')) return null;
  if (header.includes('eval_type_1')) {
    const doc = {
      projectId: ctx.projectId,
      caseType: schema?.caseType === 'voice_ticket_dialogue' ? 'voice_ticket_dialogue' : 'vehicle_agent_turns',
      caseId,
      name: rowValue(row, header, 'name') || caseId,
      groupName: rowValue(row, header, 'group_name') || (schema?.caseType === 'voice_ticket_dialogue' ? '工单结构化' : '默认分组'),
      tags: rowValue(row, header, 'tags'),
      userId: rowValue(row, header, 'user_id'),
      input1: rowValue(row, header, 'input1'),
      input2: rowValue(row, header, 'input2'),
      input3: rowValue(row, header, 'input3'),
      enabled: rowValue(row, header, 'enable') !== 'false'
    };
    [1, 2, 3].forEach((n) => {
      doc[`eval_type_${n}`] = rowValue(row, header, `eval_type_${n}`);
      doc[`expected_arg_${n}`] = rowValue(row, header, `expected_arg_${n}`);
      doc[`judge_prompt_id_${n}`] = rowValue(row, header, `judge_prompt_id_${n}`);
    });
    doc.turns = schemaCompatTurns(doc);
    if (doc.caseType === 'voice_ticket_dialogue') doc.payload = schemaVoicePayload(doc);
    return doc;
  }
  if (schema?.caseType === 'voice_ticket_dialogue') {
    const expectedTicket = parseJsonObject(rowValue(row, header, 'expected_ticket_json'), {});
    const missingFields = listValue(rowValue(row, header, 'missing_fields'));
    if (missingFields.length) expectedTicket.missingFields = missingFields;
    if (rowValue(row, header, 'expected_route')) expectedTicket.routeQueue = rowValue(row, header, 'expected_route').trim();
    const noiseTags = listValue(rowValue(row, header, 'noise_tags'));
    return {
      projectId: ctx.projectId,
      caseType: 'voice_ticket_dialogue',
      caseId,
      name: rowValue(row, header, 'name') || caseId,
      groupName: rowValue(row, header, 'group_name') || '工单结构化',
      enabled: rowValue(row, header, 'enable') !== 'false',
      tags: noiseTags.join(','),
      riskLevel: rowValue(row, header, 'risk_level') || 'medium',
      payload: {
        dialogueText: rowValue(row, header, 'dialogue_text'),
        expectedTicket,
        assertions: {},
        noiseTags
      }
    };
  }
  const turns = [1, 2, 3].map((n) => ({
    userInput: rowValue(row, header, `input${n}`),
    expectedTool: rowValue(row, header, `expected_tool_${n}`),
    expectedArgs: rowValue(row, header, `expected_args_${n}`),
    replyContains: listValue(rowValue(row, header, `reply_contains_${n}`)),
    replyNotContains: listValue(rowValue(row, header, `reply_not_contains_${n}`)),
    judgePrompt: rowValue(row, header, `judge_prompt_${n}`),
    judgeThreshold: rowValue(row, header, `judge_threshold_${n}`)
  })).filter((turn) => turn.userInput || turn.expectedTool);
  return {
    projectId: ctx.projectId,
    caseType: 'vehicle_agent_turns',
    caseId,
    name: rowValue(row, header, 'name') || caseId,
    userId: rowValue(row, header, 'user_id') || '900100000',
    groupName: rowValue(row, header, 'group_name') || '默认分组',
    enabled: rowValue(row, header, 'enable') !== 'false',
    turns
  };
}
