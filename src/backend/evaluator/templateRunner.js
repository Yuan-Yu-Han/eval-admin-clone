import { evaluateFieldStage } from './fieldCheck.js';
import { evaluateLlmStage } from './llmJudge.js';
import { evaluateTextStage } from './textCheck.js';

function expectedForStage(stage, expectedMap) {
  return expectedMap[stage.key]
    ?? expectedMap[`${stage.key}_exact`]
    ?? expectedMap[`${stage.key}_contains`]
    ?? stage.expected_content
    ?? '';
}

export function evaluateTemplateStage(stage, caseDoc, actualOutput) {
  const expectedMap = caseDoc.expected || {};
  const expected = expectedForStage(stage, expectedMap);
  if (stage.eval_type === 'structure_match') return evaluateFieldStage(stage, expected, actualOutput);
  if (stage.eval_type === 'text_match') return evaluateTextStage(stage, expectedMap, expected, actualOutput);
  return evaluateLlmStage(stage, actualOutput);
}

export function evaluateCase({ template, caseDoc, actualOutput, durationMs = 500 }) {
  const stageResults = (template.stages || []).map((stage) => evaluateTemplateStage(stage, caseDoc, actualOutput || {}));
  const pass = stageResults.every((stage) => stage.pass);
  const input = caseDoc.input1 || ((caseDoc.turns || [])[0]?.userInput) || '';
  const avgScore = Math.round(stageResults.reduce((sum, stage) => sum + stage.score, 0) / Math.max(1, stageResults.length));
  return {
    caseId: caseDoc.caseId,
    caseName: caseDoc.name,
    template_id: template.templateId,
    template_name: template.name,
    userId: caseDoc.userId,
    pass,
    failReason: pass ? '' : (stageResults.find((stage) => !stage.pass)?.reason || '模板评测未通过'),
    durationMs,
    toolMatchSummary: 'template',
    reviewFlagged: false,
    comments: [],
    caseMeta: caseDoc,
    stage_results: stageResults,
    stageChecks: stageResults.map((stage) => ({
      key: stage.stage_key,
      label: stage.stage_name,
      evalType: stage.eval_type,
      pass: stage.pass,
      score: stage.score,
      expected: stage.expected,
      actual: stage.actual,
      summary: stage.reason
    })),
    llmJudge: { score: avgScore, reason: pass ? '模板检查全部通过' : '存在未通过检查点' },
    turns: [{
      turnIndex: 1,
      userInput: input,
      actualTool: actualOutput?.function_name || '',
      expectedTool: (caseDoc.expected && caseDoc.expected.functionInvocation) || '',
      llmReplyText: actualOutput?.final_reply || actualOutput?.reply || '',
      skillResultJson: actualOutput?.arguments ? JSON.stringify({ arguments: actualOutput.arguments }) : '',
      hintsJson: JSON.stringify({ mockOutput: true, templateId: template.templateId })
    }]
  };
}
