# EchoHunt E2E 用户主动提交互动链接改造方案

> 日期：2026-10-26  
> 后端：`/Users/luykin/Documents/mac-work/luykin-chaineye-service`  
> 前端：`/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt`

## 1. 需求结论

新流程为：

```text
用户报名
  -> 在 X 上评论或引用目标推文
  -> 在 EchoHunt 任务详情页粘贴自己的互动链接
  -> 后端实时验证作者与互动关系并保存
  -> 定时任务只对已提交、已验证的链接刷新数据并算分
  -> 活动到期生成结算草稿
```

明确停止：

- 不再按目标推文定时分页搜索 `tweet_replies`、`tweet_quotes`。
- 不再读取只读库来补齐未由用户提交的互动。
- 不恢复普通转推抓取，普通转推继续不计分。

“前端验证是否本人链接”应理解为前端发起验证并展示结果。浏览器只能检查链接格式，不能可信地证明作者身份；最终必须由后端通过 X API 返回的 `author_id` 与当前登录账号 Twitter ID 比较。URL 路径里的 Handle 可修改或过期，不能作为鉴权依据。

## 2. 当前实现与必须调整的位置

1. 当前定时器每 5 分钟调用 `updateActiveE2eTweetEngages()`，每 10 分钟算分；前一个任务就是需要下线的自动发现任务（`src/echohunt/e2e/jobs/e2eScheduler.js:1-55`）。
2. 即使删除 5 分钟任务，活动到期时 `calculateCampaignScores()` 仍会调用 `updateTweetEngageByTweetId()` 做最后一次抓取，因此这个调用也必须删除（`src/echohunt/e2e/services/e2eScoreService.js:1-5,107-125`）。
3. 当前互动统一保存在目标推文的 `engage_data` JSONB 中（`src/echohunt/e2e/models/E2eTweet.js:7-21`），算分时读取 `replies`、`quotes` 并按 `user_id` 归属参与者（`src/echohunt/e2e/services/e2eScoreService.js:38-78,116-136`）。该结构没有提交人、验证时间、验证失败原因，也不能安全处理并发提交和同一目标推文的多个活动批次。
4. 当前 `getEchohuntTweetDetail()` 只请求 `author_id`，只能判断作者，不能判断提交推文是否回复/引用目标推文，也没有发布时间和实时指标（`src/xhunt/services/twitter-echohunt.js:201-232`）。
5. 当前 E2E 公共路由只有列表、详情、关注校验和报名，没有互动链接提交接口（`src/echohunt/e2e/api/router.js:87-101,180-220`）。
6. 当前详情页只展示报名流程；报名后没有“我的互动”提交区域（前端 `components/e2e/E2ETaskDetailPage.tsx:147-270,372-517`）。
7. Admin 诊断页仍展示“最近抓取过程”和从 `engage_data` 拼出的互动（`src/admin/api/e2e-campaigns.js:571-654`；`admin-web/src/components/e2e/E2eDiagnosticsTab.tsx:41-50`），新方案应改为提交与验证明细。

## 3. 后端设计

### 3.1 新增独立提交表

新增迁移、模型 `E2eInteractionSubmission`，表名建议 `EchohuntE2eInteractionSubmissions`。不要继续把人工提交写进 `E2eTweet.engage_data`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID, PK | 提交记录 ID |
| `campaign_address` | STRING, NOT NULL | 精确关联活动批次 `E2eList.address` |
| `campaign_tweet_id` | STRING, NOT NULL | 目标推文 ID 快照 |
| `interaction_tweet_id` | STRING, NOT NULL | 用户提交的评论/引用推文 ID |
| `interaction_type` | STRING, NOT NULL | 仅 `reply` / `quote` |
| `interaction_url` | STRING, NOT NULL | 规范化后的 `https://x.com/.../status/...` |
| `user_id` | STRING, NOT NULL | 已验证的互动作者 Twitter ID |
| `username` / `name` / `profile_image_url` | STRING | 作者资料快照 |
| `text` | TEXT | 互动正文 |
| `interaction_created_at` | DATE, NOT NULL | X 返回的真实发布时间 |
| `likes` / `replies` / `retweets` / `views` | BIGINT | 当前指标快照 |
| `status` | STRING, NOT NULL | `verified` / `unavailable`；只有 `verified` 参与算分 |
| `verified_at` | DATE, NOT NULL | 首次验证时间 |
| `last_refreshed_at` | DATE | 最近一次指标刷新时间 |
| `last_error` | TEXT | 最近刷新失败原因，供 Admin 排查 |
| `submitted_at` / `updated_at` | DATE | 审计时间 |

索引与约束：

- 唯一索引：`(campaign_address, interaction_tweet_id)`，同一互动在同一活动只能被认领一次。
- 查询索引：`(campaign_address, user_id, status)`。
- 校验约束：`interaction_type IN ('reply', 'quote')`。
- 每个用户每种类型最多接受 20 条，与当前评分配置允许的 `maxReplies/maxQuotes` 上限一致（`src/echohunt/e2e/services/e2eScoringConfig.js:28-41`）；最终计分条数仍由活动配置决定。

该表按 `campaign_address` 隔离批次，可以避免同一原推文以后重新投放时把旧活动互动错误带入新活动。

### 3.2 扩展 X 推文详情能力

用户提供的 XClaw API 文档目前没有按 Tweet URL / Tweet ID 获取详情的接口；现有 `/data/*` 都是账号或项目分析接口，不能验证回复/引用关系。仓库内部虽然已经约定调用 crawler 的 `tweet_detail`（`POST <crawlerUrl>`，body 为 `{ endpoint: "tweet_detail", tweet_id }`），但当前 E2E 只消费正文和作者字段。实现时可二选一：

- 扩展现有官方 X API 查询；
- 让 crawler / XClaw 的 `tweet_detail` 支持同一数据契约，提交和定时刷新均逐条传入 `tweet_id`。

无论选择哪个数据源，都必须返回作者 ID、发布时间、回复/引用目标和公开互动指标；完整接口缺口另见 `docs/2026-10/xclaw-tweet-detail-api-gap-20261026.md`。

扩展 `getEchohuntTweetDetail()`，请求：

```text
tweet.fields=author_id,created_at,conversation_id,referenced_tweets,public_metrics
expansions=author_id
user.fields=id,name,username,profile_image_url
```

标准化返回至少包含：

```js
{
  id,
  text,
  authorId,
  authorUsername,
  authorName,
  authorProfileImageUrl,
  createdAt,
  conversationId,
  referencedTweets, // [{ type: "replied_to" | "quoted" | "retweeted", id }]
  metrics: { likes, replies, retweets, quotes, views }
}
```

保留现有字段名称，避免影响投放审核和关注验证的调用方。定时算分逐条查询已验证的 Tweet ID；当前预计总量不大，不增加批量查询接口。

### 3.3 新增用户接口

路由继续挂在现有 `/api/xhunt/echohunt/e2e` 下；前端仍通过自身 `/api/echohunt` 代理转发（前端 `app/api/echohunt/[...path]/route.ts:4-25,73-81,111-128`）。

#### 提交并验证互动

```http
POST /api/xhunt/echohunt/e2e/tasks/:tweetId/interactions
Authorization: Bearer <auth-center-token>
Content-Type: application/json

{
  "address": "活动地址/批次标识",
  "tweet_url": "https://x.com/user/status/123"
}
```

服务端验证顺序：

1. 当前登录态必须包含 Twitter identity。
2. `address + :tweetId` 必须精确匹配活动，活动状态为 `active`，且当前时间未超过 `end_time`。
3. 当前 Twitter ID 必须已存在于该活动的 `E2eRecord` 报名记录；报名主键目前就是 `address + user_id`（`src/echohunt/e2e/models/E2eRecord.js:7-16`）。
4. 严格解析 HTTPS 的 `x.com` / `twitter.com` status URL，不接受任意字符串或纯数字。
5. 实时查询互动推文详情，以 X 返回的 `author_id` 校验必须等于当前登录 Twitter ID。前端 URL Handle 不参与鉴权。
6. 从 `referenced_tweets` 自动识别类型：
   - `reply`：必须存在 `{ type: "replied_to", id: campaign.tweet_id }`；
   - `quote`：必须存在 `{ type: "quoted", id: campaign.tweet_id }`；
   - 普通转推、独立推文、回复其他推文全部拒绝。
7. `created_at` 必须不晚于活动结束时间；当 `retro=false` 时还必须不早于该用户报名时间。语言要求继续由现有算分逻辑统一判定，提交成功不代表一定计分。
8. 在事务中写入；重复提交同一链接由唯一索引兜底。本人重复提交返回原记录，其他用户认领同一链接返回冲突。

建议成功响应：

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "tweetId": "123",
    "tweetUrl": "https://x.com/user/status/123",
    "type": "reply",
    "status": "verified",
    "text": "...",
    "createdAt": "2026-10-26T00:00:00.000Z",
    "metrics": { "likes": 0, "replies": 0, "retweets": 0, "views": 0 },
    "submittedAt": "2026-10-26T00:01:00.000Z"
  }
}
```

核心错误码：`E2E_REGISTRATION_REQUIRED`、`E2E_INTERACTION_SUBMISSION_CLOSED`、`E2E_INVALID_INTERACTION_URL`、`E2E_INTERACTION_NOT_FOUND`、`E2E_INTERACTION_AUTHOR_MISMATCH`、`E2E_INTERACTION_TARGET_MISMATCH`、`E2E_INTERACTION_TYPE_UNSUPPORTED`、`E2E_INTERACTION_LIMIT_REACHED`、`E2E_INTERACTION_ALREADY_CLAIMED`，并沿用 `X_REAUTH_REQUIRED` 和 X API 限流错误。

#### 查询我的提交

```http
GET /api/xhunt/echohunt/e2e/tasks/:tweetId/interactions/me?address=<campaign-address>
Authorization: Bearer <auth-center-token>
```

只返回当前登录 Twitter ID 在该活动中的提交，按互动时间升序；同时用 `E2eRecord.score_breakdown.interactions` 的 tweet ID 补充最近一次 `counted`、`score`、`reason`，供前端解释“已验证但因语言或条数上限未计分”。不要在公共排行榜响应中暴露所有人的完整提交内容。

### 3.4 调整算分数据源与定时器

`e2eScoreService` 的评分公式不改，只替换互动数据来源：

- 从 `EchohuntE2eInteractionSubmissions` 查询 `campaign_address + status=verified`。
- 转成现有 `scoreSingleInteraction()` 需要的 `{ id, user_id, text, create_time, likes, replies, retweets, views }`，继续复用语言过滤、时间衰减、条数上限、排名权重（当前公式位于 `src/echohunt/e2e/services/e2eScoreService.js:38-96` 和 `src/echohunt/e2e/services/e2eScoringPolicy.js:23-59`）。
- 删除 `e2eScoreService` 对 `E2eTweet.engage_data` 的读取和 `updateTweetEngageByTweetId()` 调用。
- 删除 `e2eScheduler` 的 5 分钟抓取 cron、`runEngageTaskSafely` 状态及导出；保留 10 分钟算分、到期流转和分发状态刷新。
- `e2eEngageService.js` 在所有调用移除后成为死代码，可以随本改造删除；`E2eCrawlRun` 表先保留只读历史，不再新增记录，后续单独迁移删除，避免把业务切换和历史清理绑在一次发布中。

每轮算分逐条刷新“已知提交 ID”的指标，然后算分；这不是查找回复/引用列表。刷新失败时保留上一次已验证快照并记录 `last_error`，不得把提交删除或分数直接清零。活动到期生成不可变结算草稿前再执行一次已知 ID 刷新；Admin 需显示失败数和最旧快照时间，管理员可在确认名单前重试重新计算。

为避免任务重叠，保留现有 `scoreRunning` 互斥保护（`src/echohunt/e2e/jobs/e2eScheduler.js:24-40`）。

## 4. 前端改造

涉及：

- `lib/e2e-api.ts`
- `components/e2e/E2ETaskDetailPage.tsx`
- `lib/i18n/locales/zh-CN.ts`
- `lib/i18n/locales/en.ts`

### 4.1 API 与类型

在 `lib/e2e-api.ts` 增加 `E2eInteractionSubmission` 类型，以及：

- `submitE2eInteraction(tweetId, { address, tweet_url }, token)`
- `fetchMyE2eInteractions(tweetId, address, token)`

现有 API 调用都集中在该文件（`lib/e2e-api.ts:189-249`），无需改 Next.js 代理；E2E 已被标记为实时、`no-store` 路径。

### 4.2 任务详情交互

在“我的参与状态”中：

- 未报名：保持现有关注作者 + EVM 地址报名流程。
- 已报名且活动进行中：展示“我的互动”卡片、一个统一链接输入框和“验证并提交”按钮；后端自动识别评论或引用，不让用户手选类型。
- 输入时前端只做 URL 格式检查。URL Handle 与当前会话用户名不一致时可以提示，但不能据此通过或拒绝，因为当前会话已有 `twitterId/username`（`lib/echohunt-api.ts:11-32`）。
- 提交中显示“正在验证作者和互动关系”；成功后展示评论/引用标签、链接、提交时间、当前指标，以及“已验证，等待下次算分”或最近一次得分。
- 验证失败时按错误码展示具体原因，例如“链接不是当前登录 X 账号发布”或“该链接不是对本任务原推文的评论/引用”。
- `review/complete` 状态不再允许新增提交，但仍可只读查看历史提交与得分原因。

同时修正文案：当前规则仍写“引用、转推和回复均有贡献值”（中文 `lib/i18n/locales/zh-CN.ts:1408-1414`；英文 `lib/i18n/locales/en.ts:1413-1419`），应改为“只有已主动提交并验证通过的评论、引用参与评分；普通转推不计分”。

## 5. Admin 改造

`GET /api/admin/e2e-campaigns/campaigns/:address/diagnostics` 改为返回：

- `submissionStats`：已验证数、评论数、引用数、刷新失败数、最近/最旧刷新时间。
- `submissions`：提交用户、链接、类型、验证时间、互动时间、指标快照、最近刷新时间、刷新错误、当前计分/不计分原因。
- 原有 `scores`、`scoreLogs` 保留。
- `crawlRuns` 暂时可以作为 `legacyCrawlRuns` 折叠展示历史，但不再作为当前流程状态。

Admin 页面把“最近抓取过程 / 抓到的互动”改为“用户提交与验证过程 / 已验证互动”，保留现有算分明细表。这样管理员能从“谁提交了什么链接 -> 后端如何验证 -> 使用了哪次指标 -> 如何得到分数”完整追踪。

## 6. 文件级实施清单

后端新增：

- `migrations-pg/<timestamp>-create-echohunt-e2e-interaction-submissions.js`
- `src/echohunt/e2e/models/E2eInteractionSubmission.js`
- `src/echohunt/e2e/services/e2eInteractionSubmissionService.js`

后端修改：

- `src/models/postgres/registry.js`：注册新模型；现有 E2E 模型集中注册于 `src/models/postgres/registry.js:66-72,149-154`。
- `src/xhunt/services/twitter-echohunt.js`：扩展单条详情查询返回字段。
- `src/echohunt/e2e/api/router.js`：新增提交、查询本人提交路由。
- `src/echohunt/e2e/services/e2eScoreService.js`：改为读取提交表并移除到期抓取。
- `src/echohunt/e2e/jobs/e2eScheduler.js`：删除 5 分钟发现任务。
- `src/admin/api/e2e-campaigns.js`、`admin-web/src/services/e2e-campaigns.ts`、`admin-web/src/components/e2e/E2eDiagnosticsTab.tsx`：诊断改为提交验证视图。
- `src/echohunt/e2e/services/e2eEngageService.js`：确认无调用后删除。

EchoHunt 前端修改：

- `lib/e2e-api.ts`
- `components/e2e/E2ETaskDetailPage.tsx`
- `lib/i18n/locales/zh-CN.ts`
- `lib/i18n/locales/en.ts`

## 7. 已确认的产品决策

### 7.1 指标采用提交快照还是定时刷新

已确认采用“提交时验证并保存快照 + 每次算分只按已知 Tweet ID 刷新”。点赞、回复、转推、引用和浏览等指标随定时算分更新；不会扫描目标推文的回复列表或引用列表。刷新失败时保留上一次快照并记录错误。

### 7.2 已在进行中的活动如何切换

已确认当前仍处于开发阶段，没有真实用户使用，不考虑进行中活动及历史 `engage_data` 的迁移、兼容或补提交。新版本直接停止自动发现，评分只读取新提交表中的已验证互动。

## 8. 验收与测试

后端自动化测试至少覆盖：

- 合法 X/Twitter URL、非法域名和畸形 URL。
- 本人直接回复、本人引用成功；他人链接、无关推文、普通转推、回复其他推文失败。
- 未报名、非 active、活动结束后提交失败。
- `retro=false` 时早于报名时间的互动失败；晚于活动结束时间失败。
- 同链接重复提交幂等；两用户并发认领由唯一索引保证只有本人记录成功。
- 达到每类 20 条硬上限失败；评分仍按活动 `maxReplies/maxQuotes` 取最早的合规互动。
- 算分周期不再调用 `tweet_replies` / `tweet_quotes`，仅查询已知 tweet ID。
- 指标刷新失败使用上次快照并留下错误；到期刷新后仍能生成可审核的结算草稿。
- Admin 只能查看，公共接口只能返回当前用户自己的提交。

前端验证至少覆盖：

- 未登录、未报名、已报名 active、review/complete 四种状态。
- 输入校验、提交 loading、防重复点击、错误码文案、成功后刷新列表。
- 中英文文案均明确“主动提交”和“普通转推不计分”。
- 移动端输入框、长链接、长正文和提交列表不溢出。

轻量检查建议：后端运行相关 Node 测试文件；EchoHunt 前端运行 `npm run lint`（实际为 `tsc --noEmit`）。按项目约定不自动启动服务或执行构建。
