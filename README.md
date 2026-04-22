# Eval Admin Clone

本项目是 `/admin/eval` 的本地前后端复现与演进仓库。

- 前端主入口：`public/index.html`（唯一前端轨道）
- 后端主入口：`server.js`
- 后端业务模块：`src/backend/**`
- Serverless 适配：`api/server.js`
- 初始数据：`data/*.json`
- 运行态存储：`data/runtime.sqlite`（cases/runs）

说明：JSON 文件只作为初始化 seed，运行中的用例与运行记录会写入 SQLite。

## 启动

```bash
cd /Users/yuany/neolix/eval_platform/eval-admin-clone
npm install
npm run start:api
```

打开：

```text
http://localhost:5178/admin/eval
```

## 说明

服务启动后访问页面时，会读取本地 `public/index.html`；接口请求全部落到本地 Node API。

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

## 页面与后端修改入口

```text
前端页面：public/index.html
后端入口：server.js
后端模块：src/backend/
```

更多架构说明见：`docs/architecture.md`
