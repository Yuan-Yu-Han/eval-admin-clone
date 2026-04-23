import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = process.env.VERCEL
  ? '/tmp/runtime.sqlite'
  : path.resolve(__dirname, '../../../data/runtime.sqlite');

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (error) => {
      if (error) reject(error);
      else resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row || null);
    });
  });
}

function parseJson(text, fallback) {
  try {
    const parsed = JSON.parse(String(text || ''));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function projectKey(kind, projectId) {
  return `${kind}:${projectId}`;
}

function groupByProject(items = []) {
  return items.reduce((acc, item) => {
    const projectId = item?.projectId || 'shared';
    if (!acc[projectId]) acc[projectId] = [];
    acc[projectId].push(item);
    return acc;
  }, {});
}

export async function createSqliteStateStore(options = {}) {
  const dbPath = path.resolve(options.dbPath || process.env.EVAL_DEMO_DB_PATH || DEFAULT_DB_PATH);
  const db = await openDb(dbPath);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );

  const save = async (key, value) => {
    await run(
      db,
      `INSERT INTO app_state(key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), new Date().toISOString()]
    );
  };

  const load = async (key, fallback) => {
    const row = await get(db, 'SELECT value_json FROM app_state WHERE key = ?', [key]);
    if (!row) return fallback;
    return parseJson(row.value_json, fallback);
  };

  const ensureSeed = async (key, seedValue) => {
    const row = await get(db, 'SELECT key FROM app_state WHERE key = ?', [key]);
    if (!row) await save(key, seedValue);
  };

  const projectIds = options.projectIds || Object.keys(options.seedCasesByProject || {});
  const seedCasesByProject = options.seedCasesByProject || groupByProject(options.seedCases || []);
  const seedRunsByProject = options.seedRunsByProject || groupByProject(options.seedRuns || []);

  if (projectIds.length) {
    for (const projectId of projectIds) {
      await ensureSeed(projectKey('cases', projectId), seedCasesByProject[projectId] || []);
      await ensureSeed(projectKey('runs', projectId), seedRunsByProject[projectId] || []);
    }
  } else {
    await ensureSeed('cases', options.seedCases || []);
    await ensureSeed('runs', options.seedRuns || []);
  }

  return {
    dbPath,
    projectKey,
    async loadCases() {
      if (!projectIds.length) return load('cases', options.seedCases || []);
      const buckets = await Promise.all(projectIds.map((projectId) => load(projectKey('cases', projectId), seedCasesByProject[projectId] || [])));
      return buckets.flat();
    },
    async loadRuns() {
      if (!projectIds.length) return load('runs', options.seedRuns || []);
      const buckets = await Promise.all(projectIds.map((projectId) => load(projectKey('runs', projectId), seedRunsByProject[projectId] || [])));
      return buckets.flat();
    },
    async loadProjectCases(projectId) {
      return load(projectKey('cases', projectId), seedCasesByProject[projectId] || []);
    },
    async loadProjectRuns(projectId) {
      return load(projectKey('runs', projectId), seedRunsByProject[projectId] || []);
    },
    async loadTemplates() {
      if (!projectIds.length) return load('templates', []);
      const buckets = await Promise.all(projectIds.map((projectId) => load(projectKey('templates', projectId), [])));
      return buckets.flat();
    },
    async loadMockConfigs() {
      if (!projectIds.length) return load('mockConfigs', options.seedMockConfigs || []);
      const seedByProject = groupByProject(options.seedMockConfigs || []);
      const buckets = await Promise.all(projectIds.map((projectId) => load(projectKey('mockConfigs', projectId), seedByProject[projectId] || [])));
      return buckets.flat();
    },
    async loadProjectTemplates(projectId) {
      return load(projectKey('templates', projectId), []);
    },
    async saveCases(cases) {
      if (!projectIds.length) return save('cases', cases || []);
      const byProject = groupByProject(cases || []);
      for (const projectId of projectIds) {
        await save(projectKey('cases', projectId), byProject[projectId] || []);
      }
    },
    async saveRuns(runs) {
      if (!projectIds.length) return save('runs', runs || []);
      const byProject = groupByProject(runs || []);
      for (const projectId of projectIds) {
        await save(projectKey('runs', projectId), byProject[projectId] || []);
      }
    },
    async saveProjectCases(projectId, cases) {
      await save(projectKey('cases', projectId), cases || []);
    },
    async saveProjectRuns(projectId, runs) {
      await save(projectKey('runs', projectId), runs || []);
    },
    async saveTemplates(templates) {
      if (!projectIds.length) return save('templates', templates || []);
      const byProject = groupByProject(templates || []);
      for (const projectId of projectIds) {
        await save(projectKey('templates', projectId), byProject[projectId] || []);
      }
    },
    async saveProjectTemplates(projectId, templates) {
      await save(projectKey('templates', projectId), templates || []);
    },
    async saveMockConfigs(mockConfigs) {
      if (!projectIds.length) return save('mockConfigs', mockConfigs || []);
      const byProject = groupByProject(mockConfigs || []);
      for (const projectId of projectIds) {
        await save(projectKey('mockConfigs', projectId), byProject[projectId] || []);
      }
    }
  };
}
