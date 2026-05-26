# AGENTS.md - 项目智能体指南

## 1. 项目概述

**项目名称**: enterprise-admin  
**版本**: 1.0.5  
**项目性质**: 数据爬虫与API服务系统

### 1.1 主要业务模块

| 模块 | 说明 | 路径 |
|------|------|------|
| **XHunt** | 浏览器插件后端服务（用户系统、认证、点评、私信） | `src/xhunt/` |
| **RootDataPro** | RootData数据爬虫与API服务 | `src/rootdatapro/` |
| **Admin** | 管理后台服务 | `src/admin/` |
| **Fundraising** | 融资数据管理 | `src/routes/fundraising.js` |
| **CryptoHunt TG** | Telegram机器人相关 | `src/routes/cryptohunt-tg.js` |

### 1.2 服务架构

系统采用多服务架构，通过 PM2 管理：

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  API Server     │  │ Crawler Server  │  │   Bot Server    │  │ Singleton Jobs  │
│  (apiServer.js) │  │(crawlerServer.js│  │ (botServer.js)  │  │ (singletonJobs) │
│     端口:8090   │  │                 │  │                 │  │                 │
└────────┬────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
         │
         ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   PostgreSQL    │  │     Redis       │  │    SQLite       │
│  (主业务数据库)  │  │  (缓存/队列)    │  │  (轻量存储)     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 2. 技术栈

- **运行时**: Node.js
- **Web框架**: Express.js
- **数据库**: PostgreSQL 16.9 (主库), SQLite (辅助)
- **ORM**: Sequelize 6.x
- **缓存**: Redis 4.x
- **爬虫**: Puppeteer 24.x
- **认证**: JWT, Twitter OAuth 2.0, WebAuthn
- **区块链**: ethers.js v5
- **包管理**: Yarn 4.9.1

---

## 3. XHunt 模块详解

XHunt 是浏览器插件的后端服务，为核心业务模块。

### 3.1 目录结构

```
src/xhunt/
├── api/                    # API路由
│   ├── auth.js            # 认证相关（Twitter OAuth、钱包签名）
│   ├── campaign.js        # 活动管理
│   ├── mantle.js          # Mantle活动注册
│   ├── notes.js           # 私人笔记
│   ├── private-messages.js # 私信功能
│   ├── proxy.js           # Twitter代理
│   ├── report.js          # 数据上报
│   ├── reviews.js         # 用户点评
│   ├── rootdata.js        # RootData查询
│   ├── sse.js             # Server-Sent Events
│   ├── stats.js           # 统计服务
│   └── user-entry.js      # 未注册用户登记
├── middleware/            # 中间件
│   ├── auth.js            # JWT认证
│   ├── security.js        # 安全中间件（指纹、速率限制）
│   ├── pro-status.js      # Pro用户状态检查
│   └── ...
├── models/                # 数据模型
│   ├── XHuntUser.js       # 用户表
│   ├── XHuntUserToken.js  # 用户Token表
│   ├── XReviewForAccount.js # 点评表
│   └── ...
├── services/              # 业务服务
│   ├── twitter.js         # Twitter API服务
│   ├── dailyReportService.js # 日报服务
│   └── statsService.js    # 统计服务
├── utils/                 # 工具函数
│   ├── legacy-pro.js      # 老用户Pro逻辑
│   └── pro-data-filtering.js # Pro数据过滤
└── constants/             # 常量定义
```

### 3.2 核心数据模型

#### XHuntUser（用户表）
- `id`: UUID 主键
- `twitterId`: Twitter用户ID（唯一）
- `username`: Twitter用户名
- `displayName`: 显示名称
- `avatar`: 头像URL
- `evmAddresses`: 绑定的EVM地址数组（JSON）
- `classification`: 用户分类（KOL/项目方/机构/个人）
- `kolRank20W`: KOL影响力排名

#### XHuntUserToken（用户Token表）
- 存储用户JWT Token与Twitter OAuth Token
- 支持Token撤销（isRevoked）
- 设备指纹绑定（fingerprint）

#### XReviewForAccount（点评表）
- 用户对Twitter账号的点评
- 关联XHuntUser和XAccount

#### XHuntUserProSubscription（Pro订阅表）
- 用户Pro会员订阅记录
- 支持多种planType

### 3.3 认证机制

#### 3.3.1 Twitter OAuth 2.0 流程
1. 前端请求 `/api/xhunt/auth/twitter/url` 获取授权URL
2. 用户授权后，Twitter回调到前端
3. 前端将code和state发送到 `/api/xhunt/auth/twitter/callback`
4. 后端验证state，获取Twitter Tokens和用户信息
5. 创建/更新用户，签发JWT Token（30天有效期）

#### 3.3.2 钱包签名认证（EVM）
1. 前端请求 `/api/xhunt/auth/wallet/nonce` 获取挑战消息
2. 用户使用私钥签名消息
3. 前端发送签名到 `/api/xhunt/auth/wallet/verify`
4. 后端使用ethers.js验证签名

#### 3.3.3 JWT Token验证
- Token有效期：30天
- 支持从Header或Query参数读取（SSE场景）
- 设备指纹验证，不匹配时强制登出

### 3.4 Pro用户体系

#### 老用户Pro（Legacy Pro）
- 在 `src/xhunt/constants/xhuntVip.js` 中定义的活跃用户名单
- 有效期至 2025-12-29
- 检查逻辑在 `src/xhunt/utils/legacy-pro.js`

#### 付费Pro
- 通过 `XHuntUserProSubscription` 表管理
- 查询有效订阅判断Pro状态

---

## 4. RootDataPro 模块详解

RootDataPro 是专门针对 RootData.com 的数据爬虫与 API 服务模块，使用独立的数据库 `rootdatapro`。

### 4.1 目录结构

```
src/rootdatapro/
├── api/                          # API路由
│   └── rootdatapro.js           # 内部爬虫管理API
├── models/                       # 数据模型
│   ├── index.js                 # 模型初始化与关联定义
│   ├── Project.js               # 项目表
│   ├── Organization.js          # 投资机构表
│   ├── Person.js                # 人物表
│   ├── Investment.js            # 投资关系表（多态关联）
│   ├── Ecosystem.js             # 生态系统表
│   ├── Tag.js                   # 标签表
│   ├── CrawlLog.js              # 爬虫日志表
│   └── ...                      # 其他关联表
└── scraper/                      # 爬虫核心
    ├── index.js                 # 爬虫入口（scrapeProject/Organization/Person）
    ├── browser-fetcher.js       # Puppeteer浏览器封装
    ├── taskManager.js           # 任务队列管理器
    ├── db-updater.js            # 数据库更新器
    ├── url-builder.js           # URL构建工具
    └── parsers/                 # 解析器
        ├── projectParser.js     # 项目页面解析
        ├── organizationParser.js # 机构页面解析
        ├── personParser.js      # 人物页面解析
        └── fundraisingParser.js # Fundraising列表解析
```

### 4.2 数据模型架构

#### 核心实体表

| 表名 | 主键 | 说明 |
|------|------|------|
| **RootdataProjects** | `project_id` (INTEGER) | 项目/创业公司 |
| **RootdataOrganizations** | `org_id` (INTEGER) | 投资机构/VC |
| **RootdataPersons** | `people_id` (BIGINT) | 人物/团队成员 |

#### 关系表

| 表名 | 关系类型 | 说明 |
|------|----------|------|
| **RootdataInvestments** | 多态关联 | 投资记录（投资方→被投资方） |
| **RootdataProjectTeamMembers** | 多对多 | 项目 ↔ 人物 |
| **RootdataOrganizationTeamMembers** | 多对多 | 机构 ↔ 人物 |
| **RootdataProjectTags** | 多对多 | 项目 ↔ 标签 |
| **RootdataOrganizationTags** | 多对多 | 机构 ↔ 标签 |
| **RootdataProjectEcosystems** | 多对多 | 项目 ↔ 生态系统 |
| **RootdataOrganizationInvestorCategories** | 多对多 | 机构 ↔ 投资类别 |

#### Investment（投资关系）多态关联设计

```javascript
// 被投资方（只能是 Project 或 Organization）
fundedId: BIGINT
fundedType: 'Project' | 'Organization'

// 投资方（可以是 Project、Organization 或 Person）
investorId: BIGINT
investorType: 'Project' | 'Organization' | 'Person'

// 投资详情
round: STRING      // 轮次名称
amount: BIGINT     // 投资金额
date: DATE         // 投资日期
lead: BOOLEAN      // 是否领投
```

### 4.3 爬虫系统

#### 4.3.1 爬虫架构

```
┌─────────────────────────────────────────────────────────────┐
│                    TaskManager (任务管理器)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  未爬取队列  │  │  失败重试队列 │  │   Fundraising优先级  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Worker 循环 (多进程)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Worker 1   │  │  Worker 2   │  │  Worker N   │          │
│  │ (Project)   │  │(Organization│  │  (Person)   │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Browser Fetcher (Puppeteer)                    │
│     - 代理池轮询 (5个代理IP)                                 │
│     - 请求拦截（屏蔽图片/CSS/字体）                           │
│     - Stealth 插件反检测                                     │
│     - 页面刷新重试机制                                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Parsers (解析器)                          │
│     - 解析 __NUXT__ JSON 数据                               │
│     - 解析 DOM 结构补充字段                                  │
│     - 提取团队成员、投资机构、融资信息                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  DB Updater (入库)                           │
│     - 事务保证一致性                                         │
│     - 关联数据批量创建                                        │
│     - 写入 CrawlLog 日志                                     │
└─────────────────────────────────────────────────────────────┘
```

#### 4.3.2 每日维护任务流程

```
每日维护任务 (runDailyMaintenanceTask)
│
├── 步骤0: Fundraising页面抓取（最高优先级）
│   └── 抓取 https://www.rootdata.com/Fundraising
│       └── 获取最新融资项目ID（最多300个）
│
├── 步骤1: 失败任务重试
│   └── 查询 CrawlLog 中失败≤10次且从未成功的记录
│
├── 步骤2: 增量发现新ID
│   └── 从当前最大ID开始探测，连续失败5次停止
│
├── 步骤3: 旧数据重爬
│   └── 10天前成功爬取的记录，每类最多1000条
│
└── 步骤4: 顺序执行队列（单Worker模式）
```

#### 4.3.3 关键配置

```javascript
// 环境变量
RDT_CRAWL_WORKERS=1              // Worker数量（默认1）
RDT_PROXY_BYPASS_RATE=0.1        // 绕过代理概率（10%）

// Redis Keys
rdt_crawl:status                 // 爬虫状态
rdt_crawl:queue:1                // Project队列
rdt_crawl:queue:2                // Organization队列
rdt_crawl:queue:3                // Person队列
rdt_crawl:current_tasks          // 当前执行任务
rdt_crawl:maintenance_stage      // 维护任务阶段
rdt_crawl:maintenance_report     // 维护任务报告
```

### 4.4 API 接口

#### 4.4.1 内部管理 API（`/api/rootdatapro/internal`，需 adminAuth）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/query_by_id` | 按 ID 查询 Project/Organization/Person（调试用） |
| POST | `/scrape` | 抓取指定URL（Project/Organization/Person） |
| POST | `/crawl/start` | 启动爬虫任务 |
| POST | `/crawl/pause` | 暂停爬虫任务 |
| GET | `/crawl/status` | 获取爬虫状态 |
| POST | `/crawl/reset` | 重置并重新初始化 |
| POST | `/crawl/maintenance/run_now` | 立即执行每日维护任务 |
| POST | `/crawl/force_reset_status` | 强制重置状态 |

### 4.5 数据库配置

RootDataPro 使用独立的 PostgreSQL 数据库：

```javascript
// 数据库名：rootdatapro
// 其他配置与主库一致（PG_HOST, PG_PORT, PG_USERNAME, PG_PASSWORD）

// 连接池配置
pool: { max: 5, min: 0, idle: 10000, acquire: 20000 }
```

### 4.6 爬虫技术细节

#### 4.6.1 代理池配置

```javascript
const PROXY_POOL = [
  "163.5.88.220:6324:user81794:8ipjmd",
  "108.165.167.7:6324:user81794:8ipjmd",
  "108.165.167.11:6324:user81794:8ipjmd",
  "45.135.251.198:6324:user81794:8ipjmd",
  "45.135.251.37:6324:user81794:8ipjmd",
];
```

#### 4.6.2 反爬措施

1. **Stealth 插件**: `puppeteer-extra-plugin-stealth` 隐藏自动化特征
2. **请求拦截**: 屏蔽图片、CSS、字体，减少加载时间
3. **随机代理**: 90%请求使用代理池，10%直接连接
4. **用户数据目录**: 每个Worker独立userDataDir，保持登录状态
5. **请求延迟**: 500ms~1700ms随机延迟

#### 4.6.3 页面解析策略

```javascript
// 1. 获取 __NUXT__ JSON 数据（主要数据来源）
const nuxtData = await page.evaluate(() => window.__NUXT__);

// 2. 获取 main DOM（补充字段）
const mainDom = await page.evaluate(() => document.querySelector("main")?.outerHTML);

// 3. 解析器组合使用 JSDOM + JSON 解析
```

---

## 5. 数据库配置

### 5.1 PostgreSQL（主库）

环境变量：
```
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=cryptohunt
PG_USERNAME=postgres
PG_PASSWORD=xxx
PG_SSL=false
```

#### 5.1.1 远程只读验证库（本地 Mac 数据校验用）

- 用途：仅用于数据验证，禁止写入或迁移操作
- 地址：`150.5.158.179`
- 端口：`5432`
- 数据库：`luykindatabase`
- 用户名：`readonly`
- 密码：`readonly.0813`
- 连接提示：远程连接通常需要 SSL；如遇 `pg_hba.conf` 拒绝，说明当前出口 IP 未被授权

### 5.2 SQLite（辅助）

用于轻量级数据存储，文件位于项目根目录 `database.sqlite`

### 5.3 Redis

用于：
- 缓存（Twitter OAuth state、Challenge nonce）
- 速率限制计数
- 性能监控数据缓冲

---

## 6. 常用命令

### 6.1 开发启动

```bash
# 开发环境启动API服务
yarn dev

# 生产环境启动
yarn start

# 仅启动API服务（不启动爬虫和Bot）
yarn start-api
```

### 6.2 数据库迁移

```bash
# PostgreSQL迁移
yarn db:migrate:pg

# RootDataPro迁移
yarn db:migrate:rootdatapro

# 查看迁移状态
yarn db:migrate:pg:status
```

### 6.3 PM2管理

```bash
# 停止服务
yarn stop

# 重启服务
yarn restart

# 查看日志
yarn logs
```

---

## 7. 核心约定

### 7.1 不自动运行项目
- **不要**自动启动开发服务器（`npm run dev` / `yarn dev`）
- **不要**自动运行构建（`npm run build` / `yarn build`）
- 项目运行由坤哥自行控制
- 代码修改完成后，通知坤哥即可

### 7.2 代码修改原则
- **最小改动原则**：只修改必要的代码，不引入无关变更
- **保持现有代码风格**：遵循项目现有的命名规范、格式化规则
- **修改后简要说明改动点**：列出修改的文件和核心逻辑变更
- **不要**随意重构未涉及的功能模块

### 7.3 沟通约定
- **回复内容**：不要展示 `ReadFile` 的文件内容，只提供关键信息
- **回复结构**：思路说明、修改的文件列表、需要批准的权限/确认事项
- **称呼**：统一称呼项目负责人为 **坤哥**，每次回复以此开头
- **简洁模式**：使用 `--final-message-only` 参数时，只输出最终结果和关键信息，省略中间过程和无关细节

---

## 8. 安全机制

### 8.1 中间件层级

API路由的安全中间件应用顺序（以 `/api/xhunt/auth` 为例）：
```javascript
app.use(
  "/api/xhunt/auth",
  fingerprintLimiter,      // 设备指纹速率限制
  browserOnlyMiddleware,   // 浏览器环境验证
  securityMiddleware,      // 安全验证（签名、时间戳）
  xHuntAuthRoutes
);
```

### 8.2 安全验证内容

- **请求时间戳验证**: 防止重放攻击
- **请求签名验证**: 确保请求来源可信
- **设备指纹**: 识别和限制异常设备
- **速率限制**: 防止暴力破解和滥用

### 8.3 速率限制规则

- 认证接口：每设备指纹 5次/分钟
- 普通接口：每IP 100次/15分钟
- 上报接口：单独限制

---

## 9. 性能监控

位于 `src/lib/perf-monitor/`，提供：
- 请求性能追踪（采样率3%）
- 慢请求记录（>500ms）
- 错误统计
- 实时KPI指标

管理后台访问：`/api/stats/perf`（需adminAuth）

---

## 10. 注意事项

### 10.1 环境变量管理
- 开发环境使用 `.env-dev`
- 生产环境使用 `.env-pro`
- 关键配置（如JWT_SECRET、Twitter凭证）必须通过环境变量注入

### 10.2 代码提交
- `database.sqlite` 不应提交到Git（已在 `.gitignore`）
- 迁移文件必须提交

### 10.3 第三方依赖
- Twitter API使用 `twitter-api-v2`
- 爬虫使用 `puppeteer` + `puppeteer-extra-plugin-stealth`

---

## 11. 联系与维护

项目负责人：**坤哥**

代码修改完成后，请向坤哥汇报：
1. 修改的文件列表
2. 核心逻辑变更说明
3. 测试建议（如有）
