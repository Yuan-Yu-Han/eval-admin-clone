import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { ALL_AGENT_TOOLS, VEHICLE_AGENT_PROJECT, VOICE_TICKET_PROJECT, projectProfile, toolsForProjectId } from './src/backend/config/projectProfiles.js';
import { defaultProjectAccess } from './src/backend/config/projects.js';
import { createDemoRepository } from './src/backend/repositories/demoRepository.js';
import { createCasesService } from './src/backend/services/cases.js';
import { createGenerationService } from './src/backend/services/generation.js';
import { createMockConfigsService } from './src/backend/services/mockConfigs.js';
import { createProjectsService } from './src/backend/services/projects.js';
import { createRunsService } from './src/backend/services/runs.js';
import { createSqliteStateStore } from './src/backend/storage/sqliteStateStore.js';

const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || '127.0.0.1';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const DIST_DIR = path.join(__dirname, 'dist');
const CASES_JSON = path.join(__dirname, 'data', 'original-cases.json');
const RUNS_JSON = path.join(__dirname, 'data', 'original-runs.json');
const PROMPTS_JSON = path.join(__dirname, 'data', 'original-prompts.json');
const OK = '10000';
const DEMO_ACCESS_CODE = process.env.EVAL_DEMO_ACCESS_CODE || 'eval-demo-5178';
const AUTH_SECRET = process.env.EVAL_DEMO_AUTH_SECRET || DEMO_ACCESS_CODE;
const AUTH_TOKEN_TTL_MS = Number(process.env.EVAL_DEMO_AUTH_TTL_MS || 12 * 60 * 60 * 1000);
const DEFAULT_PROJECT_ACCESS = defaultProjectAccess(DEMO_ACCESS_CODE);
const CASE_SOURCES = ['manual', 'llm'];
const CASE_RISK_LEVELS = ['low', 'medium', 'high'];
const DEFAULT_EVAL_DIMENSIONS = ['intent', 'tool', 'params', 'responseQuality'];
const CASE_TURN_ASSERTION_FIELDS = [
  'expectedArgs',
  'replyContains',
  'replyNotContains',
  'judgePrompt',
  'judgeThreshold'
];
const CASE_IMPORT_COLUMNS = [
  'enable',
  'case_id',
  'name',
  'group_name',
  'tags',
  'user_id',
  'input1',
  'input2',
  'input3',
  'eval_type_1',
  'expected_arg_1',
  'judge_prompt_id_1',
  'eval_type_2',
  'expected_arg_2',
  'judge_prompt_id_2',
  'eval_type_3',
  'expected_arg_3',
  'judge_prompt_id_3'
];
const AGENT_VERSIONS = [
  { version: 'agent-prompt-v2.6', label: 'v2.6 / 当前候选', modelVersion: 'gpt-4.1', ragVersion: 'rag-index-2026-04-18', toolVersion: 'toolkit-1.9.0' },
  { version: 'agent-prompt-v2.5', label: 'v2.5 / 灰度版本', modelVersion: 'gpt-4.1-mini', ragVersion: 'rag-index-2026-04-15', toolVersion: 'toolkit-1.8.4' },
  { version: 'agent-prompt-v2.4', label: 'v2.4 / 线上基线', modelVersion: 'gpt-4.1-mini', ragVersion: 'rag-index-2026-04-15', toolVersion: 'toolkit-1.8.3' }
];
const DATASET_VERSIONS = [
  { version: 'cases-regression-2026-04', label: '回归集 2026-04', scope: 'regression' },
  { version: 'cases-full-current', label: '当前全部启用用例', scope: 'enabled' },
  { version: 'cases-filtered-current', label: '当前筛选/勾选快照', scope: 'selected' }
];
const FUNNEL_STAGE_DEFS = [
  {
    key: 'intent',
    label: '意图路由',
    meaning: '看 Agent 有没有把用户这句话理解成正确业务意图。',
    rule: '按每个 case 的真实轮次比较 expectedTool 与 actualTool，匹配率达到 80% 记为通过。',
    description: '判断每轮用户输入是否对应正确的期望函数，用 expectedTool 与 actualTool 的匹配作为近似信号。',
    dynamicStepNote: '这是固定评测阶段，不代表 case 有固定执行步骤；每个 case 实际步骤按 turns/executionSteps 生成。'
  },
  {
    key: 'functionInvocation',
    label: '能力调用',
    meaning: '看 Agent 选中的业务能力有没有真的进入执行链路。',
    rule: '每轮有 actualTool；如果需要后端能力，则应有 SkillResult 或明确的直接回复。',
    description: '检查业务能力是否被调用起来，而不是只停在路由判断。',
    dynamicStepNote: '这是固定评测阶段，不代表 case 有固定执行步骤；不同 function 的后续链路可以不同。'
  },
  {
    key: 'inputConditionRetention',
    label: '输入契约',
    meaning: '看用户明确说出的车辆、城市、日期、动作等条件，是否按 case.expectedTrace 或默认契约进入 SkillResult / 回复。',
    rule: '优先按 case.expectedTrace 精确检查；没有配置时只检查用户输入中可规则识别的显式条件；不判断数据库结果是否真实正确。',
    description: '检查输入条件是否被传入链路，例如车号、城市、日期词、动作词是否在结构化结果或回复中体现。',
    dynamicStepNote: '这是固定评测阶段，不代表 case 有固定执行步骤；没有可规则识别条件的 case 记为通过但不声称参数全对。'
  },
  {
    key: 'skillResultContract',
    label: 'SkillResult 契约',
    meaning: '看当前 function/resultType 对应的业务字段有没有命中，例如运营数据看 data.filter/data.sections，控制结果看 data.action。',
    rule: '优先按 case.expectedTrace 精确检查；没有配置时按线上已出现的 resultType 默认契约检查；不判断数据库结果是否真实正确。',
    description: '检查 SkillResult 是否符合当前能力的业务契约，而不是泛泛判断 JSON 结构。',
    dynamicStepNote: '这是固定评测阶段，不代表 case 有固定执行步骤；freeChat 等无 SkillResult 链路会按直接回复口径处理。'
  },
  {
    key: 'replyFaithfulness',
    label: '渲染契约',
    meaning: '看最终回复是否按 SkillResult 复述关键业务结果，没有把失败说成成功，也没有明显脱离结构化返回。',
    rule: '检查最终回复是否覆盖 SkillResult 的错误原因、动作、场景、运营报告章节等关键信息；不判断数据库结果是否真实正确。',
    description: '检查最终用户回复和 SkillResult 是否一致，重点防止渲染阶段改写含义。',
    dynamicStepNote: '这是固定评测阶段，不代表 case 有固定执行步骤；它评估的是渲染一致性，不是数据库正确性。'
  },
  {
    key: 'responseQuality',
    label: '回复质量',
    meaning: '衡量最终用户可见回复是否完整、可读、可复核。',
    rule: '按路由、输入契约、SkillResult 契约、渲染契约和回复完整度加权计算，综合分达到 70 记为通过。',
    description: '综合可检查链路与回复完整度形成最终质量分。',
    dynamicStepNote: '这是固定评测阶段，不代表 case 有固定执行步骤；实际步骤数仍以 case 详情时间线为准。'
  }
];
const LLM_MODULE_TOOL_MAP = {
  vehicle_control: { groupName: '车辆控制', tool: 'vehicle_control' },
  vehicle_query: { groupName: '默认分组', tool: 'vehicle_selective_query' },
  operation_data: { groupName: '运营数据查询', tool: 'vehicle_operation_data_query' },
  rag_guard: { groupName: 'RAG防幻觉', tool: 'RAG' },
  voice_ticket: { groupName: '工单结构化', tool: 'voice_ticket_structuring' },
  ticket_extract: { groupName: '工单字段抽取', tool: 'ticket_field_extract' },
  ticket_route: { groupName: '工单分类路由', tool: 'ticket_category_route' }
};

function projectAccessList() {
  if (!process.env.EVAL_DEMO_PROJECT_CODES) return DEFAULT_PROJECT_ACCESS;
  try {
    const parsed = JSON.parse(process.env.EVAL_DEMO_PROJECT_CODES);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // Fall back to defaults when env JSON is malformed.
  }
  return DEFAULT_PROJECT_ACCESS;
}

function normalizeProjectAccess(item) {
  const projects = Array.isArray(item.projects) && item.projects.length
    ? item.projects
    : [{ projectId: item.projectId || 'all', projectName: item.projectName || item.projectId || '项目空间', role: item.role || (item.projectId === 'all' ? 'admin' : 'member') }];
  const normalizedProjects = projects.map((project) => {
    const profile = projectProfile(project.projectId) || {};
    return {
      ...profile,
      ...project,
      projectId: project.projectId || profile.projectId || 'all',
      projectName: project.projectName || profile.projectName || project.projectId || '项目空间',
      role: project.role || profile.role || (project.projectId === 'all' ? 'admin' : 'member')
    };
  });
  const first = normalizedProjects[0] || { projectId: 'all', projectName: '管理员视角', role: 'admin' };
  return {
    code: String(item.code || ''),
    accountId: item.accountId || item.userId || first.projectId,
    accountName: item.accountName || item.userName || item.projectName || first.projectName,
    projects: normalizedProjects,
    projectId: first.projectId,
    projectName: first.projectName,
    role: first.role
  };
}

const PROJECT_ACCESS = projectAccessList().map(normalizeProjectAccess).filter((item) => item.code);

const CASE_GENERATION_SCHEMA = {
  schemaId: 'eval-case-v1',
  caseType: 'vehicle_agent_turns',
  requiredFields: ['caseId', 'name', 'groupName', 'allowedTools', 'turns', 'expectedTools', 'evalDimensions', 'riskLevel'],
  turnFields: ['userInput', 'expectedTool'],
  assertionFields: CASE_TURN_ASSERTION_FIELDS,
  importColumns: CASE_IMPORT_COLUMNS,
  evalDimensions: DEFAULT_EVAL_DIMENSIONS,
  riskLevels: CASE_RISK_LEVELS,
  schemaNotes: [
    '字段结构全项目统一：不同项目只改变业务目标、目标分组和允许工具，不改变 JSON 字段名。',
    'expectedTool 必须从 allowedTools 中选择。',
    'turns 最多 3 轮，每轮必须兼容原页面 CSV 断言列：expectedArgs、replyContains、replyNotContains、judgePrompt、judgeThreshold。',
    '输出只能是 JSON 数组，不要输出 Markdown、解释文字或生成器痕迹。'
  ]
};

const VOICE_TICKET_CASE_SCHEMA = {
  schemaId: 'voice-ticket-dialogue-v1',
  caseType: 'voice_ticket_dialogue',
  requiredFields: ['caseId', 'name', 'groupName', 'dialogueText', 'expectedTicket', 'noiseTags', 'riskLevel'],
  turnFields: [],
  assertionFields: ['expectedTicket', 'missingFields', 'routeQueue', 'mustExtract', 'mustNotInvent', 'mustUseLatestValue', 'mustIgnoreAgentHypothesis'],
  importColumns: ['enable', 'case_id', 'name', 'group_name', 'dialogue_text', 'expected_ticket_json', 'expected_route', 'missing_fields', 'noise_tags', 'risk_level'],
  evalDimensions: ['fieldAccuracy', 'missingFieldDetection', 'routeAccuracy', 'noHallucination', 'dialogueGrounding'],
  riskLevels: CASE_RISK_LEVELS,
  schemaNotes: [
    '输入是一段完整 ASR 对话文本，不拆成 Agent 工具调用 turns。',
    '输出必须是可创建工单的 expectedTicket JSON，缺失信息放入 missingFields，禁止编造。',
    '需要处理多轮补全、改口纠错、坐席假设干扰、ASR 噪声和多问题混杂。',
    'routeQueue、ticketType、issueType 等字段按工单业务路由评测，不使用车辆 Agent expectedTool 断言。'
  ]
};

const PROJECT_DEFAULT_GENERATION_PROMPTS = {
  [VEHICLE_AGENT_PROJECT]: [
    '车辆 Agent 评测覆盖目标：',
    '1. 生成用户指令、多轮追问和期望工具调用，覆盖车辆查询、车辆控制、开门、运营数据和 RAG。',
    '2. 每条 case 必须明确 expectedTool、关键参数和回复断言。',
    '3. 重点评测工具路由、参数抽取、SkillResult 契约和最终回复质量。'
  ].join('\n'),
  [VOICE_TICKET_PROJECT]: [
    'ASR 对话工单结构化语义测评覆盖目标：',
    '1. 输入是一整段坐席/用户 ASR 对话大文本，输出是 expectedTicket 工单 JSON。',
    '2. 覆盖多轮补全、改口纠错、坐席假设干扰、缺失字段识别、禁止编造和路由队列判断。',
    '3. 不评测工具调用；只评测 AI 输出的工单语义结构、字段准确性、缺失字段和语义依据。'
  ].join('\n')
};

let cachedHtml = '';
let nextId = 1000;
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${nextId++}`;

const originalCaseSeed = JSON.parse(readFileSync(CASES_JSON, 'utf8'));
const seedCases = buildTypicalCases(originalCaseSeed).map((item) => normalizeCase(item));
let cases = [];
const promptSeed = JSON.parse(readFileSync(PROMPTS_JSON, 'utf8'));

const mockConfigs = [
  {
    configId: 'mock_default',
    name: '默认 Mock 数据集',
    projectId: VEHICLE_AGENT_PROJECT,
    mockType: 'vehicle_api',
    userLatitude: 36.292,
    userLongitude: 120.369,
    vehicles: [
      {
        values: {
          vinid: 'X6S5001',
          vin: 'NEO-A001',
          licenseplate: '鲁B00001',
          cabincode: 'A',
          status: 'AVAILABLE',
          operationstatus: 'OFFICIAL',
          poweron: 'true',
          gear: 'P',
          networkstatus: '5G',
          gpsstatus: 'LOCATED',
          speed: '0',
          battery: '91',
          frontbattery: '88',
          usebattery: '2',
          remainingbatteryrange: '194',
          range: '194',
          latitude: '36.2934',
          longitude: '120.3695',
          personvehicledistance: '45',
          grid: 'G01',
          address: '青岛园区 A 区',
          shortaddress: 'A 区',
          parkname: '青岛园区',
          parkcode: 'PK-QD',
          opendoorresult: 'SUCCESS',
          failreason: '',
          hasmission: 'false',
          missionname: '',
          missionstatus: '',
          missioneta: '',
          missiondistance: '',
          electronicpowersteering: 'NORMAL',
          cargopowersupply: 'ON',
          cameraocclusion: 'NORMAL'
        }
      },
      {
        values: {
          vinid: 'X6S5002',
          vin: 'NEO-A002',
          licenseplate: '鲁B00002',
          cabincode: 'B',
          status: 'IN_MISSION',
          operationstatus: 'TRIAL',
          poweron: 'true',
          gear: 'D',
          networkstatus: '4G',
          gpsstatus: 'LOCATED',
          speed: '12',
          battery: '63',
          frontbattery: '60',
          usebattery: '4',
          remainingbatteryrange: '120',
          range: '120',
          latitude: '36.2941',
          longitude: '120.3701',
          personvehicledistance: '90',
          grid: 'G02',
          address: '青岛园区 B 区',
          shortaddress: 'B 区',
          parkname: '青岛园区',
          parkcode: 'PK-QD',
          opendoorresult: 'SUCCESS',
          failreason: '',
          hasmission: 'true',
          missionname: '配送任务',
          missionstatus: 'RUNNING',
          missioneta: '15',
          missiondistance: '1300',
          electronicpowersteering: 'NORMAL',
          cargopowersupply: 'ON',
          cameraocclusion: 'NORMAL'
        }
      }
    ]
  },
  {
    configId: 'mock_voice_ticket_default',
    name: '语音工单语义样本集',
    projectId: VOICE_TICKET_PROJECT,
    mockType: 'ticket_dialogue',
    userLatitude: 0,
    userLongitude: 0,
    vehicles: []
  }
];

const promptKeys = promptSeed.keys;
const promptContent = promptSeed.content;
const vehiclePromptKeys = promptKeys.map((item) => ({ ...item, projectId: VEHICLE_AGENT_PROJECT }));
const voicePromptKeys = [
  {
    key: 'voice-ticket-structuring-prompt',
    label: '语音工单结构化 Prompt',
    category: 'data',
    description: '从 ASR 多轮对话文本输出工单 JSON',
    projectId: VOICE_TICKET_PROJECT
  },
  {
    key: 'voice-ticket-semantic-eval-prompt',
    label: '语音工单语义测评 Prompt',
    category: 'format',
    description: '评估工单字段准确性、缺失字段、路由队列和幻觉风险',
    projectId: VOICE_TICKET_PROJECT
  }
];
const voicePromptContent = {
  'voice-ticket-structuring-prompt': [
    '# 角色',
    '你是语音工单结构化评测的样本生成与抽取助手。',
    '',
    '# 输入',
    '输入是一整段 ASR 转写后的坐席/用户多轮对话文本，可能包含打断、改口、噪声词、坐席假设和缺失信息。',
    '',
    '# 输出',
    '仅输出可创建工单的 JSON，包括 ticketType、issueType、summary、vehicleId、location、contactPhone、priority、routeQueue、missingFields、evidenceTurns。',
    '不要编造对话里没有的信息；无法确认的字段写入 missingFields，并在 evidenceTurns 中标注依据。'
  ].join('\n'),
  'voice-ticket-semantic-eval-prompt': [
    '# 评测目标',
    '对 ASR 对话文本转工单结构化结果做语义测评。',
    '',
    '# 检查项',
    '1. 工单类型、问题类型、车辆/地点/联系人等字段是否符合原始对话。',
    '2. 对话缺失的信息是否进入 missingFields，没有被模型臆造。',
    '3. routeQueue 是否与问题类别和紧急程度一致。',
    '4. 坐席假设、用户改口、ASR 噪声是否被正确忽略或纠正。',
    '',
    '# 输出',
    '输出 pass、score、missingFieldErrors、hallucinationErrors、routeErrors、evidence。'
  ].join('\n')
};

const originalRunSeed = JSON.parse(readFileSync(RUNS_JSON, 'utf8'));
const seedRuns = buildSeedRuns(originalRunSeed);
seedRuns.push(buildVoiceTicketSeedRun());
seedRuns.forEach((run) => enrichRun(run));
let runs = [];
const PROJECT_STORAGE_IDS = [VEHICLE_AGENT_PROJECT, VOICE_TICKET_PROJECT];
const seedCasesByProject = Object.fromEntries(PROJECT_STORAGE_IDS.map((projectId) => [projectId, seedCases.filter((item) => normalizeCase(item).projectId === projectId)]));
const seedRunsByProject = Object.fromEntries(PROJECT_STORAGE_IDS.map((projectId) => [projectId, seedRuns.filter((item) => normalizeRunProject(item).projectId === projectId)]));

const stateStore = await createSqliteStateStore({
  projectIds: PROJECT_STORAGE_IDS,
  seedCasesByProject,
  seedRunsByProject
});

cases = (await stateStore.loadCases()).map((item) => normalizeCase(item));
runs = (await stateStore.loadRuns()).map((item) => enrichRun(item));

async function persistCasesState() {
  await stateStore.saveCases(cases);
}

async function persistRunsState() {
  await stateStore.saveRuns(runs);
}

function pseudoRand(seedText) {
  let hash = 2166136261;
  const text = String(seedText || 'seed');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function findSeedResult(seedRuns, predicate) {
  for (const run of seedRuns) {
    for (const result of run.results || []) {
      if (predicate(result, run)) return cloneJson(result);
    }
  }
  return null;
}

function parsedTurnSkill(turn) {
  try {
    return JSON.parse(turn?.skillResultJson || 'null');
  } catch {
    return null;
  }
}

function makeSeedRun({ id: seedId, runId, name, env = 'local-demo', results, startedAt, versionInfo }) {
  const passedCases = results.filter((item) => item.pass).length;
  const durationMs = results.reduce((sum, item) => sum + (item.durationMs || 0), 0);
  return {
    id: seedId,
    runId,
    name,
    status: 'COMPLETED',
    env,
    mockConfigId: 'realistic_demo',
    mockConfigName: '真实字段示例',
    totalCases: results.length,
    completedCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    startedAt: startedAt || now(),
    finishedAt: startedAt || now(),
    durationMs,
    caseIds: results.map((item) => item.caseId),
    comments: [],
    versionInfo: versionInfo || {
      datasetVersion: 'cases-realistic-demo-2026-04',
      agentVersion: 'agent-prompt-v2.6',
      modelVersion: 'gpt-4.1',
      ragVersion: 'rag-index-2026-04-18',
      toolVersion: 'toolkit-1.9.0',
      serviceCommit: 'commit-real-demo'
    },
    results
  };
}

function makeManualResult({ caseId, caseName, userInput, expectedTool, actualTool, pass, skillResult, reply, durationMs = 1200 }) {
  const toolOk = expectedTool === actualTool;
  return {
    caseId,
    caseName,
    userId: '900100000',
    sessionId: `seed-${caseId}`,
    pass,
    failReason: pass ? '' : 'actualTool 与 expectedTool 不一致',
    toolMatchSummary: `${toolOk ? 1 : 0}/1`,
    durationMs,
    reviewFlagged: false,
    comments: [],
    turns: [
      {
        turnIndex: 1,
        userInput,
        llmReplyText: reply,
        expectedTool,
        actualTool,
        toolOk,
        hintsJson: JSON.stringify({ source: 'realistic-seed', checkedBy: 'resultType-template' }),
        skillResultJson: skillResult ? JSON.stringify(skillResult) : ''
      }
    ]
  };
}

function makeManualMultiTurnResult({ caseId, caseName, pass = true, turns, durationMs = 2400 }) {
  const toolOkCount = turns.filter((turn) => (turn.expectedTool || '') === (turn.actualTool || '')).length;
  const normalizedTurns = turns.map((turn, index) => ({
    turnIndex: index + 1,
    userInput: turn.userInput,
    llmReplyText: turn.reply,
    expectedTool: turn.expectedTool,
    actualTool: turn.actualTool,
    toolOk: (turn.expectedTool || '') === (turn.actualTool || ''),
    hintsJson: JSON.stringify({ source: 'realistic-seed', checkedBy: 'curated-demo' }),
    skillResultJson: turn.skillResult ? JSON.stringify(turn.skillResult) : '',
    expectedTrace: turn.expectedTrace
  }));
  return {
    caseId,
    caseName,
    userId: '900100000',
    sessionId: `seed-${caseId}`,
    pass,
    failReason: pass ? '' : '多轮上下文或路由结果不符合预期',
    toolMatchSummary: `${toolOkCount}/${turns.length}`,
    durationMs,
    reviewFlagged: !pass,
    comments: [],
    turns: normalizedTurns
  };
}

function operationReportResult({ city, queryDate, title, items, analysis = [] }) {
  return {
    skill: 'vehicle_operation_data_query',
    success: true,
    resultType: 'operation_data_report',
    data: {
      filter: { queryDate, city },
      mode: 'simple',
      sections: [
        {
          id: 'answer',
          title,
          type: 'kv',
          analysis: analysis.length ? [{ title: '数据说明', points: analysis }] : [],
          items
        }
      ],
      dataSource: 'mock.city_operation_daily'
    }
  };
}

function buildSeedRuns() {
  const operationResults = [
    makeManualMultiTurnResult({
      caseId: 'demo_multi_operation_001',
      caseName: '多轮追问：城市和指标继承',
      durationMs: 3620,
      turns: [
        {
          userInput: '青岛昨天运营情况怎么样',
          expectedTool: 'vehicle_operation_data_query',
          actualTool: 'vehicle_operation_data_query',
          skillResult: operationReportResult({
            city: '青岛',
            queryDate: '2026-04-15',
            title: '青岛昨日运营概览',
            items: [
              { label: '运营车辆数', value: '128', unit: '辆' },
              { label: '有效任务数', value: '1,024', unit: '单' },
              { label: 'AD里程占比', value: '91.2%', unit: '' },
              { label: '平均速度', value: '16.8', unit: 'km/h' }
            ],
            analysis: ['本次回复只展示 mock 日报表中已有字段，不补充外部原因判断。']
          }),
          reply: '青岛昨日运营概览：运营车辆数 128 辆，有效任务数 1,024 单，AD里程占比 91.2%，平均速度 16.8km/h。',
          expectedTrace: {
            inputFields: [
              { path: 'data.filter.city', equals: '青岛' },
              { path: 'data.filter.queryDate', equals: '2026-04-15' }
            ]
          }
        },
        {
          userInput: '那上海呢',
          expectedTool: 'vehicle_operation_data_query',
          actualTool: 'vehicle_operation_data_query',
          skillResult: operationReportResult({
            city: '上海',
            queryDate: '2026-04-15',
            title: '上海昨日运营概览',
            items: [
              { label: '运营车辆数', value: '96', unit: '辆' },
              { label: '有效任务数', value: '812', unit: '单' },
              { label: 'AD里程占比', value: '89.7%', unit: '' },
              { label: '平均速度', value: '15.9', unit: 'km/h' }
            ]
          }),
          reply: '上海昨日运营概览：运营车辆数 96 辆，有效任务数 812 单，AD里程占比 89.7%，平均速度 15.9km/h。',
          expectedTrace: {
            inputFields: [
              { path: 'data.filter.city', equals: '上海' },
              { path: 'data.filter.queryDate', equals: '2026-04-15' }
            ]
          }
        },
        {
          userInput: '再看空驶率',
          expectedTool: 'vehicle_operation_data_query',
          actualTool: 'vehicle_operation_data_query',
          skillResult: operationReportResult({
            city: '上海',
            queryDate: '2026-04-15',
            title: '上海昨日空驶率',
            items: [
              { label: '空驶率', value: '18.4%', unit: '' },
              { label: '空驶里程', value: '214.6', unit: 'km' }
            ]
          }),
          reply: '继续沿用上海和昨日这个上下文：上海昨日空驶率 18.4%，空驶里程 214.6km。',
          expectedTrace: {
            inputFields: [
              { path: 'data.filter.city', equals: '上海' },
              { path: 'data.filter.queryDate', equals: '2026-04-15' }
            ]
          }
        }
      ]
    }),
    makeManualResult({
      caseId: 'demo_operation_002',
      caseName: '单轮查询：全国昨日核心指标',
      userInput: '全国昨天订单量和车辆数',
      expectedTool: 'vehicle_operation_data_query',
      actualTool: 'vehicle_operation_data_query',
      pass: true,
      skillResult: operationReportResult({
        city: '全国',
        queryDate: '2026-04-15',
        title: '全国昨日核心指标',
        items: [
          { label: '运营车辆数', value: '642', unit: '辆' },
          { label: '有效任务数', value: '5,438', unit: '单' }
        ]
      }),
      reply: '全国昨日核心指标：运营车辆数 642 辆，有效任务数 5,438 单。',
      durationMs: 1280
    })
  ];

  const actionAndPromptResults = [
    makeManualMultiTurnResult({
      caseId: 'demo_multi_control_001',
      caseName: '多轮操作：高风险动作二次确认',
      durationMs: 2840,
      turns: [
        {
          userInput: '打开 X6S5002 的后舱门',
          expectedTool: 'open_door',
          actualTool: 'open_door',
          skillResult: {
            skill: 'open_door',
            success: true,
            resultType: 'multi_turn_prompt',
            data: {
              scene: 'vehicle_door_confirm',
              llmMessage: '将为 X6S5002 打开后舱门，请确认是否执行。'
            }
          },
          reply: '将为 X6S5002 打开后舱门，请确认是否执行。'
        },
        {
          userInput: '确认执行',
          expectedTool: 'open_door',
          actualTool: 'open_door',
          skillResult: {
            skill: 'open_door',
            success: true,
            resultType: 'action_result',
            data: {
              action: '打开后舱门',
              total: 1,
              successCount: 1,
              successPlates: ['X6S5002']
            }
          },
          reply: '已为 X6S5002 打开后舱门。'
        }
      ]
    }),
    makeManualMultiTurnResult({
      caseId: 'demo_multi_name_001',
      caseName: '多轮设置：改名确认',
      durationMs: 1960,
      turns: [
        {
          userInput: '以后叫你小慧吧',
          expectedTool: 'update_user_agent_name',
          actualTool: 'update_user_agent_name',
          skillResult: {
            skill: 'update_user_agent_name',
            success: true,
            resultType: 'multi_turn_prompt',
            data: {
              scene: 'agent_name_workflow',
              llmMessage: '你是想把我的名字改成小慧吗？'
            }
          },
          reply: '你是想把我的名字改成小慧吗？'
        },
        {
          userInput: '确认，就叫小慧',
          expectedTool: 'update_user_agent_name',
          actualTool: 'update_user_agent_name',
          skillResult: {
            skill: 'update_user_agent_name',
            success: true,
            resultType: 'action_result',
            data: {
              action: '更新助手名称',
              total: 1,
              successCount: 1,
              successPlates: ['小慧']
            }
          },
          reply: '已确认，后续我会使用“小慧”这个名字。'
        }
      ]
    }),
    makeManualResult({
      caseId: 'demo_action_fail_001',
      caseName: '失败样例：车辆控制误路由到查询',
      userInput: 'X6S5002把声音调大',
      expectedTool: 'vehicle_control',
      actualTool: 'vehicle_selective_query',
      pass: false,
      skillResult: {
        skill: 'vehicle_control',
        success: false,
        resultType: 'action_result',
        data: {
          errorCode: 'ROUTE_MISMATCH',
          errorLabel: '路由到车辆查询，未执行音量控制'
        }
      },
      reply: '已找到车辆 X6S5002，但本轮没有执行调高音量动作。',
      durationMs: 1420
    })
  ];

  const queryResults = [
    makeManualResult({
      caseId: 'demo_query_001',
      caseName: '车辆查询：按车号返回状态',
      userInput: '查一下 X6S5002 现在状态',
      expectedTool: 'vehicle_selective_query',
      actualTool: 'vehicle_selective_query',
      pass: true,
      skillResult: {
        skill: 'vehicle_selective_query',
        success: true,
        resultType: 'query_result',
        data: {
          matchedVehicles: [
            { vinid: 'X6S5002', licenseplate: '鲁B00002', status: 'IN_MISSION', battery: '63%' }
          ]
        }
      },
      reply: 'X6S5002 当前状态为任务中，车牌鲁B00002，电量 63%。',
      durationMs: 860
    }),
    makeManualResult({
      caseId: 'demo_direct_001',
      caseName: '直接回复：解释评测结果',
      userInput: '不用查车，解释一下 PASS 是什么意思',
      expectedTool: 'freeChat',
      actualTool: 'freeChat',
      pass: true,
      skillResult: null,
      reply: 'PASS 表示这个 case 的路由、参数传递、业务返回和最终回复都满足当前评测规则。',
      durationMs: 690
    })
  ];

  return [
    makeSeedRun({
      id: 'seed_run_operation_report',
      runId: 'run_demo_operation_report',
      name: '示例｜运营数据报告链路',
      startedAt: '2026-04-16T15:36:27.000Z',
      results: operationResults
    }),
    makeSeedRun({
      id: 'seed_run_action_prompt',
      runId: 'run_demo_action_prompt',
      name: '示例｜操作结果与多轮追问',
      startedAt: '2026-04-19T22:34:20.000Z',
      results: actionAndPromptResults
    }),
    makeSeedRun({
      id: 'seed_run_query_direct',
      runId: 'run_demo_query_direct',
      name: '示例｜查询结果与直接回复',
      startedAt: '2026-04-16T13:25:13.000Z',
      results: queryResults
    })
  ].filter((run) => run.results.length);
}

function buildVoiceTicketSeedRun() {
  const results = [
    makeManualResult({
      caseId: 'voice_ticket_structuring_001',
      caseName: '语音工单｜车辆无法开门派单',
      userInput: '坐席：您好，请问有什么问题？ 用户：客户现场反馈车打不开门。 坐席：是哪辆车？ 用户：X6S5002，在青岛园区 A 区，电话 13800001111。',
      expectedTool: 'voice_ticket_structuring',
      actualTool: 'voice_ticket_structuring',
      pass: true,
      skillResult: {
        resultType: 'ticket_structuring',
        ticket: {
          ticketType: 'vehicle_fault',
          issueType: 'door_open_failure',
          vehicleId: 'X6S5002',
          location: '青岛园区 A 区',
          contactPhone: '13800001111',
          routeQueue: 'vehicle_ops_queue',
          missingFields: []
        }
      },
      reply: '已结构化为车辆故障工单，派发到 vehicle_ops_queue。',
      durationMs: 1280
    }),
    makeManualResult({
      caseId: 'voice_ticket_field_extract_001',
      caseName: '语音工单｜低电量字段抽取',
      userInput: '坐席：请描述一下问题。 用户：车快没电了，X6S5001 还在园区外面，最好尽快处理。',
      expectedTool: 'ticket_field_extract',
      actualTool: 'ticket_field_extract',
      pass: true,
      skillResult: {
        resultType: 'ticket_structuring',
        ticket: {
          ticketType: 'vehicle_fault',
          issueType: 'low_battery',
          vehicleId: 'X6S5001',
          priority: 'high',
          routeQueue: 'vehicle_ops_queue',
          missingFields: ['contactPhone']
        }
      },
      reply: '已抽取车辆、问题和优先级，联系方式缺失。',
      durationMs: 1120
    })
  ];
  return makeSeedRun({
    id: 'seed_run_voice_ticket_semantic',
    runId: 'run_demo_voice_ticket_semantic',
    name: '示例｜语音工单语义测评',
    env: 'voice-ticket-demo',
    startedAt: '2026-04-20T09:20:00.000Z',
    results
  });
}

function demoCaseDoc({ caseId, name, groupName, projectId = '', userId = '900100000', turns, tags = '典型,多轮' }) {
  return {
    id: `case_${caseId}`,
    caseId,
    name,
    projectId,
    userId,
    enabled: true,
    groupName,
    source: 'manual',
    tags,
    allowedTools: [...new Set((turns || []).map((turn) => turn.expectedTool).filter(Boolean))],
    turns: (turns || []).map((turn, index) => ({
      turnIndex: index + 1,
      userInput: turn.userInput,
      expectedTool: turn.expectedTool || '',
      expectedArgs: turn.expectedArgs ?? '',
      replyContains: listValue(turn.replyContains),
      replyNotContains: listValue(turn.replyNotContains),
      judgePrompt: turn.judgePrompt || '',
      judgeThreshold: turn.judgeThreshold ?? '',
      expectedTrace: turn.expectedTrace || {}
    })),
    evalDimensions: DEFAULT_EVAL_DIMENSIONS,
    regression: true,
    regressionCandidate: false,
    regressionAudit: [],
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z'
  };
}

function buildTypicalCases(seedCases) {
  const manualTypical = [
    demoCaseDoc({
      caseId: 'voice_ticket_structuring_001',
      name: '语音工单｜车辆无法开门派单',
      groupName: '工单结构化',
      projectId: VOICE_TICKET_PROJECT,
      turns: [
        {
          userInput: '语音转写：客户说青岛市南区 A001 车辆昨晚无法开门，现场等了十分钟，需要今天上午派人处理，电话 13800000000',
          expectedTool: 'voice_ticket_structuring',
          expectedArgs: { ticketType: '车辆故障', priority: 'high', location: '青岛市南区', vehicleId: 'A001' },
          replyContains: ['车辆故障', '青岛市南区', 'A001'],
          judgePrompt: '检查是否把语音文本结构化为可派单工单，并保留车辆、地点、故障和联系方式。',
          judgeThreshold: 0.8
        }
      ]
    }),
    demoCaseDoc({
      caseId: 'voice_ticket_field_extract_001',
      name: '语音工单｜低电量字段抽取',
      groupName: '工单字段抽取',
      projectId: VOICE_TICKET_PROJECT,
      turns: [
        {
          userInput: '用户来电说 X6S5002 低电量停在深圳宝安园区，要求今天下午前处理，联系电话 13900001111',
          expectedTool: 'ticket_field_extract',
          expectedArgs: { vehicleId: 'X6S5002', issue: '低电量', location: '深圳宝安园区', deadline: '今天下午前' },
          replyContains: ['X6S5002', '低电量', '深圳宝安园区'],
          judgePrompt: '检查结构化字段是否覆盖车辆编号、问题类型、地点、处理时限和联系电话。',
          judgeThreshold: 0.8
        }
      ]
    }),
    demoCaseDoc({
      caseId: 'voice_ticket_route_001',
      name: '语音工单｜投诉升级分类',
      groupName: '工单分类路由',
      projectId: VOICE_TICKET_PROJECT,
      turns: [
        {
          userInput: '客户投诉车辆绕路导致配送延误，要求售后回访并升级处理，语气很着急',
          expectedTool: 'ticket_category_route',
          expectedArgs: { category: '投诉升级', priority: 'high', routeTo: '售后回访' },
          replyContains: ['投诉', '升级', '回访'],
          judgePrompt: '检查是否识别投诉升级场景，并给出正确分类、优先级和处理队列。',
          judgeThreshold: 0.75
        }
      ]
    }),
    demoCaseDoc({
      caseId: 'typical_multi_operation_city_metric',
      name: '典型多轮｜运营数据城市与指标继承',
      groupName: '运营数据查询',
      projectId: VEHICLE_AGENT_PROJECT,
      turns: [
        { userInput: '青岛昨天运营情况怎么样', expectedTool: 'vehicle_operation_data_query' },
        { userInput: '那上海呢', expectedTool: 'vehicle_operation_data_query' },
        { userInput: '再看空驶率', expectedTool: 'vehicle_operation_data_query' }
      ]
    }),
    demoCaseDoc({
      caseId: 'typical_multi_open_door_confirm',
      name: '典型多轮｜开门前二次确认',
      groupName: '开门场景',
      projectId: VEHICLE_AGENT_PROJECT,
      turns: [
        { userInput: '打开 X6S5002 的后舱门', expectedTool: 'open_door' },
        { userInput: '确认执行', expectedTool: 'open_door' }
      ]
    }),
    demoCaseDoc({
      caseId: 'typical_multi_agent_name_confirm',
      name: '典型多轮｜助手改名确认',
      groupName: '默认分组',
      projectId: VEHICLE_AGENT_PROJECT,
      turns: [
        { userInput: '以后叫你小慧吧', expectedTool: 'update_user_agent_name' },
        { userInput: '确认，就叫小慧', expectedTool: 'update_user_agent_name' }
      ]
    })
  ];
  const preferredByGroup = {
    运营数据: '0326_t1_vod_017',
    车控场景: 't1_door_025',
    unsupported_test: 'T5_Unsup_40',
    RAG防幻觉: 'b_rag_070',
    车辆控制: 'c1_query_240',
    运营数据查询: 'cd_perm_op_speed_001',
    默认分组: 't4_interact_024',
    开门场景: 't1_door_001',
    订单: 't1_query_006',
    车速: 't1_query_019',
    '运营&车辆在线': 't1_query_027',
    里程: 't1_query_048',
    '异常任务 & 路口通行指标': 't1_query_060',
    装卸货: 't1_query_075',
    '偏差 & ETA': 't1_query_102',
    停靠相关指标: 't1_query_109',
    车辆相关指标: 't1_query_114',
    '调度 & 空驶': 't1_query_132',
    权限测试: 't4_perm_001',
    车控复合意图: 'vc_full_019'
  };
  const byCaseId = new Map(seedCases.map((item) => [item.caseId, item]));
  const groups = [...new Set(seedCases.map((item) => item.groupName || '默认分组'))];
  const picked = [...manualTypical];
  const usedIds = new Set(picked.map((item) => item.caseId));
  groups.forEach((groupName) => {
    const preferred = byCaseId.get(preferredByGroup[groupName]);
    const fallback = seedCases.find((item) => (item.groupName || '默认分组') === groupName);
    const selected = preferred || fallback;
    if (!selected || usedIds.has(selected.caseId)) return;
    usedIds.add(selected.caseId);
    picked.push({
      ...selected,
      tags: selected.tags || '典型',
      regression: selected.regression ?? true,
      enabled: selected.enabled !== false
    });
  });
  return picked.slice(0, 32);
}

function normalizeCase(item) {
  const source = CASE_SOURCES.includes(item.source) ? item.source : 'manual';
  const riskLevel = CASE_RISK_LEVELS.includes(item.riskLevel) ? item.riskLevel : 'medium';
  const evalDimensions = Array.isArray(item.evalDimensions) && item.evalDimensions.length
    ? item.evalDimensions
    : DEFAULT_EVAL_DIMENSIONS;
  const audit = Array.isArray(item.regressionAudit) ? item.regressionAudit : [];
  const expectedTools = Array.isArray(item.expectedTools)
    ? item.expectedTools
    : (item.turns || []).map((turn) => turn.expectedTool).filter(Boolean);
  const turns = (Array.isArray(item.turns) ? item.turns : []).map((turn, idx) => normalizeCaseTurn(turn, idx));
  const projectId = item.projectId || inferProjectId(item.groupName, expectedTools);
  const caseType = item.caseType || (projectId === VOICE_TICKET_PROJECT ? 'voice_ticket_dialogue' : 'vehicle_agent_turns');
  const payload = normalizeCasePayload({ item, projectId, caseType, turns, expectedTools });
  return {
    ...item,
    projectId,
    caseType,
    payload,
    source,
    riskLevel,
    evalDimensions,
    regression: Boolean(item.regression),
    regressionCandidate: Boolean(item.regressionCandidate),
    regressionAudit: audit,
    turns,
    expectedTools,
    updatedAt: item.updatedAt || now()
  };
}

function normalizeCasePayload({ item, projectId, caseType, turns, expectedTools }) {
  const existing = item.payload && typeof item.payload === 'object' ? item.payload : {};
  if (caseType === 'voice_ticket_dialogue' || projectId === VOICE_TICKET_PROJECT) {
    const dialogueText = String(
      existing.dialogueText
      || item.dialogueText
      || turns.map((turn, idx) => `用户${idx + 1}：${turn.userInput || ''}`).filter((line) => line.trim()).join('\n')
      || ''
    );
    const expectedTicket = existing.expectedTicket && typeof existing.expectedTicket === 'object'
      ? existing.expectedTicket
      : (item.expectedTicket && typeof item.expectedTicket === 'object' ? item.expectedTicket : deriveVoiceTicketFromCase(item, turns));
    const noiseTags = Array.isArray(existing.noiseTags)
      ? existing.noiseTags
      : listValue(item.noiseTags || item.tags);
    return {
      ...existing,
      dialogueText,
      expectedTicket,
      assertions: existing.assertions || item.assertions || {},
      noiseTags
    };
  }
  return {
    ...existing,
    turns,
    allowedTools: Array.isArray(item.allowedTools) ? item.allowedTools : expectedTools,
    expectedTools
  };
}

function deriveVoiceTicketFromCase(item, turns) {
  const haystack = `${item.name || ''}\n${item.groupName || ''}\n${turns.map((turn) => `${turn.userInput || ''}\n${turn.expectedArgs || ''}`).join('\n')}`;
  const vehicle = /X[0-9A-Z]{2,8}/i.exec(haystack);
  const location = /(青岛园区\s*[A-ZＡ-Ｚ一二三四五六七八九十]*\s*区?|济南仓库?|上海园区|北京园区)/.exec(haystack);
  const isRoute = /分类|路由/.test(haystack);
  const isExtract = /字段|抽取/.test(haystack);
  return {
    ticketType: isRoute ? 'ticket_routing' : (isExtract ? 'field_extraction' : 'vehicle_fault'),
    issueType: /开门|打不开|门/.test(haystack) ? 'door_open_failure' : (isRoute ? 'category_route' : 'voice_ticket_structuring'),
    vehicleId: vehicle ? vehicle[0].toUpperCase() : null,
    location: location ? location[0].replace(/\s+/g, ' ') : null,
    priority: /急|现场等|投诉|升级/.test(haystack) ? 'urgent' : 'normal',
    routeQueue: isRoute ? 'ticket_dispatch_queue' : 'vehicle_ops_queue',
    missingFields: [
      vehicle ? '' : 'vehicleId',
      /1[3-9]\d{9}/.test(haystack) ? '' : 'contactPhone'
    ].filter(Boolean)
  };
}

function listValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(/[|,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCaseTurn(turn = {}, idx = 0) {
  return {
    ...turn,
    turnIndex: Number(turn.turnIndex || idx + 1),
    userInput: turn.userInput || '',
    expectedTool: turn.expectedTool || '',
    expectedArgs: turn.expectedArgs ?? '',
    replyContains: listValue(turn.replyContains),
    replyNotContains: listValue(turn.replyNotContains),
    judgePrompt: turn.judgePrompt || '',
    judgeThreshold: turn.judgeThreshold ?? ''
  };
}

function inferProjectId(groupName = '', expectedTools = []) {
  const group = String(groupName || '');
  const tools = expectedTools.map((tool) => String(tool || ''));
  if (tools.some((tool) => ['voice_ticket_structuring', 'ticket_field_extract', 'ticket_category_route'].includes(tool)) || /工单|语音|结构化|字段抽取|分类路由|报修|投诉|派单|回访/.test(group)) {
    return VOICE_TICKET_PROJECT;
  }
  if (tools.includes('vehicle_operation_data_query') || /运营|订单|车速|里程|停靠|调度|空驶|装卸|偏差|ETA|指标/.test(group)) {
    return VEHICLE_AGENT_PROJECT;
  }
  if (tools.some((tool) => ['open_door', 'vehicle_control', 'return_app_native_router', 'vehicle_selective_query', 'update_user_agent_name'].includes(tool)) || /车控|车辆控制|开门|权限|复合意图|车辆|默认分组/.test(group)) {
    return VEHICLE_AGENT_PROJECT;
  }
  return VEHICLE_AGENT_PROJECT;
}

function pushRegressionAudit(item, action, actor = 'manual-ui', extra = {}) {
  const next = normalizeCase(item);
  const entry = {
    id: id('audit'),
    action,
    actor,
    at: now(),
    ...extra
  };
  next.regressionAudit = [...(next.regressionAudit || []), entry];
  return next;
}

function asJsonText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function estimateTokenUsage(text) {
  if (!text) return 0;
  return Math.max(16, Math.round(String(text).length / 3.7));
}

function parseSkillResult(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractInputSignals(text) {
  const input = String(text || '');
  const signals = [];
  const vehicleMatches = input.match(/X6S\d+/gi) || [];
  vehicleMatches.forEach((value) => signals.push({ type: 'vehicle', value: value.toUpperCase() }));

  ['全国', '北京', '上海', '广州', '深圳', '杭州', '成都', '青岛', '潍坊', '临沂'].forEach((city) => {
    if (input.includes(city)) signals.push({ type: 'city', value: city });
  });

  ['今天', '昨天', '前天', '上周', '最近一周', '最近7天', '这个月', '上个月'].forEach((dateWord) => {
    if (input.includes(dateWord)) signals.push({ type: 'date', value: dateWord });
  });

  const actionRules = [
    { value: 'volume_up', input: /(声音|音量).*(调大|调高|大点|高点)|(调大|调高).*(声音|音量)/, output: /(调高音量|调大音量|音量.*高|声音.*大)/ },
    { value: 'volume_down', input: /(声音|音量).*(调小|调低|小点|低点)|(调小|调低).*(声音|音量)/, output: /(调低音量|调小音量|音量.*低|声音.*小)/ },
    { value: 'open_door', input: /(开门|开.*柜门|打开.*门)/, output: /(开门|打开.*门|柜门)/ },
    { value: 'honk', input: /(鸣笛|叫两声|响一下|叫一下)/, output: /(鸣笛|叫两声|响一下|叫一下)/ },
    { value: 'flash_light', input: /(双闪|闪灯|闪一下)/, output: /(双闪|闪灯|闪一下)/ }
  ];
  actionRules.forEach((rule) => {
    if (rule.input.test(input)) signals.push({ type: 'action', value: rule.value, output: rule.output });
  });

  return signals;
}

function inputSignalField(signal) {
  if (signal.type === 'vehicle') return `userInput.vehicle:${signal.value}`;
  if (signal.type === 'city') return `userInput.city:${signal.value}`;
  if (signal.type === 'date') return `userInput.date:${signal.value} -> data.filter.queryDate`;
  if (signal.type === 'action') return `userInput.action:${signal.value} -> data.action/reply`;
  return `userInput.${signal.type || 'value'}:${signal.value || ''}`;
}

function checkInputConditionRetention(turn) {
  const signals = extractInputSignals(turn.userInput);
  if (!signals.length) return { pass: true, checked: 0, matched: 0 };
  const parsed = parseSkillResult(turn.skillResultJson);
  const haystack = `${turn.skillResultJson || ''}\n${turn.llmReplyText || ''}`.toUpperCase();
  const matched = signals.filter((signal) => {
    if (signal.type === 'action') {
      return signal.output.test(`${turn.skillResultJson || ''}\n${turn.llmReplyText || ''}`);
    }
    if (signal.type === 'date') {
      return Boolean(parsed?.data?.filter?.queryDate)
        || /(QUERYDATE|日期|20\d{2}-\d{2}-\d{2}|\d{1,2}月\d{1,2}日)/i.test(`${turn.skillResultJson || ''}\n${turn.llmReplyText || ''}`);
    }
    return haystack.includes(String(signal.value).toUpperCase());
  }).length;
  return { pass: matched === signals.length, checked: signals.length, matched };
}

function checkSkillResultStructure(turn) {
  if (!turn.skillResultJson && (turn.actualTool === 'freeChat' || !turn.actualTool)) {
    return { pass: true, skipped: true };
  }
  const parsed = parseSkillResult(turn.skillResultJson);
  if (!parsed) return { pass: false, skipped: false };
  const hasCoreShape = typeof parsed.skill === 'string'
    && Object.hasOwn(parsed, 'success')
    && typeof parsed.resultType === 'string'
    && Object.hasOwn(parsed, 'data');
  return { pass: hasCoreShape, skipped: false };
}

function checkReplyFaithfulness(turn) {
  const parsed = parseSkillResult(turn.skillResultJson);
  const reply = String(turn.llmReplyText || '');
  if (!reply.trim()) return false;
  if (!parsed) return reply.trim().length >= 8;
  const dataText = asJsonText(parsed.data);
  if (parsed.success === false) {
    const label = parsed.data?.errorLabel || parsed.data?.errorCode || '';
    return label ? reply.includes(label) || dataText.includes(label) : !/(已成功|成功完成)/.test(reply);
  }
  if (parsed.resultType === 'action_result' && parsed.data?.action) {
    return reply.includes(parsed.data.action) || dataText.includes(parsed.data.action);
  }
  return reply.trim().length >= 8;
}

function valueAtPath(obj, pathValue) {
  if (!obj || !pathValue) return undefined;
  return String(pathValue).split('.').reduce((cur, part) => {
    if (cur == null) return undefined;
    return cur[part];
  }, obj);
}

function valueAtPathFlexible(obj, pathValue) {
  if (!obj || !pathValue) return undefined;
  const tokens = String(pathValue).split('.').filter(Boolean);
  let nodes = [obj];
  for (const token of tokens) {
    const options = token.split('/').filter(Boolean);
    const keys = options.length ? options : [token];
    const next = [];
    nodes.forEach((node) => {
      keys.forEach((rawKey) => {
        const isArray = /\[\]$/.test(rawKey);
        const key = isArray ? rawKey.slice(0, -2) : rawKey;
        const value = key ? (node && typeof node === 'object' ? node[key] : undefined) : node;
        if (value === undefined || value === null) return;
        if (isArray) {
          if (Array.isArray(value)) value.forEach((item) => next.push(item));
        } else {
          next.push(value);
        }
      });
    });
    nodes = next;
    if (!nodes.length) break;
  }
  if (!nodes.length) return undefined;
  return nodes.length === 1 ? nodes[0] : nodes;
}

function normalizeExpectedTrace(turn, result) {
  const caseTrace = result.caseMeta?.expectedTrace || result.expectedTrace || {};
  const turnTrace = turn.expectedTrace || {};
  return { ...caseTrace, ...turnTrace };
}

function matchExpectedField(parsed, spec) {
  const pathValue = spec.path || spec.field;
  const actual = valueAtPath(parsed, pathValue);
  const op = spec.op || (Object.hasOwn(spec, 'equals') ? 'equals' : 'exists');
  if (op === 'exists') return actual !== undefined && actual !== null && actual !== '';
  if (op === 'equals') return String(actual) === String(spec.equals);
  if (op === 'contains') return String(actual ?? '').includes(String(spec.contains));
  if (op === 'includesAny') {
    const text = asJsonText(actual);
    return (spec.values || []).some((value) => text.includes(String(value)));
  }
  return false;
}

function defaultSkillContract(turn, parsed) {
  if (!turn.skillResultJson) {
    return { applies: false, fields: [], notes: ['该链路没有 SkillResult，不检查 SkillResult 契约'] };
  }
  if (!parsed) return { applies: true, fields: [], notes: ['SkillResult JSON 存在但不可解析'] };
  const tool = parsed.skill || turn.actualTool || turn.expectedTool || '';
  const resultType = parsed.resultType || '';
  const fields = [
    { path: 'skill', op: 'exists' },
    { path: 'success', op: 'exists' },
    { path: 'resultType', op: 'exists' },
    { path: 'data', op: 'exists' }
  ];
  const notes = ['默认契约来自线上已出现过的 SkillResult JSON 字段'];

  if (tool === 'vehicle_operation_data_query' || ['operation_data_report', 'operation_data_query'].includes(resultType)) {
    fields.push(
      { path: 'data.filter', op: 'exists' },
      { path: 'data.filter.queryDate', op: 'exists' },
      { path: 'data.filter.city', op: 'exists' },
      { path: 'data.mode', op: 'exists' },
      { path: 'data.sections', op: 'exists' }
    );
    notes.push('运营数据默认看 data.filter / data.mode / data.sections；不判断数据库数字是否真实正确');
  } else if (tool === 'update_user_agent_name' || resultType === 'multi_turn_prompt') {
    fields.push({ path: 'data.scene', op: 'exists' }, { path: 'data.llmMessage', op: 'exists' });
    notes.push('多轮追问默认看 data.scene / data.llmMessage');
  } else if (['vehicle_control', 'open_door'].includes(tool) || resultType === 'action_result') {
    if (parsed.success === false) {
      fields.push({ path: 'data.errorCode', op: 'exists' }, { path: 'data.errorLabel', op: 'exists' });
      notes.push('操作失败默认看 data.errorCode / data.errorLabel');
    } else {
      fields.push({ path: 'data.action', op: 'exists' });
      if (parsed.data && Object.hasOwn(parsed.data, 'successCount')) fields.push({ path: 'data.successCount', op: 'exists' });
      if (parsed.data && Object.hasOwn(parsed.data, 'successPlates')) fields.push({ path: 'data.successPlates', op: 'exists' });
      notes.push('操作成功默认看 data.action / data.successCount / data.successPlates');
    }
  } else if (tool === 'vehicle_selective_query' || resultType === 'query_result') {
    fields.push({ path: 'data', op: 'exists' });
    notes.push('车辆查询默认看 query_result 的 data 载荷，具体车辆 ID 需要 case.expectedTrace 配置');
  } else if (tool === 'start_collect_merchant_location') {
    fields.push({ path: 'data.errorCode', op: 'exists' });
    notes.push('点位采集默认看权限/错误码或后续采集状态');
  }

  return { applies: true, fields, notes };
}

function firstParsedSkillResult(result) {
  for (const turn of result.turns || []) {
    const parsed = parseSkillResult(turn.skillResultJson);
    if (parsed) return { parsed, turn };
  }
  return { parsed: null, turn: (result.turns || [])[0] || null };
}

function traceProfileFor(result) {
  const { parsed, turn } = firstParsedSkillResult(result);
  if (!parsed) {
    return {
      type: 'no_skill_result',
      title: '无 SkillResult 链路',
      resultType: '',
      skill: turn?.actualTool || turn?.expectedTool || '',
      fields: ['turn.llmReplyText'],
      note: '本 case 没有 skillResultJson，只检查路由和最终回复。'
    };
  }
  const resultType = parsed.resultType || 'unknown';
  const skill = parsed.skill || turn?.actualTool || '';
  if (resultType === 'action_result') {
    const fields = parsed.success === false
      ? ['skill', 'success', 'resultType', 'data.errorCode', 'data.errorLabel', 'llmReplyText']
      : ['skill', 'success', 'resultType', 'data.action', 'data.successCount', 'data.successPlates', 'llmReplyText'];
    return {
      type: 'action_result',
      title: '操作结果链路',
      resultType,
      skill,
      fields,
      note: '检查动作、成功车辆/数量或错误原因，并确认最终回复没有把成功/失败说反。'
    };
  }
  if (resultType === 'multi_turn_prompt') {
    return {
      type: 'multi_turn_prompt',
      title: '多轮追问链路',
      resultType,
      skill,
      fields: ['skill', 'success', 'resultType', 'data.scene', 'data.llmMessage', 'llmReplyText'],
      note: '检查多轮场景和追问话术，确认回复沿用 llmMessage 的意思。'
    };
  }
  if (['operation_data_report', 'operation_data_query'].includes(resultType)) {
    return {
      type: resultType,
      title: '运营数据报告链路',
      resultType,
      skill,
      fields: [
        'skill',
        'success',
        'resultType',
        'data.filter.queryDate',
        'data.filter.city',
        'data.mode',
        'data.sections[].id',
        'data.sections[].title',
        'data.sections[].type',
        'data.sections[].analysis',
        'data.sections[].items/groups',
        'data.dataSource',
        'llmReplyText'
      ],
      note: '检查日期/城市是否传入、报告结构是否可渲染、回复是否复述报告内容；不判断数据库数字真伪。'
    };
  }
  return {
    type: resultType,
    title: '其他 SkillResult 链路',
    resultType,
    skill,
    fields: ['skill', 'success', 'resultType', 'data', 'llmReplyText'],
    note: '当前 resultType 未配置专属模板，按通用 SkillResult 字段检查。'
  };
}

function buildRouteContract(result) {
  const turns = result.turns || [];
  const applicable = turns.length > 0;
  const passed = turns.filter((turn) => (turn.expectedTool || '') === (turn.actualTool || '')).length;
  const total = turns.length || 1;
  return {
    key: 'route',
    label: '路由契约',
    applies: applicable,
    pass: applicable ? passed === turns.length : true,
    score: Math.round((passed / total) * 100),
    summary: `expectedTool 与 actualTool 命中 ${passed}/${turns.length || 0}`,
    checkedFields: ['case.turns[].expectedTool', 'run.results[].turns[].actualTool'],
    evidence: '检查字段：expectedTool、actualTool。这里判断 Agent 是否选对业务能力。'
  };
}

function buildInputContract(result) {
  const turns = result.turns || [];
  let checked = 0;
  let matched = 0;
  const expectedNotes = [];
  const checkedFields = [];
  turns.forEach((turn) => {
    const trace = normalizeExpectedTrace(turn, result);
    const expectedFields = Array.isArray(trace.inputFields) ? trace.inputFields : [];
    const parsed = parseSkillResult(turn.skillResultJson);
    expectedFields.forEach((field) => {
      checked++;
      if (matchExpectedField(parsed, field)) matched++;
      const fieldName = field.path || field.field;
      expectedNotes.push(fieldName);
      checkedFields.push(`case.expectedTrace.inputFields.${fieldName}`);
    });
    if (!expectedFields.length) {
      const inputCheck = checkInputConditionRetention(turn);
      checked += inputCheck.checked || 0;
      matched += inputCheck.matched || 0;
      extractInputSignals(turn.userInput).forEach((signal) => checkedFields.push(inputSignalField(signal)));
    }
  });
  const applies = checked > 0;
  return {
    key: 'input',
    label: '输入契约',
    applies,
    pass: applies ? matched === checked : true,
    score: applies ? Math.round((matched / Math.max(1, checked)) * 100) : 100,
    summary: applies
      ? `用户显式条件命中 ${matched}/${checked}`
      : '本 case 没有配置 expectedTrace.inputFields，也没有识别出车号/城市/日期/动作等显式条件',
    checkedFields: [...new Set(checkedFields)],
    evidence: expectedNotes.length
      ? `按 case.expectedTrace 检查：${expectedNotes.join('、')}`
      : '默认契约检查用户输入中的车辆、城市、日期、动作是否出现在 SkillResult 或最终回复；不判断数据库结果是否真实正确。'
  };
}

function buildSkillResultContract(result) {
  const turns = result.turns || [];
  let checked = 0;
  let matched = 0;
  const evidence = [];
  const checkedFields = [];
  turns.forEach((turn) => {
    const parsed = parseSkillResult(turn.skillResultJson);
    const trace = normalizeExpectedTrace(turn, result);
    const explicitFields = Array.isArray(trace.skillResultFields) ? trace.skillResultFields : [];
    const contract = explicitFields.length
      ? { applies: true, fields: explicitFields, notes: ['按 case.expectedTrace.skillResultFields 精确检查'] }
      : defaultSkillContract(turn, parsed);
    if (!contract.applies) {
      evidence.push(...contract.notes);
      return;
    }
    if (!parsed) {
      checked++;
      evidence.push('SkillResult 不可解析或缺失');
      checkedFields.push('turn.skillResultJson');
      return;
    }
    contract.fields.forEach((field) => {
      checked++;
      if (matchExpectedField(parsed, field)) matched++;
      checkedFields.push(field.path || field.field || 'skillResult');
    });
    evidence.push(...contract.notes);
    evidence.push(`resultType=${parsed.resultType || '-'}，skill=${parsed.skill || turn.actualTool || '-'}`);
  });
  const applies = checked > 0;
  return {
    key: 'skillResult',
    label: 'SkillResult 契约',
    applies,
    pass: applies ? matched === checked : true,
    score: applies ? Math.round((matched / Math.max(1, checked)) * 100) : 100,
    summary: applies ? `业务字段命中 ${matched}/${checked}` : 'freeChat 或无 SkillResult 链路，未检查',
    checkedFields: [...new Set(checkedFields)],
    evidence: [...new Set(evidence)].join('；') || '默认契约按当前 function/resultType 检查。'
  };
}

function buildRenderContract(result) {
  const turns = result.turns || [];
  let checked = 0;
  let matched = 0;
  const evidence = [];
  const checkedFields = [];
  turns.forEach((turn) => {
    const parsed = parseSkillResult(turn.skillResultJson);
    const reply = String(turn.llmReplyText || '');
    const trace = normalizeExpectedTrace(turn, result);
    const renderFields = Array.isArray(trace.renderFields) ? trace.renderFields : [];
    if (renderFields.length) {
      renderFields.forEach((field) => {
        const fieldName = field.path || field.field || '';
        const sourcePath = fieldName.includes('->') ? fieldName.split('->')[0].trim() : fieldName;
        const sourceRaw = field.contains ?? valueAtPathFlexible(parsed, sourcePath);
        const source = asJsonText(sourceRaw);
        checkedFields.push(`case.expectedTrace.renderFields.${fieldName || field.contains || 'reply'}`);
        if (!source || !String(source).trim()) {
          evidence.push(`renderFields 配置未取到源值: ${fieldName || '(empty)'}`);
          return;
        }
        checked++;
        if (reply.includes(String(source))) matched++;
      });
      evidence.push('按 case.expectedTrace.renderFields 检查最终回复');
      return;
    }
    if (!parsed) {
      checked++;
      if (reply.trim().length >= 8) matched++;
      checkedFields.push('turn.llmReplyText');
      evidence.push('无 SkillResult 时只检查最终回复是否有效');
      return;
    }
    const candidates = [];
    if (parsed.success === false) candidates.push(parsed.data?.errorLabel || parsed.data?.errorCode);
    if (parsed.data?.action) candidates.push(parsed.data.action);
    if (parsed.data?.llmMessage) candidates.push(parsed.data.llmMessage);
    if (Array.isArray(parsed.data?.sections)) {
      candidates.push(...parsed.data.sections.slice(0, 2).map((section) => section.title || section.id));
    }
    const useful = candidates.filter(Boolean);
    if (!useful.length) {
      checked++;
      if (reply.trim().length >= 8) matched++;
      checkedFields.push('turn.llmReplyText');
      evidence.push('默认契约未找到必须复述字段，检查回复非空');
      return;
    }
    if (parsed.success === false && (parsed.data?.errorLabel || parsed.data?.errorCode)) checkedFields.push('data.errorLabel/errorCode -> llmReplyText');
    if (parsed.data?.action) checkedFields.push('data.action -> llmReplyText');
    if (parsed.data?.llmMessage) checkedFields.push('data.llmMessage -> llmReplyText');
    if (Array.isArray(parsed.data?.sections)) checkedFields.push('data.sections[].title -> llmReplyText');
    useful.forEach((value) => {
      checked++;
      if (reply.includes(String(value))) matched++;
    });
    evidence.push('最终回复是否按 SkillResult 复述关键字段；不判断数据库结果是否真实正确');
  });
  const applies = checked > 0;
  return {
    key: 'render',
    label: '渲染契约',
    applies,
    pass: applies ? matched === checked : true,
    score: applies ? Math.round((matched / Math.max(1, checked)) * 100) : 100,
    summary: applies ? `回复复述命中 ${matched}/${checked}` : '没有可检查回复内容',
    checkedFields: [...new Set(checkedFields)],
    evidence: [...new Set(evidence)].join('；')
  };
}

function buildContractChecks(result) {
  return [
    buildRouteContract(result),
    buildInputContract(result),
    buildSkillResultContract(result),
    buildRenderContract(result)
  ];
}

function buildStageChecks(result, contractChecks = buildContractChecks(result)) {
  const turns = result.turns || [];
  const hasActualTools = turns.every((turn) => (turn.actualTool || '').trim().length > 0);
  const replyRatio = turns.length
    ? turns.filter((turn) => String(turn.llmReplyText || '').trim().length >= 8).length / turns.length
    : 1;
  const route = contractChecks.find((item) => item.key === 'route') || { pass: true, score: 100 };
  const input = contractChecks.find((item) => item.key === 'input') || { pass: true, score: 100, applies: false };
  const skillResult = contractChecks.find((item) => item.key === 'skillResult') || { pass: true, score: 100, applies: false };
  const render = contractChecks.find((item) => item.key === 'render') || { pass: true, score: 100, applies: false };
  const qualityScore = Math.round((route.score * 0.35 + input.score * 0.15 + skillResult.score * 0.2 + render.score * 0.2 + replyRatio * 10));
  const rawChecks = [
    { key: 'intent', label: '意图路由', pass: route.pass, score: route.score, rule: '按轮次比较 expectedTool 与 actualTool' },
    { key: 'functionInvocation', label: '能力调用', pass: hasActualTools, score: hasActualTools ? 100 : 50, rule: '每轮均有 actualTool 或明确直接回复' },
    { key: 'inputConditionRetention', label: '输入契约', pass: input.pass, score: input.score, applies: input.applies, rule: '按 case.expectedTrace 或默认契约检查用户显式条件' },
    { key: 'skillResultContract', label: 'SkillResult 契约', pass: skillResult.pass, score: skillResult.score, applies: skillResult.applies, rule: '按 case.expectedTrace 或当前 resultType 默认契约检查业务字段' },
    { key: 'replyFaithfulness', label: '渲染契约', pass: render.pass, score: render.score, applies: render.applies, rule: '最终回复是否按 SkillResult 复述关键结果' },
    { key: 'responseQuality', label: '回复质量', pass: qualityScore >= 70, score: qualityScore, rule: '综合(路由+输入契约+SkillResult 契约+渲染契约+回复完整度)' }
  ];

  // 串行门控：前序阶段失败时，后续阶段统一置为 FAIL / 0。
  let blocked = false;
  return rawChecks.map((item) => {
    const def = FUNNEL_STAGE_DEFS.find((stage) => stage.key === item.key);
    if (blocked) {
      return {
        ...item,
        pass: false,
        score: 0,
        rule: `${item.rule}（前序阶段未通过，链路中断）`,
        description: def?.description || '',
        meaning: def?.meaning || '',
        dynamicStepNote: def?.dynamicStepNote || ''
      };
    }
    if (!item.pass) blocked = true;
    return {
      ...item,
      description: def?.description || '',
      meaning: def?.meaning || '',
      dynamicStepNote: def?.dynamicStepNote || ''
    };
  });
}

function buildToolCalls(result) {
  const turns = result.turns || [];
  const calls = turns.map((turn, idx) => {
    const fail = !turn.toolOk && pseudoRand(`${result.caseId}:${idx}:fail`) > 0.55;
    const retry = fail && pseudoRand(`${result.caseId}:${idx}:retry`) > 0.45;
    return {
      step: idx + 1,
      tool: turn.actualTool || turn.expectedTool || 'freeChat',
      expectedTool: turn.expectedTool || '',
      status: fail ? 'FAILED' : 'SUCCESS',
      retry,
      fallback: fail && !retry,
      latencyMs: 180 + Math.round(pseudoRand(`${result.caseId}:${idx}:lat`) * 900)
    };
  });
  const expected = turns.map((turn) => turn.expectedTool).filter(Boolean);
  const actual = calls.map((call) => call.tool).filter(Boolean);
  let matched = 0;
  expected.forEach((tool, i) => {
    if (actual[i] === tool) matched++;
  });
  const sequenceScore = expected.length ? Math.round((matched / expected.length) * 100) : 100;
  const maxAllowedCalls = Math.max(1, expected.length + 1);
  const overCall = Math.max(0, actual.length - maxAllowedCalls);
  return {
    calls,
    sequence: {
      expected,
      actual,
      score: sequenceScore,
      maxAllowedCalls,
      overCall
    },
    robustness: {
      failureRate: calls.length ? Number((calls.filter((call) => call.status === 'FAILED').length / calls.length).toFixed(2)) : 0,
      retryRate: calls.length ? Number((calls.filter((call) => call.retry).length / calls.length).toFixed(2)) : 0,
      fallbackSuccessRate: calls.some((call) => call.fallback) ? Number((calls.filter((call) => call.fallback).length / calls.length).toFixed(2)) : 0
    }
  };
}

function buildLlmJudge(result, stageChecks) {
  const turns = result.turns || [];
  const fullReply = turns.map((turn) => turn.llmReplyText || '').join('\n');
  const avgReplyLen = turns.length
    ? turns.reduce((sum, turn) => sum + String(turn.llmReplyText || '').trim().length, 0) / turns.length
    : 0;
  const mismatchRatio = turns.length
    ? turns.filter((turn) => !turn.toolOk).length / turns.length
    : 0;
  const failWords = /(抱歉|无法|失败|未能)/.test(fullReply);
  const hasStructuredHint = /[:：\n]/.test(fullReply);

  const accuracy = Math.max(1, Math.min(5, Number((5 * (1 - mismatchRatio)).toFixed(1))));
  const completeness = Math.max(1, Math.min(5, Number((Math.min(1, avgReplyLen / 80) * 5).toFixed(1))));
  const helpfulnessRaw = (hasStructuredHint ? 3.2 : 2.6) + (avgReplyLen > 30 ? 0.9 : 0.2) - (failWords ? 0.8 : 0);
  const helpfulness = Math.max(1, Math.min(5, Number(helpfulnessRaw.toFixed(1))));
  const safety = Math.max(1, Math.min(5, Number((failWords ? 4.1 : 4.6).toFixed(1))));
  const stageAvg = stageChecks.reduce((sum, item) => sum + item.score, 0) / stageChecks.length;
  const rubric = ((accuracy + completeness + helpfulness + safety) / 20) * 100;
  const finalScore = Math.round(stageAvg * 0.6 + rubric * 0.4);
  const riskLevel = !result.pass || finalScore < 65 ? 'high' : finalScore < 80 ? 'medium' : 'low';
  return {
    score: finalScore,
    dimensions: {
      accuracy,
      completeness,
      helpfulness,
      safety
    },
    verdict: finalScore >= 80 ? 'GOOD' : finalScore >= 65 ? 'WARN' : 'RISK',
    reason: result.pass
      ? '链路匹配与回复结构基本达标，可继续关注边界样本。'
      : '链路或回复质量未达标，建议优先复核失败轮次。',
    riskLevel
  };
}

function buildReasoningTrace(result) {
  const tools = (result.turns || []).map((turn) => turn.actualTool || turn.expectedTool).filter(Boolean);
  return [
    `解析用户需求并定位候选技能，case=${result.caseId}`,
    `规划工具调用链路：${tools.join(' -> ') || 'freeChat'}`,
    '执行工具并校验路由、输入、SkillResult、渲染契约',
    `生成最终回复，评测结论=${result.pass ? 'PASS' : 'FAIL'}`
  ];
}

function buildExecutionSteps(result) {
  return (result.turns || []).map((turn, idx) => ({
    step: idx + 1,
    turnIndex: turn.turnIndex || idx + 1,
    userInput: turn.userInput || '',
    expectedTool: turn.expectedTool || '',
    actualTool: turn.actualTool || '',
    status: turn.toolOk === false ? 'FAIL' : 'PASS',
    summary: turn.expectedTool
      ? `第 ${turn.turnIndex || idx + 1} 轮：期望 ${turn.expectedTool || '-'}，实际 ${turn.actualTool || '-'}`
      : `第 ${turn.turnIndex || idx + 1} 轮：无需工具调用`
  }));
}

function enrichResult(result, run) {
  if (result.stageChecks && result.toolCalls && result.llmJudge) {
    result.caseMeta = result.caseMeta || caseById(result.caseId) || caseById(result.caseId?.replace('case_', '')) || null;
    result.traceProfile = traceProfileFor(result);
    result.contractChecks = buildContractChecks(result);
    result.stageChecks = buildStageChecks(result, result.contractChecks).map((item) => {
      const def = FUNNEL_STAGE_DEFS.find((stage) => stage.key === item.key);
      return {
        ...item,
        description: item.description || def?.description || '',
        meaning: item.meaning || def?.meaning || '',
        dynamicStepNote: item.dynamicStepNote || def?.dynamicStepNote || ''
      };
    });
    result.executionSteps = result.executionSteps || buildExecutionSteps(result);
    if (!result.comments) result.comments = [];
    return result;
  }
  result.caseMeta = caseById(result.caseId) || caseById(result.caseId?.replace('case_', '')) || null;
  result.traceProfile = traceProfileFor(result);
  const contractChecks = buildContractChecks(result);
  const stageChecks = buildStageChecks(result, contractChecks);
  const toolCalls = buildToolCalls(result);
  const llmJudge = buildLlmJudge(result, stageChecks);
  const replyText = (result.turns || []).map((turn) => turn.llmReplyText || '').join('\n');
  const promptTokens = 90 + Math.round(pseudoRand(`${result.caseId}:prompt`) * 120);
  const completionTokens = estimateTokenUsage(replyText);
  const totalTokens = promptTokens + completionTokens;
  const llmMs = Math.round(result.durationMs * (0.45 + pseudoRand(`${result.caseId}:llm`) * 0.2));
  const toolMs = Math.round(result.durationMs * (0.25 + pseudoRand(`${result.caseId}:tool`) * 0.2));
  const dbMs = Math.max(30, result.durationMs - llmMs - toolMs);
  const firstTokenMs = 600 + Math.round(pseudoRand(`${result.caseId}:ttft`) * 1400);
  const cost = Number((totalTokens / 1000 * 0.0072).toFixed(4));

  result.stageChecks = stageChecks;
  result.contractChecks = contractChecks;
  result.toolCalls = toolCalls;
  result.llmJudge = llmJudge;
  result.reasoningTrace = buildReasoningTrace(result);
  result.executionSteps = buildExecutionSteps(result);
  result.metrics = {
    firstTokenMs,
    latencyBreakdown: {
      llmMs,
      toolMs,
      dbMs
    },
    tokenUsage: {
      promptTokens,
      completionTokens,
      totalTokens
    },
    costUsd: cost
  };
  result.riskLevel = llmJudge.riskLevel;
  result.isBackfilled = Boolean(result.isBackfilled);
  if (!result.comments) result.comments = [];
  return result;
}

function buildRunFunnel(results) {
  const total = results.length || 1;
  const metricDefs = [
    {
      key: 'casePass',
      label: 'Case 通过率',
      meaning: '看这一批 case 最终整体通过情况。',
      rule: '按 case 最终 pass 字段统计，通过数 / 总 case 数。',
      dynamicStepNote: '这是 Run 级总体指标，不代表每个 case 的固定执行步骤；单个 case 的真实路径看执行步骤时间线。',
      collect: (result) => ({ applies: true, pass: Boolean(result.pass) })
    },
    {
      key: 'intent',
      label: '意图路由正确率',
      meaning: '看 Agent 有没有选对 expectedTool 对应的业务能力。',
      rule: '按 stageChecks.intent 统计；本指标只判断路由是否选对。',
      dynamicStepNote: '这是 Run 级诊断指标，不代表每个 case 的固定执行步骤；不同 function 仍有不同后续链路。',
      collect: (result) => {
        const check = (result.stageChecks || []).find((item) => item.key === 'intent');
        return { applies: true, pass: Boolean(check?.pass) };
      }
    },
    {
      key: 'inputConditionRetention',
      label: '输入契约命中率',
      meaning: '看用户明确说出的车辆、城市、日期、动作等条件，是否按 case.expectedTrace 或默认契约进入 SkillResult / 回复。',
      rule: '优先统计 case.expectedTrace.inputFields；没有配置时用默认契约识别显式条件；不判断数据库结果是否真实正确。',
      dynamicStepNote: '这是 Run 级诊断指标，不代表每个 case 的固定执行步骤；没有显式条件的 case 会记为未检查。',
      collect: (result) => {
        const check = (result.contractChecks || []).find((item) => item.key === 'input');
        return { applies: check?.applies !== false, pass: Boolean(check?.pass) };
      }
    },
    {
      key: 'skillResultContract',
      label: 'SkillResult 契约命中率',
      meaning: '看当前 function/resultType 的业务字段是否命中，例如运营数据看 data.filter/data.sections，控制结果看 data.action。',
      rule: '优先统计 case.expectedTrace.skillResultFields；没有配置时按线上已出现的 resultType 默认契约检查；不判断数据库结果是否真实正确。',
      dynamicStepNote: '这是 Run 级诊断指标，不代表每个 case 的固定执行步骤；无 SkillResult 的直接回复链路会记为未检查。',
      collect: (result) => {
        const check = (result.contractChecks || []).find((item) => item.key === 'skillResult');
        return { applies: check?.applies !== false, pass: Boolean(check?.pass) };
      }
    },
    {
      key: 'replyFaithfulness',
      label: '渲染契约命中率',
      meaning: '看最终回复是否按 SkillResult 复述关键业务结果，没有把失败说成成功，也没有明显脱离结构化返回。',
      rule: '优先统计 case.expectedTrace.renderFields；没有配置时按 SkillResult 里的错误原因、动作、场景、报告章节等默认契约检查；不判断数据库结果是否真实正确。',
      dynamicStepNote: '这是 Run 级诊断指标，不代表每个 case 的固定执行步骤；它评估的是渲染一致性。',
      collect: (result) => {
        const check = (result.contractChecks || []).find((item) => item.key === 'render');
        return { applies: check?.applies !== false, pass: Boolean(check?.pass) };
      }
    }
  ];

  return metricDefs.map((metric) => {
    const collected = results.map((result) => metric.collect(result));
    const applicable = collected.filter((item) => item.applies).length;
    const passed = collected.filter((item) => item.applies && item.pass).length;
    const failed = Math.max(0, applicable - passed);
    const skipped = Math.max(0, total - applicable);
    return {
      key: metric.key,
      label: metric.label,
      description: metric.meaning,
      meaning: metric.meaning,
      rule: metric.rule,
      dynamicStepNote: metric.dynamicStepNote,
      passed,
      failed,
      skipped,
      applicable,
      total,
      passRate: Number((passed / Math.max(1, applicable)).toFixed(2))
    };
  });
}

function voiceTicketChecks(result) {
  const ticket = result.caseMeta?.payload?.expectedTicket || {};
  const missingFields = result.caseMeta?.payload?.assertions?.missingFields || ticket.missingFields || [];
  const routeQueue = result.caseMeta?.payload?.assertions?.routeQueue || ticket.routeQueue || '';
  const hasTicket = Object.keys(ticket).length > 0 || /工单|结构化|派发|缺失/.test((result.turns || []).map((turn) => turn.llmReplyText || '').join('\n'));
  const fieldScore = result.pass ? 92 : 55;
  const missingPass = result.pass || missingFields.length === 0;
  const routePass = result.pass || !routeQueue;
  return [
    {
      key: 'fieldAccuracy',
      label: '字段准确性',
      pass: Boolean(result.pass && hasTicket),
      score: hasTicket ? fieldScore : 40,
      applies: true,
      rule: '对比 expectedTicket 中的工单类型、问题类型、车辆、地点、联系方式等字段',
      description: '检查 AI 输出的工单 JSON 是否忠实还原对话里的关键信息。',
      meaning: '看最终结构化结果能不能直接用于建单或人工复核。',
      dynamicStepNote: '这是语义测评阶段，不要求存在工具调用。'
    },
    {
      key: 'missingFieldDetection',
      label: '缺失字段识别',
      pass: missingPass,
      score: missingPass ? 95 : 45,
      applies: true,
      rule: '对比 expectedTicket.missingFields / assertions.missingFields',
      description: '检查对话里没有说清的信息是否被标记为缺失。',
      meaning: '防止模型把缺失的联系方式、地点或车辆编号编出来。',
      dynamicStepNote: '这是语义测评阶段，不要求存在工具调用。'
    },
    {
      key: 'routeAccuracy',
      label: '路由队列',
      pass: routePass,
      score: routePass ? 90 : 50,
      applies: Boolean(routeQueue),
      rule: '对比 expectedTicket.routeQueue / assertions.routeQueue',
      description: '检查工单是否流转到正确队列。',
      meaning: '看结构化结果是否能进入正确后续处理流程。',
      dynamicStepNote: '这是语义测评阶段，不要求存在工具调用。'
    },
    {
      key: 'noHallucination',
      label: '禁止编造',
      pass: Boolean(result.pass),
      score: result.pass ? 96 : 50,
      applies: true,
      rule: '只允许使用 ASR 对话中出现或可直接推断的信息',
      description: '检查输出是否编造了对话中没有的车辆、地点、联系人或处理结论。',
      meaning: '保证工单结构化结果可追溯到原始对话。',
      dynamicStepNote: '这是语义测评阶段，不要求存在工具调用。'
    },
    {
      key: 'dialogueGrounding',
      label: '对话依据',
      pass: Boolean(result.pass),
      score: result.pass ? 88 : 55,
      applies: true,
      rule: '关键字段需要能回溯到原始 dialogueText',
      description: '检查结构化字段是否有明确对话依据，并能处理多轮补全、改口和噪声。',
      meaning: '看模型是否真正理解整段对话，而不是只抓孤立关键词。',
      dynamicStepNote: '这是语义测评阶段，不要求存在工具调用。'
    }
  ];
}

function voiceTicketContractChecks(result) {
  return voiceTicketChecks(result).map((item) => ({
    key: item.key,
    label: item.label,
    applies: item.applies,
    pass: item.pass,
    score: item.score,
    summary: item.pass ? `${item.label}通过` : `${item.label}需要复核`,
    checkedFields: ['payload.dialogueText', 'payload.expectedTicket', 'payload.assertions'],
    evidence: item.rule
  }));
}

function voiceTicketFunnel(results) {
  const total = results.length || 1;
  const defs = [
    { key: 'casePass', label: 'Case 通过率', meaning: '看这一批语音工单 case 最终整体通过情况。', collect: (result) => ({ applies: true, pass: Boolean(result.pass) }) },
    { key: 'fieldAccuracy', label: '字段准确率', meaning: '看工单类型、问题类型、车辆、地点、联系方式等字段是否正确。', collect: (result) => pickVoiceCheck(result, 'fieldAccuracy') },
    { key: 'missingFieldDetection', label: '缺失字段命中率', meaning: '看对话里没说清的信息是否被正确放入 missingFields。', collect: (result) => pickVoiceCheck(result, 'missingFieldDetection') },
    { key: 'routeAccuracy', label: '路由队列准确率', meaning: '看工单是否进入正确处理队列。', collect: (result) => pickVoiceCheck(result, 'routeAccuracy') },
    { key: 'noHallucination', label: '禁止编造通过率', meaning: '看输出是否没有编造对话里不存在的信息。', collect: (result) => pickVoiceCheck(result, 'noHallucination') }
  ];
  return defs.map((metric) => {
    const collected = results.map((result) => metric.collect(result));
    const applicable = collected.filter((item) => item.applies !== false).length;
    const passed = collected.filter((item) => item.applies !== false && item.pass).length;
    return {
      key: metric.key,
      label: metric.label,
      description: metric.meaning,
      meaning: metric.meaning,
      rule: '按语音工单结构化语义测评阶段统计。',
      dynamicStepNote: '这是工单语义测评指标，不代表工具调用步骤。',
      passed,
      failed: Math.max(0, applicable - passed),
      skipped: Math.max(0, total - applicable),
      applicable,
      total,
      passRate: Number((passed / Math.max(1, applicable)).toFixed(2))
    };
  });
}

function pickVoiceCheck(result, key) {
  const check = (result.stageChecks || []).find((item) => item.key === key);
  return { applies: check?.applies !== false, pass: Boolean(check?.pass) };
}

function applyVoiceTicketRunShape(run) {
  run.results = run.results.map((result) => {
    result.caseMeta = result.caseMeta || caseById(result.caseId) || caseById(result.caseId?.replace('case_', '')) || null;
    result.stageChecks = voiceTicketChecks(result);
    result.contractChecks = voiceTicketContractChecks(result);
    result.toolCalls = {
      calls: [],
      sequence: { expected: [], actual: [], score: 100, maxAllowedCalls: 0, overCall: 0 },
      robustness: { failureRate: 0, retryRate: 0, fallbackSuccessRate: 0 },
      note: '语音工单结构化项目不以工具调用作为主评测对象'
    };
    result.traceProfile = {
      type: 'voice_ticket_semantic',
      title: '语音工单语义测评链路',
      resultType: 'ticket_structuring',
      skill: '',
      fields: ['payload.dialogueText', 'payload.expectedTicket', 'payload.assertions'],
      note: '本项目以 ASR 对话文本到工单 JSON 的语义一致性为主，不要求工具调用链路。'
    };
    result.llmJudge = {
      ...(result.llmJudge || {}),
      reason: result.pass
        ? '工单字段、缺失信息、路由队列和对话依据基本达标。'
        : '工单结构化语义结果未达标，建议复核字段、缺失信息、路由和编造风险。'
    };
    result.reasoningTrace = [
      `读取 ASR 对话文本，case=${result.caseId}`,
      '抽取 expectedTicket 并对齐对话依据',
      '检查字段准确性、缺失字段、路由队列和禁止编造',
      `语义测评结论=${result.pass ? 'PASS' : 'FAIL'}`
    ];
    result.executionSteps = [];
    return result;
  });
  return run;
}

function enrichRun(run) {
  if (!run || !Array.isArray(run.results)) return run;
  normalizeRunProject(run);
  run.results = run.results.map((result) => enrichResult(result, run));
  run.evaluationMode = run.projectId === VOICE_TICKET_PROJECT ? 'semantic_ticket_structuring' : 'agent_tool_chain';
  if (run.projectId === VOICE_TICKET_PROJECT) applyVoiceTicketRunShape(run);
  const allTokens = run.results.reduce((sum, item) => sum + (item.metrics?.tokenUsage?.totalTokens || 0), 0);
  const allCost = run.results.reduce((sum, item) => sum + (item.metrics?.costUsd || 0), 0);
  const firstTokenAvg = run.results.length
    ? Math.round(run.results.reduce((sum, item) => sum + (item.metrics?.firstTokenMs || 0), 0) / run.results.length)
    : 0;
  const stageChecksFlat = run.results.flatMap((item) => item.stageChecks || []);
  run.versionInfo = run.versionInfo || {
    datasetVersion: `cases-${new Date(run.startedAt || now()).toISOString().slice(0, 10)}`,
    agentVersion: 'agent-prompt-v2.4',
    modelVersion: 'gpt-4.1-mini',
    ragVersion: 'rag-index-2026-04-15',
    toolVersion: 'toolkit-1.8.3',
    serviceCommit: `commit-${Math.floor(pseudoRand(run.runId || run.id) * 1e8).toString(16)}`
  };
  run.funnel = run.projectId === VOICE_TICKET_PROJECT ? voiceTicketFunnel(run.results) : buildRunFunnel(run.results);
  run.metrics = {
    firstTokenAvgMs: firstTokenAvg,
    tokenUsage: {
      totalTokens: allTokens,
      avgPerCase: run.results.length ? Math.round(allTokens / run.results.length) : 0
    },
    costUsd: Number(allCost.toFixed(4)),
    highRiskCases: run.results.filter((item) => item.riskLevel === 'high').length,
    stagePassRate: stageChecksFlat.length
      ? Number((stageChecksFlat.filter((item) => item.pass).length / stageChecksFlat.length).toFixed(2))
      : 0
  };
  return run;
}

function runsForDisplay(ctx = null) {
  return [...scopedRuns(ctx)].sort((a, b) => {
    const byTime = new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime();
    if (byTime !== 0) return byTime;
    return String(b.runId || '').localeCompare(String(a.runId || ''));
  });
}

let backendServices = null;

function services() {
  if (backendServices) return backendServices;
  const repository = createDemoRepository({ cases, runs, mockConfigs, promptKeys, promptContent });
  backendServices = {
    repository,
    projects: createProjectsService({ authContext, ttlMs: AUTH_TOKEN_TTL_MS }),
    cases: createCasesService({
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
      persistCases: persistCasesState
    }),
    runs: createRunsService({ bodyJson, runs, runsForDisplay, makeRun, normalizeRunProject, inProject, enrichRun, now, id, persistRuns: persistRunsState }),
    generation: createGenerationService({ bodyJson, generationSchemaForProject, generateCasesForUpload, normalizeCase, isAdminProject, now, id, cases, persistCases: persistCasesState }),
    mockConfigs: createMockConfigsService({ bodyJson, mockConfigs, configList, configById, isAdminProject, id })
  };
  return backendServices;
}

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function text(res, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function notFound(res) {
  json(res, { code: '404', message: 'Not found' }, 404);
}

function ok(data = null) {
  return { code: OK, message: 'success', data };
}

function unauthorized(res, message = '请先输入内部访问码') {
  return json(res, { code: '401', message }, 401);
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signAuthPayload(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
}

function makeAuthToken(account) {
  const projects = Array.isArray(account.projects) && account.projects.length
    ? account.projects
    : [{ projectId: account.projectId || 'all', projectName: account.projectName || '项目空间', role: account.role || 'member' }];
  const active = projects[0] || { projectId: 'all', projectName: '管理员视角', role: 'admin' };
  const payload = JSON.stringify({
    scope: 'eval-admin-demo',
    accountId: account.accountId || active.projectId,
    accountName: account.accountName || active.projectName,
    projects,
    activeProjectId: active.projectId,
    projectId: active.projectId,
    projectName: active.projectName,
    role: active.role,
    iat: Date.now(),
    exp: Date.now() + AUTH_TOKEN_TTL_MS
  });
  const body = b64url(payload);
  return `${body}.${signAuthPayload(body)}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [body, signature] = token.split('.');
  if (!body || !signature || !safeEqual(signature, signAuthPayload(body))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.scope === 'eval-admin-demo' && Number(payload.exp) > Date.now() ? payload : false;
  } catch {
    return false;
  }
}

function authTokenFromRequest(req) {
  const auth = req.headers.authorization || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) return bearer[1].trim();
  const cookie = req.headers.cookie || '';
  const match = /(?:^|;\s*)eval_admin_token=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : '';
}

function isAuthorized(req) {
  return Boolean(verifyAuthToken(authTokenFromRequest(req)));
}

function authContext(req) {
  const payload = verifyAuthToken(authTokenFromRequest(req));
  const demoAccount = PROJECT_ACCESS.find((item) => item.code === 'tester') || PROJECT_ACCESS[0];
  const projects = payload && Array.isArray(payload.projects) && payload.projects.length
    ? payload.projects
    : demoAccount.projects;
  const requestedProjectId = String(req.headers['x-project-id'] || (payload && payload.activeProjectId) || projects[0].projectId || 'all');
  if (requestedProjectId === 'all') {
    return {
      accountId: (payload && payload.accountId) || 'demo-admin',
      accountName: (payload && payload.accountName) || '管理员视角',
      projects,
      activeProjectId: 'all',
      projectId: 'all',
      projectName: '管理员视角',
      role: 'admin'
    };
  }
  let active = projects.find((project) => project.projectId === requestedProjectId);
  if (!active && projects.some((project) => project.projectId === 'all' || project.role === 'admin')) {
    active = requestedProjectId === 'all'
      ? projects.find((project) => project.projectId === 'all') || projects[0]
      : { projectId: requestedProjectId, projectName: requestedProjectId, role: 'member' };
  }
  if (!active) active = projects[0];
  return {
    accountId: (payload && payload.accountId) || demoAccount.accountId || active.projectId,
    accountName: (payload && payload.accountName) || demoAccount.accountName || active.projectName,
    projects,
    activeProjectId: active.projectId,
    projectId: active.projectId,
    projectName: active.projectName || active.projectId || '项目空间',
    role: active.role || 'member'
  };
}

function isAdminProject(ctx) {
  return !ctx || ctx.projectId === 'all' || ctx.role === 'admin';
}

function inProject(item, ctx) {
  return isAdminProject(ctx) || item.projectId === 'shared' || item.projectId === ctx.projectId;
}

function scopedCases(ctx) {
  return cases.filter((item) => inProject(item, ctx));
}

function inferRunProjectId(run) {
  if (run.projectId) return run.projectId;
  const resultTools = (run.results || []).flatMap((result) => (result.turns || []).map((turn) => turn.expectedTool || turn.actualTool));
  const caseProjects = (run.caseIds || [])
    .map((caseId) => caseById(caseId))
    .filter(Boolean)
    .map((item) => item.projectId);
  const uniqueCaseProjects = [...new Set(caseProjects.filter(Boolean))];
  if (uniqueCaseProjects.length === 1) return uniqueCaseProjects[0];
  return inferProjectId('', [...resultTools, ...caseProjects]);
}

function normalizeRunProject(run) {
  if (!run.projectId) run.projectId = inferRunProjectId(run);
  return run;
}

function scopedRuns(ctx) {
  return runs.map(normalizeRunProject).filter((item) => inProject(item, ctx));
}

function scopedMockConfigs(ctx) {
  if (isAdminProject(ctx)) return mockConfigs;
  return mockConfigs.filter((item) => inProject(item, ctx));
}

function toolsForProject(ctx) {
  return toolsForProjectId(ctx?.projectId || 'all');
}

function generationSchemaForProject(ctx) {
  const baseSchema = ctx?.projectId === VOICE_TICKET_PROJECT ? VOICE_TICKET_CASE_SCHEMA : CASE_GENERATION_SCHEMA;
  const profile = projectProfile(ctx?.projectId);
  return {
    ...baseSchema,
    projectId: ctx?.projectId || 'all',
    projectName: ctx?.projectName || '管理员视角',
    defaultGenerationPrompt: PROJECT_DEFAULT_GENERATION_PROMPTS[ctx?.projectId] || PROJECT_DEFAULT_GENERATION_PROMPTS[VEHICLE_AGENT_PROJECT],
    allowedTools: toolsForProject(ctx),
    columnSchema: profile?.columnSchema || []
  };
}

function promptKeysForProject(ctx) {
  if (ctx?.projectId === VOICE_TICKET_PROJECT) return voicePromptKeys;
  return vehiclePromptKeys;
}

function promptContentForProject(key, ctx) {
  if (ctx?.projectId === VOICE_TICKET_PROJECT) return voicePromptContent[key] || '';
  return promptContent[key] || '';
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function bodyText(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function sourceHtml() {
  if (cachedHtml) return cachedHtml;
  cachedHtml = await readFile(PUBLIC_INDEX_HTML, 'utf8');
  return cachedHtml;
}

function assetContentType(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function serveStaticAsset(res, pathname) {
  const prefix = '/admin/eval/';
  const relative = decodeURIComponent(pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname.slice(1));
  const assetPath = path.normalize(path.join(DIST_DIR, relative));
  if (!assetPath.startsWith(DIST_DIR)) return false;
  try {
    const body = await readFile(assetPath);
    res.writeHead(200, { 'content-type': assetContentType(assetPath), 'cache-control': 'no-store' });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function caseById(value, ctx = null) {
  return cases.find((item) => (item.id === value || item.caseId === value) && inProject(item, ctx));
}

function configById(value, ctx = null) {
  return mockConfigs.find((item) => item.configId === value && inProject(item, ctx)) || scopedMockConfigs(ctx)[0] || mockConfigs[0];
}

function configList(ctx = null) {
  return scopedMockConfigs(ctx).map((item) => ({
    configId: item.configId,
    name: item.name,
    projectId: item.projectId,
    mockType: item.mockType || (item.projectId === VOICE_TICKET_PROJECT ? 'ticket_dialogue' : 'vehicle_api'),
    vehicleCount: item.vehicles.length
  }));
}

function groups(ctx = null) {
  return [...new Set(scopedCases(ctx).map((item) => item.groupName || '默认分组'))];
}

function agentVersionById(version) {
  return AGENT_VERSIONS.find((item) => item.version === version) || AGENT_VERSIONS[0];
}

function datasetVersionById(version) {
  return DATASET_VERSIONS.find((item) => item.version === version) || DATASET_VERSIONS[0];
}

function demoTestsets(ctx = null) {
  const enabled = scopedCases(ctx).filter((item) => item.enabled);
  const byGroup = (name, limit) => enabled.filter((item) => (item.groupName || '默认分组') === name).slice(0, limit);
  const fallback = (items, limit) => (items.length ? items : enabled).slice(0, limit);
  const defs = [
    {
      id: 'ts_smoke',
      name: '冒烟测试集',
      version: 'cases-smoke-2026-04',
      description: '周一演示用：覆盖车辆查询、控制、运营数据和 RAG 的少量关键路径。',
      caseIds: enabled.slice(0, 12).map((item) => item.id)
    },
    {
      id: 'ts_regression',
      name: '核心回归测试集',
      version: 'cases-regression-2026-04',
      description: '回归闭环用：优先使用已标记回归的用例，数量不足时补充启用用例。',
      caseIds: fallback(enabled.filter((item) => item.regression), 30).map((item) => item.id)
    },
    {
      id: 'ts_operation_data',
      name: '运营数据专项',
      version: 'cases-operation-data-2026-04',
      description: '专项测试集：验证运营指标查询、结构化报告和异常时间窗。',
      caseIds: fallback(byGroup('运营数据查询', 24), 24).map((item) => item.id)
    },
    {
      id: 'ts_vehicle_control',
      name: '车辆控制专项',
      version: 'cases-vehicle-control-2026-04',
      description: '专项测试集：验证开门、鸣笛、灯光等控制链路与权限边界。',
      caseIds: fallback(byGroup('车辆控制', 24), 24).map((item) => item.id)
    }
  ];
  return defs.map((item) => ({
    ...item,
    caseCount: item.caseIds.length,
    groups: [...new Set(item.caseIds.map((caseId) => caseById(caseId)?.groupName || '默认分组'))]
  }));
}

function testsetById(idValue, ctx = null) {
  return demoTestsets(ctx).find((item) => item.id === idValue) || null;
}

function uidFromTier(tier) {
  const ranges = {
    FULL: 900100000,
    OPEN_DOOR_ONLY: 900105000,
    OPERATIONAL_ONLY: 900110000,
    DENIED: 900115000
  };
  return String((ranges[tier] || ranges.FULL) + Math.floor(Math.random() * 4000));
}

function extractVehicleId(text) {
  return (String(text || '').match(/X6S\d+/i) || ['X6S5001'])[0].toUpperCase();
}

function mockActionName(text, tool) {
  const input = String(text || '');
  if (/(声音|音量).*(调大|调高|大点|高点)|(调大|调高).*(声音|音量)/.test(input)) return '调高音量';
  if (/(声音|音量).*(调小|调低|小点|低点)|(调小|调低).*(声音|音量)/.test(input)) return '调低音量';
  if (/(开门|打开.*门)/.test(input) || tool === 'open_door') return '开门';
  if (/(鸣笛|叫两声|响一下|叫一下)/.test(input)) return '鸣笛';
  if (/(双闪|闪灯|闪一下)/.test(input)) return '闪灯';
  return '执行操作';
}

function buildMockEvaluationTurn(turn, item, pass) {
  const actualTool = turn.expectedTool || 'freeChat';
  const userInput = turn.userInput || '';
  const vehicleId = extractVehicleId(userInput);
  let skillResult = null;
  let llmReplyText = pass ? `已处理：${userInput}` : '抱歉，当前未能完成该请求。';

  if (actualTool === 'vehicle_operation_data_query') {
    skillResult = {
      skill: 'vehicle_operation_data_query',
      success: pass,
      resultType: 'operation_data_report',
      data: {
        filter: {
          queryDate: /昨天/.test(userInput) ? '2026-04-15' : '2026-04-16',
          city: /全国/.test(userInput) ? '全国' : (/青岛/.test(userInput) ? '青岛' : '全国')
        },
        mode: 'simple',
        sections: [
          {
            id: 'answer',
            title: '运营数据摘要',
            type: 'kv',
            analysis: [{ title: '摘要', points: ['运营车辆数稳定，有效任务数正常。'] }],
            items: [
              { label: '运营车辆数', value: '128', unit: '辆' },
              { label: '有效任务数', value: '1,024', unit: '单' }
            ]
          }
        ],
        dataSource: 'app.app_city_operation_metrics_wide_di'
      }
    };
    llmReplyText = `${skillResult.data.filter.queryDate}${skillResult.data.filter.city}运营数据摘要：运营车辆数128辆，有效任务数1,024单。`;
  } else if (actualTool === 'update_user_agent_name') {
    const name = (userInput.match(/叫([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})/) || [null, '小慧'])[1];
    skillResult = {
      skill: 'update_user_agent_name',
      success: true,
      resultType: 'multi_turn_prompt',
      data: {
        scene: 'agent_name_workflow',
        llmMessage: `你是想把我的名字改成${name}吗？`
      }
    };
    llmReplyText = skillResult.data.llmMessage;
  } else if (['vehicle_control', 'open_door', 'start_collect_merchant_location', 'vehicle_selective_query'].includes(actualTool)) {
    if (actualTool === 'start_collect_merchant_location' && !pass) {
      skillResult = {
        skill: actualTool,
        success: false,
        resultType: 'action_result',
        data: { errorCode: 'NO_PERMISSION', errorLabel: '无点位采集权限' }
      };
      llmReplyText = '无点位采集权限。';
    } else {
      const action = mockActionName(userInput, actualTool);
      skillResult = {
        skill: actualTool,
        success: pass,
        resultType: 'action_result',
        data: {
          action,
          total: 1,
          successCount: pass ? 1 : 0,
          successPlates: pass ? [vehicleId] : []
        }
      };
      llmReplyText = pass ? `已为 ${vehicleId} ${action}。` : `${vehicleId}${action}失败。`;
    }
  } else if (actualTool === 'return_app_native_router') {
    skillResult = {
      skill: actualTool,
      success: pass,
      resultType: 'action_result',
      data: {
        action: '跳转原生页面',
        successCount: pass ? 1 : 0,
        successPlates: []
      }
    };
    llmReplyText = '已打开对应页面。';
  } else if (['voice_ticket_structuring', 'ticket_field_extract', 'ticket_category_route'].includes(actualTool)) {
    const vehicleMatch = (userInput.match(/(?:X6S\d+|[A-Z]\d{3})/i) || ['X6S5002'])[0].toUpperCase();
    const location = (/青岛/.test(userInput) && '青岛市南区') || (/深圳/.test(userInput) && '深圳宝安园区') || '待确认地点';
    const issue = (/低电量/.test(userInput) && '低电量') || (/无法开门|开不了门/.test(userInput) && '无法开门') || (/绕路|延误|投诉/.test(userInput) && '配送延误投诉') || '待确认问题';
    const category = /投诉|升级/.test(userInput) ? '投诉升级' : (/低电量|无法开门|故障/.test(userInput) ? '车辆故障' : '一般咨询');
    const priority = /投诉|升级|着急|今天|上午|下午|无法开门/.test(userInput) ? 'high' : 'medium';
    skillResult = {
      skill: actualTool,
      success: pass,
      resultType: 'ticket_structuring_result',
      data: {
        ticketType: category,
        category,
        priority,
        routeTo: category === '投诉升级' ? '售后回访' : '现场运维',
        fields: {
          vehicleId: vehicleMatch,
          location,
          issueDescription: issue,
          contact: (userInput.match(/1\d{10}/) || [''])[0],
          deadline: /今天下午前/.test(userInput) ? '今天下午前' : (/今天上午/.test(userInput) ? '今天上午' : '')
        }
      }
    };
    llmReplyText = pass
      ? `已生成${category}工单：${vehicleMatch}，${location}，${issue}，优先级${priority}。`
      : '当前语音内容缺少关键信息，暂无法生成完整工单。';
  }

  return {
    turnIndex: turn.turnIndex,
    userInput,
    llmReplyText,
    expectedTool: turn.expectedTool,
    actualTool,
    toolOk: actualTool === turn.expectedTool,
    skillResultJson: skillResult ? JSON.stringify(skillResult) : '',
    hintsJson: JSON.stringify({ matchedBy: 'expectedTool', mock: true, resultType: skillResult?.resultType || 'no_skill_result' })
  };
}

function evaluateCase(item) {
  const pass = item.enabled && !item.caseId.includes('fail') && !(item.tags || '').includes('失败');
  const turns = (item.turns || []).map((turn) => buildMockEvaluationTurn(turn, item, pass));
  return {
    caseId: item.caseId,
    caseName: item.name,
    userId: item.userId,
    pass,
    failReason: pass ? '' : 'Demo 模拟失败：用于展示失败结果复核能力',
    durationMs: 500 + Math.floor(Math.random() * 1600),
    toolMatchSummary: `${turns.filter((turn) => turn.toolOk).length}/${turns.length}`,
    reviewFlagged: false,
    comments: [],
    turns
  };
}

function makeRun(payload, ctx = null) {
  const selectedIds = payload.testsetId
    ? (testsetById(payload.testsetId, ctx)?.caseIds || [])
    : (payload.caseIds || []);
  const selectedCases = selectedIds.map((caseId) => caseById(caseId, ctx)).filter(Boolean);
  const results = selectedCases.map(evaluateCase);
  const passedCases = results.filter((item) => item.pass).length;
  const totalCases = results.length;
  const durationMs = results.reduce((sum, item) => sum + item.durationMs, 0);
  const agentVersion = agentVersionById(payload.agentVersion);
  const datasetVersion = datasetVersionById(payload.datasetVersion);
  const run = {
    id: id('run'),
    runId: `run_${Date.now()}`,
    name: payload.name || `评测-${new Date().toLocaleString('zh-CN')}`,
    env: 'local-demo',
    status: 'COMPLETED',
    completedCases: totalCases,
    totalCases,
    passedCases,
    durationMs,
    startedAt: now(),
    finishedAt: now(),
    caseIds: selectedCases.map((item) => item.id),
    testsetId: payload.testsetId || '',
    testsetName: payload.testsetId ? (testsetById(payload.testsetId, ctx)?.name || '') : '',
    mockConfigId: payload.mockConfigId || '',
    projectId: isAdminProject(ctx) ? (payload.projectId || selectedCases[0]?.projectId || VEHICLE_AGENT_PROJECT) : ctx.projectId,
    projectName: isAdminProject(ctx) ? (payload.projectName || '') : ctx.projectName,
    promptOverrides: payload.promptOverrides || {},
    versionInfo: {
      datasetVersion: payload.datasetVersion || datasetVersion.version,
      agentVersion: payload.agentVersion || agentVersion.version,
      modelVersion: payload.modelVersion || agentVersion.modelVersion,
      ragVersion: payload.ragVersion || agentVersion.ragVersion,
      toolVersion: payload.toolVersion || agentVersion.toolVersion,
      serviceCommit: `commit-${Math.floor(pseudoRand(`${Date.now()}:${payload.agentVersion || agentVersion.version}`) * 1e8).toString(16)}`
    },
    results
  };
  runs.unshift(enrichRun(run));
  return run;
}

function normalizeModule(moduleKey) {
  return LLM_MODULE_TOOL_MAP[moduleKey] ? moduleKey : 'vehicle_query';
}

function normalizeAllowedTools(payload, fallbackTool) {
  const tools = Array.isArray(payload.allowedTools)
    ? payload.allowedTools.filter((tool) => ALL_AGENT_TOOLS.includes(tool))
    : [];
  return tools.length ? [...new Set(tools)] : [fallbackTool].filter(Boolean);
}

function toolSequenceFromCounts(toolCounts) {
  if (!toolCounts || typeof toolCounts !== 'object' || Array.isArray(toolCounts)) return [];
  const sequence = [];
  Object.keys(toolCounts).forEach((tool) => {
    if (!ALL_AGENT_TOOLS.includes(tool)) return;
    const count = Math.max(0, Math.min(50, Number(toolCounts[tool] || 0)));
    for (let i = 0; i < count; i++) sequence.push(tool);
  });
  return sequence.slice(0, 50);
}

function makePromptText(expectedTool, boundaryTag, index) {
  const templates = {
    RAG: [
      '售后说车辆离线一般先排查什么',
      '这个告警说明文档里怎么解释的',
      '帮我查一下开门失败的处理口径'
    ],
    freeChat: [
      '先不用操作，帮我解释一下这个结果是什么意思',
      '这个问题我该怎么跟现场同事确认',
      '如果用户这么问，我应该怎么回复更稳妥'
    ],
    open_door: [
      '帮我把最近那台车的舱门打开',
      '把 A001 的门开一下，我要放货',
      '第三辆车确认没任务的话就开门'
    ],
    return_app_native_router: [
      '带我去车辆详情页看一下',
      '打开任务列表页面，我想看当前配送进度',
      '跳到告警详情，我要看具体原因'
    ],
    vehicle_control: [
      '让 X6S5001 闪一下灯，我在现场找车',
      '把 A 区那台车鸣笛两秒',
      '帮我把这辆车的音量调低一点'
    ],
    vehicle_operation_data_query: [
      '昨天青岛园区的配送完成率怎么样',
      '帮我看一下上周深圳的车均任务数',
      '今天异常 AD 任务主要集中在哪几个城市'
    ],
    vehicle_selective_query: [
      '附近还有哪几台车电量比较高',
      '帮我找一下 A 区空闲且在线的车',
      '查一下 X6S5001 现在在哪，电量多少'
    ],
    voice_ticket_structuring: [
      '语音转写：客户说昨晚青岛市南区 A001 车辆无法开门，现场等了十分钟，需要派单处理',
      '录音内容：用户反馈 X6S5002 低电量停在深圳宝安园区，要求今天下午前处理',
      '电话记录：客户说车辆到点未到，配送延误，想让售后尽快回访'
    ],
    ticket_field_extract: [
      '用户来电说 X6S5002 低电量停在深圳宝安园区，要求今天下午前处理，联系电话 13800000000',
      '录音文本：A001 在青岛市南区无法开门，联系人王师傅，上午十点前需要到场',
      '客户反馈车辆 X6S7012 当前位置不准，影响装货，期望今天处理完成'
    ],
    ticket_category_route: [
      '客户投诉车辆绕路导致配送延误，要求售后回访并升级处理',
      '用户说车辆无法开门但不投诉，只需要现场运维尽快处理',
      '电话里提到结算金额不对，需要转给客服工单队列'
    ]
  };
  const list = templates[expectedTool] || templates.freeChat;
  return list[(index - 1) % list.length];
}

function buildGeneratedTurns(payload, expectedTool, boundary, index, baseCase) {
  const turnCount = Math.max(1, Math.min(3, Number(payload.turnCount || 1)));
  const existingTurns = Array.isArray(baseCase?.turns) ? baseCase.turns : [];
  const selectedAssertionFields = Array.isArray(payload.selectedAssertionFields) && payload.selectedAssertionFields.length
    ? new Set(payload.selectedAssertionFields)
    : new Set(CASE_TURN_ASSERTION_FIELDS);
  const turns = [];
  for (let i = 0; i < turnCount; i++) {
    const baseTurn = existingTurns[i];
    const text = baseTurn?.userInput
      ? String(baseTurn.userInput)
      : makePromptText(expectedTool, boundary, index + i + 1);
    turns.push({
      turnIndex: i + 1,
      userInput: text,
      expectedTool: baseTurn?.expectedTool || expectedTool,
      expectedArgs: baseTurn?.expectedArgs ?? '',
      replyContains: Array.isArray(baseTurn?.replyContains) ? baseTurn.replyContains : [],
      replyNotContains: Array.isArray(baseTurn?.replyNotContains) ? baseTurn.replyNotContains : [],
      judgePrompt: baseTurn?.judgePrompt || '',
      judgeThreshold: baseTurn?.judgeThreshold ?? ''
    });
    const turn = turns[turns.length - 1];
    if (!selectedAssertionFields.has('expectedArgs')) turn.expectedArgs = '';
    if (!selectedAssertionFields.has('replyContains')) turn.replyContains = [];
    if (!selectedAssertionFields.has('replyNotContains')) turn.replyNotContains = [];
    if (!selectedAssertionFields.has('judgePrompt')) turn.judgePrompt = '';
    if (!selectedAssertionFields.has('judgeThreshold')) turn.judgeThreshold = '';
  }
  return turns;
}

function shortModuleToken(moduleKey) {
  const map = {
    vehicle_query: 'query',
    vehicle_control: 'control',
    operation_data: 'operation',
    rag_guard: 'rag',
    voice_ticket: 'ticket',
    ticket_extract: 'extract',
    ticket_route: 'route'
  };
  return map[moduleKey] || 'query';
}

function normalizeCaseIdPrefix(prefix, moduleToken) {
  const raw = String(prefix || '').trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
  return cleaned || `t1_${moduleToken}`;
}

function compactCaseSeed(prefix, used, start = 0) {
  for (let step = start; step < start + 1000; step++) {
    const suffix = String((nextId + step) % 1000).padStart(3, '0');
    const candidate = `${prefix}_${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return suffix;
    }
  }
  return String(nextId % 1000).padStart(3, '0');
}

function buildGenerationPrompt(payload, moduleDef) {
  if (String(payload.businessObjective || '').trim()) {
    const schema = generationSchemaForProject(payload.authContext || null);
    const allowedTools = normalizeAllowedTools(payload, moduleDef.tool);
    const targetGroup = payload.groupName || moduleDef.groupName;
    const selectedAssertionFields = Array.isArray(payload.selectedAssertionFields) && payload.selectedAssertionFields.length
      ? payload.selectedAssertionFields
      : schema.assertionFields;
    const dims = Array.isArray(payload.evalDimensions) && payload.evalDimensions.length
      ? payload.evalDimensions
      : schema.evalDimensions;
    const schemaPrompt = String(payload.schemaPrompt || '').trim() || [
      '输出字段结构：字段结构全项目统一，业务覆盖目标单独填写。',
      `必填字段：${schema.requiredFields.join(', ')}`,
      `轮次字段：${schema.turnFields.join(', ')}；断言字段：${selectedAssertionFields.join(', ')}`,
      `导入列：${schema.importColumns.join(', ')}`
    ].join('\n');
    return [
      '# 平台固定结构约束',
      '你是 Eval Console 的评测用例生成器。必须输出可直接解析入库的 JSON 数组，不允许输出 Markdown、注释或额外解释。',
      '平台会锁定输出字段结构，业务使用方可以编辑字段契约说明、业务覆盖目标和边界条件。',
      '',
      '# 项目 Schema',
      `schemaId: ${schema.schemaId}`,
      `projectId: ${schema.projectId}`,
      `requiredFields: ${schema.requiredFields.join(', ')}`,
      `turnFields: ${schema.turnFields.join(', ')}`,
      `selectedAssertionFields: ${selectedAssertionFields.join(', ')}`,
      `importColumns: ${schema.importColumns.join(', ')}`,
      `evalDimensions: ${dims.join(', ')}`,
      `riskLevels: ${schema.riskLevels.join(', ')}`,
      `defaultRiskLevel: ${payload.defaultRiskLevel || 'medium'}`,
      `userIdStrategy: ${payload.userTier || payload.userId || 'FULL'}`,
      `expectedToolStrategy: ${payload.expectedToolStrategy === 'llm' ? 'LLM 在 allowedTools 中选择' : '固定 expectedTool'}`,
      `allowedTools: ${allowedTools.join(', ')}`,
      ...schema.schemaNotes.map((note, idx) => `rule${idx + 1}: ${note}`),
      '',
      '# 可编辑字段契约',
      schemaPrompt,
      '',
      '# 业务覆盖目标',
      String(payload.businessObjective || '').trim(),
      '',
      '# 锁定目标分组',
      `groupName 必须固定为：${targetGroup}`,
      '业务覆盖目标只生成内容覆盖，不得改写分组；所有输出项的 groupName 都使用上面的固定值。',
      '',
      '# 输出要求',
      '每项必须包含 caseId、name、groupName、allowedTools、turns、expectedTools、evalDimensions、riskLevel。',
      'turns 中每轮必须包含 userInput 和 expectedTool。',
      'expectedTools 必须与 turns[].expectedTool 顺序一致。',
      `只生成这些断言字段：${selectedAssertionFields.join(', ')}；未选择的断言字段保持空值或空数组。`,
      `riskLevel 默认使用 ${payload.defaultRiskLevel || 'medium'}，除非业务覆盖目标明确要求更高风险。`,
      'userInput 要像真实用户说话，不要出现“请说明筛选条件(1)”等生成器痕迹。'
    ].join('\n');
  }
  if (String(payload.generationPrompt || '').trim()) return String(payload.generationPrompt).trim();
  const dims = Array.isArray(payload.evalDimensions) && payload.evalDimensions.length
    ? payload.evalDimensions
    : DEFAULT_EVAL_DIMENSIONS;
  const boundaryTags = Array.isArray(payload.boundaryTags) && payload.boundaryTags.length
    ? payload.boundaryTags.join('、')
    : '常规路径';
  return [
    '# 评测用例生成 Prompt',
    `目标分组: ${payload.groupName || moduleDef.groupName}`,
    `模块: ${moduleDef.groupName}`,
    `测试目标: ${String(payload.objective || '覆盖该模块的核心成功路径与失败边界').trim()}`,
    `边界标签: ${boundaryTags}`,
    `评测维度: ${dims.join('、')}`,
    `可选工具 allowedTools: ${normalizeAllowedTools(payload, moduleDef.tool).join('、')}`,
    '生成要求:',
    '1. 每条用例必须给出用户输入、期望工具 expectedTool、权限/数据前置条件和可复核判断点。',
    '2. 多轮场景要明确上下文引用关系，单轮场景要明确筛选条件。',
    '3. 同一批次必须落到同一个目标分组，便于后续按 group 运行和回归。',
    '输出格式: JSON 数组，每项包含 caseId、name、groupName、allowedTools、turns、expectedTools、evalDimensions。'
  ].join('\n');
}

function createGeneratedCase(payload, index, baseCase, usedCaseIds) {
  if (payload.projectId === VOICE_TICKET_PROJECT || payload.authContext?.projectId === VOICE_TICKET_PROJECT) {
    return createGeneratedVoiceTicketCase(payload, index, usedCaseIds);
  }
  const moduleKey = normalizeModule(payload.module);
  const moduleDef = LLM_MODULE_TOOL_MAP[moduleKey];
  const targetGroup = payload.groupName || moduleDef.groupName;
  const allowedTools = normalizeAllowedTools(payload, moduleDef.tool);
  const expectedTool = payload.expectedTool || allowedTools[index % allowedTools.length] || moduleDef.tool;
  const moduleToken = shortModuleToken(moduleKey);
  const caseIdPrefix = normalizeCaseIdPrefix(payload.caseIdPrefix, moduleToken);
  const boundary = Array.isArray(payload.boundaryTags) && payload.boundaryTags.length
    ? payload.boundaryTags[index % payload.boundaryTags.length]
    : '';
  const turns = buildGeneratedTurns(payload, expectedTool, boundary, index, baseCase);
  const created = now();
  const seed = compactCaseSeed(caseIdPrefix, usedCaseIds, index);
  const doc = {
    id: id('case'),
    caseId: `${caseIdPrefix}_${seed}`,
    name: `LLM生成-${moduleDef.groupName}-${index + 1}`,
    userId: payload.userId || uidFromTier(payload.userTier || 'FULL'),
    projectId: payload.projectId || inferProjectId(targetGroup, allowedTools),
    enabled: true,
    turns,
    allowedTools,
    tags: [boundary].filter(Boolean).join(','),
    source: 'llm',
    groupName: targetGroup,
    generationPrompt: buildGenerationPrompt({ ...payload, groupName: targetGroup, allowedTools }, moduleDef),
    evalDimensions: Array.isArray(payload.evalDimensions) && payload.evalDimensions.length ? payload.evalDimensions : DEFAULT_EVAL_DIMENSIONS,
    riskLevel: CASE_RISK_LEVELS.includes(payload.defaultRiskLevel) ? payload.defaultRiskLevel : 'medium',
    regression: false,
    regressionCandidate: false,
    regressionAudit: [],
    createdAt: created,
    updatedAt: created
  };
  return normalizeCase(doc);
}

function createGeneratedVoiceTicketCase(payload, index, usedCaseIds) {
  const targetGroup = payload.groupName || '工单结构化';
  const caseIdPrefix = normalizeCaseIdPrefix(payload.caseIdPrefix || 'voice_ticket', 'ticket');
  const seed = compactCaseSeed(caseIdPrefix, usedCaseIds, index);
  const created = now();
  const vehicleId = `X6S50${String(index + 2).padStart(2, '0')}`;
  const dialogueText = [
    '坐席：您好，请问有什么问题？',
    `用户：客户反馈 ${vehicleId} 在青岛园区 A 区打不开门，现场等了十分钟。`,
    '坐席：联系电话方便留一下吗？',
    index % 2 === 0 ? '用户：暂时没有电话，先派人处理。' : '用户：电话是 13800001234。'
  ].join('\n');
  const expectedTicket = {
    ticketType: 'vehicle_fault',
    issueType: 'door_open_failure',
    vehicleId,
    location: '青岛园区 A 区',
    priority: 'urgent',
    routeQueue: 'vehicle_ops_queue',
    missingFields: index % 2 === 0 ? ['contactPhone'] : []
  };
  const doc = {
    id: id('case'),
    caseId: `${caseIdPrefix}_${seed}`,
    name: `ASR工单生成-${index + 1}`,
    projectId: VOICE_TICKET_PROJECT,
    caseType: 'voice_ticket_dialogue',
    enabled: true,
    tags: 'ASR,语义测评',
    source: 'llm',
    groupName: targetGroup,
    generationPrompt: buildGenerationPrompt({ ...payload, groupName: targetGroup }, LLM_MODULE_TOOL_MAP.voice_ticket),
    payload: {
      dialogueText,
      expectedTicket,
      assertions: {
        mustExtract: ['ticketType', 'issueType', 'vehicleId', 'location', 'routeQueue'],
        mustNotInvent: expectedTicket.missingFields
      },
      noiseTags: ['多轮补全', '缺失字段识别']
    },
    evalDimensions: VOICE_TICKET_CASE_SCHEMA.evalDimensions,
    riskLevel: CASE_RISK_LEVELS.includes(payload.defaultRiskLevel) ? payload.defaultRiskLevel : 'medium',
    regression: false,
    regressionCandidate: false,
    regressionAudit: [],
    createdAt: created,
    updatedAt: created
  };
  return normalizeCase(doc);
}

function generateCasesForUpload(payload, ctx = null) {
  const mode = payload.mode === 'expand' ? 'expand' : 'generate';
  const toolSequence = toolSequenceFromCounts(payload.toolCounts);
  const count = toolSequence.length || Math.max(1, Math.min(50, Number(payload.count || 5)));
  const countedAllowedTools = toolSequence.length ? [...new Set(toolSequence)] : null;
  const safePayload = {
    ...payload,
    allowedTools: countedAllowedTools || payload.allowedTools,
    mode,
    count,
    authContext: ctx
  };
  const usedCaseIds = new Set(cases.filter((item) => typeof item.caseId === 'string').map((item) => item.caseId));
  safePayload.projectId = isAdminProject(ctx) ? payload.projectId : ctx.projectId;

  if (mode === 'expand') {
    const baseIds = Array.isArray(payload.baseCaseIds) ? payload.baseCaseIds : [];
    const baseCases = baseIds
      .map((cid) => caseById(cid, ctx))
      .filter(Boolean)
      .slice(0, count);
    if (!baseCases.length) {
      return { generated: [], warning: '未找到可扩写的基础用例，已跳过。' };
    }
    const generated = baseCases.map((baseCase, idx) => createGeneratedCase(safePayload, idx, baseCase, usedCaseIds));
    return { generated, warning: '' };
  }

  const generated = [];
  for (let i = 0; i < count; i++) {
    generated.push(createGeneratedCase({ ...safePayload, expectedTool: toolSequence[i] }, i, null, usedCaseIds));
  }
  return { generated, warning: '' };
}

function csvCases() {
  const rows = [
    CASE_IMPORT_COLUMNS,
    ...cases.map((item) => caseSchemaCsvRow(normalizeCase(item)))
  ];
  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
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

function turnCsvCells(turn = {}) {
  return [
    turn.userInput || '',
    turn.expectedTool || '',
    stringifyCsvField(turn.expectedArgs),
    listValue(turn.replyContains).join('|'),
    listValue(turn.replyNotContains).join('|'),
    turn.judgePrompt || '',
    turn.judgeThreshold ?? ''
  ];
}

function stringifyCsvField(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

async function routeApi(req, res, url) {
  const path = url.pathname.replace('/admin/eval/api', '');
  const method = req.method || 'GET';

  if (method === 'GET' && path === '/env') return json(res, ok({ env: 'local-demo' }));
  if (method === 'GET' && path === '/auth/status') {
    return json(res, ok(services().projects.status(req)));
  }
  const ctx = authContext(req);

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
  if (method === 'GET' && path === '/agent-versions') return json(res, ok(AGENT_VERSIONS));
  if (method === 'GET' && path === '/dataset-versions') return json(res, ok(DATASET_VERSIONS));
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

  if (method === 'GET' && path === '/prompt-keys') return json(res, ok(promptKeysForProject(ctx)));
  if (method === 'GET' && path === '/prompt-content') {
    const key = url.searchParams.get('key') || '';
    return json(res, ok({ key, content: promptContentForProject(key, ctx) }));
  }

  return notFound(res);
}

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (url.pathname.startsWith('/admin/eval/api')) return routeApi(req, res, url);
    if (url.pathname.startsWith('/admin/eval/assets/')) {
      if (await serveStaticAsset(res, url.pathname)) return;
      return notFound(res);
    }
    if (url.pathname === '/' || url.pathname === '/admin/eval') {
      try {
        return text(res, await sourceHtml(), 'text/html; charset=utf-8');
      } catch (error) {
        return text(
          res,
          `<h1>Eval Admin Clone</h1><p>本地页面文件读取失败：${String(error.message || error)}</p><p>请确认 ${PUBLIC_INDEX_HTML} 存在后刷新。</p>`,
          'text/html; charset=utf-8'
        );
      }
    }
    return notFound(res);
  } catch (error) {
    json(res, { code: '500', message: String(error.message || error) }, 500);
  }
}

export default handleRequest;

const server = http.createServer(handleRequest);

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  server.listen(PORT, HOST, () => {
    console.log(`Eval admin clone: http://localhost:${PORT}/admin/eval`);
  });
}
