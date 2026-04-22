import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createSqliteStateStore } from '../src/backend/storage/sqliteStateStore.js';

const PORT = 5199;
const BASE = `http://localhost:${PORT}/admin/eval/api`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ACCESS_CODE = 'eval';
const VEHICLE_AGENT_PROJECT = 'vehicle-agent-eval';
const VOICE_TICKET_PROJECT = 'voice-ticket-eval';
const OPS_ACCESS_CODE = 'voice';
const VEHICLE_ACCESS_CODE = 'vehicle';
const TESTER_ACCESS_CODE = 'tester';
let authToken = '';
let server;
const rawFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (input, options = {}) => {
  const url = String(input);
  if (!authToken || !url.startsWith(BASE) || url.endsWith('/env')) {
    return rawFetch(input, options);
  }
  const headers = { ...(options.headers || {}), 'X-Project-Id': authToken };
  return rawFetch(input, { ...options, headers });
};

function waitForServer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const tick = async () => {
      try {
        const res = await fetch(`${BASE}/env`);
        if (res.ok) return resolve();
      } catch {
        // Keep polling until the child server is ready.
      }
      if (Date.now() > deadline) return reject(new Error('server did not start'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      EVAL_DEMO_ACCESS_CODE: ACCESS_CODE,
      EVAL_DEMO_PROJECT_CODES: JSON.stringify([
        { code: ACCESS_CODE, projectId: 'all', projectName: '管理员视角', role: 'admin' },
        { code: OPS_ACCESS_CODE, projectId: VOICE_TICKET_PROJECT, projectName: '语音工单结构化评测', role: 'member' },
        { code: VEHICLE_ACCESS_CODE, projectId: VEHICLE_AGENT_PROJECT, projectName: '车辆 Agent 评测', role: 'member' },
        {
          code: TESTER_ACCESS_CODE,
          accountId: 'tester',
          accountName: '测试人员',
          projects: [
            { projectId: VEHICLE_AGENT_PROJECT, projectName: '车辆 Agent 评测', role: 'member' },
            { projectId: VOICE_TICKET_PROJECT, projectName: '语音工单结构化评测', role: 'member' }
          ]
        }
      ])
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });
  await waitForServer();
});

after(() => {
  if (server) server.kill();
});

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers['X-Project-Id'] = authToken;
  return fetch(`${BASE}${path}`, { ...options, headers });
}

test('eval admin APIs load without login and expose workspace projects', async () => {
  const status = await fetch(`${BASE}/auth/status`);
  assert.equal(status.status, 200);
  const statusJson = await status.json();
  assert.equal(statusJson.code, '10000');
  assert.equal(statusJson.data.authenticated, true);
  assert.deepEqual(statusJson.data.projects.map((item) => item.projectId), [VEHICLE_AGENT_PROJECT, VOICE_TICKET_PROJECT]);
  authToken = 'all';

  const allowed = await apiFetch('/cases');
  assert.equal(allowed.status, 200);
  const allowedJson = await allowed.json();
  assert.equal(allowedJson.code, '10000');
  assert.ok(Array.isArray(allowedJson.data));
});

test('workspace status exposes project-specific home profiles', async () => {
  const status = await fetch(`${BASE}/auth/status`);
  assert.equal(status.status, 200);
  const statusJson = await status.json();
  assert.equal(statusJson.code, '10000');

  const projects = statusJson.data.projects;
  const vehicle = projects.find((item) => item.projectId === VEHICLE_AGENT_PROJECT);
  const voice = projects.find((item) => item.projectId === VOICE_TICKET_PROJECT);

  assert.equal(vehicle.homeTitle, '车辆 Agent 评测首页');
  assert.equal(voice.homeTitle, '语音工单结构化评测首页');
  assert.deepEqual(vehicle.primaryMetrics.map((item) => item.key), ['control', 'query', 'rag']);
  assert.deepEqual(voice.primaryMetrics.map((item) => item.key), ['structuring', 'extract', 'routing']);
  assert.notDeepEqual(vehicle.homeModules, voice.homeModules);
  assert.equal(vehicle.defaultTab, 'project-home');
  assert.equal(voice.defaultTab, 'project-home');
});

async function loginForProject(accessCode) {
  const map = {
    [OPS_ACCESS_CODE]: VOICE_TICKET_PROJECT,
    [VEHICLE_ACCESS_CODE]: VEHICLE_AGENT_PROJECT,
    [ACCESS_CODE]: 'all',
    [TESTER_ACCESS_CODE]: ''
  };
  const projectId = map[accessCode] || VEHICLE_AGENT_PROJECT;
  const headers = projectId ? { 'X-Project-Id': projectId } : {};
  const status = await rawFetch(`${BASE}/auth/status`, { headers });
  assert.equal(status.status, 200);
  const json = await status.json();
  const project = json.data.project || {};
  return {
    code: json.code,
    data: {
      token: projectId || 'tester',
      account: json.data.account,
      projects: json.data.projects,
      activeProjectId: json.data.activeProjectId,
      projectId: project.projectId,
      projectName: project.projectName,
      role: project.role
    }
  };
}

async function authedJson(path, token) {
  const headers = token && token !== 'tester' ? { 'X-Project-Id': token } : {};
  const res = await rawFetch(`${BASE}${path}`, { headers });
  assert.equal(res.status, 200);
  return res.json();
}

async function projectJson(path, token, projectId) {
  const res = await rawFetch(`${BASE}${path}`, { headers: { 'X-Project-Id': projectId } });
  assert.equal(res.status, 200);
  return res.json();
}

test('project workspaces isolate cases and runs by scenario', async () => {
  const voiceLogin = await loginForProject(OPS_ACCESS_CODE);
  const vehicleLogin = await loginForProject(VEHICLE_ACCESS_CODE);

  assert.equal(voiceLogin.data.projectId, VOICE_TICKET_PROJECT);
  assert.equal(voiceLogin.data.projectName, '语音工单结构化评测');
  assert.equal(vehicleLogin.data.projectId, VEHICLE_AGENT_PROJECT);
  assert.equal(vehicleLogin.data.projectName, '车辆 Agent 评测');

  const voiceCases = await authedJson('/cases', voiceLogin.data.token);
  const vehicleCases = await authedJson('/cases', vehicleLogin.data.token);
  assert.ok(voiceCases.data.length > 0);
  assert.ok(vehicleCases.data.length > 0);
  assert.ok(voiceCases.data.every((item) => item.projectId === VOICE_TICKET_PROJECT));
  assert.ok(vehicleCases.data.every((item) => item.projectId === VEHICLE_AGENT_PROJECT));
  assert.ok(voiceCases.data.every((item) => (item.turns || []).every((turn) => ['voice_ticket_structuring', 'ticket_field_extract', 'ticket_category_route'].includes(turn.expectedTool))));
  assert.ok(vehicleCases.data.some((item) => (item.turns || []).some((turn) => ['open_door', 'vehicle_control', 'vehicle_selective_query'].includes(turn.expectedTool))));
  assert.notDeepEqual(
    voiceCases.data.map((item) => item.caseId).sort(),
    vehicleCases.data.map((item) => item.caseId).sort()
  );

  const opsRuns = await authedJson('/runs', voiceLogin.data.token);
  const vehicleRuns = await authedJson('/runs', vehicleLogin.data.token);
  assert.ok(opsRuns.data.every((item) => item.projectId === VOICE_TICKET_PROJECT));
  assert.ok(vehicleRuns.data.every((item) => item.projectId === VEHICLE_AGENT_PROJECT));

  const opsMockConfigs = await authedJson('/mock-configs', voiceLogin.data.token);
  const vehicleMockConfigs = await authedJson('/mock-configs', vehicleLogin.data.token);
  assert.ok(opsMockConfigs.data.every((item) => item.projectId === VOICE_TICKET_PROJECT));
  assert.ok(opsMockConfigs.data.some((item) => item.configId === 'mock_voice_ticket_default'));
  assert.ok(vehicleMockConfigs.data.some((item) => item.configId === 'mock_default'));
});

test('one tester account can switch project workspaces with isolated data', async () => {
  const testerLogin = await loginForProject(TESTER_ACCESS_CODE);
  assert.equal(testerLogin.data.account.accountId, 'tester');
  assert.deepEqual(testerLogin.data.projects.map((item) => item.projectId), [VEHICLE_AGENT_PROJECT, VOICE_TICKET_PROJECT]);
  assert.equal(testerLogin.data.activeProjectId, VEHICLE_AGENT_PROJECT);

  const token = testerLogin.data.token;
  const voiceCases = await projectJson('/cases', token, VOICE_TICKET_PROJECT);
  const vehicleCases = await projectJson('/cases', token, VEHICLE_AGENT_PROJECT);
  assert.ok(voiceCases.data.length > 0);
  assert.ok(vehicleCases.data.length > 0);
  assert.ok(voiceCases.data.every((item) => item.projectId === VOICE_TICKET_PROJECT));
  assert.ok(vehicleCases.data.every((item) => item.projectId === VEHICLE_AGENT_PROJECT));
  assert.notDeepEqual(
    voiceCases.data.map((item) => item.caseId).sort(),
    vehicleCases.data.map((item) => item.caseId).sort()
  );

  const voiceSchema = await projectJson('/case-service/schema', token, VOICE_TICKET_PROJECT);
  const vehicleSchema = await projectJson('/case-service/schema', token, VEHICLE_AGENT_PROJECT);
  assert.equal(voiceSchema.data.projectId, VOICE_TICKET_PROJECT);
  assert.equal(vehicleSchema.data.projectId, VEHICLE_AGENT_PROJECT);
  assert.ok(voiceSchema.data.allowedTools.includes('voice_ticket_structuring'));
  assert.equal(voiceSchema.data.allowedTools.includes('open_door'), false);
  assert.ok(vehicleSchema.data.allowedTools.includes('open_door'));
  assert.equal(vehicleSchema.data.allowedTools.includes('voice_ticket_structuring'), false);

  const status = await projectJson('/auth/status', token, VOICE_TICKET_PROJECT);
  assert.equal(status.data.activeProjectId, VOICE_TICKET_PROJECT);
  assert.equal(status.data.project.projectName, '语音工单结构化评测');
});

test('project case models are isolated by backend schema and payload', async () => {
  const testerLogin = await loginForProject(TESTER_ACCESS_CODE);
  const token = testerLogin.data.token;

  const voiceSchema = await projectJson('/case-service/schema', token, VOICE_TICKET_PROJECT);
  const vehicleSchema = await projectJson('/case-service/schema', token, VEHICLE_AGENT_PROJECT);
  assert.equal(voiceSchema.data.caseType, 'voice_ticket_dialogue');
  assert.equal(vehicleSchema.data.caseType, 'vehicle_agent_turns');
  assert.notDeepEqual(voiceSchema.data.requiredFields, vehicleSchema.data.requiredFields);
  assert.ok(voiceSchema.data.requiredFields.includes('dialogueText'));
  assert.ok(voiceSchema.data.requiredFields.includes('expectedTicket'));
  assert.ok(vehicleSchema.data.requiredFields.includes('turns'));
  assert.equal(vehicleSchema.data.requiredFields.includes('dialogueText'), false);

  const voiceCases = await projectJson('/cases', token, VOICE_TICKET_PROJECT);
  const vehicleCases = await projectJson('/cases', token, VEHICLE_AGENT_PROJECT);
  assert.ok(voiceCases.data.every((item) => item.caseType === 'voice_ticket_dialogue'));
  assert.ok(vehicleCases.data.every((item) => item.caseType === 'vehicle_agent_turns'));
  assert.ok(voiceCases.data.every((item) => item.payload && typeof item.payload.dialogueText === 'string'));
  assert.ok(voiceCases.data.every((item) => item.payload && item.payload.expectedTicket && typeof item.payload.expectedTicket === 'object'));
  assert.ok(vehicleCases.data.every((item) => item.payload && Array.isArray(item.payload.turns)));
  assert.ok(vehicleCases.data.every((item) => !item.payload.dialogueText));
});

test('sqlite state store physically separates cases and runs by project key', async () => {
  const dbPath = `/tmp/eval-admin-project-store-${process.pid}-${Date.now()}.sqlite`;
  const store = await createSqliteStateStore({
    dbPath,
    projectIds: [VEHICLE_AGENT_PROJECT, VOICE_TICKET_PROJECT],
    seedCasesByProject: {
      [VEHICLE_AGENT_PROJECT]: [{ caseId: 'vehicle_only', projectId: VEHICLE_AGENT_PROJECT }],
      [VOICE_TICKET_PROJECT]: [{ caseId: 'voice_only', projectId: VOICE_TICKET_PROJECT }]
    },
    seedRunsByProject: {
      [VEHICLE_AGENT_PROJECT]: [{ runId: 'vehicle_run', projectId: VEHICLE_AGENT_PROJECT }],
      [VOICE_TICKET_PROJECT]: [{ runId: 'voice_run', projectId: VOICE_TICKET_PROJECT }]
    }
  });

  assert.deepEqual((await store.loadProjectCases(VEHICLE_AGENT_PROJECT)).map((item) => item.caseId), ['vehicle_only']);
  assert.deepEqual((await store.loadProjectCases(VOICE_TICKET_PROJECT)).map((item) => item.caseId), ['voice_only']);
  assert.deepEqual((await store.loadProjectRuns(VEHICLE_AGENT_PROJECT)).map((item) => item.runId), ['vehicle_run']);
  assert.deepEqual((await store.loadProjectRuns(VOICE_TICKET_PROJECT)).map((item) => item.runId), ['voice_run']);

  await store.saveProjectCases(VEHICLE_AGENT_PROJECT, [{ caseId: 'vehicle_new', projectId: VEHICLE_AGENT_PROJECT }]);
  assert.deepEqual((await store.loadProjectCases(VEHICLE_AGENT_PROJECT)).map((item) => item.caseId), ['vehicle_new']);
  assert.deepEqual((await store.loadProjectCases(VOICE_TICKET_PROJECT)).map((item) => item.caseId), ['voice_only']);
});

test('case generation schema is project-scoped and assembled with editable business objective', async () => {
  const opsLogin = await loginForProject(OPS_ACCESS_CODE);
  const vehicleLogin = await loginForProject(VEHICLE_ACCESS_CODE);

  const opsSchema = await authedJson('/case-service/schema', opsLogin.data.token);
  const vehicleSchema = await authedJson('/case-service/schema', vehicleLogin.data.token);
  assert.equal(opsSchema.data.projectId, VOICE_TICKET_PROJECT);
  assert.equal(vehicleSchema.data.projectId, VEHICLE_AGENT_PROJECT);
  assert.notDeepEqual(opsSchema.data.requiredFields, vehicleSchema.data.requiredFields);
  assert.deepEqual(vehicleSchema.data.turnFields, ['userInput', 'expectedTool']);
  assert.deepEqual(opsSchema.data.turnFields, []);
  assert.deepEqual(opsSchema.data.importColumns.slice(0, 10), [
    'enable',
    'case_id',
    'name',
    'group_name',
    'dialogue_text',
    'expected_ticket_json',
    'expected_route',
    'missing_fields',
    'noise_tags',
    'risk_level'
  ]);
  assert.ok(vehicleSchema.data.importColumns.includes('expected_args_3'));
  assert.ok(vehicleSchema.data.importColumns.includes('judge_threshold_3'));
  assert.match(opsSchema.data.schemaNotes.join('\n'), /ASR 对话文本/);

  const businessObjective = '重点覆盖语音转写缺字段、投诉升级和字段抽取错误，不要改 JSON 字段结构。';
  const genJson = await rawFetch(`${BASE}/case-service/generate-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opsLogin.data.token}`
    },
    body: JSON.stringify({
      mode: 'generate',
      module: 'voice_ticket',
      count: 1,
      turnCount: 2,
      groupName: '工单结构化',
      businessObjective,
      allowedTools: ['voice_ticket_structuring'],
      caseIdPrefix: 'voice_schema'
    })
  }).then((res) => res.json());

  const prompt = genJson.data.preview[0].generationPrompt;
  assert.match(prompt, /平台固定结构约束/);
  assert.match(prompt, /项目 Schema/);
  assert.match(prompt, /业务覆盖目标/);
  assert.match(prompt, /投诉升级/);
  assert.match(prompt, /caseId/);
  assert.match(prompt, /voice_ticket_structuring/);
});

test('case generation prompt includes editable field contract while locking selected group', async () => {
  const opsLogin = await loginForProject(OPS_ACCESS_CODE);
  const editableContract = [
    '输出字段结构：字段结构全项目统一，业务覆盖目标单独填写。',
    '必填字段：caseId, name, groupName, allowedTools, turns, expectedTools, evalDimensions, riskLevel',
    '轮次字段：userInput, expectedTool；断言字段：expectedArgs, replyContains, replyNotContains, judgePrompt, judgeThreshold',
    '导入列：enable, case_id, name, user_id, group_name, input1, expected_tool_1, expected_args_1, reply_contains_1, reply_not_contains_1, judge_prompt_1, judge_threshold_1'
  ].join('\n');

  const genJson = await rawFetch(`${BASE}/case-service/generate-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opsLogin.data.token}`
    },
    body: JSON.stringify({
      mode: 'generate',
      module: 'voice_ticket',
      count: 1,
      groupName: '工单结构化专项',
      businessObjective: '只生成语音工单内容覆盖，不要决定分组。',
      schemaPrompt: editableContract,
      allowedTools: ['voice_ticket_structuring']
    })
  }).then((res) => res.json());

  assert.equal(genJson.code, '10000');
  const generated = genJson.data.preview[0];
  assert.equal(generated.groupName, '工单结构化专项');
  assert.match(generated.generationPrompt, /# 可编辑字段契约/);
  assert.match(generated.generationPrompt, /字段结构全项目统一/);
  assert.match(generated.generationPrompt, /# 锁定目标分组/);
  assert.match(generated.generationPrompt, /groupName 必须固定为：工单结构化专项/);
  assert.match(generated.generationPrompt, /业务覆盖目标只生成内容覆盖，不得改写分组/);
});

test('case CSV export and generated preview align to source admin flat assertion columns', async () => {
  const casesJson = await apiFetch('/cases').then((res) => res.json());
  const firstCase = casesJson.data[0];
  assert.equal(Object.hasOwn(firstCase.turns[0], 'expectedArgs'), true);
  assert.equal(Object.hasOwn(firstCase.turns[0], 'replyContains'), true);
  assert.equal(Object.hasOwn(firstCase.turns[0], 'replyNotContains'), true);
  assert.equal(Object.hasOwn(firstCase.turns[0], 'judgePrompt'), true);
  assert.equal(Object.hasOwn(firstCase.turns[0], 'judgeThreshold'), true);

  const exportText = await apiFetch('/cases/export').then((res) => res.text());
  const header = exportText.replace(/^\uFEFF/, '').split('\n')[0].replaceAll('"', '').split(',');
  assert.deepEqual(header.slice(0, 12), [
    'enable',
    'case_id',
    'name',
    'user_id',
    'group_name',
    'input1',
    'expected_tool_1',
    'expected_args_1',
    'reply_contains_1',
    'reply_not_contains_1',
    'judge_prompt_1',
    'judge_threshold_1'
  ]);
  assert.equal(header.at(-1), 'judge_threshold_3');

  const genJson = await fetch(`${BASE}/case-service/generate-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'generate',
      module: 'operation_data',
      count: 1,
      turnCount: 2,
      groupName: '断言字段验证',
      allowedTools: ['vehicle_operation_data_query'],
      businessObjective: '生成时必须保留原页面 CSV 断言字段。'
    })
  }).then((res) => res.json());

  assert.equal(genJson.code, '10000');
  assert.equal(Object.hasOwn(genJson.data.preview[0].turns[0], 'expectedArgs'), true);
  assert.equal(Object.hasOwn(genJson.data.preview[0].turns[0], 'replyContains'), true);
  assert.equal(Object.hasOwn(genJson.data.preview[0].turns[0], 'replyNotContains'), true);
  assert.equal(Object.hasOwn(genJson.data.preview[0].turns[0], 'judgePrompt'), true);
  assert.equal(Object.hasOwn(genJson.data.preview[0].turns[0], 'judgeThreshold'), true);
});

test('case CSV export uses the active project case schema', async () => {
  const vehicleCsv = await rawFetch(`${BASE}/cases/export`, { headers: { 'X-Project-Id': VEHICLE_AGENT_PROJECT } }).then((res) => res.text());
  const voiceCsv = await rawFetch(`${BASE}/cases/export`, { headers: { 'X-Project-Id': VOICE_TICKET_PROJECT } }).then((res) => res.text());

  assert.match(vehicleCsv.split('\n')[0], /input1/);
  assert.match(vehicleCsv.split('\n')[0], /expected_tool_1/);
  assert.doesNotMatch(vehicleCsv.split('\n')[0], /dialogue_text/);
  assert.match(voiceCsv.split('\n')[0], /dialogue_text/);
  assert.match(voiceCsv.split('\n')[0], /expected_ticket_json/);
  assert.doesNotMatch(voiceCsv.split('\n')[0], /expected_tool_1/);
});

test('case CSV import maps rows through the active project schema', async () => {
  const csv = [
    'enable,case_id,name,group_name,dialogue_text,expected_ticket_json,expected_route,missing_fields,noise_tags,risk_level',
    'true,voice_import_001,CSV导入语音工单,CSV导入,"坐席：您好\\n用户：X6S5002 在青岛园区 A 区打不开门","{""ticketType"":""vehicle_fault"",""issueType"":""door_open_failure"",""vehicleId"":""X6S5002"",""location"":""青岛园区 A 区"",""routeQueue"":""vehicle_ops_queue"",""missingFields"":[""contactPhone""]}",vehicle_ops_queue,contactPhone,CSV导入|多轮补全,high'
  ].join('\n');
  const imported = await rawFetch(`${BASE}/cases/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv', 'X-Project-Id': VOICE_TICKET_PROJECT },
    body: csv
  }).then((res) => res.json());

  assert.equal(imported.code, '10000');
  assert.equal(imported.data.imported, 1);
  const casesJson = await rawFetch(`${BASE}/cases`, { headers: { 'X-Project-Id': VOICE_TICKET_PROJECT } }).then((res) => res.json());
  const importedCase = casesJson.data.find((item) => item.caseId === 'voice_import_001');
  assert.ok(importedCase);
  assert.equal(importedCase.caseType, 'voice_ticket_dialogue');
  assert.match(importedCase.payload.dialogueText, /X6S5002/);
  assert.equal(importedCase.payload.expectedTicket.vehicleId, 'X6S5002');
  assert.deepEqual(importedCase.payload.expectedTicket.missingFields, ['contactPhone']);
});

test('all project workbench APIs expose project-specific contracts', async () => {
  const voiceSchema = await rawFetch(`${BASE}/case-service/schema`, { headers: { 'X-Project-Id': VOICE_TICKET_PROJECT } }).then((res) => res.json());
  assert.equal(voiceSchema.data.caseType, 'voice_ticket_dialogue');
  assert.match(voiceSchema.data.defaultGenerationPrompt, /ASR|工单|语义测评/);
  assert.doesNotMatch(voiceSchema.data.defaultGenerationPrompt, /车辆控制专项|远程开门|鸣笛闪灯/);

  const voicePreview = await rawFetch(`${BASE}/case-service/generate-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-Id': VOICE_TICKET_PROJECT },
    body: JSON.stringify({ mode: 'generate', count: 1, groupName: '工单结构化', businessObjective: '覆盖 ASR 对话工单语义测评。' })
  }).then((res) => res.json());
  assert.equal(voicePreview.code, '10000');
  assert.equal(voicePreview.data.preview[0].caseType, 'voice_ticket_dialogue');
  assert.ok(voicePreview.data.preview[0].payload.dialogueText);
  assert.ok(voicePreview.data.preview[0].payload.expectedTicket);

  const voiceRuns = await rawFetch(`${BASE}/runs`, { headers: { 'X-Project-Id': VOICE_TICKET_PROJECT } }).then((res) => res.json());
  assert.ok(voiceRuns.data.length > 0);
  assert.ok(voiceRuns.data.every((run) => run.projectId === VOICE_TICKET_PROJECT));
  assert.ok(voiceRuns.data.some((run) => run.evaluationMode === 'semantic_ticket_structuring'));
  const voiceRunWithChecks = voiceRuns.data.find((run) => run.evaluationMode === 'semantic_ticket_structuring' && run.results?.[0]?.stageChecks);
  assert.ok(voiceRunWithChecks.results[0].stageChecks.some((item) => item.key === 'fieldAccuracy'));
  assert.equal(voiceRunWithChecks.results[0].stageChecks.some((item) => /SkillResult|工具调用|Agent/.test(`${item.label}${item.rule}${item.description}`)), false);

  const voiceMocks = await rawFetch(`${BASE}/mock-configs`, { headers: { 'X-Project-Id': VOICE_TICKET_PROJECT } }).then((res) => res.json());
  const vehicleMocks = await rawFetch(`${BASE}/mock-configs`, { headers: { 'X-Project-Id': VEHICLE_AGENT_PROJECT } }).then((res) => res.json());
  assert.ok(voiceMocks.data.every((item) => item.projectId === VOICE_TICKET_PROJECT));
  assert.ok(voiceMocks.data.every((item) => item.mockType === 'ticket_dialogue'));
  assert.ok(vehicleMocks.data.every((item) => item.projectId === VEHICLE_AGENT_PROJECT || item.projectId === 'shared'));

  const voicePromptKeys = await rawFetch(`${BASE}/prompt-keys`, { headers: { 'X-Project-Id': VOICE_TICKET_PROJECT } }).then((res) => res.json());
  const vehiclePromptKeys = await rawFetch(`${BASE}/prompt-keys`, { headers: { 'X-Project-Id': VEHICLE_AGENT_PROJECT } }).then((res) => res.json());
  assert.ok(voicePromptKeys.data.length > 0);
  assert.ok(voicePromptKeys.data.every((item) => item.projectId === VOICE_TICKET_PROJECT));
  assert.ok(vehiclePromptKeys.data.every((item) => item.projectId === VEHICLE_AGENT_PROJECT));
});

test('project workbench contract drives generate templates, evaluator rules, and version labels', async () => {
  const voiceContract = await rawFetch(`${BASE}/workbench-contract`, { headers: { 'X-Project-Id': VOICE_TICKET_PROJECT } }).then((res) => res.json());
  const vehicleContract = await rawFetch(`${BASE}/workbench-contract`, { headers: { 'X-Project-Id': VEHICLE_AGENT_PROJECT } }).then((res) => res.json());

  assert.equal(voiceContract.code, '10000');
  assert.equal(voiceContract.data.runLabels.primaryVersionLabel, '结构化 Prompt 版本');
  assert.equal(voiceContract.data.runLabels.datasetVersionLabel, '样本集版本');
  assert.equal(voiceContract.data.runLabels.ruleVersionLabel, '评测规则版本');
  assert.equal(vehicleContract.data.runLabels.primaryVersionLabel, 'Agent 版本');

  const voiceColumns = voiceContract.data.generateTemplate.columns;
  assert.deepEqual(voiceColumns.map((item) => item.key), [
    'enable',
    'case_id',
    'name',
    'group_name',
    'dialogue_text',
    'expected_ticket_json',
    'expected_route',
    'missing_fields',
    'noise_tags',
    'risk_level'
  ]);
  assert.ok(voiceColumns.some((item) => item.key === 'dialogue_text' && item.source === 'llm' && /ASR|对话/.test(item.prompt)));
  assert.ok(voiceColumns.some((item) => item.key === 'expected_ticket_json' && item.dependsOn?.includes('dialogue_text')));
  assert.equal(JSON.stringify(voiceColumns).includes('expected_tool_1'), false);

  const rules = voiceContract.data.evaluatorConfig.rules;
  assert.deepEqual(rules.map((item) => item.targetField), ['expectedTicket', 'missingFields', 'routeQueue', 'hallucination', 'dialogueGrounding']);
  assert.ok(rules.some((item) => item.method === 'llm_judge' && item.promptKey === 'voice-ticket-semantic-eval-prompt'));
  assert.ok(rules.some((item) => item.method === 'json_schema_match'));
});

test('cases and runs expose enhanced fields for case management and result analysis', async () => {
  const casesRes = await rawFetch(`${BASE}/cases`, { headers: { 'X-Project-Id': VEHICLE_AGENT_PROJECT } });
  const casesJson = await casesRes.json();
  const firstCase = casesJson.data[0];

  assert.equal(Object.hasOwn(firstCase, 'source'), true);
  assert.equal(Object.hasOwn(firstCase, 'riskLevel'), true);
  assert.equal(Object.hasOwn(firstCase, 'evalDimensions'), true);
  assert.equal(Array.isArray(firstCase.evalDimensions), true);

  const runRes = await rawFetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-Id': VEHICLE_AGENT_PROJECT },
    body: JSON.stringify({
      caseIds: [firstCase.id],
      name: 'Baseline run'
    })
  });
  const runJson = await runRes.json();
  const run = runJson.data;

  assert.equal(Object.hasOwn(run, 'versionInfo'), true);
  assert.equal(Object.hasOwn(run, 'metrics'), true);
  assert.equal(Object.hasOwn(run, 'funnel'), true);
  const result = run.results[0];
  assert.equal(Object.hasOwn(result, 'stageChecks'), true);
  assert.equal(Object.hasOwn(result, 'traceProfile'), true);
  assert.equal(Object.hasOwn(result, 'contractChecks'), true);
  assert.deepEqual(result.contractChecks.map((item) => item.key), ['route', 'input', 'skillResult', 'render']);
  assert.equal(Object.hasOwn(result, 'toolCalls'), true);
  assert.equal(Object.hasOwn(result, 'llmJudge'), true);
  assert.equal(Object.hasOwn(result, 'metrics'), true);
});

test('prompt keys match the source admin page prompt groups', async () => {
  const prompts = await fetch(`${BASE}/prompt-keys`).then((res) => res.json());
  const labels = prompts.data.map((item) => item.label);

  assert.deepEqual(labels, [
    '数据 Prompt（ReAct Agent）',
    '格式 Prompt — 运营报告',
    '格式 Prompt — 运营数据查询',
    '格式 Prompt — 基础人格',
    '格式 Prompt — 车辆查询结果',
    '格式 Prompt — 操作结果',
    '格式 Prompt — 错误渲染'
  ]);
});

test('prompt content mirrors the source data agent prompt', async () => {
  const prompts = await fetch(`${BASE}/prompt-keys`).then((res) => res.json());
  const dataPrompt = prompts.data.find((item) => item.label === '数据 Prompt（ReAct Agent）');
  const contentJson = await fetch(`${BASE}/prompt-content?key=${encodeURIComponent(dataPrompt.key)}`).then((res) =>
    res.json()
  );

  assert.equal(dataPrompt.key, 'operation-data-agent-prompt');
  assert.match(contentJson.data.content, /^# 角色/);
  assert.match(contentJson.data.content, /你是专业的无人配送车运营数据分析师/);
  assert.match(contentJson.data.content, /query_metrics/);
  assert.match(contentJson.data.content, /仅输出 JSON/);
});

test('runs page seeds a small set of realistic result-type examples', async () => {
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const seededRuns = runsJson.data.filter((run) => run.runId.startsWith('run_demo_'));

  const ordered = runsJson.data || [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = new Date(ordered[i].startedAt || 0).getTime();
    const b = new Date(ordered[i + 1].startedAt || 0).getTime();
    assert.equal(a >= b, true, 'runs should be sorted by latest startedAt first');
  }
  assert.deepEqual([...new Set(seededRuns.map((run) => run.runId))].sort(), [
    'run_demo_action_prompt',
    'run_demo_operation_report',
    'run_demo_query_direct'
  ]);
  assert.ok(seededRuns.every((run) => run.results.length <= 3), 'seeded runs should stay compact');

  for (const run of seededRuns) {
    assert.equal(run.results.length, run.totalCases, `${run.runId} should include all detail results`);
    assert.equal(run.caseIds.length, run.totalCases, `${run.runId} should include all case ids`);
  }

  const types = new Set(seededRuns.flatMap((run) => run.results.map((result) => result.traceProfile?.type)));
  for (const type of ['operation_data_report', 'action_result', 'multi_turn_prompt']) {
    assert.ok(types.has(type), `seeded examples should include ${type}`);
  }
});

test('seeded run examples expose realistic mock evaluation results', async () => {
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const topRuns = runsJson.data.filter((item) => item.runId.startsWith('run_demo_'));
  const results = topRuns.flatMap((run) => run.results || []);
  const text = JSON.stringify(results);

  assert.ok(results.length > 0);
  assert.ok(results.every((result) => result.traceProfile?.type), 'each result should have a resultType/no-skill profile');
  assert.ok(results.every((result) => Array.isArray(result.contractChecks)), 'each result should have contract checks');
  assert.equal(text.includes('"source":"local-demo"'), false);
  assert.match(text, /operation_data_report|action_result|multi_turn_prompt|no_skill_result/);
  assert.doesNotMatch(text, /行业领先|行业优秀|行业标杆|推测|可能受|天气|节假日|清明节/);
});

test('seeded run examples include realistic multi-turn context cases', async () => {
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const seededRuns = runsJson.data.filter((run) => run.runId.startsWith('run_demo_'));
  const multiTurnResults = seededRuns
    .flatMap((run) => run.results || [])
    .filter((result) => (result.turns || []).length >= 2);

  assert.ok(multiTurnResults.length >= 3, 'seeded demos should include at least three multi-turn cases');
  assert.ok(
    multiTurnResults.some((result) => result.turns.some((turn) => /那上海呢|再看|继续|确认/.test(turn.userInput))),
    'multi-turn demos should show follow-up utterances'
  );
  assert.ok(
    multiTurnResults.every((result) => result.executionSteps?.length === result.turns.length),
    'multi-turn demos should expose one execution step per turn'
  );
});

test('cases page exposes a compact typical set covering all major categories', async () => {
  const casesJson = await rawFetch(`${BASE}/cases`, { headers: { 'X-Project-Id': VEHICLE_AGENT_PROJECT } }).then((res) => res.json());
  const counts = {};
  for (const item of casesJson.data) counts[item.groupName || '默认分组'] = (counts[item.groupName || '默认分组'] || 0) + 1;

  assert.ok(casesJson.data.length >= 18, 'typical cases should cover enough scenarios for demo');
  assert.ok(casesJson.data.length <= 40, 'cases page should stay compact for Monday walkthrough');
  assert.ok(Object.keys(counts).length >= 8, 'typical cases should preserve major groups');
  assert.ok((counts['默认分组'] || 0) > 0);
  assert.ok((counts['车辆控制'] || 0) > 0);
  assert.ok((counts['运营数据查询'] || 0) > 0);
  assert.ok((counts['RAG防幻觉'] || 0) > 0);
  assert.ok(casesJson.data.some((item) => (item.turns || []).length >= 2), 'typical cases should include multi-turn examples');
});

test('local page preserves the existing static UI while architecture modules live separately', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  assert.equal(html.includes('<h1>Eval Console</h1>'), true);
  assert.equal(html.includes('id="project-switcher"'), true);
  assert.equal(html.includes('<div id="root"></div>'), false);
  assert.equal(html.includes('/admin/eval/assets/index-'), false);
});

test('frontend remains single-track static page without React mount artifacts', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  assert.equal(html.includes('id="auth-overlay"'), false);
  assert.equal(html.includes('id="auth-access-code"'), false);
  assert.equal(html.includes('evalAdminAccessToken'), false);
  assert.equal(html.includes('<div id="root"></div>'), false);
  assert.equal(html.includes('/admin/eval/assets/index-'), false);
  assert.equal(html.includes('id="project-switcher"'), true);
});

test('frontend provides workspace entry and project-specific home shell', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  assert.equal(html.includes('id="workspace-home"'), true);
  assert.equal(html.includes('id="workspace-project-grid"'), true);
  assert.equal(html.includes('项目控制台'), true);
  assert.equal(html.includes('车辆 Agent 评测'), true);
  assert.equal(html.includes('语音工单结构化评测'), true);
  assert.equal(html.includes('id="p-project-home"'), false);
  assert.equal(html.includes('id="project-home-title"'), false);
  assert.equal(html.includes('id="workspace-return"'), false);
  assert.equal(html.includes('openWorkspaceHome'), true);
  assert.equal(html.includes('enterWorkspaceProject'), true);
  assert.equal(html.includes('switchWorkspaceProject'), true);
  assert.equal(html.includes('返回工作台'), false);
  assert.match(html, /data-tab="workspace" onclick="openWorkspaceHome\(\)"/);
});

test('frontend cases table and CSV template can switch by project schema', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  assert.equal(html.includes('id="cases-head-row"'), true);
  assert.equal(html.includes('renderCasesTableHeader'), true);
  assert.equal(html.includes('renderVoiceTicketCases'), true);
  assert.equal(html.includes('dialogue_text'), true);
  assert.equal(html.includes('expected_ticket_json'), true);
});

test('frontend exposes evaluator page and schema-driven generate form hooks', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  assert.equal(html.includes('data-tab="evaluation"'), true);
  assert.equal(html.includes('id="p-evaluation"'), true);
  assert.equal(html.includes('id="eval-rules-tbody"'), true);
  assert.equal(html.includes('loadWorkbenchContract'), true);
  assert.equal(html.includes('renderGenerateTemplateFields'), true);
  assert.equal(html.includes('renderEvaluatorRules'), true);
  assert.equal(html.includes('结构化 Prompt 版本'), true);
});

test('run setup exposes selectable agent and dataset versions', async () => {
  const agentsJson = await fetch(`${BASE}/agent-versions`).then((res) => res.json());
  const datasetsJson = await fetch(`${BASE}/dataset-versions`).then((res) => res.json());

  assert.equal(agentsJson.code, '10000');
  assert.equal(datasetsJson.code, '10000');
  assert.ok(agentsJson.data.length >= 3, 'should expose multiple agent versions for comparison');
  assert.ok(datasetsJson.data.length >= 2, 'should expose selectable dataset versions');
  assert.equal(Object.hasOwn(agentsJson.data[0], 'version'), true);
  assert.equal(Object.hasOwn(datasetsJson.data[0], 'version'), true);
});

test('new runs preserve selected agent and dataset versions', async () => {
  const casesJson = await fetch(`${BASE}/cases`).then((res) => res.json());
  const firstCase = casesJson.data[0];

  const runJson = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caseIds: [firstCase.id],
      name: 'Agent version smoke run',
      agentVersion: 'agent-prompt-v2.6',
      datasetVersion: 'cases-regression-2026-04',
      modelVersion: 'gpt-4.1'
    })
  }).then((res) => res.json());

  assert.equal(runJson.code, '10000');
  assert.equal(runJson.data.versionInfo.agentVersion, 'agent-prompt-v2.6');
  assert.equal(runJson.data.versionInfo.datasetVersion, 'cases-regression-2026-04');
  assert.equal(runJson.data.versionInfo.modelVersion, 'gpt-4.1');
});

test('LLM generated cases keep target group and generation prompt details', async () => {
  const customPrompt = [
    '请基于运营数据查询能力生成评测用例。',
    '要求覆盖跨园区、异常时间窗、指标口径追问。',
    '每条用例必须包含可验证的期望工具和判断点。'
  ].join('\n');
  const genJson = await fetch(`${BASE}/case-service/generate-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'generate',
      module: 'operation_data',
      count: 2,
      groupName: '运营指标边界',
      objective: '覆盖跨园区运营指标查询',
      generationPrompt: customPrompt,
      boundaryTags: ['跨园区', '异常时间窗'],
      evalDimensions: ['intent', 'tool', 'params', 'responseQuality']
    })
  }).then((res) => res.json());

  assert.equal(genJson.code, '10000');
  assert.equal(genJson.data.preview.length, 2);
  assert.equal(genJson.data.preview[0].groupName, '运营指标边界');
  assert.equal(genJson.data.preview[0].generationPrompt, customPrompt);
  assert.match(genJson.data.preview[0].generationPrompt, /异常时间窗/);
  assert.deepEqual(genJson.data.preview[0].expectedTools, ['vehicle_operation_data_query']);
  assert.equal(genJson.data.preview[0].turns[0].expectedTool, 'vehicle_operation_data_query');
  assert.deepEqual(genJson.data.preview[0].evalDimensions, ['intent', 'tool', 'params', 'responseQuality']);
});

test('LLM generated cases can use a selected set of allowed tools', async () => {
  const genJson = await fetch(`${BASE}/case-service/generate-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'generate',
      module: 'vehicle_query',
      count: 3,
      groupName: '多工具混合生成',
      generationPrompt: '请在 allowedTools 中按业务需要选择 expectedTool，不要求所有用例都是同一个工具。',
      allowedTools: ['RAG', 'freeChat', 'open_door']
    })
  }).then((res) => res.json());

  assert.equal(genJson.code, '10000');
  const tools = genJson.data.preview.map((item) => item.turns[0].expectedTool);
  assert.deepEqual(tools, ['RAG', 'freeChat', 'open_door']);
  assert.deepEqual(genJson.data.preview[0].allowedTools, ['RAG', 'freeChat', 'open_door']);
});

test('LLM generated cases can allocate counts per expected function field', async () => {
  const genJson = await fetch(`${BASE}/case-service/generate-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'generate',
      groupName: '按函数数量生成',
      generationPrompt: '请按 toolCounts 给每个 expectedTool 生成指定数量的用例。',
      toolCounts: {
        RAG: 1,
        vehicle_operation_data_query: 2,
        open_door: 1
      }
    })
  }).then((res) => res.json());

  assert.equal(genJson.code, '10000');
  assert.equal(genJson.data.count, 4);
  const tools = genJson.data.preview.map((item) => item.turns[0].expectedTool);
  assert.deepEqual(tools, ['RAG', 'vehicle_operation_data_query', 'vehicle_operation_data_query', 'open_door']);
});

test('LLM generated cases can use one selected expectedTool for the whole batch', async () => {
  const genJson = await fetch(`${BASE}/case-service/generate-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'generate',
      count: 3,
      groupName: '单工具生成',
      generationPrompt: '请围绕 vehicle_control 生成 3 条真实问法。',
      allowedTools: ['vehicle_control']
    })
  }).then((res) => res.json());

  assert.equal(genJson.code, '10000');
  assert.equal(genJson.data.count, 3);
  assert.deepEqual(genJson.data.preview.map((item) => item.turns[0].expectedTool), [
    'vehicle_control',
    'vehicle_control',
    'vehicle_control'
  ]);
});



test('LLM generated mock user inputs read like real user utterances', async () => {
  const genJson = await fetch(`${BASE}/case-service/generate-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'generate',
      module: 'vehicle_query',
      count: 4,
      groupName: '真实问法生成',
      generationPrompt: '请生成像真实用户会说的话，不要暴露生成器说明。',
      allowedTools: ['vehicle_selective_query', 'vehicle_operation_data_query', 'RAG', 'open_door']
    })
  }).then((res) => res.json());

  assert.equal(genJson.code, '10000');
  const inputs = genJson.data.preview.map((item) => item.turns[0].userInput);
  for (const input of inputs) {
    assert.equal(input.includes('请说明筛选条件'), false);
    assert.equal(input.includes('请给出结构化说明'), false);
    assert.equal(/\(\d+\)$/.test(input), false);
  }
  assert.match(inputs.join('\n'), /附近|昨天|怎么开|售后/);
});

test('single-track frontend source keeps workspace header and run/generate controls', async () => {
  const source = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  for (const text of ['X-Project-Id', 'Mock 数据集', 'Agent 版本', 'LLM 评价', '生成预览与编辑', 'expected_tool_1']) {
    assert.equal(source.includes(text), true, `public/index.html should include ${text}`);
  }
});

test('run metrics keep total token data in API without requiring single-file detail rendering', async () => {
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const run = runsJson.data.find((item) => item.metrics?.tokenUsage);

  assert.ok(run);
  assert.equal(typeof run.metrics.tokenUsage.totalTokens, 'number');
  assert.equal(typeof run.metrics.tokenUsage.avgPerCase, 'number');
});

test('run funnel explains fixed evaluation stages separately from variable case steps', async () => {
  const runsJson = await rawFetch(`${BASE}/runs`, { headers: { 'X-Project-Id': VEHICLE_AGENT_PROJECT } }).then((res) => res.json());
  const run = runsJson.data.find((item) => item.evaluationMode === 'agent_tool_chain' && Array.isArray(item.funnel) && item.funnel.length);

  assert.ok(run, 'should have at least one run with funnel data');
  assert.deepEqual(run.funnel.map((stage) => stage.label), [
    'Case 通过率',
    '意图路由正确率',
    '输入契约命中率',
    'SkillResult 契约命中率',
    '渲染契约命中率'
  ]);

  for (const stage of run.funnel) {
    assert.equal(typeof stage.meaning, 'string');
    assert.equal(typeof stage.rule, 'string');
    assert.equal(typeof stage.dynamicStepNote, 'string');
    assert.equal(typeof stage.applicable, 'number');
    assert.equal(typeof stage.skipped, 'number');
    assert.equal(typeof stage.failed, 'number');
    assert.match(stage.meaning, /看|判断|确认|衡量|检查/);
    assert.match(stage.dynamicStepNote, /不代表.*固定|实际.*步骤|case.*步骤/i);
  }
});

test('run funnel uses verifiable SkillResult link checks instead of database correctness claims', async () => {
  const runsJson = await rawFetch(`${BASE}/runs`, { headers: { 'X-Project-Id': VEHICLE_AGENT_PROJECT } }).then((res) => res.json());
  const run = runsJson.data.find((item) => item.evaluationMode === 'agent_tool_chain' && Array.isArray(item.funnel) && item.funnel.length);
  const labels = run.funnel.map((stage) => stage.label);
  const text = JSON.stringify(run.funnel);

  for (const label of ['输入契约命中率', 'SkillResult 契约命中率', '渲染契约命中率']) {
    assert.ok(labels.includes(label), `funnel should include ${label}`);
  }

  assert.match(text, /不判断数据库结果是否真实正确/);
  assert.match(text, /case\.expectedTrace|默认契约/);
  assert.match(text, /用户明确说出的车辆、城市、日期、动作/);
  assert.match(text, /最终回复是否按 SkillResult/);
  assert.equal(labels.includes('参数提取'), false);
  assert.equal(labels.includes('回复质量'), false);
});

test('run result exposes middle-link contract checks based on current SkillResult JSON fields', async () => {
  const runsJson = await rawFetch(`${BASE}/runs`, { headers: { 'X-Project-Id': VEHICLE_AGENT_PROJECT } }).then((res) => res.json());
  const run = runsJson.data.find((item) => item.evaluationMode === 'agent_tool_chain' && item.results?.some((result) => result.contractChecks?.length));
  const result = run.results.find((item) => item.contractChecks?.length);
  const text = JSON.stringify(result.contractChecks);

  assert.deepEqual(result.contractChecks.map((item) => item.label), [
    '路由契约',
    '输入契约',
    'SkillResult 契约',
    '渲染契约'
  ]);
  assert.match(text, /actualTool|expectedTool/);
  assert.match(text, /resultType|data\.filter|data\.action|data\.scene|data\.sections|默认契约/);
  assert.match(text, /checkedFields/);
  assert.ok(result.contractChecks.every((item) => Array.isArray(item.checkedFields)));
  assert.match(text, /不判断数据库结果是否真实正确/);
});

test('run result classifies SkillResult by resultType templates', async () => {
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const run = runsJson.data.find((item) => item.results?.some((result) => result.traceProfile?.fields?.length));
  const result = run.results.find((item) => item.traceProfile?.fields?.includes('llmReplyText'))
    || run.results.find((item) => item.traceProfile?.fields?.length);
  const profile = result.traceProfile;

  assert.equal(typeof profile.type, 'string');
  assert.equal(Array.isArray(profile.fields), true);
  assert.ok(profile.fields.length > 0);
  assert.match(JSON.stringify(profile), /action_result|multi_turn_prompt|operation_data_report|no_skill_result|resultType/);
});

test('direct reply cases skip SkillResult checks instead of failing them', async () => {
  const caseJson = await fetch(`${BASE}/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caseId: 'direct_reply_no_skill',
      name: '直接回复无 SkillResult',
      userId: '900100000',
      enabled: true,
      groupName: '直接回复',
      turns: [{ turnIndex: 1, userInput: '先聊两句，不用查车', expectedTool: 'freeChat' }]
    })
  }).then((res) => res.json());

  const runJson = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseIds: [caseJson.data.id], name: 'No SkillResult run' })
  }).then((res) => res.json());

  const result = runJson.data.results[0];
  const skillCheck = result.contractChecks.find((item) => item.key === 'skillResult');
  assert.equal(result.turns[0].skillResultJson, '');
  assert.equal(skillCheck.applies, false);
  assert.match(skillCheck.summary, /无 SkillResult|未检查/);
});

test('run detail data distinguishes funnel stages from per-case variable steps', async () => {
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const run = runsJson.data.find((item) => item.results?.length && item.funnel?.length);

  assert.ok(run);
  assert.ok(run.funnel.every((stage) => /不代表.*固定|实际.*步骤|case.*步骤/i.test(stage.dynamicStepNote)));
  assert.ok(run.results.some((result) => Array.isArray(result.stageChecks)));
  assert.ok(run.results.some((result) => Array.isArray(result.contractChecks)));
});

test('backend is split into service modules for cases, runs, generation, mock configs, and projects', async () => {
  const [serverSource, casesSvc, runsSvc, generationSvc, mockSvc, projectsSvc, repo] = await Promise.all([
    readFile(new URL('../server.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/backend/services/cases.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/backend/services/runs.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/backend/services/generation.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/backend/services/mockConfigs.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/backend/services/projects.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/backend/repositories/demoRepository.js', import.meta.url), 'utf8')
  ]);

  assert.match(serverSource, /createCasesService/);
  assert.match(serverSource, /createRunsService/);
  assert.match(serverSource, /createGenerationService/);
  assert.match(serverSource, /createMockConfigsService/);
  assert.match(serverSource, /createProjectsService/);
  assert.match(casesSvc, /createCasesService/);
  assert.match(runsSvc, /createRunsService/);
  assert.match(generationSvc, /createGenerationService/);
  assert.match(mockSvc, /createMockConfigsService/);
  assert.match(projectsSvc, /createProjectsService/);
  assert.match(repo, /createDemoRepository/);
});

test('testsets can launch a run without manually selected case ids', async () => {
  const testsetsJson = await fetch(`${BASE}/testsets`).then((res) => res.json());

  assert.equal(testsetsJson.code, '10000');
  assert.ok(testsetsJson.data.length >= 3, 'should expose fake testsets for Monday demo');
  assert.ok(testsetsJson.data[0].caseCount > 0, 'testsets should include runnable case counts');

  const smokeSet = testsetsJson.data.find((item) => item.id === 'ts_smoke') || testsetsJson.data[0];
  const runJson = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testsetId: smokeSet.id,
      name: 'Testset launched run',
      agentVersion: 'agent-prompt-v2.6',
      datasetVersion: smokeSet.version
    })
  }).then((res) => res.json());

  assert.equal(runJson.code, '10000');
  assert.equal(runJson.data.testsetId, smokeSet.id);
  assert.equal(runJson.data.totalCases, smokeSet.caseCount);
  assert.equal(runJson.data.versionInfo.agentVersion, 'agent-prompt-v2.6');
  assert.equal(runJson.data.versionInfo.datasetVersion, smokeSet.version);
});

test('parallel React frontend track is removed', async () => {
  await assert.rejects(
    () => readFile(new URL('../src/frontend-react/src/App.jsx', import.meta.url), 'utf8'),
    /ENOENT/
  );
});

test('run case result data prioritizes diagnosis before raw execution evidence', async () => {
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const run = runsJson.data.find((item) => item.results?.some((result) => result.contractChecks?.length && result.turns?.length));
  const result = run.results.find((item) => item.contractChecks?.length && item.turns?.length);

  assert.ok(result);
  assert.equal(typeof result.failReason, 'string');
  assert.equal(Array.isArray(result.contractChecks), true);
  assert.equal(Array.isArray(result.turns), true);
});
