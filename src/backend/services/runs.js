export function createRunsService(deps) {
  const { bodyJson, runs, runsForDisplay, makeRun, normalizeRunProject, inProject, enrichRun, now, id, persistRuns } = deps;

  return {
    list(ctx) {
      return runsForDisplay(ctx).map((run) => enrichRun(run));
    },
    async create(req, ctx) {
      const run = makeRun(await bodyJson(req), ctx);
      if (persistRuns) await persistRuns();
      return run;
    },
    async byPath(req, path, ctx) {
      const method = req.method || 'GET';
      const parts = path.split('/').filter(Boolean);
      const run = runs.map(normalizeRunProject).find((item) => item.id === parts[1] && inProject(item, ctx));
      if (!run) return null;
      if (method === 'GET' && parts.length === 2) return enrichRun(run);
      if (method === 'DELETE' && parts.length === 2) {
        const index = runs.findIndex((item) => item.id === parts[1]);
        if (index >= 0) runs.splice(index, 1);
        if (index >= 0 && persistRuns) await persistRuns();
        return true;
      }
      if (method === 'GET' && parts[2] === 'status') {
        return {
          status: run.status,
          completedCases: run.completedCases,
          totalCases: run.totalCases,
          passedCases: run.passedCases
        };
      }
      if (method === 'POST' && parts[2] === 'stop') {
        run.status = 'STOPPED';
        run.finishedAt = now();
        if (persistRuns) await persistRuns();
        return run;
      }
      if (method === 'POST' && parts[2] === 'failures' && parts[3] === 'backflow') {
        return { affected: 0, candidates: 0, message: '已停用自动回流，请在 Run 结果中手工勾选加入回归集。' };
      }
      if (parts[2] === 'cases') {
        const caseId = decodeURIComponent(parts[3] || '');
        const result = run.results.find((item) => item.caseId === caseId);
        if (!result) return null;
        if (method === 'PATCH' && parts[4] === 'review-flag') {
          const payload = await bodyJson(req);
          result.reviewFlagged = Boolean(payload.flagged);
          if (persistRuns) await persistRuns();
          return run;
        }
        if (parts[4] === 'comments') {
          if (method === 'POST' && parts.length === 5) {
            const payload = await bodyJson(req);
            result.comments.push({ id: id('cmt'), content: payload.content || '', createdAt: now() });
            if (persistRuns) await persistRuns();
            return run;
          }
          const commentId = parts[5];
          const commentIndex = result.comments.findIndex((item) => item.id === commentId);
          if (commentIndex < 0) return null;
          if (method === 'PUT') {
            const payload = await bodyJson(req);
            result.comments[commentIndex].content = payload.content || '';
            if (persistRuns) await persistRuns();
            return run;
          }
          if (method === 'DELETE') {
            result.comments.splice(commentIndex, 1);
            if (persistRuns) await persistRuns();
            return run;
          }
        }
      }
      return undefined;
    }
  };
}
