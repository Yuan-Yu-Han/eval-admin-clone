# Eval Admin Clone 架构说明

## 当前主架构

这是一个同仓库的前后端项目：

- 前端主入口：`public/index.html`
- 后端主入口：`server.js`
- Serverless 适配：`api/server.js`
- 业务后端模块：`src/backend/**`
- 运行态存储：`data/runtime.sqlite`（当前承载 cases/runs）

## 请求流

1. 浏览器访问 `/admin/eval`
2. 后端返回 `public/index.html`
3. 页面通过 `/admin/eval/api/*` 调用后端接口
4. 后端服务层通过 `src/backend/services/**` 处理业务
5. 启动时使用 `data/*.json` 作为 seed，运行态读写走 SQLite

## 目录职责

- `public/`: 当前上线 UI（单文件）
- `src/backend/`: 后端配置、仓储、服务
- `data/`: 初始 seed + SQLite 运行态数据库
- `api/`: Vercel 适配入口
- `test/`: 接口与适配测试

## 单轨约束

前端只保留 `public/index.html`，不再维护并行 React/Vite 页面。

## 建议重构路径（保持 UI 不变）

阶段 1（已完成）：

- 以 `public/index.html` 作为唯一前端真源
- 继续用 `server.js + src/backend/**` 作为唯一后端入口
- 移除并行前端轨，测试与脚本统一到单轨

阶段 2（进行中）：

- 运行态数据从 JSON 迁移到 SQLite（已接入 cases/runs）
- 保持 API 路径不变，前端零改动

阶段 3：

- 将 `server.js` 的路由层进一步拆分到 `src/backend/http/**`
- 保留 `server.js` 作为启动入口和兼容层
