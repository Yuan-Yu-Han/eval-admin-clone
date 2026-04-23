import { objectText } from './fieldCheck.js';

export function evaluateLlmStage(stage, actualOutput) {
  const score = 85;
  return {
    stage_key: stage.key,
    stage_name: stage.name,
    eval_type: 'llm_judge',
    pass: score >= Number(stage.judge_threshold || 80),
    score,
    expected: stage.prompt_content || '',
    actual: objectText(actualOutput.final_reply || actualOutput.reply || actualOutput.llmReplyText || ''),
    reason: 'Demo LLM 评审：按 Prompt 生成模拟评分'
  };
}
