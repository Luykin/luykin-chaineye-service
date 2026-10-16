# EchoHunt Social Listening V1 技术实现文档

> 生成日期：2026-08-31
> 最近更新：2026-09-01
> 后端仓库：`/Users/luykin/Documents/mac-work/luykin-chaineye-service`
> 前端仓库：`/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt/app`
> 状态：后端与 admin-web 第一版已实现；EchoHunt 前台接真实 API 仍以对应前端仓库为准。
> 约束：本文不包含任何线上改库、改数据、重启或发布操作。

## 1. 当前确认状态

已确认并采用的结论：

- Social Listening 业务表放在当前 XHunt 主业务 PostgreSQL 库，不写入 `meta` 只读库的 `dev` schema。
- 新增表/模型统一使用 `EchohuntSocialListening*` 命名。
- `admin-web` 使用权限点 `social-listening` 管理被监控账号、授权、任务、预警、帖子、AI 配置。
- EchoHunt 前台只有被分配了至少一个被监控账号的账号才应展示 Social Listening 入口；无授权用户直接访问时应跳回首页。
- 手动刷新和导出必须限流；同一看板不允许并发跑重复采集任务。
- 华语排名优先取 `dev.twitter_user.feature.rank.kolCnRank`，缺失时 fallback 到 `dev.twitter_user.kol` 或 `dev.cache` 排名快照。
- 关注/取关来源为 `dev.twitter_user_follow`、`dev.twitter_user_unfollow`、`dev.project_follow`；通用关注关系默认沿用旧服务口径 `latest >= 150`。
- AI 不回写 `dev.tweet.ai`，也不把 `dev.tweet.ai` 作为最终展示/聚合口径。
- 当前 AI 主链路是每条推文一次 `tweetAnalysis` 综合结构化调用，同时产出摘要、结构化主题/热词、项目态度；不生成 `postZh`。

## 2. V1 产品边界

Social Listening V1 实现：

1. 运营人员在 `admin-web` 维护“被监控账号名单”，每个被监控账号对应一个看板。
2. 新看板先让最近 7 天数据可用，再继续补最近 30 天数据。
3. 监控中看板默认按 15 分钟增量采集；任务内部按小窗口扫描只读大表。
4. AI Worker 与采集调度分离：有待处理时连续回填，约 10 秒一轮；可独立暂停。
5. 运营人员可以把某个看板分配给一个或多个 EchoHunt X 登录账号查看。
6. 前台统一支持 `24H / 7D / 30D` 时间范围。
7. 页面模块：概览指标、趋势/情绪/主题、关键事件、关键账号动态、预警信号、帖子列表、帖子导出。
8. 数据为空、处理中、失败、历史数据不足必须明确表达，不能用 Mock 或 0 伪装真实数据。

V1 不做：工单处置系统、复杂客户组织/跨看板权限体系、直接维护 `dev.tweet.ai`。

## 3. 系统落点

### 3.1 后端落点

- API 服务入口：`src/apiServer.js`
- EchoHunt 前台挂载：`/api/xhunt/echohunt/social-listening`
- Admin 挂载：`/api/admin/social-listening`
- 前台鉴权：`authenticateAuthCenterToken()`
- 管理后台鉴权：`adminAuth + requirePermission("social-listening")`
- 单实例任务进程：`src/singletonJobsServer.js`，PM2 名称按现有部署为准。
- 迁移目录：`migrations-pg/`
- 模型注册：`src/models/postgres-start.js`
- 只读库连接：`src/infra/k8s/postgres-readonly.js`

目录：

```text
src/xhunt/social-listening/
├── api/
│   ├── public.js
│   └── admin.js
├── models/
│   └── EchohuntSocialListening*.js
├── services/
│   ├── aggregate-service.js
│   ├── analysis-service.js
│   ├── ai-backfill-scheduler.js
│   ├── ai-prompt-templates.js
│   ├── board-service.js
│   ├── data-source.js
│   ├── export-service.js
│   ├── ingest-service.js
│   ├── local-ai-service.js
│   ├── runtime-config.js
│   └── scheduler.js
└── utils/
    ├── text-normalize.js
    └── twitter.js
```

### 3.2 管理后台落点

本后端仓库内的 `admin-web` 已实现：

```text
admin-web/src/config/admin-navigation.tsx
admin-web/src/pages/SocialListeningPage.tsx
admin-web/src/services/social-listening.ts
```

能力包括看板管理、授权、任务、预警、帖子排查/导出、AI 运行配置、AI Worker 独立暂停/恢复、AI 回填样本分页查看。

### 3.3 EchoHunt 前台落点

EchoHunt 前台仓库需继续完成真实 API 接入：

- `/social-listening` 页面门禁。
- 替换 Mock 数据。
- 调用 `/api/echohunt/social-listening/me/access-summary`。
- 调用 boards/overview/posts/accounts/alerts/events/export 接口。
- 无授权跳回首页。

前端隐藏入口只是体验优化；后端授权校验才是安全边界。

## 4. `meta` 只读库复用方式

V1 只读复用 PostgreSQL `dev` schema：

| 表 | 用途 |
|---|---|
| `dev.tweet` | 推文主表，按 `create_time` 扫描。 |
| `dev.twitter_user` | 作者/官方账号 profile、AI 画像、排名字段。 |
| `dev.cache` | 排名快照 fallback。 |
| `dev.twitter_user_follow` | 通用关注关系。 |
| `dev.twitter_user_unfollow` | 通用取关关系。 |
| `dev.project_follow` | 项目相关关注关系。 |
| `dev.tweet_metric_snapshot` | 可选用于更准确的历史指标趋势。 |

原则：

- `dev.*` 表只读，不写游标、不写去重、不写 AI 结果。
- 后台任务分片扫描后写入本项目主库。
- API 请求不直接扫 `dev.tweet/dev.twitter_user` 大表。
- 去重、任务状态、授权、聚合、导出审计都写 `EchohuntSocialListening*`。

## 5. 数据模型设计

### 5.1 `EchohuntSocialListeningBoards`

被监控账号/看板主表。核心字段：

```text
id
officialTwitterId
officialHandle
projectName / projectDescription / projectAvatar / brandColor
verified / followersCount / globalRank / cnRank
status: initializing / monitoring / paused / deleting / deleted / failed
coverageStartAt / processedThrough / lastSuccessAt / lastFailureAt / lastFailureReason
createdByAdminId / updatedByAdminId
metadata
```

### 5.2 `EchohuntSocialListeningBoardAccesses`

看板授权表。核心字段：

```text
boardId
twitterId
twitterHandle
authCenterUserId
xhuntUserId
status: active / revoked
grantedByAdminId / revokedByAdminId
grantedAt / revokedAt
metadata
```

前台授权匹配优先级：

1. `authCenterUserId = currentUser.id`
2. `twitterId = twitter identity providerSubject`
3. `twitterHandle = lower(identity.username)`

### 5.3 `EchohuntSocialListeningPosts`

帖子事实表，页面和导出的主数据源。核心字段：

```text
boardId / tweetId
authorTwitterId / authorHandle / authorName / authorAvatar
authorFollowersCount / authorGlobalRank / authorCnRank / authorIsCn
postCreatedAt / text / normalizedText / source
conversationId / quoteId / replyId / retweetId
viewsCount / likesCount / repostsCount / quotesCount / repliesCount
summaryZh / summaryEn
topics / keywords
projectAttitudeScore / sentimentScore / sentiment / sentimentSummaryZh
tagStatus / summaryStatus / attitudeStatus / aiStatus
aiAnalyzedAt / aiError / aiSource
rawTweet / rawAuthor
```

AI 字段当前来源：

- `summaryZh/summaryEn`：来自一次综合 `tweetAnalysis` 的 `summary_cn/summary_en`。
- `topics`：来自 `domain_tag/crypto_sub_tags/ai_sub_tags` 规整后的主题集合；自由文本 `tags` 仅作兼容记录，不作为主聚合口径。
- `keywords`：入库保留命中关键词 + `hot_tags`；聚合词云只使用过滤后的讨论热词，排除项目名、官方 handle、token、aliases、召回 keywords，以及看板级 `metadata.wordCloudExcludeKeywords`。
- `metadata.recallExcludeKeywords`：召回阶段排除词，命中后帖子不入库；用于必须排除的噪音文本。
- `projectAttitudeScore/sentiment/sentimentSummaryZh`：来自 `score/sentiment/attitude_summary`。
- `aiSource` 主口径：`social_listening_combined`。
- `postZh`：当前不使用、不查询、不写入；如有错误日志说明存在旧引用。

### 5.4 其他表

| 表 | 作用 |
|---|---|
| `EchohuntSocialListeningSnapshots` | 按 `24H/7D/30D` 保存聚合快照。 |
| `EchohuntSocialListeningAccountSignals` | 高排名提及、关注/取关动态。 |
| `EchohuntSocialListeningAlerts` | 高排名提及、负面内容、讨论量异常、负面占比异常等预警。 |
| `EchohuntSocialListeningKeyEvents` | 用户自维护关键事件，按 `authCenterUserId` 隔离。 |
| `EchohuntSocialListeningJobs` | `history_backfill/incremental/manual_refresh/reanalyze` 等任务状态。 |
| `EchohuntSocialListeningAccessAuditLogs` | 看板、授权、导出等运营操作审计。 |

## 6. 数据处理流程

### 6.1 运营维护看板

1. 输入 `officialHandle`，规范化为小写、去 `@`。
2. 查询只读库 `dev.twitter_user` 解析官方账号资料。
3. 快照头像、简介、粉丝数、认证、排名等字段到 board。
4. 新看板默认可保持暂停，由运营恢复后触发刷新/补数据。
5. 写操作审计。

### 6.2 推文召回与去重

后台任务读取：

- `dev.tweet`：正文、时间、作者、引用/回复/会话、统计、info/mention 等 JSON。
- `dev.twitter_user`：作者 profile、排名、是否华语账号。

匹配来源：

- 正文召回：`officialHandle / projectName / metadata.keywords / metadata.aliases / metadata.token` 合并为一组召回词，匹配 `dev.tweet.text`；不区分强词/弱词。
- 关系召回：引用或回复官方账号近期推文时也会召回。
- 召回排除：如 `dev.tweet.text` 命中 `metadata.recallExcludeKeywords`，即使命中召回词或引用/回复官方推文，也不入库。
- `info.mentions`：当前主要用于入库后辅助标记来源类型，不是主召回入口。
- `retweet`：默认不作为独立主口径，后续如纳入需明确标记。

去重：`boardId + tweetId` 唯一。同一帖子命中多个来源时只入库一次，多来源可记录在 `rawTweet.matchedSources`。

### 6.3 采集/聚合任务

- `history_backfill`：先补最近 7 天，再补 7-30 天。
- `incremental`：默认每 15 分钟扫描 `processedThrough - overlap` 到当前时间。
- `manual_refresh`：手动触发，但同一看板不并发。
- 任务内部按 `scan.windowMinutes` 小窗口扫描，只读库查询有 timeout 和分页限制。
- 每轮完成后刷新 snapshots、account signals、alerts。

## 7. AI 实现

### 7.1 目标

AI 只做 Social Listening 自己需要的结构化字段，不阻塞帖子入库，不回写只读库，不生成全文翻译。

### 7.2 当前主链路：一次综合调用

当前每条推文调用一次：

```text
purpose=tweetAnalysis
```

调用位置：

```text
src/xhunt/social-listening/services/analysis-service.js
src/xhunt/social-listening/services/local-ai-service.js
```

底层能力：

```text
src/lib/llm structuredChat(prompt, schema, options)
```

一次输出：

```text
crypto_relevant
tags
summary_cn
summary_en
domain_tag
domain_tag_version
crypto_sub_tags
ai_sub_tags
hot_tags
score
sentiment
relevant_to_project
confidence
attitude_summary
```

写入：

```text
summaryZh / summaryEn
topics / keywords
projectAttitudeScore / sentimentScore / sentiment / sentimentSummaryZh
tagStatus / summaryStatus / attitudeStatus / aiStatus
aiAnalyzedAt / aiError / aiSource=social_listening_combined
rawTweet.socialListeningAi
```

### 7.3 Prompt 配置

默认 prompt 在：

```text
src/xhunt/social-listening/services/ai-prompt-templates.js
```

Nacos 可覆盖：

```json
{
  "ai": {
    "prompts": {
      "tweetAnalysis": "...",
      "tweetTag": "...",
      "tweetSummary": "...",
      "projectAttitude": "..."
    }
  }
}
```

当前推荐只维护 `tweetAnalysis`。`tweetTag/tweetSummary/projectAttitude` 保留是为了兼容旧拆分配置和组合 prompt 素材，不代表运行时一定会拆成三次请求。

### 7.4 开关、模型与费用

运行配置来自 Nacos：

```text
dataId: echohunt_social_listening_config
group: DEFAULT_GROUP
```

关键字段：

```text
ai.apiKey
ai.baseURL
ai.model
ai.tweetAnalysisModel
ai.tweetAnalysisMaxTokens
ai.contentEnabled
ai.projectAttitudeEnabled
ai.summaryWords
ai.maxTextLength
ai.negativeScoreThreshold
ai.positiveScoreThreshold
ai.estimateInputPricePerMillion
ai.estimateOutputPricePerMillion
```

费用估算按“每条推文 1 次综合调用”计算，不再按三次 AI 请求或全文翻译估算。

### 7.5 AI Worker

AI Worker 文件：

```text
src/xhunt/social-listening/services/ai-backfill-scheduler.js
```

Redis key：

```text
echohunt:social-listening:ai-worker:state
echohunt:social-listening:ai-worker:last-run
```

管理接口：

```text
GET  /api/admin/social-listening/ai-worker/status
POST /api/admin/social-listening/ai-worker/pause
POST /api/admin/social-listening/ai-worker/resume
```

行为：

- 默认未暂停时运行。
- Nacos `aiWorker.mode=disabled` 会强制关闭。
- Redis state 为 `paused` 时暂停。
- 有待处理帖子时，下一轮约 10 秒继续处理。
- 无待处理时，按 `aiWorker.tickIntervalMs` 空闲检查。
- 每轮按 `maxBoardsPerTick` 选择有待处理 AI 的 monitoring 看板。
- 单看板处理 `limit=max(contentBatchSize, projectAttitudeBatchSize)`。
- 并发取 `max(contentConcurrency, projectAttitudeConcurrency)`，范围限制为 1-20。
- 文本按 `maxTextLength` 截断，短文本优先处理，长文本放后面。

### 7.6 日志与失败降级

日志关键字：

```text
[SocialListeningAIWorker] started
[SocialListeningAIWorker] board=...
[SocialListeningAIWorker] tick {...}
[SocialListeningAI] request purpose=tweetAnalysis ... ms=... promptLen=...
[SocialListeningAI] combined ... status=ok/failed ... textLen=... truncated=...
[SocialListeningAI] combined batch ... concurrency=... maxTextLength=... ms=...
```

失败策略：

- AI 失败不阻断帖子入库。
- 失败时写 `aiError`，相关 status 置为 `failed`。
- 态度失败时 `sentiment='unknown'`。
- 情绪聚合分母只统计已分析出明确情绪的帖子，`unknown` 单独记录。

## 8. 运行配置

后端默认配置在 `runtime-config.js`，Nacos 读取失败时使用默认值。默认值中 AI 总闸关闭，避免未配置 Key 时误跑。

简化示例：

```json
{
  "version": "2026-09-01",
  "scan": {
    "windowMinutes": 30,
    "historyDays": 30,
    "recentDays": 7,
    "incrementalOverlapHours": 2,
    "pageSize": 200,
    "maxPages": 3
  },
  "scheduler": {
    "tickIntervalMs": 60000,
    "maxJobsPerTick": 3,
    "staleRunningMinutes": 60,
    "incrementalIntervalMinutes": 15
  },
  "ai": {
    "baseURL": "https://aaii.xclaw.info/v1/",
    "model": "gemini-3.1-flash-lite-preview",
    "tweetAnalysisModel": "",
    "tweetAnalysisMaxTokens": 1200,
    "contentEnabled": false,
    "projectAttitudeEnabled": false,
    "contentConcurrency": 4,
    "projectAttitudeConcurrency": 8,
    "maxTextLength": 1200
  },
  "aiWorker": {
    "mode": "enabled",
    "tickIntervalMs": 60000,
    "maxBoardsPerTick": 3,
    "contentBatchSize": 80,
    "projectAttitudeBatchSize": 160,
    "contentConcurrency": 4,
    "projectAttitudeConcurrency": 8,
    "maxTextLength": 1200
  }
}
```

## 9. 后端 API

### 9.1 前台接口

挂载：`/api/xhunt/echohunt/social-listening`

| Method | Path | 说明 |
|---|---|---|
| GET | `/me/access-summary` | 当前用户是否有入口权限。 |
| GET | `/boards` | 当前用户可访问看板。 |
| GET | `/boards/:boardId` | 看板详情。 |
| GET | `/boards/:boardId/overview?range=7D` | 概览、趋势、情绪、主题、词云。 |
| GET | `/boards/:boardId/posts` | 帖子分页筛选。 |
| GET | `/boards/:boardId/posts/export` | xlsx 导出。 |
| POST | `/boards/:boardId/refresh` | 手动刷新。 |
| GET | `/boards/:boardId/accounts` | 关键账号动态。 |
| GET | `/boards/:boardId/alerts` | 预警列表。 |
| GET/POST/PATCH/DELETE | `/boards/:boardId/events...` | 用户关键事件。 |

### 9.2 管理接口

挂载：`/api/admin/social-listening`

| Method | Path | 说明 |
|---|---|---|
| GET/POST/PATCH/DELETE | `/monitored-accounts...`、`/boards/:boardId...` | 看板维护。 |
| GET/POST/DELETE | `/boards/:boardId/accesses...` | 授权维护。 |
| GET/POST | `/jobs...`、`/jobs/:jobId/retry` | 任务查询/重试。 |
| GET | `/boards/:boardId/posts`、`/posts/export` | 帖子排查/导出。 |
| GET | `/boards/:boardId/accounts`、`/alerts`、`/audit-logs` | 动态、预警、审计。 |
| GET/POST | `/runtime-config` | 运行配置读写。 |
| GET/POST | `/boards/:boardId/ai-config` | 看板级 AI 开关与费用确认。 |
| GET/POST | `/ai-worker/status|pause|resume` | AI Worker 状态与独立暂停/恢复。 |

## 10. 管理后台交互

`admin-web` 页面当前重点能力：

- 列表区：看板状态、粉丝/排名、帖子量、授权数、最新任务。
- 抽屉区：账号详细字段、授权、任务、账号动态、预警、帖子排查。
- AI 运行配置：总闸、模型、Base URL、API Key 操作、prompt、并发、批大小、截断、费用估算。
- AI Worker：单独暂停/恢复，展示 Redis 状态和上次运行摘要。
- AI 回填检查：可翻页查看最新 AI 回填内容，展示 `summaryZh/summaryEn/topics/keywords/projectAttitudeScore/sentiment/sentimentSummaryZh/tagStatus/summaryStatus/attitudeStatus/aiError` 等字段，方便调 prompt。

## 11. 聚合与预警

聚合来源：`EchohuntSocialListeningPosts`。

快照范围：`24H / 7D / 30D`。

核心计算：

- 讨论量：帖子数。
- 参与账号：`count(distinct authorTwitterId)`。
- 曝光：`sum(viewsCount)`。
- 互动：likes + reposts + quotes + replies。
- 情绪：只统计明确 positive/neutral/negative 的帖子；unknown 单独记录。
- 主题：聚合 `topics`。
- 词云：聚合过滤后的 AI 讨论热词，不直接展示召回关键词；可通过看板配置追加词云排除词。

预警：

- 高排名账号提及：global <= 10000 或 cn <= 1500。
- 讨论量异常：最近 1 小时 vs 历史同小时段基线，默认 2x 且达到最小样本数。
- 负面占比异常：最近 1 小时负面占比相对基线上升，默认 +20pp。
- 负面内容风险：最近窗口内出现达到配置阈值的已确认负面讨论即可提示。
- 集中负面风险：最近窗口内负面帖数与负面作者数同时达到集中阈值时提高严重级别。

阈值在 Nacos `alert` 配置中控制。

## 12. 性能与容量控制

- 不在 API 请求里扫 `dev.tweet/dev.twitter_user` 大表。
- 采集任务按时间窗口分页扫描，设置 statement timeout。
- 增量使用 overlap + unique 去重，防上游延迟。
- AI Worker 支持并发、批大小、文本截断、短文本优先。
- 导出字段白名单化，默认 10,000 行上限。
- 建议根据线上日志持续调整 AI 并发和截断长度；目标是稳定优先，再逐步提速。

## 13. 测试与验证建议

后端：

- handle/X URL 解析、文本归一化、关键词边界。
- 权限：未登录、未授权、授权、撤销。
- 看板唯一性与软删除。
- 任务锁：重复手动刷新只产生一个 running job。
- 采集：同 tweetId 多来源去重、overlap 不丢数据。
- 聚合：24H/7D/30D 指标一致性，unknown 情绪不混入分母。
- AI：一次 `tweetAnalysis` 是否写全字段；失败是否写 `aiError`；不引用 `postZh`；不回写 `dev.tweet.ai`。
- 导出：字段白名单、筛选条件一致、限流生效。

前端/admin-web：

- AI 配置保存后 Nacos 回读正常。
- AI Worker 暂停/恢复状态和 Redis 状态一致。
- AI 回填检查分页、字段展示、错误展示正常。
- 帖子导出与当前筛选一致。

## 14. 上线与生产排查规则

生产环境限制：

- 只允许查看日志、进程状态、只读配置和只读诊断结果。
- 禁止直接执行迁移、写 SQL、重启/停止服务、修改配置、删除文件、安装依赖等变更命令。
- 如果需要变更，只汇报原因、风险和建议命令，由用户确认并执行。

只读日志关键字：

```text
SocialListeningScheduler
SocialListeningAIWorker
SocialListeningAI
purpose=tweetAnalysis
column "postZh" does not exist
```

“管理后台 AI 全是 0”的常见原因：

1. 没有 pending 帖子。
2. 看板不是 `monitoring`。
3. AI 总闸或看板开关关闭。
4. API Key/Base URL/模型配置不完整。
5. Redis 暂停了 AI Worker。
6. Nacos `aiWorker.mode=disabled`。
7. 线上进程仍是旧代码或未加载最新配置。
8. AI 请求失败，错误写在日志和 `aiError`。

## 15. 当前仍待确认/优化

- EchoHunt 前台真实 API 接入进度。
- quote/reply/comment 召回 SQL 与真实 JSON 样例的边界校准。
- 关注/取关动态的展示继续按“高排名账号提及 / 新增 KOL 粉丝 / 取关动态”校准，通用 follow 默认 `latest >= 150`，project follow 默认 `latest > 0`。
- AI prompt 质量：通过管理后台“AI 回填检查”抽样调优。
- 线上并发、批大小、截断长度与成本的最终平衡。
- Social Listening 数据保留周期。
