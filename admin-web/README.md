# XHunt Admin React

## 启动方式

在项目根目录执行：

```bash
yarn admin-web:dev
```

默认会通过 Vite 代理请求到：

```bash
https://kb.cryptohunt.ai
```

如需修改后端代理地址，可设置环境变量：

```bash
VITE_API_TARGET=http://localhost:8090
```

### 当前默认策略

- 本地开发前端：`http://localhost:5174`
- 默认代理目标：`https://kb.cryptohunt.ai`

也就是说，当前 `admin-web` 默认是直接对接**线上接口**。

如果要切回本地后端，再显式设置：

```bash
VITE_API_TARGET=http://localhost:8090
```

### 登录态说明

由于前端页面运行在 `localhost:5174`，而接口在 `kb.cryptohunt.ai`，默认情况下浏览器不会天然复用线上登录态。

当前方案默认依赖：

- 坤哥通过浏览器插件或其它方式处理 cookie / 登录态注入

这只是第一阶段联调方案，后续更推荐把前端挂到同域路径，例如：

- `https://kb.cryptohunt.ai/admin-react`

## 当前阶段

当前已完成：

- React + Vite + TypeScript + Ant Design 基础壳子
- 管理员会话接入（`/admin/session`）
- 基础后台 Layout
- 404 页面
- 无权限页面
- `日活详情` 与 `在线用户` 页面接入
- 其余首批页面路由骨架

尚未完成：

- `generic-stats` 真实数据接入
- `admin-audit-logs` 真实数据接入
- `url-stats` / `version-stats` 真实数据接入
- 后续按原后台顺序继续迁移剩余页面
