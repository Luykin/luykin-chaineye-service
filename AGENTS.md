# AGENTS.md - 项目智能体指南

## 1. 项目概览

**项目名称**: enterprise-admin  
**版本**: 1.0.5  
**项目性质**: XHunt 后端服务、管理后台、数据任务与内部 API 系统

### 1.1 主要模块

| 模块 | 说明 | 路径 |
|------|------|------|
| **XHunt** | 插件/业务后端，包含用户、认证、点评、私信、活动等能力 | `src/xhunt/` |
| **认证中心** | 统一登录体系，支持账号密码、Google、Twitter、EVM 钱包 | `src/xhunt/auth-center/` |
| **Admin API** | 管理后台服务接口 | `src/admin/` |
| **Admin Web** | 管理后台前端 | `admin-web/` |
| **Auth Client** | React 登录中心 npm 包 | `packages/xhunt-auth-client/` |
| **Fundraising** | 融资数据管理接口 | `src/routes/fundraising.js` |
| **CryptoHunt TG** | Telegram 机器人相关接口 | `src/routes/cryptohunt-tg.js` |

### 1.2 整体架构

系统由 PM2 管理多类服务：

```text
API Server(apiServer.js:8090)
├── XHunt 业务 API
├── 认证中心 API
├── Admin API
└── 其他业务路由

Crawler Server(crawlerServer.js)   Bot Server(botServer.js)   Singleton Jobs

PostgreSQL：主业务数据
Redis：缓存、队列、OAuth state、nonce、限流、性能缓冲
SQLite：少量轻量级辅助存储
```

---

## 2. 技术栈

- **运行时**: Node.js
- **Web 框架**: Express.js
- **数据库**: PostgreSQL 16.9、SQLite
- **ORM**: Sequelize 6.x
- **缓存/队列**: Redis 4.x
- **爬虫/自动化**: Puppeteer 24.x
- **认证**: JWT、Twitter OAuth 2.0、Google OAuth、WebAuthn、EVM 钱包签名
- **区块链**: ethers.js v5
- **包管理**: Yarn 4.9.1

---

## 3. 核心业务关系

### 3.1 XHunt 原有用户体系

XHunt 原有用户体系主要服务插件和既有业务：

- `XHuntUser`：原有 XHunt 用户主体，历史上以 Twitter 身份为主要标识。
- `XHuntUserToken`：原有登录 token / Twitter OAuth token / 设备指纹绑定。
- `XReviewForAccount`：用户对 Twitter 账号的点评，关联 `XHuntUser` 和账号数据。
- Notes、Private Messages、Campaign 等业务数据围绕 `XHuntUser` 展开。
- Pro 体系分两类：
  - Legacy Pro：配置在 `src/xhunt/constants/xhuntVip.js`，逻辑在 `src/xhunt/utils/legacy-pro.js`。
  - 付费 Pro：通过 Pro 订阅表判断有效订阅。

### 3.2 认证中心体系

认证中心是新的统一登录体系，和原有 `XHuntUser` **不是同一张表**，但可以关联。

核心关系：

- `AuthCenterXhuntUser`：认证中心用户主体。
- `AuthCenterXhuntIdentity`：用户登录身份。一个用户可以绑定多种登录方式：`password`、`google`、`twitter`、`evm`。
- `AuthCenterXhuntPasswordCredential`：账号密码登录的密码凭证。
- `AuthCenterXhuntSession`：认证中心登录会话、access token / refresh token 管理。
- `AuthCenterXhuntClient`：接入认证中心的业务应用，使用 `clientKey` 区分来源。
- 当用户使用 Twitter 登录时，可以按 `twitterId` 关联到原有 `XHuntUser`，但两套用户体系保持独立。

对外展示用户名优先级：

```text
Twitter 名字 > 用户设置的账户名 > Google 邮箱 > EVM 地址
```

---

## 4. 认证与安全

### 4.1 原有 XHunt 插件认证

原有插件认证路由主要位于：

- `src/xhunt/api/auth.js`
- `src/xhunt/middleware/auth.js`
- `src/xhunt/middleware/security.js`

典型安全链路：

```javascript
app.use(
  "/api/xhunt/auth",
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
  xHuntAuthRoutes
);
```

### 4.2 认证中心 Web 认证

认证中心路由位于：

- `src/xhunt/auth-center/`

特点：

- 支持账号密码、Google、Twitter、EVM 钱包登录。
- 支持同一认证中心用户绑定多种登录方式。
- Web 端请求使用认证中心轻量签名机制，和插件旧签名机制不是同一套。
- `packages/xhunt-auth-client/` 提供 React 侧登录 UI、token 存储、接口调用和回调处理。

### 4.3 内部 token 校验

对内服务可通过认证中心内部接口用 token 换取用户信息：

```text
POST /api/xhunt/auth-center/internal/token/introspect
```

该接口用于内部服务校验 token；token 过期或无效时需要明确返回错误。

---

## 5. 数据库与环境

### 5.1 PostgreSQL

主库环境变量：

```text
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=cryptohunt
PG_USERNAME=postgres
PG_PASSWORD=xxx
PG_SSL=false
```

### 5.2 Redis

Redis 主要用于：

- OAuth state / 登录 nonce
- 限流计数
- 缓存
- 队列状态
- 性能监控缓冲

### 5.3 环境文件

- 开发环境：`.env-dev`
- 生产环境：`.env-pro`
- 敏感配置必须通过环境变量或服务器配置注入，不要硬编码真实密钥。

---

## 6. 常用命令

### 6.1 启动

```bash
# 开发环境启动 API 服务
yarn dev

# 生产环境启动
yarn start

# 仅启动 API 服务
yarn start-api
```

### 6.2 数据库迁移

```bash
# PostgreSQL 迁移
yarn db:migrate:pg

# 查看迁移状态
yarn db:migrate:pg:status
```

### 6.3 PM2 管理

```bash
# 停止服务
yarn stop

# 重启服务
yarn restart

# 查看日志
yarn logs
```

---

## 7. 性能监控与日志

- 性能监控位于 `src/lib/perf-monitor/`。
- 管理后台入口：`/api/stats/perf`（需 adminAuth）。
- Web 端请求应携带独立的 request id / client 信息，方便区分插件、认证中心、管理后台等来源。
- 新增接口时注意错误码、耗时、来源 clientKey、request id 的可观测性。

---

## 8. 开发约定

### 8.1 不自动运行项目

- **不要**自动启动开发服务器（`npm run dev` / `yarn dev`）。
- **不要**自动运行构建（`npm run build` / `yarn build`）。
- 项目运行由坤哥自行控制。

### 8.2 代码修改原则

- 最小改动，只修改必要代码。
- 保持现有代码风格和命名习惯。
- 不随意重构无关模块。
- 迁移文件必须提交。
- `database.sqlite`、`package-lock.json` 等按 `.gitignore` 规则处理。

### 8.3 沟通约定

每次完成后向坤哥汇报：

1. 修改的文件列表
2. 核心逻辑变更
3. 测试建议或部署注意事项

回复开头统一称呼：**坤哥**。
