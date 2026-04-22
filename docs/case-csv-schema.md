# Case CSV Schema

本文定义评测平台的通用 Case CSV 契约。该契约用于 Case 导入、导出、新建页面表单映射，以及评测执行时对 evaluator 的参数解释。

## 设计目标

- 不按业务项目定制大量专用列。
- 用统一的输入列表达被测系统入参。
- 一个 case 支持多个评测点，例如结构匹配、文本匹配和语义评测。
- CSV 保持宽表结构，方便表格编辑和导入导出。
- 页面可以用结构化表单编辑，底层保存为同一套 CSV 字段。

## 标准字段

字段顺序固定如下：

```text
enable
case_id
name
group_name
tags
user_id
input1
input2
input3
eval_type_1
expected_arg_1
judge_prompt_id_1
eval_type_2
expected_arg_2
judge_prompt_id_2
eval_type_3
expected_arg_3
judge_prompt_id_3
```

## 字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `enable` | 否 | 是否启用。为空默认启用。建议使用 `true` / `false`。 |
| `case_id` | 是 | 项目内唯一的稳定用例 ID。用于导入、导出、运行结果追踪。 |
| `name` | 是 | 用例名称。用于列表展示和人工识别。 |
| `group_name` | 否 | 用例分组。为空时由项目默认分组兜底。 |
| `tags` | 否 | 标签。多个标签建议用 `|` 分隔，例如 `开门|高风险`。 |
| `user_id` | 否 | 被测系统需要的用户上下文。车辆 Agent 项目使用；不需要用户身份的项目留空。 |
| `input1` | 是 | 第一个输入。单轮 case 只填此列。 |
| `input2` | 否 | 第二个输入。用于多轮对话或补充输入。 |
| `input3` | 否 | 第三个输入。用于多轮对话或补充输入。 |
| `eval_type_1` | 是 | 第一个评测点类型。 |
| `expected_arg_1` | 否 | 第一个评测点参数。由 `eval_type_1` 决定格式；可填写普通文本，也可填写 JSON。 |
| `judge_prompt_id_1` | 否 | 第一个评测点使用的 LLM judge prompt ID。仅在该评测点需要 LLM 判断时填写。 |
| `eval_type_2` | 否 | 第二个评测点类型。 |
| `expected_arg_2` | 否 | 第二个评测点参数。 |
| `judge_prompt_id_2` | 否 | 第二个评测点使用的 LLM judge prompt ID。 |
| `eval_type_3` | 否 | 第三个评测点类型。 |
| `expected_arg_3` | 否 | 第三个评测点参数。 |
| `judge_prompt_id_3` | 否 | 第三个评测点使用的 LLM judge prompt ID。 |

## 核心约定

一个 case 最多定义 3 个评测点。每个评测点由一组三列组成：

```text
eval_type_N
expected_arg_N
judge_prompt_id_N
```

`eval_type_N` 决定平台调用哪种 evaluator。

`expected_arg_N` 是传给该 evaluator 的期望参数，不等同于业务工具的 args。它可以表达结构化字段、函数名、关键文本，或语义评测的额外配置。简单场景可以直接填写函数名、字段名或关键文本；复杂场景可以填写 JSON。

`judge_prompt_id_N` 是可复用 judge prompt 的引用。若 `eval_type_N` 不需要 LLM，则留空。

## eval_type 建议枚举

第一版建议支持以下类型：

| eval_type | 中文名 | 用途 | expected_arg 示例 |
| --- | --- | --- | --- |
| `structure_match` | 结构匹配 | 检查结构化输出、函数名、参数字段等是否符合预期。 | `open_door` 或 `ticketType|issueType|vehicleId` |
| `text_match` | 文本匹配 | 检查最终文本回复是否命中期望关键文本。 | `已为你开门|成功` |
| `llm_judge` | 语义评测 | 使用 LLM judge 做语义评分。 | `threshold=0.8` |

后续可以扩展新的 `eval_type`，但应保持三列组合不变。

## expected_arg 格式

`expected_arg_N` 支持两种格式。

简单文本格式：

```text
open_door
```

```text
已为你开门|成功
```

JSON 格式适合更复杂的结构化规则。例如文本匹配规则：

```json
{"contains":["已为你开门"],"notContains":["系统错误"]}
```

写入 CSV 单元格时，按 CSV 转义规则将双引号写成两个双引号，并用双引号包裹整个单元格：

```csv
"{""contains"":[""已为你开门""],""notContains"":[""系统错误""]}"
```

页面新建或编辑时不应要求用户手写转义后的 CSV。页面可以让用户直接填写函数名、字段名、关键文本或评测说明；如需复杂结构，再允许填写 JSON。

## 车辆 Agent 示例

车辆 Agent 通常使用 `user_id` 和多轮输入。一个 case 可以同时检查结构字段、回复文本和语义评测。

```csv
enable,case_id,name,group_name,tags,user_id,input1,input2,input3,eval_type_1,expected_arg_1,judge_prompt_id_1,eval_type_2,expected_arg_2,judge_prompt_id_2,eval_type_3,expected_arg_3,judge_prompt_id_3
true,t1_door_001,开门基本流程,开门场景,开门|成功,900100000,帮我打开车门,,,structure_match,open_door,,text_match,已为你开门|成功,,llm_judge,threshold=0.8,vehicle_control_success_v1
```

多轮输入示例：

```csv
enable,case_id,name,group_name,tags,user_id,input1,input2,input3,eval_type_1,expected_arg_1,judge_prompt_id_1,eval_type_2,expected_arg_2,judge_prompt_id_2,eval_type_3,expected_arg_3,judge_prompt_id_3
true,t1_multi_open_001,多轮选车后开门,车辆控制,多轮|开门,900100000,附近有什么车,第一辆,帮我开门,structure_match,open_door,,text_match,开门,,llm_judge,threshold=0.8,vehicle_control_success_v1
```

## 语音工单示例

语音工单通常不需要 `user_id`。完整 ASR 对话可以放在 `input1`，`input2` 和 `input3` 留空。

```csv
enable,case_id,name,group_name,tags,user_id,input1,input2,input3,eval_type_1,expected_arg_1,judge_prompt_id_1,eval_type_2,expected_arg_2,judge_prompt_id_2,eval_type_3,expected_arg_3,judge_prompt_id_3
true,voice_ticket_001,开门失败-缺联系电话,工单结构化,字段抽取|缺失字段,,"坐席：您好，请问有什么问题？
用户：车打不开了，客户在现场挺急的。
坐席：是哪辆车？
用户：X6S5002，在青岛园区 A 区。",,,structure_match,ticketType|issueType|vehicleId|location,,structure_match,missingFields: contactPhone; mustNotInvent: contactPhone,,llm_judge,threshold=0.85,voice_ticket_structuring_v1
```

## 校验规则

导入时建议执行以下校验：

- `case_id` 必填，且在当前项目内唯一。
- `name` 必填。
- `input1` 必填。
- 至少存在一个有效评测点，即至少填写 `eval_type_1`。
- 如果填写了 `eval_type_N`，则该类型必须是平台支持的 evaluator 类型。
- `expected_arg_N` 可以是普通文本；当内容以 JSON 方式填写时，应是合法 JSON object。
- 如果 `eval_type_N = llm_judge`，建议填写 `judge_prompt_id_N`，或在 `expected_arg_N` 中提供足够的 judge 配置。
- `enable` 为空时按 `true` 处理。
- `tags` 使用 `|` 分隔；导入后可规范化为数组或原始字符串。

## 页面映射建议

CSV 是存储和导入导出协议，页面不应直接暴露复杂 JSON 转义。

新建 Case 页面建议按以下结构展示：

```text
基础信息
- enable
- case_id
- name
- group_name
- tags
- user_id

输入
- input1
- input2
- input3

评测点 1
- eval_type_1
- expected_arg_1 的结构化表单
- judge_prompt_id_1

评测点 2
- eval_type_2
- expected_arg_2 的结构化表单
- judge_prompt_id_2

评测点 3
- eval_type_3
- expected_arg_3 的结构化表单
- judge_prompt_id_3
```

列表页建议展示每个 case 的：

- 启用状态
- `name` 和 `case_id`
- `group_name` 与 `tags`
- `input1` 摘要
- 评测点摘要，例如 `structure_match + text_match + llm_judge`
- 最近运行结果
