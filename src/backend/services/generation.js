export function createGenerationService(deps) {
  const { bodyJson, generationSchemaForProject, generateCasesForUpload, normalizeCase, isAdminProject, now, id, cases, persistCases } = deps;

  return {
    schema(ctx) {
      return generationSchemaForProject(ctx);
    },
    async preview(req, ctx) {
      const payload = await bodyJson(req);
      const { generated, warning } = generateCasesForUpload(payload || {}, ctx);
      return {
        mode: payload?.mode === 'expand' ? 'expand' : 'generate',
        count: generated.length,
        warning,
        preview: generated
      };
    },
    async uploadGenerated(req, ctx) {
      const payload = await bodyJson(req);
      const { generated, warning } = generateCasesForUpload(payload || {}, ctx);
      generated.forEach((doc) => cases.unshift(doc));
      if (generated.length && persistCases) await persistCases();
      return {
        inserted: generated.length,
        warning,
        insertedIds: generated.map((item) => item.id),
        insertedCaseIds: generated.map((item) => item.caseId)
      };
    },
    async uploadPreview(req, ctx) {
      const payload = await bodyJson(req);
      const previewCases = Array.isArray(payload?.cases) ? payload.cases : [];
      const inserted = previewCases
        .map((item) => normalizeCase({
          ...item,
          projectId: isAdminProject(ctx) ? item?.projectId : ctx.projectId,
          id: id('case'),
          caseId: item?.caseId || `llm_upload_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          source: 'llm',
          enabled: item?.enabled !== false,
          createdAt: now(),
          updatedAt: now()
        }))
        .filter((item) => item.caseId);
      inserted.forEach((doc) => cases.unshift(doc));
      if (inserted.length && persistCases) await persistCases();
      return {
        inserted: inserted.length,
        warning: inserted.length ? '' : '没有可上传的预览用例。',
        insertedIds: inserted.map((item) => item.id),
        insertedCaseIds: inserted.map((item) => item.caseId)
      };
    }
  };
}
