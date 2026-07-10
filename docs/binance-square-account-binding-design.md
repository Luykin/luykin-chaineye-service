# EchoHunt 个人主页绑定 Binance Square 技术方案

## 1. 背景与目标

EchoHunt 需要支持用户在个人主页绑定自己的 Binance Square 账号，用于榜单账户身份识别、后续内容任务校验、账户展示和权益归属等场景。

绑定流程：

1. 用户在 EchoHunt 个人主页点击「绑定 Binance Square」。
2. 后端基于当前登录用户生成专属验证码文案，例如：

   ```text
   Verifying my Binance Square account via EchoHunt: EH-9K7Q2M
   ```

3. 用户复制文案到 Binance Square 发帖。
4. 用户把 Binance Square 帖子链接贴回 EchoHunt。
5. 后端抓取该帖子详情：
   - 校验帖子正文是否包含本次验证码。
   - 识别帖子作者信息，包括 `username`、`squareUid`、`displayName`、头像等。
   - 确认该 Binance Square 账号由当前用户控制。
6. 后端保存当前 EchoHunt 用户 Twitter ID 与 Binance Square 账号的一对一绑定关系。
7. 前端展示绑定成功状态。

重要业务约束：

- 绑定关系以用户的 **Twitter ID** 为准。
- 绑定关系与活动无关，不使用 `campaignKey`。
- 一个 EchoHunt 用户只允许绑定一个 Binance Square 账号。
- 一个 Binance Square 账号也只允许绑定给一个 EchoHunt 用户。
- 支持解绑。
- 每个用户每月最多换绑 3 次。
- 管理后台查看绑定记录、人工解绑等能力二期再做。

> 活动期间为了降低 Binance Square 抓取压力、提高验证码帖子识别稳定性，可以先暂停原有 Top1000 帖子爬取任务，只保留绑定校验接口的按需抓取。

---

## 2. 当前项目现状

### 2.1 后端项目

后端项目：

```text
/Users/luykin/Documents/mac-work/luykin-chaineye-service
```

当前已有 Binance Square 模块：

```text
src/binance-square/
├── api/binance-square.js                  # 管理后台 API
├── scraper/api-client.js                  # Binance Square API client
├── scraper/parsers/postParser.js          # 帖子解析器
├── scraper/taskManager.js                 # 批量爬取任务管理器
├── services/scheduler.js                  # 定时调度器
└── models/                                # Sequelize models
```

已有可复用能力：

- 拉取 Binance Square 用户 profile。
- 拉取 Binance Square 单帖详情。
- 解析帖子正文、作者、互动数据。
- 管理后台已有帖子链接解析接口：

```http
POST /api/admin/binance-square/posts/resolve-link
```

注意：这个接口是 `adminAuth` 下的后台接口，不建议直接给 EchoHunt 用户侧前端调用。用户绑定应新增独立用户侧 API。

### 2.2 EchoHunt 前端项目

前端项目：

```text
/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt
```

需要在 EchoHunt 个人主页或 Profile Settings 中增加 Binance Square 绑定 UI。

---

## 3. 总体设计

### 3.1 推荐架构

```text
EchoHunt Web
  ↓ 当前登录态
XHunt Backend 用户侧绑定 API
  ↓ challenge / verify / binding 状态
PostgreSQL
  ↓ 按需请求
Binance Square detail API
```

绑定 API 应放在用户侧路由下，而不是后台管理路由下。

建议新增：

```text
src/xhunt/api/binance-square-binding.js
src/xhunt/services/binance-square-binding-service.js
```

### 3.2 用户身份主键

业务上以 Twitter ID 为准。

推荐后端保存以下字段：

| 字段 | 说明 |
|---|---|
| `twitterId` | 绑定关系主键，必须有 |
| `twitterUsername` | Twitter handle，展示和排查用，不作为唯一身份 |
| `xhuntUserId` | 旧 XHuntUser ID，可选冗余 |
| `authCenterUserId` | Auth Center 用户 ID，可选冗余 |

推荐取值顺序：

1. 如果当前登录态能直接拿到 Twitter ID，直接使用。
2. 如果当前登录态是 Auth Center 用户，则查 `AuthCenterXhuntIdentity` 中 provider 为 `twitter` 的身份，取其 Twitter external id。
3. 如果当前登录态是旧 XHunt 用户，则从 `XHuntUser` / `XHuntUserToken` 现有 Twitter 身份字段取 Twitter ID。
4. 如果用户当前没有 Twitter ID，不允许绑定 Binance Square，前端提示先绑定或登录 Twitter。

不要用 Twitter handle 作为唯一主键，因为用户可能改名。

---

## 4. API 设计

API 前缀建议：

```http
/api/xhunt/echohunt/binance-square-binding
```

### 4.1 查询当前绑定状态

```http
GET /api/xhunt/echohunt/binance-square-binding/me
```

认证：必须登录，且后端能解析出当前用户 `twitterId`。

成功返回：

```json
{
  "success": true,
  "data": {
    "bound": true,
    "binding": {
      "twitterId": "123456789",
      "binanceSquareUid": "dxCeCLOM7uOFJKX8EnS3Kw",
      "binanceUsername": "CZ",
      "binanceDisplayName": "CZ",
      "binanceAvatar": "https://...jpg",
      "verificationPostUrl": "https://www.binance.com/en/square/post/313171518090145",
      "verifiedAt": "2026-07-10T10:00:00.000Z",
      "monthlyRebindUsed": 1,
      "monthlyRebindLimit": 3
    }
  }
}
```

未绑定返回：

```json
{
  "success": true,
  "data": {
    "bound": false,
    "binding": null,
    "monthlyRebindUsed": 0,
    "monthlyRebindLimit": 3
  }
}
```

### 4.2 生成验证码

```http
POST /api/xhunt/echohunt/binance-square-binding/challenge
```

请求 body 可以为空：

```json
{}
```

返回：

```json
{
  "success": true,
  "data": {
    "challengeId": 123,
    "verificationCode": "EH-9K7Q2M",
    "verificationText": "Verifying my Binance Square account via EchoHunt: EH-9K7Q2M",
    "expiresAt": "2026-07-10T10:30:00.000Z"
  }
}
```

规则：

- 当前用户已有未过期 `pending` challenge 时优先复用。
- 默认过期时间建议 30 分钟。
- 如果用户已绑定，也允许生成 challenge 用于换绑，但 verify 阶段需要检查每月换绑次数。

### 4.3 提交帖子链接并验证

```http
POST /api/xhunt/echohunt/binance-square-binding/verify
```

请求：

```json
{
  "challengeId": 123,
  "postUrl": "https://www.binance.com/en/square/post/313171518090145"
}
```

成功返回：

```json
{
  "success": true,
  "data": {
    "bound": true,
    "binding": {
      "twitterId": "123456789",
      "binanceSquareUid": "dxCeCLOM7uOFJKX8EnS3Kw",
      "binanceUsername": "CZ",
      "binanceDisplayName": "CZ",
      "binanceAvatar": "https://...jpg",
      "verificationPostId": "313171518090145",
      "verificationPostUrl": "https://www.binance.com/en/square/post/313171518090145",
      "verifiedAt": "2026-07-10T10:05:00.000Z",
      "monthlyRebindUsed": 1,
      "monthlyRebindLimit": 3
    }
  }
}
```

失败返回示例：

```json
{
  "success": false,
  "error": "VERIFICATION_CODE_NOT_FOUND",
  "message": "帖子内容中没有找到验证码，请确认复制的是本次生成的完整文案。"
}
```

### 4.4 解绑

```http
DELETE /api/xhunt/echohunt/binance-square-binding/me
```

请求 body 可以为空：

```json
{}
```

处理：

- 不物理删除绑定记录。
- 将当前 active binding 更新为 `revoked`。
- 记录一条解绑历史事件。
- 解绑本身是否计入每月 3 次，需要确认。推荐：**解绑不计入，成功绑定新账号才计入换绑次数**。

---

## 5. 数据库设计

### 5.1 绑定记录表

表名建议：

```text
XHuntBinanceSquareBindings
```

用途：保存 Twitter ID 与 Binance Square 账号的一对一绑定关系，并保留历史记录。

字段建议：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增 ID |
| `twitterId` | STRING(64) | 用户 Twitter ID，核心主键 |
| `twitterUsername` | STRING(128) nullable | Twitter handle，展示/排查用 |
| `xhuntUserId` | INTEGER nullable | 旧 XHuntUser ID，冗余 |
| `authCenterUserId` | INTEGER nullable | Auth Center 用户 ID，冗余 |
| `binanceSquareUid` | STRING(128) | Binance Square `squareUid` |
| `binanceUsername` | STRING(128) | Binance Square username |
| `binanceDisplayName` | STRING(256) nullable | Binance 展示名 |
| `binanceAvatar` | TEXT nullable | Binance 头像 |
| `verificationPostId` | STRING(128) | 用于验证的帖子 ID |
| `verificationPostUrl` | TEXT | 验证帖链接 |
| `verificationCode` | STRING(32) | 成功绑定使用的验证码 |
| `verifiedAt` | DATE | 绑定成功时间 |
| `revokedAt` | DATE nullable | 解绑时间 |
| `status` | STRING(32) | `active` / `revoked` |
| `rawAuthorData` | JSONB nullable | 作者原始数据备份 |
| `rawPostData` | JSONB nullable | 帖子原始数据备份 |
| `createdAt` | DATE | 创建时间 |
| `updatedAt` | DATE | 更新时间 |

索引建议：

```text
idx_xhunt_bs_bindings_twitter_id_status(twitterId, status)
idx_xhunt_bs_bindings_square_uid_status(binanceSquareUid, status)
idx_xhunt_bs_bindings_username_status(binanceUsername, status)
idx_xhunt_bs_bindings_post_id(verificationPostId)
idx_xhunt_bs_bindings_verified_at(verifiedAt)
```

唯一性要求：active 状态下一对一绑定。

```sql
CREATE UNIQUE INDEX uniq_xhunt_bs_binding_twitter_active
ON "XHuntBinanceSquareBindings" ("twitterId")
WHERE "status" = 'active';

CREATE UNIQUE INDEX uniq_xhunt_bs_binding_square_uid_active
ON "XHuntBinanceSquareBindings" ("binanceSquareUid")
WHERE "status" = 'active';
```

如果 Binance 偶尔拿不到 `squareUid`，可临时用 `binanceUsername` 兜底，但正式唯一性应以 `squareUid` 为主。

### 5.2 挑战码表

表名建议：

```text
XHuntBinanceSquareBindingChallenges
```

字段建议：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增 ID |
| `twitterId` | STRING(64) | 用户 Twitter ID |
| `twitterUsername` | STRING(128) nullable | Twitter handle |
| `xhuntUserId` | INTEGER nullable | 旧用户 ID，冗余 |
| `authCenterUserId` | INTEGER nullable | Auth Center 用户 ID，冗余 |
| `verificationCode` | STRING(32) | 验证码，如 `EH-9K7Q2M` |
| `verificationText` | TEXT | 完整发帖文案 |
| `status` | STRING(32) | `pending` / `verified` / `expired` / `failed` / `cancelled` |
| `expiresAt` | DATE | 过期时间 |
| `verifiedAt` | DATE nullable | 验证成功时间 |
| `attemptCount` | INTEGER | 校验次数 |
| `lastAttemptAt` | DATE nullable | 最近一次校验时间 |
| `lastPostUrl` | TEXT nullable | 最近提交的帖子链接 |
| `lastPostId` | STRING(128) nullable | 最近提交的帖子 ID |
| `lastErrorCode` | STRING(64) nullable | 最近失败原因 code |
| `lastErrorMessage` | TEXT nullable | 最近失败原因描述 |
| `createdAt` | DATE | 创建时间 |
| `updatedAt` | DATE | 更新时间 |

索引建议：

```text
idx_xhunt_bs_challenges_twitter_status(twitterId, status)
idx_xhunt_bs_challenges_code(verificationCode)
idx_xhunt_bs_challenges_expires(expiresAt)
idx_xhunt_bs_challenges_post_id(lastPostId)
```

### 5.3 换绑历史表，推荐新增

虽然绑定表保留 revoked 历史也能计算换绑次数，但为了月度限制和审计清晰，建议增加事件表。

表名建议：

```text
XHuntBinanceSquareBindingEvents
```

字段建议：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增 ID |
| `twitterId` | STRING(64) | 用户 Twitter ID |
| `eventType` | STRING(32) | `bind` / `rebind` / `unbind` / `verify_failed` |
| `fromBinanceSquareUid` | STRING(128) nullable | 换绑前账号 |
| `toBinanceSquareUid` | STRING(128) nullable | 换绑后账号 |
| `bindingId` | INTEGER nullable | 关联绑定记录 |
| `challengeId` | INTEGER nullable | 关联 challenge |
| `metadata` | JSONB nullable | 补充信息 |
| `createdAt` | DATE | 创建时间 |
| `updatedAt` | DATE | 更新时间 |

换绑次数统计建议：

```text
每自然月统计 eventType = 'rebind' 的成功事件数量。
```

这里需要业务最终确认：首次绑定是否计入每月 3 次。推荐规则：

- 首次绑定不计入换绑次数。
- 解绑不计入。
- 重新绑定成功计入 1 次。
- 同一个 Binance 账号重复 verify 幂等返回，不重复计数。

---

## 6. 验证码设计

### 6.1 验证码格式

建议格式：

```text
EH-XXXXXX
```

示例：

```text
EH-9K7Q2M
EH-M4P8X2
EH-72KQRA
```

生成规则：

- 前缀固定：`EH-`
- 后缀使用大写字母 + 数字，排除易混字符：`0/O`、`1/I/L`
- 长度 6-8 位
- 使用 `crypto.randomBytes`，不要用 `Math.random`

### 6.2 完整文案模板

因为绑定不与活动关联，推荐文案不要带活动名：

```text
Verifying my Binance Square account via EchoHunt: {verificationCode}
```

例如：

```text
Verifying my Binance Square account via EchoHunt: EH-9K7Q2M
```

如果运营仍希望活动期间展示活动名，可以只作为前端展示扩展，但绑定数据不存 `campaignKey`，唯一关系仍然是 Twitter ID 与 Binance Square ID。

### 6.3 校验策略

推荐校验规则：

1. 帖子正文必须包含 `verificationCode`。
2. 建议也校验正文包含 `EchoHunt`，降低误匹配概率。
3. 不强制要求完整文案逐字一致，避免 Binance Square 富文本、空格、换行、标点转义造成误判。
4. 校验时 normalize：
   - 转字符串。
   - 合并多个空白符。
   - trim。
   - code 校验大小写不敏感。

---

## 7. 后端 verify 流程

1. 校验用户登录态。
2. 解析当前用户 `twitterId`。
   - 如果没有 Twitter ID，返回 `TWITTER_ID_REQUIRED`。
3. 查询 challenge：
   - 属于当前 `twitterId`。
   - `status = pending`。
   - `expiresAt > now`。
4. 检查 challenge 校验次数是否超限。
5. 从 `postUrl` 提取 Binance Square `postId`。
6. 调用 Binance Square 单帖详情接口：

   ```js
   apiClient.fetchPostDetail(postId)
   ```

7. 使用 `postParser.parsePostContent(detail)` 解析帖子。
8. 校验正文包含验证码。
9. 校验帖子发布时间：
   - 推荐要求 `publishedAt >= challenge.createdAt - 5min`。
   - 如果 Binance 返回时间为空，可不阻断，但记录 warning。
10. 识别 Binance 作者：
    - 优先使用 `squareUid`。
    - 同时保存 `username`、`displayName`、`avatar`。
    - 可额外调用 `fetchUserProfile(username)` 补全 profile，但 profile 失败不应阻断绑定。
11. 检查一对一冲突：
    - 当前 `twitterId` 是否已 active 绑定。
    - 当前 `binanceSquareUid` 是否已 active 绑定给其他 `twitterId`。
12. 检查每月换绑次数是否超过 3 次。
13. 在事务中：
    - 如当前用户已有 active binding，先置为 `revoked`。
    - 创建新的 active binding。
    - challenge 置为 `verified`。
    - 写入 bind/rebind event。
14. 返回绑定成功。

---

## 8. 一对一与换绑规则

### 8.1 一对一规则

必须满足：

```text
twitterId  <->  binanceSquareUid
```

active 状态下：

- 一个 `twitterId` 最多只能有一个 `binanceSquareUid`。
- 一个 `binanceSquareUid` 最多只能属于一个 `twitterId`。

### 8.2 幂等规则

| 场景 | 处理 |
|---|---|
| 当前用户重复验证已绑定账号 | 返回成功，不重复计数 |
| 当前用户解绑后重新绑定同账号 | 成功，是否计数按月度规则执行 |
| 当前用户换绑新 Binance 账号 | 检查月度次数，未超限则成功 |
| Binance 账号已被其他用户绑定 | 返回 `BINANCE_ACCOUNT_ALREADY_BOUND` |
| 当前用户本月换绑次数已达 3 次 | 返回 `MONTHLY_REBIND_LIMIT_EXCEEDED` |

### 8.3 每月 3 次换绑建议口径

推荐按自然月统计，例如 Asia/Shanghai 月份：

```text
2026-07-01 00:00:00 Asia/Shanghai ~ 2026-08-01 00:00:00 Asia/Shanghai
```

统计成功事件：

```text
eventType = 'rebind'
```

本次实现口径：

- 首次绑定不计入换绑次数。
- 解绑不计入换绑次数。
- 只有用户已有绑定历史后，成功绑定新的 active 账号时记录 `rebind` 并计入。
- 重复验证当前已绑定的同一个账号按幂等成功处理，不计入。

---

## 9. Binance Square 抓取复用方案

复用现有模块：

```js
const apiClient = require("../../binance-square/scraper/api-client");
const postParser = require("../../binance-square/scraper/parsers/postParser");
```

核心调用：

```js
const detail = await apiClient.fetchPostDetail(postId);
const parsedPost = postParser.parsePostContent(detail);
```

用户绑定校验是按需抓取：

- 不走独立爬虫队列。
- 不需要启动 `binanceSquareCrawlerServer.js`。
- 不建议使用批量爬虫 Redis lock。
- 需要给绑定 verify 接口加限流。

---

## 10. 活动期间暂停原有爬取任务

为了让 Binance Square 请求更稳定，活动期间建议暂停原 Top1000 帖子定时抓取。

### 10.1 暂停方式

方式一：后台接口暂停调度器：

```http
POST /api/admin/binance-square/crawl/pause
```

方式二：停止独立爬虫 PM2 进程：

```bash
npm run stop-binance-square-crawler
```

或：

```bash
pm2 stop luykin-chaineye-binance-square-crawler
```

### 10.2 恢复方式

活动结束后恢复：

```bash
npm run start-binance-square-crawler
```

或后台调用：

```http
POST /api/admin/binance-square/crawl/start
```

---

## 11. 安全与风控

### 11.1 登录态要求

所有绑定接口必须要求登录，且必须能解析出 Twitter ID。

如果当前登录用户没有 Twitter ID：

```json
{
  "success": false,
  "error": "TWITTER_ID_REQUIRED",
  "message": "请先连接 Twitter 账号后再绑定 Binance Square。"
}
```

### 11.2 Challenge 安全

建议：

- challenge 有效期 30 分钟。
- 同一 Twitter ID 同一时间只保留一个未过期 pending challenge。
- 每个 challenge 最多允许校验 5 次。
- 校验失败记录 `attemptCount`、`lastErrorCode`。

### 11.3 接口限流

建议：

```text
POST /challenge: 每用户每分钟最多 3 次
POST /verify: 每用户每分钟最多 5 次，每 IP 每分钟最多 30 次
```

### 11.4 防重放

校验成功后：

- challenge 置为 `verified`。
- 同一个 challenge 不允许再次绑定别的帖子。
- 同一个 `verificationPostId` 不允许绑定给其他用户。

### 11.5 帖子时间校验

推荐使用 Binance 返回的时间字段：

1. `firstReleaseTime`
2. `latestReleaseTime`
3. `createTime`

建议校验：

```text
postTime >= challenge.createdAt - 5min
```

---

## 12. 前端设计

前端项目路径：

```text
/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt
```

### 12.1 UI 入口

建议在 EchoHunt 个人主页或设置页增加卡片：

未绑定：

```text
Binance Square Account
Not connected
[Bind Binance Square]
```

已绑定：

```text
Binance Square Account
头像 DisplayName (@username)
Verified on 2026-07-10
[View Verification Post]
[Unbind]
```

### 12.2 状态机

```text
loading_status
not_bound
challenge_created
waiting_user_post
verifying
verified
failed
```

### 12.3 交互流程

1. 页面加载请求：

   ```http
   GET /api/xhunt/echohunt/binance-square-binding/me
   ```

2. 未绑定显示「Bind Binance Square」。
3. 点击后请求：

   ```http
   POST /api/xhunt/echohunt/binance-square-binding/challenge
   ```

4. 展示：
   - 验证文案。
   - Copy 按钮。
   - Open Binance Square 按钮。
   - 帖子链接输入框。
5. 用户粘贴链接后点击 Verify。
6. 调用：

   ```http
   POST /api/xhunt/echohunt/binance-square-binding/verify
   ```

7. 成功后刷新绑定状态。

### 12.4 前端提示文案

英文：

```text
1. Copy the verification text below.
2. Publish it as a new post on Binance Square.
3. Paste the Binance Square post link here and click Verify.
```

中文：

```text
1. 复制下方验证文案。
2. 在 Binance Square 发布一条新帖子。
3. 将帖子链接粘贴回来并点击验证。
```

错误码映射：

| 错误码 | 前端文案 |
|---|---|
| `TWITTER_ID_REQUIRED` | 请先连接 Twitter 账号后再绑定 Binance Square。 |
| `CHALLENGE_EXPIRED` | 验证码已过期，请重新生成。 |
| `VERIFICATION_CODE_NOT_FOUND` | 暂时无法确认该帖子与本次验证请求匹配，请检查帖子内容后重试。 |
| `POST_FETCH_FAILED` | 暂时无法读取该帖子，请稍后重试。 |
| `BINANCE_ACCOUNT_ALREADY_BOUND` | 该 Binance Square 账号已绑定其他 EchoHunt 用户。 |
| `MONTHLY_REBIND_LIMIT_EXCEEDED` | 本月换绑次数已达上限。 |
| `INVALID_POST_URL` | 请粘贴 Binance Square 帖子链接。 |
| `RATE_LIMITED` | 操作太频繁，请稍后再试。 |

---

## 13. 后端实现拆分建议

### 13.1 新增 service

```text
src/xhunt/services/binance-square-binding-service.js
```

职责：

- 解析当前用户 Twitter ID。
- 生成验证码。
- 创建/复用 challenge。
- 从帖子链接提取 postId。
- 抓取帖子详情。
- 校验验证码。
- 解析 Binance 作者。
- 检查一对一绑定冲突。
- 检查每月换绑次数。
- 写入绑定记录和事件记录。

核心方法建议：

```js
getCurrentTwitterIdentity(req)
createBindingChallenge({ twitterIdentity })
getBindingStatus({ twitterId })
verifyBindingPost({ twitterIdentity, challengeId, postUrl })
revokeBinding({ twitterId })
```

### 13.2 新增 route

```text
src/xhunt/api/binance-square-binding.js
```

职责：

- 做请求参数校验。
- 做登录态校验。
- 调 service。
- 返回统一 JSON。

### 13.3 接入 EchoHunt 现有路由

本次实现直接接入现有：

```text
src/xhunt/api/echohunt.js
```

实际用户侧路径为：

```http
/api/xhunt/echohunt/binance-square-binding/*
```

EchoHunt 前端通过现有 Next.js 代理访问：

```http
/api/echohunt/binance-square-binding/*
```

---

## 14. 可观测性

建议记录日志：

- challenge 创建成功。
- verify 开始。
- Binance post detail 请求耗时。
- verify 失败原因。
- 绑定成功的 `twitterId`、`binanceUsername`、`squareUid`。
- 换绑次数命中和超限。

建议统计事件：

```text
binance_square_binding_challenge_created
binance_square_binding_verify_success
binance_square_binding_verify_failed
binance_square_binding_unbound
binance_square_binding_rebind_limit_exceeded
```

---

## 15. 边界情况

| 情况 | 建议处理 |
|---|---|
| 当前登录态没有 Twitter ID | 不允许绑定，提示先连接 Twitter |
| 用户复制了旧 challenge | 返回过期或无效 |
| 帖子链接是 `/zh-CN/square/post/xxx` | 支持 |
| 帖子链接是 `/en/square/post/xxx` | 支持 |
| 链接带 query/hash | 支持，只提取 postId |
| 用户发了图片帖但正文为空 | 校验失败 |
| Binance 接口短暂失败 | 返回可重试错误 |
| 用户 Twitter 改 handle | 不影响绑定，因为以 Twitter ID 为准 |
| 用户 Binance 改 username | 绑定以 `squareUid` 为准，后续刷新展示字段 |
| 作者 profile 拉取失败 | 不阻断，只要帖子详情有 username/squareUid 即可绑定 |
| 用户解绑后重新绑定 | 允许，但受每月 3 次限制 |

---

## 16. MVP 范围建议

第一阶段只做最小闭环：

1. 新增三张表和迁移：
   - bindings
   - challenges
   - events
2. 新增用户侧接口：
   - `GET /me`
   - `POST /challenge`
   - `POST /verify`
   - `DELETE /me`
3. 复用现有 Binance `fetchPostDetail` 和 `postParser`。
4. EchoHunt 前端增加绑定卡片。
5. 活动期间暂停原 Top1000 爬虫。

暂不做：

- 后台绑定管理页。
- 人工审核。
- 多 Binance 账号绑定。
- 大规模队列化 verify。

---

## 17. 已确认决策

1. 用户身份以 Twitter ID 为准。
2. 绑定是榜单账户能力，不与活动绑定，不使用 `campaignKey`。
3. 一个 EchoHunt 用户只允许绑定一个 Binance Square 账号。
4. 一个 Binance Square 账号只允许绑定给一个 EchoHunt 用户。
5. 支持解绑。
6. 每个用户每月最多换绑 3 次。
7. 管理后台查看和人工解绑二期再做。

---

## 18. 仍需确认的关键细节

这些不是阻塞方案的大方向，但会影响实现口径：

1. Twitter ID 从哪里取最稳：
   - 旧 `XHuntUser` 字段；
   - `XHuntUserToken` 中的 Twitter 身份；
   - `AuthCenterXhuntIdentity(provider='twitter')`；
   - 或 EchoHunt 当前接口已经返回的 Twitter ID。
2. “每月 3 次”按自然月还是滚动 30 天计算。推荐自然月，Asia/Shanghai 时区。
3. 首次绑定是否计入每月 3 次。本次实现不计入。
4. 解绑是否计入每月 3 次。本次实现不计入。
5. 如果用户已绑定 A，解绑后又绑定回 A，当前实现会按有历史后的成功绑定记录为 rebind；如果后续希望“同账号解绑重绑不计入”，可二期细化。
