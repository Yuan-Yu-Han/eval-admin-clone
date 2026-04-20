# Eval Admin Clone 离线复现版

本目录是 `/admin/eval` 评测管理平台的完全离线复现 demo。当前版本同时作为“产品经理给开发讲需求”的 mock 原型，用半真半假的数据解释 Agent 测评平台一期需要补齐的能力：

- 页面层已固化到本地 `public/index.html`，后续页面改动直接改这个文件。
- API 层由本地 Node.js 服务仿真，覆盖 Cases、Runs、Mock、Prompt 等主要接口。
- Cases 增加来源、风险等级、评测维度、回归集、期望参数和回复质量要求。
- Runs 增加 Agent / Prompt / Git / Mock 版本记录，用于说明结果可复现和版本对比。
- Run Detail 增加链路漏斗、失败原因分布、风险摘要、Tool Calls、参数 diff、Trace timeline 和 LLM Judge。
- Runs 列表提供 mock 对比入口，用于解释 Fail -> Pass / Pass -> Fail 和阶段指标变化。
- 页面资源、样式、脚本和 mock 数据都在本地，不依赖原站 IP 或外部网络。
- 不需要安装依赖，使用 Node.js 内置 `http` 模块即可运行。

## 启动

```bash
cd /Users/yuany/neolix/eval_platform/eval-admin-clone
npm start
```

打开：

```text
http://localhost:5178/admin/eval
```

## 说明

服务启动后访问页面时，会读取本地 `public/index.html`；接口请求全部落到本地 demo 数据。
即使原站关闭、断网或页面被改，本 demo 仍可独立打开和演示。

## 部署到 Vercel

项目已包含 Vercel 适配：

- `api/server.js` 将本地 Node 服务包装成 Vercel Serverless Function。
- `vercel.json` 将 `/`、`/admin/eval` 和 `/admin/eval/api/*` 路由到该函数。
- 本地仍然使用 `npm start` 运行。

推荐流程：

```bash
npm test
git push
```

然后在 Vercel 导入对应 GitHub 仓库。部署完成后访问：

```text
https://你的-vercel-域名/admin/eval
```

## 页面修改入口

```text
public/index.html
```

如需修改 mock 数据、接口逻辑、run 结果生成规则，修改：

```text
server.js
```
