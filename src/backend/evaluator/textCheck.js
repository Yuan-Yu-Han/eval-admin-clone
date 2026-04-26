import { objectText, splitExpectedContent } from './fieldCheck.js';

export function evaluateTextStage(stage, expectedMap, expected, actualOutput) {
  const reply = objectText(actualOutput.final_reply || actualOutput.reply || actualOutput.llmReplyText || '');
  const contains = splitExpectedContent(expectedMap[`${stage.key}_contains`] ?? expected);
  const notContains = splitExpectedContent(expectedMap[`${stage.key}_not_contains`] ?? '');
  const exact = String(expectedMap[`${stage.key}_exact`] || '').trim();
  const regex = String(expectedMap[`${stage.key}_regex`] || '').trim();
  let pass = true;
  if (stage.method === 'exact_match') pass = reply.trim() === exact;
  else if (stage.method === 'regex_match') {
    try {
      pass = new RegExp(regex).test(reply);
    } catch {
      pass = false;
    }
  } else {
    pass = contains.every((term) => reply.includes(term)) && notContains.every((term) => !reply.includes(term));
  }
  return {
    stage_key: stage.key,
    stage_name: stage.name,
    eval_type: 'text_match',
    pass,
    score: null,
    expected: [
      contains.length ? `包含: ${contains.join(', ')}` : '',
      notContains.length ? `不能包含: ${notContains.join(', ')}` : '',
      exact ? `完全一致: ${exact}` : '',
      regex ? `正则: ${regex}` : ''
    ].filter(Boolean).join('\n'),
    actual: reply,
    reason: pass ? '文本检查通过' : '最终回复未满足文本检查规则'
  };
}
