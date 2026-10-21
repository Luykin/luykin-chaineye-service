# EchoHunt E2E（互动任务）迁移技术分析文档

> 日期：2026-10-21  
> 涉及仓库：
> - 后端主服务：`/Users/luykin/Documents/mac-work/luykin-chaineye-service`
> - Rust 数据与爬虫服务：`/Users/luykin/Documents/mac-work-new/cryptohunt-backend-v2`
> - EchoHunt 前端：`/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt`
> - 浏览器插件（旧端）：`/Users/luykin/Documents/mac-work-new/tweet-hunt-extension`

---

## 一、 现状与架构梳理

### 1. 原有链路拆解
在现有架构中，插件端 E2E（Engage to Earn）功能由三部分配合完成：

1. **插件前端（`tweet-hunt-extension`）**：
   - **参与端**：`src/compontents/EngageToEarn.tsx`
     - 展示进行中（`active`）、待发奖（`review`）、已结束（`complete`）任务列表。
     - 包含报名前风险提示弹框、付费推广政策勾选、授权勾选、绑定 EVM 钱包检查、报名提交、排行榜展开查看等交互。
   - **投放端**：`src/compontents/ArticleBoostPanel.tsx`
     - 在 X 推文右下角注入 Boost 按钮，自动提取当前页面推文 URL 的 `statusId`。
     - 完成「配置任务（预算/天数/获奖人数/分配方式/排名门槛/语言/回溯） -> 确认费用 -> Base 链 USDC 扫码或转账支付 -> 轮询激活」四步流程。

2. **数据与互动抓取层（`cryptohunt-backend-v2`）**：
   - `server/src/bin/twitter_task_tweet_engage.rs`：
     - `update_e2e_tweet_engage_tasks` 每 5 分钟请求 `GET https://data.cryptohunt.ai/pro/api/e2e_active` 获取活跃 E2E 的 `tweet_id` 列表。
     - 按 5 个一组并发执行 `update_tweet_engage_by_tweet_id`，调用 `TwitterClient` 分页抓取推文的 `tweet_replies`、`tweet_quotes`、`tweet_retweeters`。
     - 将推文和用户资料入库 `dev.tweet` / `dev.twitter_user`，并将互动 ID 集合（`replied_ids`、`quoted_ids`、`retweeted_user_ids`）更新至 `dev.tweet.engage_ids`（JSONB）。

3. **E2E 业务接口与算分结算层（原 `data.cryptohunt.ai/pro/api/e2e*` 服务）**：
   - 插件通过 `src/xhunt/api/proxy.js`（`target=k8s_kota`，即 `DATA_SERVICE_BASE_URL`）代理调用：
     - `GET /pro/api/e2e_active`：返回活跃任务的 `tweet_id[]` 供爬虫轮询。
     - `GET /pro/api/e2es?user_id=xxx`：返回 `{ active: [], review: [], complete: [] }` 活动详情 `detail`、当前用户状态 `current_user` 及排行榜 `leaderboard`。
     - `POST /pro/api/e2e/register`：用户报名（传入活动 `address`、`user_id`、`user_address`）。
     - `POST /pro/api/e2e_tweet_examine`：校验推文是否可投放并返回 `owner_user_id`。
     - `POST /pro/api/e2e/create`：创建待支付活动，生成专用充值地址 `address`、应付金额 `deposit_rewards`（含服务费 `fee_percentage`）。
     - `POST /pro/api/e2e/activate`：校验 Base 链 USDC 到账情况并激活任务。

### 2. 本次迁移核心目标与变化（结合需求文档）
- **端侧迁移**：插件后续下线 E2E 参与和投放功能，全部迁移至 EchoHunt 网站（`XHunt.website/apps/echohunt`），左侧导航新增 **「互动任务」** 一级入口。
- **后端收拢**：将 E2E 后端能力搬迁至当前 Node.js 仓库（`luykin-chaineye-service`），不要求兼容旧插件接口格式，**底层继续复用原有数据库**。
- **新增业务能力**：
  1. **项目方投放权限控制 + 手填推文链接**：不再从浏览器当前 URL 自动取推文，改为表单输入推文链接并解析预览；仅获运营授权的项目方账号可发布任务。
  2. **手动提交评论/引用链接**：参与者报名后，可在任务详情页手动提交自己对该推文的「评论链接」或「引用（Quote）链接」进行兜底补充核验（防爬虫漏抓）。
  3. **关注发布者 5 倍加权**：当前版本中，已关注发布者的用户按 **5 倍权重** 计分；用户端突出说明关注对排名的重要性，不展示具体倍数。
  4. **计分维度调整**：引用、评论、点赞参与评分，**普通转推（Retweet）不再计分**；互动时间、内容质量（AI/真人类识别）、互动深度与影响力加成沿用现有机制。

---

## 二、 后端改造分析（`luykin-chaineye-service` & 数据库交互）

### 1. 数据库层对接与表结构扩展
当前仓库默认主库为 `luykindatabase`（`PG_DATABASE=luykindatabase`），而原 E2E 业务表位于同一 PostgreSQL 实例下的 **`luykindatabase2`** 数据库。后端需新增指向 `luykindatabase2` 的 Sequelize 连接实例（如 `pgDb2Instance`），直接对接原表并按需扩展字段：

- **`luykindatabase2` 中已定位的 4 张原 E2E 核心表（`public` schema）**：
  1. **`public.e2e_list`（E2E 活动主表）**：
     - `tweet_id` (`varchar`, NOT NULL)：目标推文 ID
     - `user_id` (`varchar`, NOT NULL)：发起人用户 ID
     - `rewards` (`numeric`, NULL)：奖池金额（USDC）
     - `address` (`varchar`, NOT NULL)：该活动专属收款钱包地址
     - `start_time` / `end_time` (`timestamp`, NULL)：活动开始与结束时间
     - `target` (`bigint`, NULL)：XHunt 排名门槛（如 `200000`、`100000`、`50000`）
     - `winners` (`integer`, NULL)：获奖人数
     - `text` (`text`, NULL)：目标推文正文
     - `summary_cn` / `summary_en` (`text`, NULL)：中英文 AI 摘要
     - `owner_handle` / `owner_image_url` / `owner_user_id` (`varchar`, NULL)：推文作者信息
     - `status` (`varchar`, NULL)：活动状态（如 `pending` / `active` / `review` / `complete`）
     - `complete_tx` (`varchar`, NULL)：发奖结算交易 Hash
     - `type` (`varchar`, NULL)：奖励分配方式（`mindshare` / `equal` 等）
     - `fees` (`numeric`, NULL)：平台服务费金额
     - `lang` (`varchar`, NULL)：互动语言要求（`all` / `zh` / `en`）
     - `retro` (`boolean`, NULL)：是否支持报名前历史互动计分
  2. **`public.e2e`（E2E 用户报名与排行榜结算表）**：
     - `tweet_id` (`varchar`, NOT NULL)：目标推文 ID
     - `user_id` (`varchar`, NOT NULL)：参与用户 Twitter ID
     - `fan_rank` (`bigint`, NULL)：用户 XHunt 粉丝/影响力排名（对应前端 `kol_rank`）
     - `username` / `name` / `profile_image_url` (`varchar`, NULL)：参与用户 Twitter 账号展示信息
     - `point` (`numeric`, NULL)：当前互动综合得分
     - `rewards` (`numeric`, NULL)：结算分配的奖励金额
     - `address` (`varchar`, NOT NULL)：关联的活动钱包地址（`e2e_list.address`）
     - `user_address` (`varchar`, NULL)：用户报名绑定的领奖 EVM 钱包地址
     - `create_time` / `update_time` (`timestamptz`, NOT NULL, default `now()`)：报名与更新时间
     - `explaination` (`text`, NULL)：AI 评分说明（注：原表字段拼写为 `explaination`）
  3. **`public.e2e_log`（E2E 算分历史日志表）**：
     - `tweet_id` (`varchar`, NOT NULL)、`user_id` (`varchar`, NOT NULL)、`calc_time` (`timestamptz`, NOT NULL, default `now()`)、`username` (`varchar`)、`point` (`numeric`)、`explanation` (`text`)
  4. **`public.e2e_tweet`（E2E 推文/长文 AI 审核与摘要缓存表，对应 `/pro/api/e2e_tweet_examine`）**：
     - `tweet_id` (`varchar`, NOT NULL)：推文 ID
     - `text` / `html` (`text`, NULL)：推文纯文本与 Article HTML 内容
     - `summary_cn` / `summary_en` (`text`, NULL)：中英文摘要
     - `owner_handle` / `owner_image_url` / `owner_user_id` (`varchar`, NULL)：作者信息
     - `political` / `sexual` / `violence` / `abusive` (`boolean`, NULL)：四项合规审核标记
     - `explanation` (`text`, NULL)：审核解释
     - `passed` (`boolean`, NULL)：是否通过审核

- **跨库/同库协同的推文互动表**：
  - `dev.tweet` & `dev.twitter_user`：存储目标推文原文、作者信息、`engage_ids`（`replied_ids`, `quoted_ids`）以及评论/引用推文的详细内容与 AI 评分字段。
  - `dev.twitter_user_follow` / `dev.project_follow`（配合实时 X API 校验）：用于判断参与者是否关注了推文发布者。

- **需新增/扩展的字段与表**：
  1. **`public.e2e` 报名/互动记录表扩展**：
     - `is_following_author` (`BOOLEAN`, 默认 `false`) + `follow_verified_at` (`TIMESTAMPTZ`)：记录用户是否已关注目标推文作者（触发 5x 权重）。
     - `submitted_reply_tweet_id` / `submitted_reply_url` / `reply_verify_status`：用户手动提交的评论推文 ID、链接及核验状态（如 `verified` / `pending` / `invalid`）。
     - `submitted_quote_tweet_id` / `submitted_quote_url` / `quote_verify_status`：用户手动提交的引用推文 ID、链接及核验状态。
  2. **投放权限复用 `EchohuntFeatureAccess`**：
     - 直接复用 `luykindatabase` 现有 `src/xhunt/models/EchohuntFeatureAccess.js`（与 `kol-match`、`social-listening` 权限体系一致），新增 `featureKey = 'e2e-publish'`（`resourceId = 'global'`），由 Admin 后台配置授权项目方 X Handle。

### 2. 认证与用户体系适配（插件旧 Token -> EchoHunt 认证中心）
- 原插件使用 `authenticateToken`（`XHuntUser`）和 `localStorage('@xhunt/user')` 里的 `evmAddresses`。
- 迁移至 EchoHunt 后，所有接口统一挂载在 `src/xhunt/api/echohunt.js` 下（如 `/api/xhunt/echohunt/e2e/*`），使用 **`authenticateAuthCenterToken`** 鉴权：
  - 从 `AuthCenterXhuntIdentity` 提取用户的 `twitter` 身份（`twitterId`、`username`）和 `evm` 身份（或 `XHuntUser.evmAddresses` / 报名时绑定的收款钱包）。
  - 复用 `src/xhunt/services/twitter-echohunt.js` 中的用户 OAuth2 Token 能力（如 `verifyEchohuntTwitterFollowTask`、`getEchohuntTweetDetail`）。

### 3. 核心业务 API 设计与改造（`src/xhunt/api/echohunt-e2e.js`）

| 模块 | 建议路由 | 核心逻辑与改造点 |
| :--- | :--- | :--- |
| **1. 权限查询** | `GET /api/xhunt/echohunt/e2e/access` | 查询当前登录用户是否具备 `featureKey = 'e2e-publish'` 投放权限（参考 `echohunt-kol-match/access-service.js`），供前端决定是否展示/开放「+ 发布任务」。 |
| **2. 任务列表** | `GET /api/xhunt/echohunt/e2e/tasks` | 支持按状态筛选（`all` / `active` / `review`待发奖 / `complete`已结束）。返回任务卡片所需字段（推文内容、中英摘要、作者信息、奖池 USDC、奖励人数、剩余时间、排名门槛 `target`、语言限制 `lang`、分配模式 `type`、当前用户是否已报名）。 |
| **3. 任务详情与榜单** | `GET /api/xhunt/echohunt/e2e/tasks/:tweetId` | 返回单条任务的完整信息 + `currentUser`（报名状态、钱包地址、**关注状态**、**已提交的评论/引用链接及核验状态**、当前积分/排名/贡献占比）+ `leaderboard`（排行榜列表）。 |
| **4. 报名参与** | `POST /api/xhunt/echohunt/e2e/tasks/:tweetId/register` | 1. 校验 X 账号登录、EVM 收款钱包地址、政策勾选；<br>2. 复用 `campaignRegistrationService.js` 的 `fetchCampaignRankByDomain` 校验 XHunt 排名门槛（如 Top 200K / Creators）；<br>3. 写入报名表。 |
| **5. 关注发布者校验（新增）** | `POST /api/xhunt/echohunt/e2e/tasks/:tweetId/verify-follow` | 复用 `twitter-echohunt.js` 的 `verifyEchohuntTwitterFollowTask`（通过 X OAuth2 `users/:id?user.fields=connection_status` 实时查询 `following`，或查 `dev.twitter_user_follow`），核验通过后标记 `is_following_author = true`，触发算分 5x 加成。 |
| **6. 手动提交互动链接（新增）** | `POST /api/xhunt/echohunt/e2e/tasks/:tweetId/submissions` | 接收 `{ type: 'reply' \| 'quote', tweetUrl }`：<br>1. 复用 `campaignTweetSubmissionService.js` 的 `parseTweetUrl` 提取互动 `subTweetId`；<br>2. 通过爬虫/X API 拉取该推文详情，校验：① 作者必须为当前登录用户的 `twitterId`；② 若为 `reply`，其 `conversation_id`（或 `in_reply_to_status_id`）必须指向目标任务 `tweetId`；③ 若为 `quote`，其 `quote_id` 必须指向目标任务 `tweetId`；<br>3. 将该互动推文写入 `dev.tweet`，并将 `subTweetId` 合并追加进目标推文 `dev.tweet.engage_ids` 的 `replied_ids` 或 `quoted_ids` 中，同时更新用户提交状态。 |
| **7. 投放：推文解析与校验** | `POST /api/xhunt/echohunt/e2e/publish/examine` | 接收 `{ tweetUrl }`（替代原插件只传 `tweet_id`）：<br>1. 解析出 `tweetId`；<br>2. 校验当前用户是否有 `e2e-publish` 权限；<br>3. 查询/抓取推文详情（作者名称、`@handle`、头像、正文、发布时间），校验推文是否有效、是否已有进行中的同名任务，返回推文预览信息供前端核对。 |
| **8. 投放：创建订单** | `POST /api/xhunt/echohunt/e2e/publish/create` | 接收 `{ tweetId, rewards, days, target, winners, type, lang, retro }`：<br>生成订单与专属收款地址 `address`、计算 `depositRewards`（奖池 + 服务费），状态置为 `pending`。 |
| **9. 投放：支付校验与激活** | `POST /api/xhunt/echohunt/e2e/publish/activate` | 接收 `{ address }`：使用 `ethers.js`（当前仓库已内置 v5）查询 Base 链（ChainId `8453`）USDC 合约在该 `address` 的余额是否 `>= depositRewards`，达标则将状态置为 `active` 并计算 `start_time` / `end_time`。 |
| **10. 内部活跃任务接口** | `GET /pro/api/e2e_active`（或内部路由） | 返回所有 `status = 'active'` 任务的 `tweet_id[]`，供互动抓取任务消费。 |

### 4. 爬虫任务与算分引擎迁移分析

#### （1）`twitter_task_tweet_engage.rs` 互动抓取逻辑迁移
在 `cryptohunt-backend-v2/server/src/bin/twitter_task_tweet_engage.rs` 中，原本跑了两个协程：
- `update_tweet_engage_tasks`：每 12 小时抓取固定 22 个 KOL 的推文互动。
- `update_e2e_tweet_engage_tasks`：每 5 分钟调 `/pro/api/e2e_active`，对每个 `tweet_id` 分页拉取 `tweet_replies`、`tweet_quotes`、`tweet_retweeters`，写入 `dev.tweet` 并更新 `dev.tweet.engage_ids`。

**迁移方案对比**：
- **方案 A（完全迁入当前 Node.js 仓库 `singletonJobsServer.js`）**：
  - 在 `src/services/singleton/` 下新增 `e2e-tweet-engage-sync.js` 定时任务（每 5 分钟执行）。
  - 直接从数据库查询 `status = 'active'` 的 E2E `tweet_id` 列表（无需再走 HTTP 调 `/pro/api/e2e_active`）。
  - 调用内部爬虫接口（`TWITTER_CLIENT_URL`，传入 payload `tweet_replies` / `tweet_quotes`）抓取互动推文；**根据新需求“普通转推不计分”，不再抓取 `tweet_retweeters`，节省爬虫配额**。
  - 将抓取到的回复/引用推文及用户手动提交的推文统一合并写入 `dev.tweet` 和 `engage_ids`。
- **方案 B（保留 Rust 进程抓底层 `dev.tweet`，Node.js 负责业务与手动补单合并）**：
  - 若 `dev.tweet` 仍统一由 `cryptohunt-backend-v2` 维护写入，则可保留 Rust 侧的 `update_tweet_engage_by_tweet_id` 能力，仅把 `/pro/api/e2e_active` 指向新后端，并在用户手动提交链接时写入/合并至 `dev.tweet`。

#### （2）算分与排行榜结算引擎改造
算分规则在现有 E2E 算分逻辑上做如下调整：
1. **互动类型权重**：
   - **保留**：引用（Quote）、评论（Reply）、点赞（Like）。
   - **移除**：普通转推（Retweet）权重设为 `0`（不计分）。
2. **新增「关注发布者 5 倍权重」**：
   - 计算公式调整：`final_user_point = base_user_point * (is_following_author ? 5.0 : 1.0)`。
   - 关注状态来源：优先读取用户在任务详情页核验通过的 `is_following_author` 标记，同时兼容从 `dev.twitter_user_follow` 中匹配 `follower_id = user.twitter_id AND following_id = author_twitter_id AND latest > 0`。
3. **手动提交链接并入算分池**：
   - 算分任务扫描某条目标推文的互动时，除了读取自动抓取的 `engage_ids`，还将报名表中用户手动提交且核验通过的 `submitted_reply_tweet_id` / `submitted_quote_tweet_id` 并入候选集（按 `tweet_id` 去重），走相同的发布时间（`time_diff`）、内容质量（AI 识别 `likely_ai_generated` / `high_human_value`）、语言过滤（`cn` / `en` / `all`）、回溯开关（`retro`：是否统计报名前的互动）与 XHunt 影响力加成计算。
4. **生命周期流转定时任务**：
   - `active -> review`（待发奖）：当前时间 `> end_time` 时自动流转，锁定最终排行榜分数与 `mindshare` 占比，按 `equal`（均分）或 `mindshare`（按贡献）计算前 `winners` 名的奖励金额。
   - `review -> complete`（已结束）：发奖完成后（1 周内自动发放）更新状态为 `complete`。

### 5. Admin 管理后台改造（`src/admin/` & `admin-web/`）
- **投放权限管理**：在 Admin 后台（复用现有 EchoHunt 功能权限管理机制）支持运营输入项目方 X Handle 授予/撤销 `e2e-publish` 权限。
- **任务与结算管理（可选增强）**：查看 E2E 任务列表、充值状态、待发奖（`review`）任务的获奖名单与发奖状态确认。

---

## 三、 前端改造分析（`XHunt.website/apps/echohunt`）

结合需求文档与三张原型图（列表页、任务详情页、发布互动任务页），以及 `apps/echohunt` 现有的 `LeaderboardPage.tsx` 架构，前端需进行以下改造：

### 1. 路由与左侧导航栏改造
- **涉及文件**：
  - `components/LeaderboardPage.tsx`
  - `app/interactive-tasks/page.tsx`（及详情/发布子路由）
  - `lib/i18n/locales/zh-CN.ts` & `en.ts`
- **改动点**：
  1. 在 `DashboardView` 类型中新增 `'interactiveTasks'`（或 `'e2e'`），在 `getRouteStateFromPath` 和 `updateDashboardUrl` 中支持：
     - `/interactive-tasks`：互动任务列表页
     - `/interactive-tasks/[tweetId]`：任务详情页
     - `/interactive-tasks/publish`：发布互动任务页
  2. 在左侧导航栏（`Campaigns` 下方，`Social Listening` 上方，与原型图一致）新增 **「互动任务」**（英文 `Engage Tasks` / `Engage to Earn`）导航项，对所有用户可见。

### 2. API 客户端封装与代理配置
- **涉及文件**：
  - 新增 `lib/e2e-api.ts`
  - 修改 `app/api/echohunt/[...path]/route.ts`
- **改动点**：
  1. 在 `route.ts` 的 `isRealtimePath` 中加入 `first === 'e2e'`，确保任务报名状态、手动提交链接状态、支付轮询状态不命中 5 分钟前端强缓存（返回 `cache-control: no-store`）。
  2. 在 `lib/e2e-api.ts` 中基于 `echohuntApiFetch` 封装 E2E 全部接口。

### 3. 页面一：互动任务列表页（对应原型图 1）
- **新增组件**：`components/e2e/E2ETaskListPage.tsx`
- **核心交互与 UI 模块**：
  1. **顶部 Header**：
     - 标题「互动任务」+ 副标题「查看推文，参与互动，按贡献排名获得奖励。」
     - 右侧 **「+ 发布任务」** 按钮（根据 `fetchE2EAccess` 判断：获授权的项目方展示/可用）。
  2. **状态筛选 Tab**：
     - `全部 (all)`、`进行中 (active)`、`待发奖 (review)`、`已结束 (complete)`。
  3. **任务卡片列表（`E2ETaskCard`）**：
     - 左侧：推文作者头像、名称、`@handle`、推文内容（支持「展开全文 ↓」切换）、底部条件标签（如 `XHunt 排名前 20 万 · 互动语言不限`）。
     - 右侧：状态角标（`进行中` / `待发奖` / `已结束`）、奖池金额（如 `500 USDC`）、奖励人数（`20 人`）、剩余时间（如 `剩余 18 小时`）、**「查看任务 →」** 按钮（点击进入任务详情页）。

### 4. 页面二：任务详情页（对应原型图 2）
- **新增组件**：`components/e2e/E2ETaskDetailPage.tsx`
- **核心交互与 UI 模块（左右双栏布局）**：
  1. **左栏上部 - 目标原推文卡片**：
     - 展示作者头像、名称、`@handle`、完整原推文正文、底部「在 X 查看原推文 ↗」外链。
  2. **左栏中部 - 「我的互动」面板（新增核心模块）**：
     - **关注发布者行**：展示 `@handle` 及右侧「关注 ↗」/「已关注」按钮。
     - **评论链接提交行**：输入框 `粘贴你的评论链接` + 「提交」按钮；提交后展示链接及状态标签（如 `已提交 · 待核验` / `已核验`）。
     - **引用链接提交行**：输入框 `粘贴你的引用链接` + 「提交」按钮；提交后展示链接及状态标签。
  3. **左栏下部 - 「排行榜」表格**：
     - 展示列：`排名`、`参与用户（头像 + 名称 + @handle）`、`分数 (point)`、`贡献占比 (mindshare%)`。
     - 固定展示当前登录用户的排名行（`我 @username`）。
  4. **右栏上部 - 任务概览与「报名参与」卡片**：
     - 展示奖励池（USDC）、奖励人数、剩余时间、参与门槛、互动语言。
     - **报名检查项**：
       - `X 账号`：已登录 / 未登录引导连接。
       - `收款钱包`：展示当前已绑定的 EVM 地址（未绑定则引导绑定或输入）。
       - 勾选框：「我已阅读参与政策与授权说明」（含免责声明与风险提示）。
       - 主按钮：「立即报名」 / 「已报名」。
  5. **右栏下部 - 「评分与奖励」规则说明卡片**：
     - **突出高亮块**：「**关注发布者，获得高权重加成** —— 是否关注是影响最终排名的关键因素。」（不展示具体 5 倍数值）。
     - 规则说明：点赞、评论和引用参与评分，普通转推不计分；关注与点赞无需提交链接；越早参与、内容质量越高越有利于排名；任务结束后 1 周内自动发放奖励。

### 5. 页面三：发布互动任务页（对应原型图 3 + 原插件 `ArticleBoostPanel.tsx` 逻辑）
- **新增组件**：`components/e2e/E2EPublishTaskPage.tsx`
- **核心交互与 UI 模块（三步向导：`01 配置任务 -> 02 确认费用 -> 03 支付`）**：
  1. **Step 1：配置任务**：
     - **01 推广对象**：输入框填写 `目标推文链接`（`https://x.com/用户名/status/推文编号`），解析后展示作者名称、`@Handle` 与原推文供发布前核对。
     - **02 奖池与时间**：
       - `奖池金额 · USDC`（500~2000 USDC，测试账号支持 `0.01`）。
       - `奖励人数`（10 ~ 50 人，默认 20 人）。
       - `持续时间`（1 天 / 2 天 / 3 天），展示预计结束时间并标明时区。
       - `奖励方式`（按综合评分排名分配 `mindshare` / 均分 `equal`）。
     - **03 参与条件**：
       - `XHunt 排名门槛`（前 5 万 / 前 10 万 / 前 20 万 / 前 20 万 + 认证创作者）。
       - `互动语言`（不限 / 仅中文 / 仅英文）。
       - 勾选框：`支持报名前互动奖励 (retro)`。
     - **右侧「费用概览」与「统一评分规则」卡片**：展示奖池金额、服务费说明，点击「下一步：确认配置」进入 Step 2。
  2. **Step 2：确认费用**：
     - 汇总核对所有配置参数，点击「去支付」调用 `createE2ETaskOrder` 获取专属 Base 链收款地址 `address` 与应付总额 `deposit_rewards`（含服务费）。
  3. **Step 3：支付与自动激活**：
     - 展示 Base 网络 USDC 专属充值地址、收款二维码、应付明细（奖池 + 服务费）。
     - 每 5 秒自动轮询 `activateE2ETaskOrder({ address })`，同时支持手动点击「我已完成付款」确认；到账后展示成功状态并跳转回列表页。

### 6. 插件端清理（`tweet-hunt-extension`）
- 待 EchoHunt 端上线后，移除插件 `HunterEarnSection.tsx` / `Web3HomeSidebar.tsx` 中的 `EngageToEarn` 入口，以及 `Main.tsx` / `ArticleBottomRightArea.tsx` 中的 `ArticleBoostPanel` 入口。

---

## 四、 待确认事项（实施前需对齐的细节）

1. **充值钱包地址与私钥生成机制确认**：
   - 已确认原 E2E 的 4 张核心表（`public.e2e`、`public.e2e_list`、`public.e2e_log`、`public.e2e_tweet`）位于服务器 `luykindatabase2` 数据库中；需进一步确认 `/pro/api/e2e/create` 生成 `e2e_list.address` 收款地址时，私钥是保存在其他表（如 wallet 相关表）中，还是通过固定助记词/HD 派生生成？
2. **「关注发布者」的核验方式**：
   - 采用用户点击「关注 ↗」后调用 X OAuth2 API 实时验证（复用 `verifyEchohuntTwitterFollowTask`），还是结合数据库 `dev.twitter_user_follow` 自动判断 + 手动触发 X API 校验？
3. **「点赞（Like）」的计分方式**：
   - 由于 X 早已隐藏推文点赞列表，`twitter_task_tweet_engage.rs` 仅抓取了 `replies` 和 `quotes`。这里的“点赞参与评分”是指用户的评论/引用推文自身获得的点赞数（likes）参与内容互动深度评分，还是有其他方式统计对主推文的点赞？
