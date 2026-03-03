# Enterprise Admin

数据爬虫与 API 服务系统，提供多模块业务支持与数据采集能力。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        PM2 进程管理                          │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  API Server  │Crawler Server│  Bot Server  │ Singleton Jobs │
│   端口:8090  │   (爬虫服务)  │  (TG机器人)  │   (定时任务)   │
└──────┬───────┴──────┬───────┴──────┬───────┴────────────────┘
       │              │              │
       └──────────────┴──────────────┘
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
┌────────────┐ ┌───────────┐ ┌───────────┐
│ PostgreSQL │ │   Redis   │ │  SQLite   │
│  (主业务)   │ │ (缓存/队列)│ │ (轻量存储) │
└────────────┘ └───────────┘ └───────────┘
```

## 核心模块

| 模块 | 路径 | 说明 |
|------|------|------|
| **XHunt** | `src/xhunt/` | 浏览器插件后端服务，支持 Twitter OAuth、钱包签名、用户点评、私信 |
| **RootDataPro** | `src/rootdatapro/` | RootData 数据爬虫与 API，独立数据库 |
| **Admin** | `src/admin/` | 管理后台服务 |
| **Fundraising** | `src/routes/fundraising.js` | 融资数据管理 |
| **CryptoHunt TG** | `src/routes/cryptohunt-tg.js` | Telegram 机器人 |

## 技术栈

- **运行时**: Node.js
- **框架**: Express.js
- **数据库**: PostgreSQL 16.x (主库) + SQLite (辅助)
- **ORM**: Sequelize 6.x
- **缓存**: Redis 4.x
- **爬虫**: Puppeteer 24.x + Stealth 插件
- **认证**: JWT + Twitter OAuth 2.0 + WebAuthn
- **进程管理**: PM2

## 快速开始

```bash
# 安装依赖
yarn install

# 开发模式启动 API 服务
yarn dev

# 生产环境启动全部服务
yarn start

# 仅启动 API 服务
yarn start-api
```

## 数据库迁移

```bash
# PostgreSQL 迁移
yarn db:migrate:pg

# RootDataPro 迁移
yarn db:migrate:rootdatapro

# 查看迁移状态
yarn db:migrate:pg:status
```

## 环境变量

```bash
# 数据库
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=cryptohunt
PG_USERNAME=postgres
PG_PASSWORD=xxx

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-secret

# Twitter OAuth
TWITTER_CLIENT_ID=xxx
TWITTER_CLIENT_SECRET=xxx
```

## 目录结构

```
src/
├── xhunt/              # XHunt 浏览器插件服务
│   ├── api/            # API 路由
│   ├── middleware/     # 认证/安全中间件
│   ├── models/         # 数据模型
│   └── services/       # 业务服务
├── rootdatapro/        # RootData 爬虫服务
│   ├── api/            # 内部管理 API
│   ├── models/         # 独立数据模型
│   └── scraper/        # 爬虫核心
├── admin/              # 管理后台
├── lib/                # 公共库
│   └── perf-monitor/   # 接口性能监控
├── models/             # 主库模型
└── *.js                # 服务入口
```

## 性能监控

基于 Redis 的高性能请求性能监控方案，零侵入业务代码。

### 架构

```
API Server (生产者)                    Singleton Jobs (消费者)
┌─────────────────┐                   ┌─────────────────┐
│  Middleware采集  │ ──事件缓冲(LPUSH)──>│   Processor     │
│  (res.on finish) │   perf:events:queue │   (批量消费)     │
└─────────────────┘                   └────────┬────────┘
                                              │
                                              ▼
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                         ┌─────────┐    ┌──────────┐    ┌──────────┐
                         │ Metrics │    │  Traces  │    │ Details  │
                         │ (Hash)  │    │  (ZSET)  │    │  (Hash)  │
                         │  聚合指标 │    │  散点索引 │    │  详细记录 │
                         └─────────┘    └──────────┘    └──────────┘
                              │                              │
                              └──────────────┬───────────────┘
                                             ▼
                                    Admin Dashboard
                                    (ECharts 可视化)
```

### 采集规则

| 类型 | 采样条件 | 保留时长 |
|------|----------|----------|
| **基础事件** | 全量采集 | 48h |
| **慢请求** | 耗时 > 500ms | 48h |
| **错误请求** | status >= 400 | 48h |
| **随机采样** | 1% 正常快速请求 | 48h |

### 管理后台

- **路径**: `/admin/stats` → 切换到「⚡️ 性能监控」Tab
- **权限**: 需 `perf-monitor` 权限
- **功能**: 
  - 散点图展示请求耗时分布（颜色区分状态码）
  - RPS / AvgDuration 实时折线图
  - 点击散点查看完整请求详情
  - 支持 1/2/4/8/24/48 小时时间范围

### Redis Key 说明

```
perf:events:queue         # 原始事件队列 (List)
perf:metrics:<ts>         # 分钟级聚合统计 (Hash)
perf:trace:index:<hour>   # 散点图索引 (ZSET)
perf:trace:detail:<id>    # 请求详情 (Hash, TTL=48h)
```

### 配置

```javascript
// apiServer.js
const { middleware: perfMiddleware, apiRouter: perfApiRouter } = initPerfMonitor({
  redisClient,
  flushThreshold: 100,      // 缓冲 100 条批量写入
  flushIntervalMs: 5000,    // 最长 5s 刷盘
  trace: {
    sampleRate: 0.01,       // 1% 采样率
    slowThresholdMs: 500,   // 慢请求阈值
    retentionHours: 48,     // 数据保留 48h
  },
});
app.use(perfMiddleware);
app.use("/api/stats/perf", perfApiRouter);

// singletonJobsServer.js (消费者)
const { processor: perfProcessor } = initPerfMonitor({ redisClient });
setInterval(() => perfProcessor.run().catch(console.error), 2000);
```
