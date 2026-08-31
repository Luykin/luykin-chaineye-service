# EchoHunt Social Listening 后端实现进度记录

> 记录日期：2026-08-31  
> 后端仓库：`/Users/luykin/Documents/mac-work/luykin-chaineye-service`  
> 关联方案文档：`docs/social-listening-technical-implementation.md`  
> 关联时序图：`docs/social-listening-sequence-diagrams/`

## 1. 当前结论

本轮已完成 **Social Listening 后端第一版骨架闭环**：

- 已新增数据库迁移和 Sequelize 模型。
- 已新增 EchoHunt 前台 API。
- 已新增 admin 后端 API。
- 已接入 `singletonJobsServer.js` 调度器；默认暂停，仅管理员在后台恢复看板/刷新/重试后才写入运行标记并开始处理。
- 已实现只读库数据源读取、帖子召回入库、聚合快照、手动刷新、导出、授权校验等第一版逻辑。
- 所有新增模型字段已写 `comment` 注释。
- 迁移中已通过 `COMMENT ON COLUMN` 写数据库字段注释。

但以下部分还没有完成：

- `admin-web` 管理界面还未实现。
- EchoHunt 前端 Social Listening 页面还未从 Mock 切到真实 API。
- 关注/取关动态还未完整实现。
- 讨论量异常、负面占比异常、集中负面预警还未完整实现。
- 摘要/标签缺失时的 AI 补充还未完整实现；目前只接了可选项目态度 AI。

## 2. 已修改/新增文件

### 2.1 新增文件

```text
migrations-pg/20260831193000-create-echohunt-social-listening-tables.js
src/xhunt/social-listening/constants.js
src/xhunt/social-listening/api/admin.js
src/xhunt/social-listening/api/public.js
src/xhunt/social-listening/models/EchohuntSocialListeningAccessAuditLog.js
src/xhunt/social-listening/models/EchohuntSocialListeningAccountSignal.js
src/xhunt/social-listening/models/EchohuntSocialListeningAlert.js
src/xhunt/social-listening/models/EchohuntSocialListeningBoard.js
src/xhunt/social-listening/models/EchohuntSocialListeningBoardAccess.js
src/xhunt/social-listening/models/EchohuntSocialListeningJob.js
src/xhunt/social-listening/models/EchohuntSocialListeningKeyEvent.js
src/xhunt/social-listening/models/EchohuntSocialListeningPost.js
src/xhunt/social-listening/models/EchohuntSocialListeningSnapshot.js
src/xhunt/social-listening/services/analysis-service.js
src/xhunt/social-listening/services/aggregate-service.js
src/xhunt/social-listening/services/board-service.js
src/xhunt/social-listening/services/data-source.js
src/xhunt/social-listening/services/errors.js
src/xhunt/social-listening/services/export-service.js
src/xhunt/social-listening/services/ingest-service.js
src/xhunt/social-listening/services/scheduler.js
src/xhunt/social-listening/utils/text-normalize.js
src/xhunt/social-listening/utils/twitter.js
```

### 2.2 修改文件

```text
src/models/postgres-start.js
src/xhunt/api/echohunt.js
src/apiServer.js
src/singletonJobsServer.js
```

## 3. 数据库与模型进度

### 3.1 已新增表

本轮新增 9 张主业务 PostgreSQL 表：

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
| `EchohuntSocialListeningJobs` | 后台任务状态表 | 已建模型与迁移 |

### 3.2 字段注释

已按要求补齐字段注释：

- Sequelize 模型字段均包含 `comment`。
- 迁移文件中增加 `COLUMN_COMMENTS` 和 `applyColumnComments(queryInterface)`。
- 迁移时会执行：

```sql
COMMENT ON COLUMN "表名"."字段名" IS '字段说明';
```

### 3.3 模型注册与关联

已在 `src/models/postgres-start.js` 中：

- require 新增模型。
- 初始化模型实例。
- 建立 board 与 access/post/snapshot/signal/alert/event/job 的关联。
- 建立 AuthCenter 用户与 access/event 的关联。
- 导出新增模型。

## 4. 已完成的前台 API

前台 API 已挂载到：

```text
/api/xhunt/echohunt/social-listening
```

所有接口都使用：

```javascript
authenticateAuthCenterToken()
```

并在访问看板数据时重复校验 `EchohuntSocialListeningBoardAccesses` 授权。

| Method | Path | 状态 | 说明 |
|---|---|---|---|
| GET | `/me/access-summary` | 已完成 | 当前用户是否有 Social Listening 权限，用于前端入口门禁 |
| GET | `/boards` | 已完成 | 当前用户可访问看板列表 |
| GET | `/boards/:boardId` | 已完成 | 看板详情、任务状态、授权数量、帖子数量 |
| GET | `/boards/:boardId/overview?range=7D` | 已完成初版 | 返回最新 snapshot 和看板状态 |
| GET | `/boards/:boardId/posts` | 已完成 | 帖子分页、范围/情绪/来源/关键词筛选、排序 |
| GET | `/boards/:boardId/posts/export` | 已完成 | xlsx 导出，含限流和最大行数保护 |
| POST | `/boards/:boardId/refresh` | 已完成 | 用户手动刷新，含限流与任务复用 |
| GET | `/boards/:boardId/accounts` | 已完成初版 | 关键账号动态列表 |
| GET | `/boards/:boardId/accounts/:twitterId` | 已完成初版 | 关键账号详情，返回 signals 和 posts |
| GET | `/boards/:boardId/alerts` | 已完成初版 | 预警列表 |
| GET | `/boards/:boardId/alerts/:alertId` | 已完成初版 | 预警详情 |
| GET | `/boards/:boardId/events` | 已完成 | 当前用户关键事件列表 |
| POST | `/boards/:boardId/events` | 已完成 | 新增当前用户关键事件 |
| PATCH | `/boards/:boardId/events/:eventId` | 已完成 | 编辑当前用户关键事件 |
| DELETE | `/boards/:boardId/events/:eventId` | 已完成 | 删除当前用户关键事件 |

## 5. 已完成的 admin 后端 API

admin API 已挂载到：

```text
/api/admin/social-listening
```

使用鉴权：

```javascript
adminAuth + requirePermission("social-listening")
```

| Method | Path | 状态 | 说明 |
|---|---|---|---|
| GET | `/monitored-accounts` | 已完成 | 被监控账号分页列表 |
| POST | `/monitored-accounts/resolve` | 已完成 | 输入 handle，从只读库解析官方账号资料 |
| POST | `/monitored-accounts` | 已完成 | 新增被监控账号；默认 paused，不创建历史补数据任务 |
| GET | `/monitored-accounts/:boardId` | 已完成 | 被监控账号详情 |
| PATCH | `/monitored-accounts/:boardId` | 已完成 | 修改看板配置、关键词、状态等 |
| POST | `/boards/:boardId/pause` | 已完成 | 暂停看板 |
| POST | `/boards/:boardId/resume` | 已完成 | 恢复看板并触发刷新 |
| DELETE | `/boards/:boardId` | 已完成 | 软删除看板 |
| POST | `/boards/:boardId/refresh` | 已完成 | 运营侧手动刷新 |
| GET | `/boards/:boardId/accesses` | 已完成 | 授权列表 |
| POST | `/boards/:boardId/accesses` | 已完成 | 给 EchoHunt X handle 授权 |
| DELETE | `/boards/:boardId/accesses/:accessId` | 已完成 | 撤销授权 |
| GET | `/jobs` | 已完成 | 任务列表 |
| POST | `/jobs/:jobId/retry` | 已完成 | 重试任务 |

## 6. 定时任务进度

已在 `src/singletonJobsServer.js` 接入：

```javascript
createSocialListeningScheduler({ redisClient }).start()
```

当前调度能力：

1. 每分钟 tick。
2. 对 `status='monitoring'` 的 board，若 `processedThrough` 超过 15 分钟未更新，则创建 `incremental` 任务。
3. 自动拉取 pending job 执行。
4. 使用 Redis key 防止同一 board 并发执行：

```text
echohunt:social-listening:job-lock:{boardId}
```

5. 恢复超时 running job：默认 60 分钟未更新则标记 failed。

相关文件：

```text
src/xhunt/social-listening/services/scheduler.js
src/xhunt/social-listening/services/ingest-service.js
src/singletonJobsServer.js
```

## 7. 数据处理进度

### 7.1 已完成

已实现从只读库读取：

- `dev.twitter_user`
- `dev.tweet`

已实现：

- 官方账号 handle 规范化。
- 查询官方账号资料并快照到 board。
- 分时间窗口扫描候选推文。
- join 作者资料。
- 关键词命中。
- 不复用 `dev.tweet.ai` 作为最终摘要/标签/主题口径；统一由本功能调用旧 AI 服务写自己的字段。
- 写入 `EchohuntSocialListeningPosts`。
- `boardId + tweetId` 唯一去重。
- 生成 24H / 7D / 30D snapshots。
- 生成高影响力账号 `AccountSignals`。
- 生成高影响力提及 `Alerts`。

### 7.2 AI 项目态度

新增：

```text
src/xhunt/social-listening/services/analysis-service.js
```

当前策略：

- Social Listening 后台任务直接调用固定内部 AI 服务：

```text
http://backend-v1.xhunt.svc.cluster.local:3010
/ai/project_attitude
/ai/tweet_tag_v2
/ai/tweet_summary_media
```

- 不再要求新增 `SOCIAL_LISTENING_AI_BASE_URL` / `AI_CLIENT_URL` / `AI_SERVICE_BASE_URL` 环境变量。
- 不复用 `dev.tweet.ai` 作为最终分析口径；召回入库后由本功能自己的任务写入 `EchohuntSocialListeningPosts` 的摘要、主题、关键词、项目态度分、情绪等字段。
- AI 失败不阻断入库。
- 失败会写：

```text
sentiment='unknown'
attitudeStatus='failed'
aiError=错误摘要
```

相关批处理配置：

```text
SOCIAL_LISTENING_AI_BATCH_SIZE
SOCIAL_LISTENING_PROJECT_ATTITUDE_ENABLED
```

## 8. 导出能力进度

已完成 xlsx 导出：

- 文件格式：xlsx。
- 默认最大导出行数：`10000`。
- 前台用户限流：同一用户 + board 10 分钟一次。
- 后台运营限流：同一 admin + board 5 分钟一次。
- 导出字段使用白名单，不导出 `rawTweet/rawAuthor`。
- 导出会写审计日志：

```text
EchohuntSocialListeningAccessAuditLogs.action = posts_export
```

## 9. 授权能力进度

前台授权匹配已实现三种方式：

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

## 10. 已做的静态校验

已执行 `node --check`：

```text
src/xhunt/social-listening/constants.js
src/xhunt/social-listening/utils/twitter.js
src/xhunt/social-listening/utils/text-normalize.js
src/xhunt/social-listening/services/errors.js
src/xhunt/social-listening/services/data-source.js
src/xhunt/social-listening/services/aggregate-service.js
src/xhunt/social-listening/services/analysis-service.js
src/xhunt/social-listening/services/ingest-service.js
src/xhunt/social-listening/services/board-service.js
src/xhunt/social-listening/services/export-service.js
src/xhunt/social-listening/services/scheduler.js
src/xhunt/social-listening/api/public.js
src/xhunt/social-listening/api/admin.js
src/apiServer.js
src/singletonJobsServer.js
migrations-pg/20260831193000-create-echohunt-social-listening-tables.js
```

并用 dummy PG env 做过模块加载验证：

```bash
PG_HOST=localhost PG_DATABASE=test PG_USERNAME=test PG_PASSWORD=test node - <<'NODE'
require('./src/xhunt/social-listening/api/public');
require('./src/xhunt/social-listening/api/admin');
require('./src/xhunt/social-listening/services/scheduler');
require('./src/xhunt/social-listening/services/analysis-service');
console.log('social listening modules loaded');
NODE
```

结果：

```text
social listening modules loaded
```

未启动开发服务器，未运行 build。

## 11. 尚未完成/需要继续做

### 11.1 admin-web 管理界面

还未实现，需要新增：

- 菜单入口。
- 权限点展示配置。
- 被监控账号列表页。
- 新增/编辑被监控账号弹窗。
- 授权管理页。
- 任务/异常列表页。
- 手动刷新按钮。
- pause/resume/delete 操作。

### 11.2 EchoHunt 前端页面接入

还未实现，需要在前端仓库做：

- `/social-listening` 页面门禁。
- 替换 Mock 数据。
- 调用 `/api/echohunt/social-listening/me/access-summary`。
- 调用 boards/overview/posts/accounts/alerts/events/export 接口。
- 无授权跳回首页。

### 11.3 后端高级计算规则

还需继续补：

- 关注/取关动态口径按 `cryptohunt-backend-v2` 对齐：通用关系来自 `dev.twitter_user_follow` / `dev.twitter_user_unfollow`；项目专属关系来自 `dev.project_follow`，并默认纳入 Social Listening 展示。
- 讨论量异常：最近 1 小时 vs 过去 7 天同小时段基线，达到 2x。
- 负面占比异常：最近 1 小时负面占比比历史基线上升 20pp。
- 集中负面风险。
- 摘要/标签缺失时调用 AI 补充并只写本项目表。
- quote/reply/comment 的召回 SQL 还需要结合真实线上 JSON 样例继续校准。

## 12. 上线前注意事项

### 12.1 数据库迁移

需要执行：

```bash
yarn db:migrate:pg
```

建议先看状态：

```bash
yarn db:migrate:pg:status
```

### 12.2 环境变量

只读库连接复用项目现有 `src/infra/k8s/postgres-readonly.js` / `getK8sReadObjectConfig()` 配置链路；如果目标环境已配置 K8s read PG，则 Social Listening 不需要新增一套配置。

```text
K8S_PG_READ_DATABASE_URL
# 或现有 getK8sReadObjectConfig 支持的 K8S_PG_READ_* / PG_READ_* 拆分配置
```

AI 服务地址已在代码中固定为 `http://backend-v1.xhunt.svc.cluster.local:3010`，不需要额外配置环境变量。

### 12.3 admin 权限

需要给运营管理员增加权限点：

```text
social-listening
```

## 13. 下一步建议

建议下一轮优先做：

1. `admin-web` Social Listening 配置界面。
2. 后端补齐关注/取关动态和聚合型预警。
3. EchoHunt 前端页面从 Mock 切真实 API。
4. 结合真实只读库样例校准 `dev.tweet.info/mention/ai` JSON 解析。

---

## 14. 续实现记录（本轮）

本轮在第一版骨架基础上继续补齐后端计算和管理后台能力：

### 14.1 后端计算补充

- 新增关注/取关动态读取（已按 `cryptohunt-backend-v2` 代码核对表来源）：
  - 通用关注/取关关系读取 `dev.twitter_user_follow`、`dev.twitter_user_unfollow`，follow 条件按旧 DAO 对齐为 `latest > 0`。
  - 默认同时读取 `dev.project_follow`，因为当前功能围绕被监控项目官方 X 账号做关系动态。
  - `dev.project_follow` 查询按官方账号 ID 的入/出关系读取，不再猜测 `project` 字段应该等于 handle、项目名还是 slug。
  - 高排名提及使用全球 Top 10,000 或华语 Top 1,500；关注/取关动态改为 XHunt KOL 口径，不套高排名提及门槛。
- 新增聚合型预警：
  - 讨论量异常：最近 1 小时 vs 过去 N 天同小时段基线，默认 2x、最小 5 条。
  - 负面占比异常：最近 1 小时负面占比相对历史基线上升默认 20pp。
  - 集中负面风险：默认最近 1 小时至少 3 条负面、2 个负面作者触发。
- 新增可选摘要/标签 AI 补充：
  - `SOCIAL_LISTENING_CONTENT_AI_ENABLED=false` 可关闭。
  - 调用 `/ai/tweet_tag_v2`、`/ai/tweet_summary_media` 时只写本项目 `EchohuntSocialListeningPosts`，不回写 `dev.tweet.ai`，也不把 `dev.tweet.ai` 复用为最终口径。
  - `/ai/project_attitude` 的 `project` 入参默认只传 board `projectName`；如需完全复刻旧任务里的项目名（例如 `BNB Chain(币安链)`），通过 board `metadata.aiProjectName` 显式指定，避免拼接 handle/aliases 导致评分口径偏移。

### 14.2 admin 后端 API 补充

新增运营侧排查接口：

```text
GET /api/admin/social-listening/boards/:boardId/overview
GET /api/admin/social-listening/boards/:boardId/posts
GET /api/admin/social-listening/boards/:boardId/posts/export
GET /api/admin/social-listening/boards/:boardId/accounts
GET /api/admin/social-listening/boards/:boardId/alerts
GET /api/admin/social-listening/alerts
GET /api/admin/social-listening/audit-logs
```

### 14.3 admin-web 管理界面

新增 `admin-web` 页面：

- 导航菜单入口：`/social-listening`。
- 管理员权限点展示：`social-listening`。
- 被监控账号列表、新增、编辑、解析资料。
- 看板管理抽屉：授权管理、关键账号动态、预警、任务、帖子排查和导出。
- 支持暂停、恢复、软删除、手动刷新、失败任务重试。

### 14.4 本轮静态校验

已执行：

```bash
find src/xhunt/social-listening -name '*.js' -print | sort | xargs -n 1 node --check
./admin-web/node_modules/.bin/tsc -p admin-web/tsconfig.app.json --noEmit --pretty false
PG_HOST=localhost PG_DATABASE=test PG_USERNAME=test PG_PASSWORD=test node - <<'NODE'
require('./src/xhunt/social-listening/api/public');
require('./src/xhunt/social-listening/api/admin');
require('./src/xhunt/social-listening/services/scheduler');
require('./src/xhunt/social-listening/services/analysis-service');
require('./src/xhunt/social-listening/services/aggregate-service');
console.log('social listening modules loaded');
NODE
```

结果：均通过。未启动开发服务器，未执行 build。
