# Run 页面链路漏斗设计说明

## 先说结论

Run 页面不要只看 `expectedTool` 和 `actualTool` 是否一致。

因为这只能说明一件事：

```text
Agent 有没有选对业务能力
```

但一次 case 真正跑起来，中间还会经过很多环节：

```text
用户输入
→ Agent 判断意图
→ 选择业务能力
→ 业务能力内部执行
→ 返回 SkillResult
→ 根据 resultType 选择渲染 Prompt
→ 生成最终回复
→ Eval 判定通过或失败
```

所以我们要把 Run 详情页拆成两层：

```text
第一层：Run 级链路漏斗
用于看整批 case 哪个大环节掉得最多。

第二层：单个 case 的真实执行链路
用于看某一个 case 具体是怎么失败的。
```

## 为什么现在容易看不懂

现在页面里有几个词混在一起：

```text
Agent
function
expectedTool
actualTool
Skill
SkillResult
resultType
Prompt
```

它们不是同一个东西。

可以先这样理解：

| 名字 | 人话解释 |
| --- | --- |
| Agent | 负责判断用户想干嘛，并决定调用哪个业务能力 |
| expectedTool | 测试用例期望 Agent 调用的业务能力 |
| actualTool | Agent 实际调用的业务能力 |
| function / 业务能力 | 例如查车、车控、运营数据查询、RAG |
| Skill | 后端真正执行这个能力的模块 |
| SkillResult | Skill 执行后返回的结构化 JSON |
| resultType | SkillResult 的类型，用来决定怎么渲染 |
| Prompt | 控制 Agent 怎么决策，或者控制结果怎么说成人话 |

最关键的区别是：

```text
expectedTool / actualTool 是“选没选对能力”
SkillResult 是“能力执行后返回了什么”
Prompt 是“怎么决策或怎么渲染”
```

## 一个 case 的真实链路

以一句用户输入为例：

```text
用户：昨天全国运营情况怎么样
```

理想链路是：

```text
1. 用户输入
2. Agent 判断这是运营数据问题
3. Agent 选择 vehicle_operation_data_query
4. 运营数据 Agent 继续判断要查哪些指标
5. 内部调用 query_metrics / trend_analysis 等数据工具
6. 返回 SkillResult
7. SkillResult 的 resultType 是 operation_data_report
8. 使用 persona-render-operation-report 渲染成报告
9. 用户看到最终回复
10. Eval 判断这条 case 是否通过
```

这时 `expectedTool` 和 `actualTool` 都应该是：

```text
vehicle_operation_data_query
```

如果一致，只能说明第 3 步选对了。

但后面第 4 到第 8 步仍然可能出错。

比如：

```text
日期解析错了
指标选错了
内部数据工具选错了
SkillResult 返回空
resultType 不对
渲染 Prompt 把 JSON 说错了
最终回复缺字段
```

这些问题不是 `expectedTool == actualTool` 能发现的。

## 为什么不能设计成固定步骤漏斗

因为不同 function 的链路不一样。

比如：

### 运营数据查询

```text
用户输入
→ Agent 选择 vehicle_operation_data_query
→ 解析城市/日期/指标
→ 选择内部数据工具
→ 查询数据
→ 生成 SkillResult
→ 渲染运营报告
→ 最终回复
```

### 车控

```text
用户输入
→ Agent 选择 vehicle_control
→ 解析车辆
→ 解析动作
→ 检查权限
→ 检查车辆状态
→ 执行动作
→ 生成 SkillResult
→ 渲染操作结果
→ 最终回复
```

### 查车

```text
用户输入
→ Agent 选择 vehicle_selective_query
→ 解析筛选条件
→ 查询车辆列表
→ 生成 SkillResult
→ 渲染车辆列表
→ 最终回复
```

### freeChat

```text
用户输入
→ Agent 选择 freeChat
→ 直接回复
```

所以不能要求所有 case 都走同一套固定步骤。

正确做法是：

```text
Run 级评测归因固定
Case 级步骤动态
```

## Run 级总体指标应该怎么设计

Run 级总体指标是给老板看的，用来回答：

```text
这一批测试到底卡在哪一层？
```

不要把它画成“真实执行流程漏斗”。

更准确的名字是：

```text
Run 级评测归因
```

建议展示 5 个指标：

| 指标 | 说明 | 主要回答的问题 |
| --- | --- | --- |
| 1. Case 通过率 | 这批 case 最终整体通过情况 | pass 的 case 有多少 |
| 2. 意图路由正确率 | Agent 有没有选对业务能力 | expectedTool 和 actualTool 是否一致 |
| 3. 输入条件保留率 | 用户明确说出的条件有没有传进结果链路 | 车号、城市、日期、动作词是否在 SkillResult 或回复里体现 |
| 4. SkillResult 结构正常率 | SkillResult 是否完整可解析 | JSON 是否能解析，是否有 skill、success、resultType、data |
| 5. 回复忠实率 | 最终回复有没有忠实复述 SkillResult | 有没有把失败说成成功、有没有脱离结构化返回 |

这里要特别注意：

```text
这些指标是 Run 级问题归因，不是每个 case 的真实执行步骤。
```

也就是说，上面的指标是统一看板，不代表每个 case 都真的按这个顺序执行。

还要特别注意：

```text
这些指标不判断数据库结果是否真实正确。
```

比如 SkillResult 里返回：

```text
运营车辆数：7,707
有效任务数：115,416
```

如果没有数据库真值、mock 真值或可复算查询，就不能说这两个数字一定对。

我们只能检查：

```text
用户参数有没有被正确传进去
SkillResult 结构是不是正常
最终回复有没有忠实复述 SkillResult
```

## Run 级指标的统计口径

不要简单用：

```text
通过数 / 总 case 数
```

因为有些阶段对某些 case 不适用。

比如 `freeChat` 没有 SkillResult。

它不应该被算作：

```text
结构化结果失败
```

而应该算作：

```text
跳过 / 不适用
```

所以每个诊断指标应该显示：

```text
通过：多少
失败：多少
未检查：多少
已检查：多少
```

页面上可以这样展示：

```text
SkillResult 结构正常率
通过 42 / 48
失败 6
未检查 13

说明：只统计会返回 SkillResult 的 case，freeChat 这类直接回复 case 不参与该阶段统计。
```

这个比单纯的 `42/61` 更准确。

## 单个 case 应该怎么展示

单个 case 展开后，不要强行塞进固定漏斗。

应该展示这个 case 的真实执行步骤：

```text
本 case 实际步骤数：N
```

然后按实际链路展示。

### 示例：运营数据 case

```text
本 case 实际步骤数：8

1. 用户输入：昨天全国运营情况怎么样
2. 意图路由：选择 vehicle_operation_data_query
3. 查询解析：城市=全国，日期=昨天，模式=report
4. 内部工具：query_metrics
5. SkillResult：operation_data_report
6. 渲染 Prompt：persona-render-operation-report
7. 最终回复：生成运营报告
8. Eval 判定：PASS
```

### 示例：车控 case

```text
本 case 实际步骤数：9

1. 用户输入：X6S5002把声音调大
2. 意图路由：期望 vehicle_control，实际 vehicle_selective_query
3. 路由判定：FAIL
4. 实际 Skill：vehicle_selective_query
5. SkillResult：action_result
6. 渲染 Prompt：persona-render-action-result
7. 最终回复：X6S5002已成功调高音量
8. Eval 判定：FAIL
9. 失败原因：期望车控能力，但实际走了查车/选车能力
```

### 示例：freeChat case

```text
本 case 实际步骤数：4

1. 用户输入
2. 意图路由：freeChat
3. 直接生成回复
4. Eval 判定
```

这就是“步骤数量不固定”的正确展示方式。

## 有 SkillResult 时怎么评估中间链路

只评估三件能站得住的事：

```text
1. 用户参数有没有被正确传进去
2. SkillResult 结构是不是正常
3. 最终回复有没有忠实复述 SkillResult
```

不要评估：

```text
数据库查出来的数字是不是真的对
```

除非以后接入了：

```text
mock 真值
数据库复算结果
人工标注 expectedResult
```

### 1. 输入条件保留

看用户明确说出来的条件有没有进入 SkillResult 或最终回复。

比如：

```text
用户：X6S5002把声音调大
```

可以检查：

```text
X6S5002 是否出现在 SkillResult 或最终回复里
“调大声音”是否被保留成“调高音量”这类同义动作
```

再比如：

```text
用户：昨天全国运营情况怎么样
```

可以检查：

```text
SkillResult.filter.city 是否体现“全国”
SkillResult.filter.queryDate 是否体现“昨天”对应的日期
```

但不能检查：

```text
运营车辆数 7,707 是否真实正确
```

### 2. SkillResult 结构

看 SkillResult 是不是一个正常的结构化返回。

至少应该能看到：

```text
skill
success
resultType
data
```

不同 resultType 可以继续看基本结构：

```text
operation_data_report：有没有 sections
query_result：有没有 vehicles / summary
action_result：有没有 action / successCount / errorLabel
multi_turn_prompt：有没有 scene / llmMessage
```

### 3. 回复忠实度

看最终回复有没有忠实表达 SkillResult。

比如 SkillResult 是：

```text
success=false
errorLabel=无点位采集权限
```

最终回复应该类似：

```text
无点位采集权限，无法完成加站点操作
```

如果回复变成：

```text
已成功添加站点
```

那就是回复忠实度失败。

## 不同 function 的中间链路关注点

### vehicle_operation_data_query

这个能力内部比较复杂，但在没有数据库真值时，只建议看：

```text
城市/日期/指标词有没有在 SkillResult 中体现
SkillResult 是否有 sections
resultType 是否正确
最终回复是否忠实复述 sections 里的关键内容
```

### vehicle_selective_query

建议看：

```text
用户输入里的车辆 ID / 筛选词有没有在 SkillResult 中体现
SkillResult 是否有 vehicles / totalCount / displayedCount
最终回复是否忠实复述车辆列表
是否没有编造 immutableKeys 之外的信息
```

### vehicle_control / open_door

建议看：

```text
目标车辆是否在 SkillResult 或回复里保留
动作词是否在 SkillResult 或回复里保留
SkillResult 是否是 action_result
失败原因是否被保留
回复是否和执行结果一致
```

### RAG

建议看：

```text
是否触发检索
是否找到证据
回答是否基于证据
没有证据时是否拒答或澄清
```

### freeChat

建议看：

```text
是否正确判断不需要工具
是否没有误调用业务能力
回复是否符合基础人格
```

## 页面设计建议

### Run 级评测归因

展示这 5 个指标：

```text
Case 通过率
意图路由正确率
输入条件保留率
SkillResult 结构正常率
回复忠实率
```

每个卡片显示：

```text
通过 / 已检查
失败数
未检查数
这个指标是什么意思
这个指标不判断什么
```

### Case 展开区

展示：

```text
期望业务能力：expectedTool
实际业务能力：actualTool
链路模板：根据 actualTool 决定
本 case 实际步骤数：N
真实执行步骤时间线
SkillResult 折叠查看
最终回复
失败原因
```

## 最终方案一句话

这个 Run 级指标应该这样设计：

```text
Run 顶部用评测归因指标，方便看整批问题分布。
Case 展开用动态执行链路，方便看单条 case 怎么跑。
不同 function 用不同内部链路模板，不能强行套同一套步骤。
统计时区分通过、失败、未检查，避免把不适用的 case 算成失败。
```

这样老板能看懂：

```text
这一批主要错在意图路由，还是内部执行，还是最终回复。
```

工程同学也能看懂：

```text
这个 case 具体错在哪一步。
```
