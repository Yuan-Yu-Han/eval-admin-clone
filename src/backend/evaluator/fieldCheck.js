export function splitExpectedContent(value) {
  return String(value || '')
    .split(/[,，\n|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function objectText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function splitFieldPath(path) {
  return String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

function getByPath(source, path) {
  const parts = splitFieldPath(path);
  if (!parts.length) return { found: false, value: undefined };
  let current = source;
  for (const part of parts) {
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(Object(current), part)) {
      return { found: false, value: undefined };
    }
    current = current[part];
  }
  return { found: true, value: current };
}

function actualForField(stage, actualOutput) {
  const targetField = stage.target_field || stage.field_path || '';
  if (targetField) {
    const lookedUp = getByPath(actualOutput || {}, targetField);
    return {
      found: lookedUp.found,
      value: lookedUp.value,
      text: objectText(lookedUp.value)
    };
  }
  return {
    found: true,
    value: actualOutputText(actualOutput || {}, stage),
    text: actualOutputText(actualOutput || {}, stage)
  };
}

export function actualOutputText(actual, stage) {
  const name = String(stage.name || '').toLowerCase();
  if (/函数|工具|function|tool/.test(name)) return objectText(actual.function_name || actual.actualTool || actual.tool || actual.name || '');
  if (/参数|argument|args/.test(name)) return objectText(actual.arguments || actual.args || actual.params || {});
  if (/回复|文本|reply|answer/.test(name)) return objectText(actual.final_reply || actual.reply || actual.llmReplyText || '');
  if (/中间|调用|trace/.test(name)) return objectText(actual.intermediate_calls || actual.trace || actual.agent_trace || actual.calls || '');
  return objectText(actual);
}

export function evaluateFieldStage(stage, expected, actualOutput) {
  const targetField = stage.target_field || stage.field_path || '';
  const actualField = actualForField(stage, actualOutput || {});
  const actual = actualField.text;
  const terms = splitExpectedContent(expected);
  let pass = false;
  if (stage.method === 'json_path_exists') {
    pass = actualField.found;
  } else if (stage.method === 'exact_match') {
    pass = String(actual).trim() === String(expected).trim();
  } else {
    pass = terms.every((term) => actual.includes(term));
  }
  return {
    stage_key: stage.key,
    stage_name: stage.name,
    eval_type: 'structure_match',
    pass,
    score: pass ? 100 : 0,
    expected,
    actual,
    reason: pass
      ? '字段检查通过'
      : (stage.method === 'json_path_exists'
        ? `未找到字段「${targetField || stage.name}」`
        : `期望「${expected}」，实际「${actual}」`)
  };
}
