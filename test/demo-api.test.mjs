import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const PORT = 5199;
const BASE = `http://localhost:${PORT}/admin/eval/api`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let server;

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
    env: { ...process.env, PORT: String(PORT) },
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

test('cases and runs expose enhanced fields for case management and result analysis', async () => {
  const casesRes = await fetch(`${BASE}/cases`);
  const casesJson = await casesRes.json();
  const firstCase = casesJson.data[0];

  assert.equal(Object.hasOwn(firstCase, 'source'), true);
  assert.equal(Object.hasOwn(firstCase, 'riskLevel'), true);
  assert.equal(Object.hasOwn(firstCase, 'evalDimensions'), true);
  assert.equal(Array.isArray(firstCase.evalDimensions), true);

  const runRes = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  assert.deepEqual(
    runsJson.data.slice(0, 3).map((run) => run.runId),
    ['run_demo_operation_report', 'run_demo_action_prompt', 'run_demo_query_direct'],
    'demo runs should be the first rows visible on the Runs page'
  );
  assert.deepEqual(seededRuns.map((run) => run.runId), [
    'run_demo_operation_report',
    'run_demo_action_prompt',
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
  const casesJson = await fetch(`${BASE}/cases`).then((res) => res.json());
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

test('local page includes original comparison and guide controls', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    '使用说明',
    '对比基线',
    '对比模式',
    'SkillResult',
    'HintsInfo',
    '更新日志'
  ]) {
    assert.equal(html.includes(text), true, `clone should include original text: ${text}`);
  }
});

test('guide button sits in topbar and prompt behavior matches original source', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  assert.match(html, /<h1>Eval Console<\/h1>[\s\S]*使用说明[\s\S]*<\/div>\s*<div class="meta"/);
  assert.equal(html.includes('<details class="card"'), false);
  assert.equal(html.includes('id="guide-overlay"'), true);
  assert.equal(html.includes('selectPromptKey(_promptKeys[0].key)'), false);
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

test('local page includes run version setup, filtering, and funnel explanation controls', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    'Agent 版本筛选',
    '测试集版本',
    'Agent 版本',
    '目标分组',
    '生成用例 Prompt',
    'Run 总览',
    'Case 执行链路',
    '无 SkillResult 链路',
    '执行步骤时间线'
  ]) {
    assert.equal(html.includes(text), true, `page should include new workflow text: ${text}`);
  }
});

test('run detail overview hides average per-case token while case token tags remain', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  assert.equal(html.includes('<span>单 case Token</span>'), false);
  assert.equal(html.includes('Token \'+((r.metrics.tokenUsage&&r.metrics.tokenUsage.totalTokens)||0)'), true);
});

test('run funnel explains fixed evaluation stages separately from variable case steps', async () => {
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const run = runsJson.data.find((item) => Array.isArray(item.funnel) && item.funnel.length);

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
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const run = runsJson.data.find((item) => Array.isArray(item.funnel) && item.funnel.length);
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
  const runsJson = await fetch(`${BASE}/runs`).then((res) => res.json());
  const run = runsJson.data.find((item) => item.results?.some((result) => result.contractChecks?.length));
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
  const result = run.results.find((item) => item.traceProfile?.fields?.length);
  const profile = result.traceProfile;

  assert.equal(typeof profile.type, 'string');
  assert.equal(Array.isArray(profile.fields), true);
  assert.ok(profile.fields.includes('llmReplyText'));
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

test('local run detail copy distinguishes funnel stages from per-case variable steps', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    'Run 总览',
    '本 case 实际步骤数',
    '整体通过',
    '路由选对',
    '中间链路异常',
    'Case 执行链路',
    '平台按 4 个环节判断是否通过',
    '理解用户问题',
    '提取查询条件',
    '调用业务能力',
    '生成最终回复',
    '查看检查字段',
    '无 SkillResult 链路'
  ]) {
    assert.equal(html.includes(text), true, `run detail should clarify funnel/step relationship: ${text}`);
  }

  assert.equal(html.includes('本 case 实际链路'), false);
  assert.equal(html.includes('该类型默认字段'), false);
  assert.equal(html.includes('本 case 检查字段'), false);
  assert.equal(html.includes('Agent 链路漏斗'), false);
  assert.equal(html.includes('Run 级评测归因'), false);
  assert.equal(html.includes('阶段评测'), false);
  assert.equal(html.includes('SkillResult 结构正常率'), false);
  assert.equal(html.includes('这里不再把所有原则堆成漏斗'), false);
  assert.equal(html.includes('每个 case 按真实轮次生成步骤'), false);
  assert.equal(html.includes('按实际返回字段检查'), false);
});

test('run compare page explains what comparison checks and optimizes', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    '对比跑说明',
    '对比跑不是自动优化器',
    '检查同一个 case 在当前 Run 和基线 Run 之间发生了什么变化',
    'PASS/FAIL 是否变化',
    'actualTool 是否变化',
    'LLM 回复是否变化',
    'SkillResult 是否变化',
    'HintsInfo 是否变化',
    '适合优化 Prompt、路由规则、结果渲染和 Mock 配置',
    '不判断数据库数字是否真实正确'
  ]) {
    assert.equal(html.includes(text), true, `compare page should explain: ${text}`);
  }
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

test('runs page exposes a complete create-run entry point', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    '新建运行',
    '测试集',
    '运行配置',
    '选择测试集后自动使用该测试集下的用例'
  ]) {
    assert.equal(html.includes(text), true, `page should include closed-loop run creation text: ${text}`);
  }
});

test('LLM generation page copy uses one prefilled prompt and expected function fields', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    '目标分组',
    '选择已有分组',
    '自定义分组',
    '生成用例 Prompt',
    '请生成一批可直接入库的评测用例',
    'expectedTool',
    'expectedTools',
    '期望函数字段',
    '本次生成只使用一个 expectedTool',
    'return_app_native_router',
    'Case ID 前缀'
  ]) {
    assert.equal(html.includes(text), true, `LLM generation modal should clarify: ${text}`);
  }

  assert.equal(html.includes('工具预设'), false);
  assert.equal(html.includes('按预设推荐'), false);
  assert.equal(html.includes('全部工具'), false);
  assert.equal(html.includes('每个函数生成数量'), false);
  assert.equal(html.includes('lg-tool-count'), false);
  assert.equal(html.includes('生成 Prompt</label><select'), false);
  assert.equal(html.includes('能力域'), false);
  assert.equal(html.includes('id="lg-objective"'), false);
  assert.equal(html.includes('id="lg-group-custom"'), false);
  assert.equal(html.includes('id="lg-boundary"'), false);
  assert.equal(html.includes('生成约束/覆盖点'), false);
  assert.equal(html.includes('边界标签'), false);
  assert.equal(html.includes('测试目标</label>'), false);
  assert.equal(html.includes("document.getElementById('lg-prefix').value='llm-demo'"), true);
  assert.equal(html.includes("document.getElementById('lg-custom-group').value=''"), true);
});

test('LLM preview explains generated cases as runnable structured fields', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    '预览入库字段',
    'enable',
    'case_id',
    'name',
    'user_id',
    'group_name',
    'input1',
    'expected_tool_1',
    'input2',
    'expected_tool_2',
    'input3',
    'expected_tool_3',
    '生成依据 Prompt'
  ]) {
    assert.equal(html.includes(text), true, `preview should expose boss-readable field: ${text}`);
  }
  assert.equal(html.includes('入库后可直接运行：每条都映射到'), false);
  assert.equal(html.includes('allowedTools: <span'), false);
  assert.equal(html.includes('evalDimensions: <span'), false);
});

test('manual case modal follows import columns and explains optional tags on hover', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    'title="enable：是否启用该用例，关闭后不会进入运行范围"',
    'title="case_id：用例唯一标识，对应导入表的 case_id"',
    'title="name：用例名称，对应导入表的 name"',
    'title="user_id：执行用例时使用的用户 ID，对应导入表的 user_id"',
    'title="group_name：用例所属分组，对应导入表的 group_name"',
    'title="input1 / expected_tool_1：第 1 轮用户输入和期望函数字段"',
    'title="标签：可选备注，不属于导入表核心字段，用于人工筛选和说明"'
  ]) {
    assert.equal(html.includes(text), true, `case modal should expose tooltip: ${text}`);
  }

  assert.equal(html.includes('id="ce-source"'), false);
  assert.equal(html.includes('id="ce-dims"'), false);
  assert.equal(html.includes('id="ce-regression"'), false);
  assert.equal(html.includes('来源</label>'), false);
  assert.equal(html.includes('评测维度</label>'), false);
  assert.equal(html.includes('是否加入回归集'), false);
});

test('buttons receive hover explanations through a shared tooltip map', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    'BUTTON_TOOLTIP_MAP',
    "'预览':'根据当前 Prompt、分组和期望函数字段生成预览，不会入库'",
    "'生成并加入用例库':'把预览逻辑生成的用例写入 Cases 列表，默认启用'",
    "'新建运行':'从测试集、Agent 版本和 Mock 数据集开始配置一次评测'",
    "'+ 新建':'新增一个分组或轮次，具体取决于所在区域'",
    'applyButtonTooltips()'
  ]) {
    assert.equal(html.includes(text), true, `button tooltip support should include: ${text}`);
  }
});

test('run case details prioritize failure diagnosis before raw execution evidence', async () => {
  const html = await fetch(`http://localhost:${PORT}/admin/eval`).then((res) => res.text());

  for (const text of [
    '失败诊断',
    '优先处理环节',
    '证据分层',
    '链路判断',
    '逐轮明细',
    '技术 JSON'
  ]) {
    assert.equal(html.includes(text), true, `run case detail should include clearer diagnosis copy: ${text}`);
  }

  assert.match(html, /function buildCaseDiagnosis/);
});
