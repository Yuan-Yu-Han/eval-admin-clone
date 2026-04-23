export function createMockConfigsService(deps) {
  const { bodyJson, mockConfigs, configList, configById, isAdminProject, id, persistMockConfigs } = deps;

  return {
    list(ctx) {
      return configList(ctx).map((item) => {
        const cfg = configById(item.configId, ctx);
        return {
          ...item,
          mockOutputCount: Object.keys(cfg?.mockOutputs || {}).length
        };
      });
    },
    async create(req, ctx) {
      const payload = await bodyJson(req);
      const clone = payload.cloneFrom ? configById(payload.cloneFrom, ctx) : null;
      const created = {
        configId: id('mock'),
        name: payload.name || '新数据集',
        projectId: isAdminProject(ctx) ? (payload.projectId || 'shared') : ctx.projectId,
        mockType: ctx.projectId === 'voice-ticket-eval' ? 'ticket_dialogue' : 'vehicle_api',
        userLatitude: clone?.userLatitude ?? 36.292,
        userLongitude: clone?.userLongitude ?? 120.369,
        vehicles: clone ? JSON.parse(JSON.stringify(clone.vehicles)) : [],
        mockOutputs: clone ? JSON.parse(JSON.stringify(clone.mockOutputs || {})) : {}
      };
      mockConfigs.push(created);
      if (persistMockConfigs) await persistMockConfigs();
      return { configId: created.configId };
    },
    byId(configId, ctx) {
      return configById(configId, ctx);
    },
    async configsPath(req, path, ctx) {
      const method = req.method || 'GET';
      const parts = path.split('/').filter(Boolean);
      const cfg = configById(decodeURIComponent(parts[1] || ''), ctx);
      if (!cfg) return null;
      if (method === 'PUT' && parts[2] === 'name') {
        cfg.name = (await bodyJson(req)).name || cfg.name;
        if (persistMockConfigs) await persistMockConfigs();
        return cfg;
      }
      if (parts[2] === 'outputs') {
        const caseId = decodeURIComponent(parts[3] || '');
        cfg.mockOutputs = cfg.mockOutputs || {};
        if (method === 'GET') return cfg.mockOutputs[caseId] || {};
        if (method === 'PUT') {
          cfg.mockOutputs[caseId] = await bodyJson(req);
          if (persistMockConfigs) await persistMockConfigs();
          return cfg.mockOutputs[caseId];
        }
        if (method === 'DELETE') {
          delete cfg.mockOutputs[caseId];
          if (persistMockConfigs) await persistMockConfigs();
          return true;
        }
      }
      if (method === 'DELETE') {
        const index = mockConfigs.findIndex((item) => item.configId === cfg.configId);
        if (index >= 0 && mockConfigs.length > 1) mockConfigs.splice(index, 1);
        if (persistMockConfigs) await persistMockConfigs();
        return true;
      }
      return undefined;
    },
    async test(req, ctx) {
      const payload = await bodyJson(req);
      const cfg = configById(payload.configId, ctx);
      return {
        url: payload.url,
        params: JSON.parse(payload.params || '{}'),
        config: cfg.name,
        vehicleCount: cfg.vehicles.length,
        data: cfg.vehicles.map((item) => item.values)
      };
    },
    async updateLocation(req, configId, ctx) {
      const cfg = configById(configId, ctx);
      const payload = await bodyJson(req);
      cfg.userLatitude = Number(payload.latitude);
      cfg.userLongitude = Number(payload.longitude);
      if (persistMockConfigs) await persistMockConfigs();
      return cfg;
    },
    async vehicles(req, configId, ctx) {
      const method = req.method || 'GET';
      const cfg = configById(configId, ctx);
      if (method === 'POST') {
        cfg.vehicles.push({ values: await bodyJson(req) });
        if (persistMockConfigs) await persistMockConfigs();
        return cfg;
      }
      if (method === 'DELETE') {
        cfg.vehicles = [];
        if (persistMockConfigs) await persistMockConfigs();
        return cfg;
      }
      return undefined;
    },
    async vehicleByVin(req, path, configId, ctx) {
      const method = req.method || 'GET';
      const cfg = configById(configId, ctx);
      const vinId = decodeURIComponent(path.split('/')[3] || '');
      const index = cfg.vehicles.findIndex((item) => item.values?.vinid === vinId);
      if (index < 0) return null;
      if (method === 'PUT') {
        cfg.vehicles[index] = { values: await bodyJson(req) };
        if (persistMockConfigs) await persistMockConfigs();
        return cfg;
      }
      if (method === 'DELETE') {
        cfg.vehicles.splice(index, 1);
        if (persistMockConfigs) await persistMockConfigs();
        return cfg;
      }
      return undefined;
    }
  };
}
