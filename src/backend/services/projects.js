export function createProjectsService({ authContext, ttlMs }) {
  return {
    status(req) {
      const ctx = authContext(req);
      return {
        enabled: true,
        authenticated: true,
        ttlMs,
        account: { accountId: ctx.accountId, accountName: ctx.accountName },
        projects: ctx.projects,
        activeProjectId: ctx.projectId,
        project: ctx
      };
    }
  };
}
