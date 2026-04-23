export function createApiRouter(deps) {
  const {
    json,
    ok,
    notFound,
    services,
    authContext,
    workbenchContract,
    demoTestsets,
    templatesForProject,
    functionBindingsForProject,
    templateMappingForProject,
    agentVersions,
    datasetVersions
  } = deps;

  return async function routeApi(req, res, url) {
    const path = url.pathname.replace('/admin/eval/api', '');
    const method = req.method || 'GET';

    if (method === 'GET' && path === '/env') return json(res, ok({ env: 'local-demo' }));
    if (method === 'GET' && path === '/auth/status') {
      return json(res, ok(services().projects.status(req)));
    }
    const ctx = authContext(req);

    if (method === 'GET' && path === '/workbench-contract') return json(res, ok(workbenchContract(ctx)));
    if (method === 'GET' && path === '/templates') {
      return json(res, ok({
        templates: services().templates.list(ctx),
        functionBindings: functionBindingsForProject(ctx.projectId),
        functionMapping: templateMappingForProject(ctx.projectId)
      }));
    }
    if (method === 'POST' && path === '/templates') return json(res, ok(await services().templates.upsert(req, ctx)));
    if (method === 'PUT' && path.startsWith('/templates/')) return json(res, ok(await services().templates.upsert(req, ctx)));
    if (method === 'DELETE' && path.startsWith('/templates/')) return json(res, ok(await services().templates.remove(path, ctx)));
    if (method === 'GET' && path === '/cases') return json(res, ok(services().cases.list(ctx)));
    if (method === 'GET' && path === '/cases/export') {
      const rows = services().cases.exportRows(ctx, {
        group: url.searchParams.get('group'),
        source: url.searchParams.get('source'),
        onlyRegression: url.searchParams.get('regression') === 'true'
      });
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="eval_cases_export.csv"'
      });
      const scopedCsv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
      return res.end(`\uFEFF${scopedCsv}`);
    }
    if (method === 'POST' && path === '/cases/bulk') {
      return json(res, ok(await services().cases.bulk(req, ctx)));
    }
    if (method === 'POST' && path === '/cases/regression-by-caseids') {
      return json(res, ok(await services().cases.regressionByCaseIds(req, ctx)));
    }
    if (method === 'POST' && path === '/cases/import') return json(res, ok(await services().cases.importCsv(req, ctx)));
    if (method === 'POST' && path === '/cases') {
      return json(res, ok(await services().cases.create(req, ctx)));
    }
    if (path.startsWith('/cases/')) {
      const result = await services().cases.byPath(req, path, ctx);
      if (result === null) return notFound(res);
      if (result !== undefined) return json(res, ok(result));
    }

    if (method === 'GET' && path === '/groups') return json(res, ok(services().cases.groupNames(ctx)));
    if (method === 'GET' && path === '/agent-versions') return json(res, ok(agentVersions));
    if (method === 'GET' && path === '/dataset-versions') return json(res, ok(datasetVersions));
    if (method === 'GET' && path === '/testsets') return json(res, ok(demoTestsets(ctx)));
    if (method === 'DELETE' && path.startsWith('/groups/')) {
      const groupName = decodeURIComponent(path.split('/')[2] || '');
      return json(res, ok(await services().cases.deleteGroup(groupName, ctx)));
    }
    if (method === 'GET' && path === '/generate-user-id') {
      return json(res, ok(services().cases.generateUserId(url.searchParams.get('tier') || 'FULL')));
    }

    if (method === 'GET' && path === '/runs') return json(res, ok(services().runs.list(ctx)));
    if (method === 'POST' && path === '/runs') return json(res, ok(await services().runs.create(req, ctx)));

    if (method === 'GET' && path === '/case-service/schema') {
      return json(res, ok(services().generation.schema(ctx)));
    }
    if (method === 'POST' && path === '/case-service/generate-preview') {
      return json(res, ok(await services().generation.preview(req, ctx)));
    }
    if (method === 'POST' && path === '/case-service/generate-upload') {
      return json(res, ok(await services().generation.uploadGenerated(req, ctx)));
    }
    if (method === 'POST' && path === '/case-service/upload-preview') {
      return json(res, ok(await services().generation.uploadPreview(req, ctx)));
    }
    if (path.startsWith('/runs/')) {
      const result = await services().runs.byPath(req, path, ctx);
      if (result === null) return notFound(res);
      if (result !== undefined) return json(res, ok(result));
    }

    if (method === 'GET' && path === '/mock-configs') return json(res, ok(services().mockConfigs.list(ctx)));
    if (method === 'POST' && path === '/mock-configs') {
      return json(res, ok(await services().mockConfigs.create(req, ctx)));
    }
    if (path.startsWith('/mock-configs/')) {
      const result = await services().mockConfigs.configsPath(req, path, ctx);
      if (result === null) return notFound(res);
      if (result !== undefined) return json(res, ok(result));
    }
    if (method === 'GET' && path === '/mock-config') return json(res, ok(services().mockConfigs.byId(url.searchParams.get('configId'), ctx)));
    if (method === 'POST' && path === '/mock-config/test') {
      return json(res, ok(await services().mockConfigs.test(req, ctx)));
    }
    if (method === 'PUT' && path === '/mock-config/location') {
      return json(res, ok(await services().mockConfigs.updateLocation(req, url.searchParams.get('configId'), ctx)));
    }
    if (path === '/mock-config/vehicles') {
      const result = await services().mockConfigs.vehicles(req, url.searchParams.get('configId'), ctx);
      if (result !== undefined) return json(res, ok(result));
    }
    if (method === 'POST' && path === '/mock-config/vehicles/import') return json(res, ok({ imported: 0 }));
    if (path.startsWith('/mock-config/vehicles/')) {
      const result = await services().mockConfigs.vehicleByVin(req, path, url.searchParams.get('configId'), ctx);
      if (result === null) return notFound(res);
      if (result !== undefined) return json(res, ok(result));
    }

    return notFound(res);
  };
}
