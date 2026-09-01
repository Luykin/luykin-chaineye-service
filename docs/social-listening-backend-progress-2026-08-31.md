# EchoHunt Social Listening 后端实现进度记录

> 首次记录日期：2026-08-31
> 最近更新：2026-09-01
> 后端仓库：`/Users/luykin/Documents/mac-work/luykin-chaineye-service`
> 关联方案文档：`docs/social-listening-technical-implementation.md`
> 关联时序图：`docs/social-listening-sequence-diagrams/`

## 1. 当前结论

Social Listening V1 后端与管理后台已从“骨架闭环”推进到 **可配置、可回填、可排查的第一版实现**。

已完成：

- PostgreSQL 迁移、Sequelize 模型、模型注册与主要关联。
- EchoHunt 前台 Social Listening API。
- `admin-web` 舆情监控管理页：看板维护、授权、任务/预警/帖子排查、导出、AI 配置与 AI Worker 控制。
- `singletonJobsServer.js` 中的采集/聚合调度器：监控中看板按配置触发增量采集，默认增量间隔 15 分钟。
- 独立 AI Worker：与 15 分钟采集调度拆开，有待处理数据时约 10 秒一轮连续回填，可在管理后台单独暂停/恢复。
- 只读库数据源读取、帖子召回入库、聚合快照、关键账号动态、预警、手动刷新、导出、授权校验。
- 关注/取关动态读取：`dev.twitter_user_follow`、`dev.twitter_user_unfollow`、`dev.project_follow`。
- 聚合型预警：讨论量异常、负面占比异常、集中负面风险。
- AI 回填改为每条推文 **一次综合调用**，一次产出摘要、结构化主题/热词、项目态度；不再按“标签/摘要/态度”拆成多次请求。

仍需注意：

- EchoHunt 前台 `/social-listening` 从静态 Mock 切真实 API 属于前端仓库工作，不在本后端仓库内完成。
- 线上效果需结合真实只读库样例、AI 返回质量、任务日志继续校准。
- 生产服务器只允许查看日志/状态；如需迁移、重启、修复数据或改配置，应由用户确认并执行。

## 2. 重要纠正

之前文档里有几处说法已经过期，统一按下面口径理解：

| 旧说法 | 当前正确说法 |
|---|---|
| `admin-web` 管理界面还未实现 | 已实现 `/social-listening` 管理页和 `social-listening` 权限入口。 |
| 关注/取关动态还未完整实现 | 已接入三张只读关系表，仍可继续根据产品展示口径微调。 |
| 讨论量/负面占比/集中负面预警还未实现 | 已实现聚合型预警初版，阈值通过运行配置控制。 |
| AI 调用固定内部服务 `/ai/project_attitude`、`/ai/tweet_tag_v2`、`/ai/tweet_summary_media` | 当前主链路改为 OpenAI-compatible `structuredChat`，配置来自 Nacos；每条推文调用 `tweetAnalysis` 综合结构化 prompt。旧拆分 prompt 仅保留兼容/配置素材。 |
| 每条推文要多次生成标签、摘要、态度 | 当前每条推文只读一次正文、发一次 `tweetAnalysis`，同时返回摘要、结构化主题/热词、项目态度，减少 token 和延迟。 |
| 需要生成/写入 `postZh` 中文全文 | 不再生成 `postZh`。该字段只作为历史兼容概念，当前表结构没有 `postZh` 列，代码不应再查询或写入它。 |
| AI 和 15 分钟采集轮询绑定 | 已拆分：采集/聚合仍按调度跑；AI Worker 独立连续回填待处理旧帖和新帖，可单独暂停。 |
| 通过 `SOCIAL_LISTENING_AI_*` 环境变量控制 | 当前主要通过 Nacos `echohunt_social_listening_config` 控制，后端有默认配置兜底。 |

## 3. 已修改/新增文件概览

### 3.1 后端核心文件

```text
migrations-pg/20260831193000-create-echohunt-social-listening-tables.js
src/models/postgres-start.js
src/apiServer.js
src/singletonJobsServer.js
src/xhunt/api/echohunt.js
src/xhunt/social-listening/constants.js
src/xhunt/social-listening/api/admin.js
src/xhunt/social-listening/api/public.js
src/xhunt/social-listening/models/EchohuntSocialListening*.js
src/xhunt/social-listening/services/aggregate-service.js
src/xhunt/social-listening/services/analysis-service.js
src/xhunt/social-listening/services/ai-backfill-scheduler.js
src/xhunt/social-listening/services/ai-prompt-templates.js
src/xhunt/social-listening/services/board-service.js
src/xhunt/social-listening/services/data-source.js
src/xhunt/social-listening/services/export-service.js
src/xhunt/social-listening/services/ingest-service.js
src/xhunt/social-listening/services/local-ai-service.js
src/xhunt/social-listening/services/runtime-config.js
src/xhunt/social-listening/services/scheduler.js
src/xhunt/social-listening/utils/text-normalize.js
src/xhunt/social-listening/utils/twitter.js
```

### 3.2 管理后台文件

```text
admin-web/src/config/admin-navigation.tsx
admin-web/src/pages/SocialListeningPage.tsx
admin-web/src/services/social-listening.ts
```

## 4. 数据库与模型进度

已新增 9 张主业务 PostgreSQL 表：

| 表名 | 用途 | 状态 |
|---|---|---|
| `EchohuntSocialListeningBoards` | 被监控账号/看板主表 | 已建模型与迁移 |
| `EchohuntSocialListeningBoardAccesses` | 看板授权表 | 已建模型与迁移 |
| `EchohuntSocialListeningAccessAuditLogs` | 操作/导出审计日志 | 已建模型与迁移 |
| `EchohuntSocialListeningPosts` | 去重后的帖子事实表 | 已建模型与迁移 |
| `EchohuntSocialListeningSnapshots` | 24H/7D/30D 聚合快照 | 已建模型与迁移 |
| `EchohuntSocialListeningAccountSignals` | 关键账号动态 | 已建模型与迁移 |
| `EchohuntSocialListeningAlerts` | 预警信号 | 已建模型与迁移 |
| `EchohuntSocialListeningKeyEvents` | 用户自维护关键事件 | 已建模型与迁移 |
| `EchohuntSocialListeningJobs` | 后台采集/刷新任务状态 | 已建模型与迁移 |

字段注释已在 Sequelize 模型和迁移 `COMMENT ON COLUMN` 中补齐。

## 5. API 进度

### 5.1 EchoHunt 前台 API

挂载：

```text
/api/xhunt/echohunt/social-listening
```

鉴权：`authenticateAuthCenterToken()`；所有看板数据接口都会重复校验 `EchohuntSocialListeningBoardAccesses` 授权。

| Method | Path | 状态 |
|---|---|---|
| GET | `/me/access-summary` | 已完成 |
| GET | `/boards` | 已完成 |
| GET | `/boards/:boardId` | 已完成 |
| GET | `/boards/:boardId/overview?range=7D` | 已完成初版 |
| GET | `/boards/:boardId/posts` | 已完成 |
| GET | `/boards/:boardId/posts/export` | 已完成 |
| POST | `/boards/:boardId/refresh` | 已完成 |
| GET | `/boards/:boardId/accounts` | 已完成初版 |
| GET | `/boards/:boardId/accounts/:twitterId` | 已完成初版 |
| GET | `/boards/:boardId/alerts` | 已完成初版 |
| GET | `/boards/:boardId/alerts/:alertId` | 已完成初版 |
| GET/POST/PATCH/DELETE | `/boards/:boardId/events...` | 已完成 |

### 5.2 admin 后端 API

挂载：

```text
/api/admin/social-listening
```

鉴权：`adminAuth + requirePermission("social-listening")`。

| Method | Path | 状态 |
|---|---|---|
| GET/POST/PATCH/DELETE | `/monitored-accounts...`、`/boards/:boardId...` | 已完成 |
| GET/POST/DELETE | `/boards/:boardId/accesses...` | 已完成 |
| GET/POST | `/jobs...`、`/jobs/:jobId/retry` | 已完成 |
| GET | `/boards/:boardId/posts`、`/posts/export` | 已完成 |
| GET | `/boards/:boardId/accounts`、`/alerts`、`/audit-logs` | 已完成 |
| GET/POST | `/runtime-config` | 已完成，读写 Nacos 运行配置 |
| GET/POST | `/boards/:boardId/ai-config` | 已完成，看板级 AI 开关/费用确认 |
| GET/POST | `/ai-worker/status`、`/ai-worker/pause`、`/ai-worker/resume` | 已完成，独立控制 AI Worker |

## 6. 定时任务与 AI Worker

### 6.1 采集/聚合调度器

`src/singletonJobsServer.js` 接入：

```javascript
createSocialListeningScheduler({ redisClient }).start()
```

当前能力：

1. 按配置 tick，默认每分钟检查。
2. 对 `status='monitoring'` 的 board，按 `scheduler.incrementalIntervalMinutes` 判断是否需要创建 `incremental` 任务，默认 15 分钟。
3. 自动认领 pending job 执行。
4. 使用 Redis board lock 防止同一看板并发采集：

```text
echohunt:social-listening:job-lock:{boardId}
```

5. 超时 running job 默认 60 分钟后恢复为失败，便于后续重试。

### 6.2 AI Worker

AI 回填已经从采集任务里拆出来：

```javascript
createSocialListeningAiWorker({ redisClient }).start()
```

关键行为：

- Redis 状态 key：`echohunt:social-listening:ai-worker:state`。
- 上次运行摘要 key：`echohunt:social-listening:ai-worker:last-run`。
- 默认状态：未显式暂停且 Nacos 未禁用时运行。
- 有待处理帖子时，下一轮约 10 秒后继续跑；没有待处理时按 `aiWorker.tickIntervalMs` 空闲间隔检查。
- 每轮最多处理 `aiWorker.maxBoardsPerTick` 个看板。
- 对同一 board 复用采集锁，避免采集和 AI 同时改同一批帖子。
- 待处理帖子按正文长度从短到长，再按排名/曝光/发布时间排序；长推文会按 `maxTextLength` 硬截断。
- 每条推文使用一次 `tweetAnalysis` 综合调用，日志会输出单条耗时、批次耗时、并发、截断情况。

## 7. AI 当前实现

### 7.1 调用方式

当前不再固定调用 K8s 内部旧路径，而是通过 `src/lib/llm` 的 OpenAI-compatible `structuredChat`：

```text
ai.baseURL
ai.apiKey
ai.model / ai.tweetAnalysisModel
ai.tweetAnalysisMaxTokens
```

这些配置来自 Nacos：

```text
dataId: echohunt_social_listening_config
group: DEFAULT_GROUP
```

如 Nacos 读取失败，使用后端默认配置兜底；默认 AI 总闸是关闭的，必须配置 API Key 并开启对应开关后才会回填。

### 7.2 一次综合输出字段

每条推文期望 AI 返回：

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

写入 `EchohuntSocialListeningPosts`：

```text
summaryZh / summaryEn
topics / keywords
projectAttitudeScore / sentimentScore / sentiment / sentimentSummaryZh
tagStatus / summaryStatus / attitudeStatus / aiStatus
aiAnalyzedAt / aiError / aiSource
rawTweet.socialListeningAi
```

`aiSource` 当前主口径为：

```text
social_listening_combined
```

### 7.3 `postZh` 说明

`postZh` 不是当前表字段，也不是当前产品需要的字段。当前 prompt 明确要求：

- 不翻译全文。
- 不输出 `post_zh`。
- 只输出短摘要与态度说明。

所以线上如果出现 `column "postZh" does not exist`，通常意味着还有旧代码/旧进程/旧导出字段/旧 SQL 在引用这个遗留字段，需要按日志定位并清理引用，而不是给表补一个无用字段。

## 8. 管理后台能力

`admin-web` 已有 `/social-listening` 页面，包含：

- 看板列表、新增、编辑、解析资料。
- 看板管理抽屉：基础资料、授权、任务、账号动态、预警、帖子排查、导出。
- AI 运行配置：Base URL、API Key、模型、prompt、阈值、批大小、并发、截断长度、费用估算。
- AI Worker 卡片：运行/暂停状态、独立暂停/恢复、上次运行摘要。
- AI 回填检查：可查看已回填帖子，字段包含摘要、结构化主题/热词、项目态度、情绪、状态、错误信息，并支持分页，便于调整 prompt 后抽样检查质量。

## 9. 导出与审计

已完成 xlsx 导出：

- 默认最大导出行数：`10000`。
- 前台用户限流：同一用户 + board 10 分钟一次。
- 后台运营限流：同一 admin + board 5 分钟一次。
- 字段白名单化，不导出 `rawTweet/rawAuthor`。
- 导出会写审计日志：

```text
EchohuntSocialListeningAccessAuditLogs.action = posts_export
```

## 10. 授权能力

前台授权匹配三种方式：

1. `authCenterUserId` 精确匹配。
2. Twitter identity 的 `providerSubject` 匹配 `twitterId`。
3. Twitter identity 的 `username` 规范化后匹配 `twitterHandle`。

如果运营先按 handle 授权，用户后续登录后首次访问会尝试自动回填：

```text
authCenterUserId
twitterId
xhuntUserId
metadata.autoBoundAt
```

撤销授权后，所有前台 API 会实时拒绝访问。

## 11. 已做校验

此前已执行并通过：

```bash
node --check src/xhunt/social-listening/services/runtime-config.js
node --check src/xhunt/social-listening/api/admin.js
node --check src/xhunt/social-listening/services/analysis-service.js
node --check src/xhunt/social-listening/services/local-ai-service.js
node --check src/xhunt/social-listening/services/ai-backfill-scheduler.js
node --check src/xhunt/social-listening/services/ai-prompt-templates.js
node --check src/xhunt/social-listening/services/export-service.js
node --check src/xhunt/social-listening/services/board-service.js
node --check src/xhunt/social-listening/models/EchohuntSocialListeningPost.js
git diff --check
admin-web/node_modules/.bin/tsc --noEmit -p admin-web/tsconfig.json
```

本次文档更新不启动开发服务器、不执行 build。

## 12. 上线/排查注意事项

### 12.1 数据库迁移

上线环境需要确认迁移已执行：

```bash
yarn db:migrate:pg:status
```

如需要执行迁移，必须由用户确认并在生产环境自行执行。

### 12.2 Nacos 运行配置

关键配置：

```json
{
  "ai": {
    "baseURL": "https://aaii.xclaw.info/v1/",
    "apiKey": "***",
    "model": "gemini-3.1-flash-lite-preview",
    "tweetAnalysisModel": "",
    "tweetAnalysisMaxTokens": 1200,
    "contentEnabled": true,
    "projectAttitudeEnabled": true,
    "maxTextLength": 1200,
    "prompts": {
      "tweetAnalysis": "..."
    }
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

### 12.3 “管理后台全是 0”的排查口径

如果 AI Worker 区域显示全是 0，不一定代表没启动，可能是：

- 当前没有待处理帖子。
- 看板不是 `monitoring` 状态。
- AI 总闸或看板级开关未开启。
- API Key/Base URL/模型配置不完整。
- Redis 中 AI Worker 被暂停。
- Nacos `aiWorker.mode=disabled`。
- 旧进程尚未重启，仍在跑旧代码。
- 任务失败但只写在 `aiError` / 日志中，需要看 `SocialListeningAI`、`SocialListeningAIWorker` 日志。

生产排查只允许查看日志/状态，不能直接修改线上配置、重启、写库或执行迁移。

## 13. 后续建议

1. 线上观察 AI Worker 日志和管理后台“AI 回填检查”样本，持续调 prompt。
2. 根据真实耗时调整 `contentConcurrency`、`projectAttitudeConcurrency`、`maxBoardsPerTick`、`maxTextLength`。
3. EchoHunt 前台仓库接真实 API，移除 Social Listening Mock 数据。
4. 继续校准 quote/reply/comment 召回 SQL 与真实 JSON 样例。
5. 如线上仍报 `postZh`，优先排查旧进程/旧导出字段/旧 SQL 引用。
