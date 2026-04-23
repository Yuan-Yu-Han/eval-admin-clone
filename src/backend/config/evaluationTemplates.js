const PASS_FAIL_REPLY_PROMPT = [
  '你是一个 AI 评测员，请判断最终回复是否通过当前检查点。',
  '',
  '评审目标：判断最终回复是否准确回应用户问题，是否忠实于可用上下文或工具结果，是否没有编造事实。',
  '',
  '通过标准：',
  '1. 回复直接回答用户需求，没有答非所问。',
  '2. 回复内容与检索结果、工具结果或已知上下文一致。',
  '3. 如果任务成功，回复要清楚说明成功结果；如果任务失败或信息不足，回复要如实说明。',
  '4. 回复没有遗漏会影响用户理解的关键事实、状态或限制条件。',
  '',
  '失败标准：',
  '1. 回复与实际结果冲突，或者把失败描述成成功。',
  '2. 回复缺少关键结论，用户无法判断任务是否完成。',
  '3. 出现没有依据的事实、数据、承诺或推断。',
  '4. 回复明显回避用户问题。',
  '',
  '请只输出 JSON：',
  '{"pass": true/false, "reason": "一句话说明原因"}'
].join('\n');

const SCORE_REPLY_PROMPT = [
  '你是一个 AI 评测员，请对最终回复进行 0-100 分评分。',
  '',
  '评分目标：衡量最终回复是否准确完成用户需求，是否忠实于可用上下文或工具结果，表达是否清楚、完整、可信。',
  '',
  '评分参考：',
  '90-100：完全回答用户问题，事实准确，关键信息完整，表达清楚，没有幻觉。',
  '75-89：基本正确，但有轻微遗漏、表达不够清楚或细节不够完整。',
  '60-74：部分正确，但遗漏重要信息，或用户需要额外追问才能理解结果。',
  '1-59：明显答非所问、事实错误、与工具结果冲突，或出现较严重幻觉。',
  '0：没有有效回答，或回复完全不可用。',
  '',
  '请重点检查：',
  '1. 是否真正解决用户问题。',
  '2. 是否忠实于工具调用、检索结果或已知上下文。',
  '3. 是否遗漏必要的状态、对象、参数、数据口径或失败原因。',
  '4. 是否出现未经依据支持的结论。',
  '',
  '请只输出 JSON：',
  '{"score": 0-100, "pass": true/false, "reason": "一句话说明主要扣分点"}'
].join('\n');

export const EVALUATION_TEMPLATES = [
  {
    templateId: 'answer_quality',
    name: '回答质量评测',
    category: 'preset',
    summary: '适合只看最终回复的场景，比如 RAG 问答、知识查询和自由对话。',
    projectIds: ['vehicle-agent-eval'],
    resultLabels: ['回复命中', '语义质量'],
    stages: [
      {
        key: 'replyFaithfulness',
        name: '回复命中',
        eval_type: 'text_match',
        method: 'contains',
        depends_on: null,
        prompt_id: null,
        blocks_downstream_on_fail: false,
        case_include_label: '回复必须包含',
        case_exclude_label: '回复不能包含',
        required_case_fields: [],
        description: '看最终回复有没有明确说到这条 Case 要求命中的关键信息。'
      },
      {
        key: 'responseQuality',
        name: '语义质量',
        eval_type: 'llm_judge',
        method: 'rubric_score',
        depends_on: 'replyFaithfulness',
        prompt_id: 'semantic-response-quality',
        prompt_content: SCORE_REPLY_PROMPT,
        judge_threshold: 80,
        blocks_downstream_on_fail: false,
        required_case_fields: [],
        description: '让 LLM 从用户视角判断这条回复是否说清楚、说对了、没有编造。'
      }
    ]
  },
  {
    templateId: 'instruction_execution',
    name: '指令执行评测',
    category: 'preset',
    summary: '适合有函数调用的指令场景，重点看工具选择、参数提取和最终回复。',
    projectIds: ['vehicle-agent-eval'],
    resultLabels: ['工具选择', '参数提取', '回复生成'],
    stages: [
      {
        key: 'functionInvocation',
        name: '工具选择',
        eval_type: 'structure_match',
        method: 'exact_match',
        target_field: 'function_name',
        depends_on: null,
        prompt_id: null,
        blocks_downstream_on_fail: true,
        case_field_label: '期望值',
        required_case_fields: [],
        description: '看这次请求有没有命中正确的函数或工具。'
      },
      {
        key: 'inputConditionRetention',
        name: '参数提取',
        eval_type: 'structure_match',
        method: 'json_subset_match',
        target_field: 'arguments',
        depends_on: 'functionInvocation',
        prompt_id: null,
        blocks_downstream_on_fail: true,
        case_field_label: '期望值',
        required_case_fields: [],
        description: '看函数需要的关键参数有没有提对，比如门位、动作、确认状态。'
      },
      {
        key: 'replyFaithfulness',
        name: '回复生成',
        eval_type: 'text_match',
        method: 'contains_and_not_contains',
        depends_on: 'inputConditionRetention',
        prompt_id: null,
        blocks_downstream_on_fail: false,
        case_include_label: '回复必须包含',
        case_exclude_label: '回复不能包含',
        required_case_fields: [],
        description: '看最终回复有没有把执行结果对用户说清楚，没有把失败说成成功。'
      }
    ]
  },
  {
    templateId: 'data_query',
    name: '数据查询评测',
    category: 'preset',
    summary: '适合运营数据、报表问答这类场景，重点看查询条件、中间数据调用和结果回答。',
    projectIds: ['vehicle-agent-eval'],
    resultLabels: ['工具选择', '参数提取', '中间调用', '回复生成', '语义质量'],
    stages: [
      {
        key: 'functionInvocation',
        name: '工具选择',
        eval_type: 'structure_match',
        method: 'exact_match',
        target_field: 'function_name',
        depends_on: null,
        prompt_id: null,
        blocks_downstream_on_fail: true,
        case_field_label: '期望值',
        required_case_fields: [],
        description: '看问题有没有进入正确的数据查询函数。'
      },
      {
        key: 'inputConditionRetention',
        name: '参数提取',
        eval_type: 'structure_match',
        method: 'json_subset_match',
        target_field: 'arguments',
        depends_on: 'functionInvocation',
        prompt_id: null,
        blocks_downstream_on_fail: true,
        case_field_label: '期望值',
        required_case_fields: [],
        description: '看城市、日期、指标等查询条件有没有被正确带入。'
      },
      {
        key: 'agentIntermediateCall',
        name: '中间调用',
        eval_type: 'structure_match',
        method: 'json_path_exists',
        target_field: 'intermediate_calls',
        depends_on: 'inputConditionRetention',
        prompt_id: null,
        blocks_downstream_on_fail: true,
        required_case_fields: [],
        description: '看回答前有没有真的拿到中间数据结果，而不是直接编造。'
      },
      {
        key: 'replyFaithfulness',
        name: '回复生成',
        eval_type: 'text_match',
        method: 'contains_and_not_contains',
        depends_on: 'agentIntermediateCall',
        prompt_id: null,
        blocks_downstream_on_fail: false,
        case_include_label: '回复必须包含',
        case_exclude_label: '回复不能包含',
        required_case_fields: [],
        description: '看最终回复有没有忠实表达中间数据结果，没有说偏。'
      },
      {
        key: 'responseQuality',
        name: '语义质量',
        eval_type: 'llm_judge',
        method: 'rubric_score',
        depends_on: 'replyFaithfulness',
        prompt_id: 'operation-data-agent-prompt',
        prompt_content: SCORE_REPLY_PROMPT,
        judge_threshold: 80,
        blocks_downstream_on_fail: false,
        required_case_fields: [],
        description: '让 LLM 判断这条数据回答是否清楚、可信、便于复核。'
      }
    ]
  },
  {
    templateId: 'custom_review',
    name: '自定义评测',
    category: 'custom',
    summary: '适合先快速搭一个评测流程，再按自己的业务检查点慢慢细化。',
    projectIds: ['vehicle-agent-eval'],
    resultLabels: ['自定义阶段'],
    stages: [
      {
        key: 'customStage',
        name: '自定义阶段',
        eval_type: 'llm_judge',
        method: 'binary_judge',
        depends_on: null,
        prompt_id: null,
        prompt_content: PASS_FAIL_REPLY_PROMPT,
        judge_threshold: 80,
        blocks_downstream_on_fail: false,
        required_case_fields: [],
        description: '先从一个自定义检查点开始，后面可以继续补更多检查点。'
      }
    ]
  },
  {
    templateId: 'voice_ticket_semantic',
    name: '语音工单语义评测',
    category: 'preset',
    summary: '适合语音工单结构化场景，重点看字段准确性、缺失信息和路由结果。',
    projectIds: ['voice-ticket-eval'],
    resultLabels: ['字段准确性', '缺失字段识别', '路由队列', '禁止编造', '对话依据'],
    stages: [
      {
        key: 'fieldAccuracy',
        name: '字段准确性',
        eval_type: 'llm_judge',
        method: 'rubric_score',
        depends_on: null,
        prompt_id: 'voice-ticket-field-accuracy',
        prompt_content: SCORE_REPLY_PROMPT,
        judge_threshold: 80,
        blocks_downstream_on_fail: false,
        required_case_fields: [],
        description: '看工单结构里的关键字段有没有忠实还原原始对话。'
      },
      {
        key: 'missingFieldDetection',
        name: '缺失字段识别',
        eval_type: 'llm_judge',
        method: 'binary_judge',
        depends_on: 'fieldAccuracy',
        prompt_id: 'voice-ticket-missing-field',
        prompt_content: PASS_FAIL_REPLY_PROMPT,
        judge_threshold: 80,
        blocks_downstream_on_fail: false,
        required_case_fields: [],
        description: '看没有说清楚的信息有没有被如实标记成缺失，而不是被补出来。'
      },
      {
        key: 'routeAccuracy',
        name: '路由队列',
        eval_type: 'llm_judge',
        method: 'binary_judge',
        depends_on: 'missingFieldDetection',
        prompt_id: 'voice-ticket-route-accuracy',
        prompt_content: PASS_FAIL_REPLY_PROMPT,
        judge_threshold: 80,
        blocks_downstream_on_fail: false,
        required_case_fields: [],
        description: '看工单结果有没有被路由到正确的后续处理队列。'
      },
      {
        key: 'noHallucination',
        name: '禁止编造',
        eval_type: 'llm_judge',
        method: 'binary_judge',
        depends_on: 'routeAccuracy',
        prompt_id: 'voice-ticket-no-hallucination',
        prompt_content: PASS_FAIL_REPLY_PROMPT,
        judge_threshold: 80,
        blocks_downstream_on_fail: false,
        required_case_fields: [],
        description: '看输出里有没有编造原始对话里根本没有的信息。'
      },
      {
        key: 'dialogueGrounding',
        name: '对话依据',
        eval_type: 'llm_judge',
        method: 'binary_judge',
        depends_on: 'noHallucination',
        prompt_id: 'voice-ticket-dialogue-grounding',
        prompt_content: PASS_FAIL_REPLY_PROMPT,
        judge_threshold: 80,
        blocks_downstream_on_fail: false,
        required_case_fields: [],
        description: '看关键判断是否都能在原始对话里找到依据。'
      }
    ]
  },
  {
    templateId: 'voice_custom_review',
    name: '语音工单自定义评测',
    category: 'custom',
    summary: '适合语音工单项目里的临时评测需求，可以先搭流程再细化规则。',
    projectIds: ['voice-ticket-eval'],
    resultLabels: ['自定义阶段'],
    stages: [
      {
        key: 'customStage',
        name: '自定义阶段',
        eval_type: 'llm_judge',
        method: 'binary_judge',
        depends_on: null,
        prompt_id: null,
        prompt_content: PASS_FAIL_REPLY_PROMPT,
        judge_threshold: 80,
        blocks_downstream_on_fail: false,
        required_case_fields: [],
        description: '先按当前语音工单需求定义一个检查点，后面可以继续扩展。'
      }
    ]
  }
];

export const FUNCTION_TEMPLATE_BINDINGS = [
  {
    functionName: 'RAG',
    templateId: 'answer_quality',
    promptOverrides: { responseQuality: 'rag-answer-quality-prompt' },
    expectedFields: ['reply_contains', 'reply_not_contains', 'judge_prompt'],
    notes: '重点看回答是否引用知识、是否避免编造。'
  },
  {
    functionName: 'freeChat',
    templateId: 'answer_quality',
    promptOverrides: { responseQuality: 'freechat-response-quality-prompt' },
    expectedFields: ['reply_contains', 'judge_prompt'],
    notes: '重点看自然回复质量和安全边界。'
  },
  {
    functionName: 'open_door',
    templateId: 'instruction_execution',
    promptOverrides: { replyFaithfulness: 'open-door-reply-faithfulness' },
    expectedFields: ['vehicleId', 'doorType', 'confirmed', 'reply_contains'],
    notes: '重点看车辆、门位和二次确认。'
  },
  {
    functionName: 'return_app_native_router',
    templateId: 'instruction_execution',
    promptOverrides: { replyFaithfulness: 'native-router-reply-faithfulness' },
    expectedFields: ['routeName', 'routeParams', 'reply_contains'],
    notes: '重点看 native 页面和参数。'
  },
  {
    functionName: 'start_collect_merchant_location',
    templateId: 'instruction_execution',
    promptOverrides: { replyFaithfulness: 'merchant-location-reply-faithfulness' },
    expectedFields: ['merchantId', 'locationType', 'reply_contains'],
    notes: '重点看采集对象和位置类型。'
  },
  {
    functionName: 'update_user_agent_name',
    templateId: 'instruction_execution',
    promptOverrides: { replyFaithfulness: 'agent-name-reply-faithfulness' },
    expectedFields: ['agentName', 'confirmed', 'reply_contains'],
    notes: '重点看昵称和确认态。'
  },
  {
    functionName: 'vehicle_control',
    templateId: 'instruction_execution',
    promptOverrides: { replyFaithfulness: 'vehicle-control-reply-faithfulness' },
    expectedFields: ['vehicleId', 'action', 'targetValue', 'confirmed', 'reply_contains'],
    notes: '重点看车辆、动作和控制参数。'
  },
  {
    functionName: 'vehicle_selective_query',
    templateId: 'instruction_execution',
    promptOverrides: { replyFaithfulness: 'vehicle-selective-query-reply' },
    expectedFields: ['selectionCriteria', 'vehicleId', 'reply_contains'],
    notes: '重点看候选车辆选择和上下文继承。'
  },
  {
    functionName: 'vehicle_operation_data_query',
    templateId: 'data_query',
    promptOverrides: { responseQuality: 'operation-data-agent-prompt' },
    expectedFields: ['city', 'date', 'metric', 'expected_trace', 'reply_contains'],
    notes: '重点看查询条件、中间数据调用和最终数据渲染。'
  }
];

export function templatesForProject(projectId) {
  if (!projectId || projectId === 'all') return EVALUATION_TEMPLATES;
  return EVALUATION_TEMPLATES.filter((item) => item.projectIds.includes(projectId));
}

export function functionBindingsForProject(projectId) {
  const templateIds = new Set(templatesForProject(projectId).map((item) => item.templateId));
  return FUNCTION_TEMPLATE_BINDINGS.filter((item) => templateIds.has(item.templateId));
}

export function templateMappingForProject(projectId) {
  return Object.fromEntries(functionBindingsForProject(projectId).map((item) => [item.functionName, item.templateId]));
}
