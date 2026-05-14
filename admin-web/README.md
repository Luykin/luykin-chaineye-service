# XHunt Admin React

## 启动方式

在项目根目录执行：

```bash
yarn admin-web:dev
```

默认情况下，前端会使用**当前页面同域的相对路径**发请求：

```bash
/admin/session
/api/...
```

这更适合以下场景：

- 后续正式接到 `https://kb.cryptohunt.ai/admin-react`
- 本地通过 `https://dev.kb.cryptohunt.ai` 之类的同域代理联调

如需显式直连某个后端，再设置环境变量：

```bash
VITE_API_BASE_URL=https://kb.cryptohunt.ai
```

### 当前默认策略

- 默认请求方式：相对路径（同域）
- 推荐联调域名：`https://dev.kb.cryptohunt.ai`
- 如需直连特定后端，再配置 `VITE_API_BASE_URL`

也就是说，当前 `admin-web` 更推荐跑在一个能承接 `/admin`、`/api` 的同域代理后面，而不是继续依赖 `localhost` 跨域复用线上 cookie。

如果要显式切到本地后端，再设置：

```bash
VITE_API_BASE_URL=http://localhost:8090
```

### 登录态说明

推荐使用同域方式复用后台登录态，例如：

- 页面入口：`https://dev.kb.cryptohunt.ai`
- 接口：`https://dev.kb.cryptohunt.ai/admin/...`
- 由本地代理再转发到真实后端

这样可以尽量避免：

- localhost 与线上域名的 cookie 隔离问题
- 跨域 CORS 问题
- 登录跳转不一致问题

如果仍然选择浏览器直连跨域接口，再显式配置：

```bash
VITE_API_BASE_URL=https://kb.cryptohunt.ai
```

但这种方式更适合临时排查，不适合作为主要开发模式。

## 推荐本地联调：`dev.kb.cryptohunt.ai`

当前仓库已经提供：

- `admin-web/Caddyfile`

推荐本地联调链路：

- 浏览器访问：`https://dev.kb.cryptohunt.ai`
- `Caddy -> Vite(127.0.0.1:5174)`
- `/admin/*`、`/api/*` 由 Caddy 继续转发到 `https://kb.cryptohunt.ai`

### 1. hosts

确保本机已配置：

```bash
127.0.0.1 dev.kb.cryptohunt.ai
```

### 2. 启动 Vite

```bash
yarn --cwd admin-web dev:kb
```

### 3. 首次信任 Caddy 本地证书

如果是首次使用 `tls internal`，需要先执行一次：

```bash
sudo caddy trust
```

### 4. 启动 Caddy

在仓库根目录执行：

```bash
caddy run --config admin-web/Caddyfile
```

### 5. 打开本地联调域名

```bash
https://dev.kb.cryptohunt.ai
```

### 6. 关键说明

- 线上后台 cookie 当前配置为：
  - `Domain=kb.cryptohunt.ai`
  - `Secure=true`
  - `SameSite=Lax`
- 因此本地联调必须走 **HTTPS**
- 当前前端默认走相对路径，适合这个同域代理方案
- 如果会话不可用，`401` 或 `403 + needLogin=true` 会自动跳转到登录页

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
