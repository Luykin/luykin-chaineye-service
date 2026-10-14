# EchoHunt 自定义榜单推文提交：技术方案

> 状态：待评审，未实施。
> 后端：`luykin-chaineye-service`；前端：`/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt`。
> 更新：2026-10-14

## 1. 目标与边界

管理员在“管理后台 → `/xhunt/stats#/nacos-campaigns`”配置**自定义榜单**时，可以针对每一个榜单单独开启“主动投稿”。已报名的 EchoHunt 用户可在活动详情页报名区域旁提交 X/Twitter 推文 URL，并查看自己在该榜单下的历史提交。

后端负责保存、限额校验、个人历史查询，以及面向外部分析系统的只读查询接口；本期不负责抓取推文内容、鉴定推文有效性、计算榜单分数或触发奖励发放。

关键边界如下：

- 开关及限额属于 `customLeaderboards[]` 的单一榜单，而不是活动全局字段。
- 只有已报名的用户才能提交；未开启提交的榜单不可提交。
- 每条提交只保存用户主动提供的 X/Twitter URL 及解析出的 Tweet ID，不调用 X API 验真。
- 限额是提交时的硬限制，不依赖前端显示。
- 传统榜单模式不再可新建、不可从后台选择；为保证历史数据可读，已有传统活动仍按原配置展示/运行，不自动迁移或改写。

## 2. 现状与落点

### 2.1 管理后台与活动配置

数据库版活动编辑页是 `admin-web/src/pages/NacosCampaignsPage.tsx`。当前每个活动的 `leaderboardMode` 支持 `traditional` 和 `custom`；新建活动的默认值仍是 `traditional`。自定义榜单已使用稳定的 `id`（为空时才回退为 `custom-${index}`），且该 ID 已被排行榜适配器使用。因此推文提交必须以填写且唯一的 `id` 为外键语义，不能使用数组下标。

活动配置最终保存在活动的 `nacosPayload` 中，现有 EchoHunt API 会将 `leaderboardConfig.customLeaderboards` 映射给网站。该 JSON 扩展不需要为配置字段另建表。

### 2.2 EchoHunt 已有能力

- 后端已有 `src/xhunt/api/echohunt.js`，挂载在 `/api/xhunt/echohunt`，并已有活动列表、详情、报名、`me` 与排行榜接口。
- `POST /campaigns/:campaignKey/register` 使用 Auth Center token，并复用 `CampaignRegistration` 记录报名状态。
- 前端活动详情由 `components/campaign/CampaignDetailView.tsx` 组合 `components/campaign/SignupPanel.tsx`；后者正是报名状态、报名操作和个人活动信息的集中位置，适合在此处增加紧凑的“推文提交”模块。
- 前端通过 `lib/echohunt-api.ts` 调用后端，活动类型定义在 `lib/campaigns.ts`。

## 3. 配置契约

在每一个 `customLeaderboards[]` 项中增加 `tweetSubmission`。推荐结构：

```json
{
  "id": "content",
  "name": { "zh": "内容创作榜", "en": "Content leaderboard" },
  "tweetSubmission": {
    "enabled": true,
    "period": "week",
    "periodLimit": 3,
    "totalLimit": 10
  }
}
```

字段规则：

| 字段 | 含义 | 校验 |
| --- | --- | --- |
| `enabled` | 是否允许向此榜单提交推文 | 仅 `true` 时显示和启用后续字段 |
| `period` | 周期限额单位 | `day` 或 `week`，必填 |
| `periodLimit` | 每位用户在当前周期内可提交的最大篇数 | 正整数，建议范围 `1..100` |
| `totalLimit` | 每位用户在该活动、该榜单生命周期内可提交的最大篇数 | 正整数，建议范围 `1..1000` |

本期将两个限额均设为开启时必填，避免“0 / 空值到底代表无限还是禁止”的歧义。若产品需要无限额度，建议在后续单独增加 `null = unlimited` 的明确语义，而不是把 `0` 复用为无限。

后台编辑行为：

1. 在每个“自定义榜单”的折叠内容中，增加 checkbox：`主动投稿`。
2. 勾选后显示“限额周期（每天 / 每周）”“周期内最多提交篇数”“该榜单累计最多提交篇数”。
3. 为避免迁移后 ID 漂移，开启提交时要求榜单 `id` 非空且在当前活动唯一；发布校验也必须强制此条件。
4. 新建活动默认 `leaderboardMode: "custom"`，模式控件不再提供“传统”选项。
5. 已有 `traditional` 活动展示“传统模式（已废弃）”只读标识，且不在保存时静默改为自定义模式。若需迁移，应由单独的人工配置/迁移流程完成。

兼容性与默认值：历史榜单没有 `tweetSubmission` 时，按 `{ enabled: false }` 处理。活动公开接口仅透出前端显示和校验所需的该配置，不透出任何外部分析凭证。

## 4. 数据模型

新增 PostgreSQL 表，建议模型名 `XhuntCampaignTweetSubmission`，迁移文件位于 `migrations-pg/`。

```text
XhuntCampaignTweetSubmission
├── id                         UUID PK
├── campaign_key               VARCHAR(128) NOT NULL
├── leaderboard_key            VARCHAR(128) NOT NULL  -- customLeaderboards[].id
├── campaign_registration_id   UUID NULL FK CampaignRegistrations.id
├── xhunt_user_id              UUID NOT NULL FK XHuntUsers.id
├── auth_center_user_id        UUID NULL               -- 方便跨系统分析/追溯
├── twitter_id                 VARCHAR(64) NULL
├── twitter_username           VARCHAR(255) NULL
├── tweet_id                   VARCHAR(32) NOT NULL
├── tweet_url                  TEXT NOT NULL            -- 规范化为 x.com/status URL
├── tweet_title                VARCHAR(255) NULL         -- X API 正文派生的展示标题
├── submitted_at               TIMESTAMPTZ NOT NULL
├── created_at / updated_at    TIMESTAMPTZ NOT NULL
└── （投稿事实不可变；仅允许在提交后补充 tweet_title，本期不提供删除功能）
```

建议约束和索引：

```sql
UNIQUE (campaign_key, leaderboard_key, xhunt_user_id, tweet_id)
INDEX  (campaign_key, leaderboard_key, xhunt_user_id, submitted_at DESC)
INDEX  (campaign_key, leaderboard_key, submitted_at DESC)
INDEX  (campaign_registration_id)
```

第一条唯一约束防止同一用户把同一条推文重复提交到同一榜单。同一用户可以把同一条推文提交到同一活动的不同榜单，因此**不**增加 `(campaign_key, xhunt_user_id, tweet_id)` 的活动级唯一约束。

不把提交历史塞进 `CampaignRegistration` 的原因是：一位用户、一场活动、一个榜单下天然是一对多；单独表才能可靠分页、统计、导出和加唯一约束。

## 5. 后端流程与接口

### 5.1 用户接口

所有用户接口沿用 EchoHunt 的 `authenticateAuthCenterToken()`，并通过现有映射取得 `XHuntUser` 和报名记录。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/xhunt/echohunt/campaigns/:campaignKey/tweet-submissions` | 获取当前登录用户在活动各开启榜单下的配置、余量和历史 |
| `POST` | `/api/xhunt/echohunt/campaigns/:campaignKey/leaderboards/:leaderboardKey/tweet-submissions` | 向一个榜单提交一条推文 URL |

`GET` 支持 `leaderboardKey`、`cursor`、`limit`（最大 50）以便模块按榜单分页；返回活动中所有开启的榜单配置、每个榜单的 `periodUsed` / `periodRemaining` / `totalUsed` / `totalRemaining` 及提交列表。未登录返回 `401`，未报名可返回 `registered: false` 和空历史，方便前端引导报名。

`POST` body：

```json
{ "tweetUrl": "https://x.com/example/status/1234567890123456789" }
```

服务端顺序：

1. 根据 `campaignKey` 读取活动配置并以 `leaderboardKey` 找到唯一的自定义榜单。
2. 确认 `tweetSubmission.enabled === true`、活动处于允许报名/提交的窗口，并确认当前用户已有有效 `CampaignRegistration`。
3. 只接受 `x.com`、`www.x.com`、`twitter.com`、`www.twitter.com` 的 status URL，提取纯数字 Tweet ID；拒绝其它 URL、缺少 status ID 和无效协议。保存统一的 `https://x.com/<handle>/status/<id>` 格式。
4. 在一个数据库事务内取得以 `campaignKey + leaderboardKey + xhuntUserId` 为粒度的 PostgreSQL advisory transaction lock；再计算周期内与累计的数量。
5. 任一上限已满时返回 `409 SUBMISSION_LIMIT_REACHED`，附带剩余量；重复 tweet 返回 `409 TWEET_ALREADY_SUBMITTED`。
6. 插入记录并提交事务后，使用当前用户的 X OAuth token 调用官方 `GET /2/tweets/{id}`；获取正文成功时取第一个非空行并截断为 80 个字符，保存为展示标题。查询失败、限流、鉴权失败或超时不影响投稿成功。
7. 返回新记录、可选的 `title`、最新使用量和剩余量。历史接口只读取已保存标题，不在列表查询时调用 X API。

采用事务锁而不是“先 count、后 insert”，避免两个并发请求都看到尚有 1 个名额而双双成功。限额时间统一按 UTC 计算：日从 `00:00:00Z` 开始，周从周一 `00:00:00Z` 开始；该口径需要在 UI 提示中明确。

投稿截止时间与活动结束时间一致：活动结束后禁止提交。实施时应使用活动实际结束字段（例如 `enrollmentWindow.endAt`；若活动配置另有权威 `endAt`，需在统一的活动状态判断中以该字段为准），由后端在提交事务前强制校验，前端仅用于展示/禁用按钮。

### 5.2 外部分析查询接口

建议提供独立的 machine-to-machine 只读接口，而不是把 EchoHunt 用户 JWT 交给外部系统：

```text
GET /api/xhunt/echohunt/external/campaigns/:campaignKey/tweet-submissions
```

查询参数：`leaderboardKey`（可选）、`from`、`to`（ISO-8601）、`cursor`、`limit`（最大 500）。按 `submittedAt DESC, id DESC` 游标分页，避免 offset 在持续写入时产生漏读/重读。

认证建议：配置 `ECHOHUNT_TWEET_SUBMISSION_EXPORT_API_KEY`，调用方使用 `Authorization: Bearer <key>`；通过 timing-safe compare 校验，并记录调用时间、请求来源、活动和结果数的审计日志。接口应加独立限流，并且禁止把该 key 放入网站前端或 Nacos 配置。

返回仅包含分析必需字段：

```json
{
  "success": true,
  "data": {
    "campaignKey": "example-campaign",
    "items": [
      {
        "id": "123",
        "leaderboardKey": "content",
        "tweetId": "1234567890123456789",
        "tweetUrl": "https://x.com/example/status/1234567890123456789",
        "title": "Tweet display title",
        "submittedAt": "2026-10-14T08:00:00.000Z",
        "user": { "twitterId": "...", "username": "example" }
      }
    ],
    "nextCursor": "..."
  }
}
```

不返回邮箱、EVM 地址、Auth Center token、内部报名备注等无关个人数据。外部消费者如需活动配置，可从现有公开活动接口获得；本接口只提供提交事实。

### 5.3 管理后台查询

活动管理页在“查询报名名单”右侧提供“查询投稿记录”入口。管理后台通过管理员 Cookie 和 `nacos_config` 权限访问：

```text
GET /api/xhunt/campaigns/internal/tweet-submissions
```

该接口接受 `campaign`、`leaderboardKey`、`from`、`to`、`cursor`、`limit`，复用对外接口的筛选和游标分页逻辑，但不要求浏览器持有对外导出密钥。弹窗同时展示带当前活动和筛选条件的对外接口 URL、Bearer Header cURL 示例及复制按钮；示例只显示密钥占位符，不把服务器密钥暴露到前端。

## 6. 前端方案

### 6.1 活动数据和 API client

- 在 `lib/campaigns.ts` 的 `customLeaderboards` 类型增加 `tweetSubmission`。
- 在 `lib/echohunt-api.ts` 增加配置、提交记录、余量等类型，以及 `getCampaignTweetSubmissions`、`createCampaignTweetSubmission` 方法。
- `CampaignDetailView` 已把 `campaignMe` 和认证状态传给 `SignupPanel`；推文模块可复用这些状态，不应重复请求报名接口。

### 6.2 UI 行为

在 `SignupPanel.tsx` 的右侧报名卡片中、报名状态/排名信息附近增加一个紧凑模块：

```text
报名卡
├── 报名状态 / 报名按钮
├── 我的活动排名
└── 我的推文提交（仅活动存在开启的榜单时）
    ├── 榜单切换或按榜单分组
    ├── “本周 1 / 3 · 累计 4 / 10”（按配置本地化）
    ├── 推文 URL 输入框 + 提交按钮
    └── 最近提交历史：时间、Tweet ID/外链、状态（已记录）
```

可见性：未登录显示“登录后提交”；已登录未报名显示“报名后可提交”；报名后在开启的榜单中显示表单。关闭开关的榜单不显示表单和历史入口。提交成功后，以服务端返回的计数刷新该榜单历史；`409` 时直接展示服务端限额/重复信息并刷新计数，不能只依靠本地禁用按钮。

文案需新增中英文 i18n key，至少覆盖：推文提交、提交链接、今日/本周限额、累计限额、剩余次数、提交成功、已达上限、已提交过此推文、报名后可提交。历史记录显示“已记录”，避免暗示已审核或已计分。

## 7. 实施范围

后端预期改动：

- `admin-web/src/pages/NacosCampaignsPage.tsx`：新建默认 custom、弃用传统模式选择、榜单级 checkbox/限额控件、normalize 和发布校验。
- `src/xhunt/api/echohunt.js`：公开配置透出、用户提交与历史 API、外部查询 API。
- `src/xhunt/services/`：新增 `campaignTweetSubmissionService.js`，集中 URL 解析、活动/报名校验、事务限额、序列化逻辑；路由不直接包含业务规则。
- `src/xhunt/models/`、`src/models/postgres/registry.js`、`src/models/postgres/associations/`：新增模型、注册和关联。
- `migrations-pg/<timestamp>-create-xhunt-campaign-tweet-submissions.js`：建表、索引、外键和回滚。

前端预期改动：

- `lib/campaigns.ts`
- `lib/echohunt-api.ts`
- `components/campaign/SignupPanel.tsx`
- 现有中英文文案来源文件（按该项目 i18n 结构补齐）

不包含：X API 内容审计、内容审核、反作弊、榜单积分计算、管理员手动删改提交、CSV 下载、传统活动自动迁移。

## 8. 验收与测试

最少覆盖以下场景：

1. 新建活动默认为自定义模式，后台不再能选择传统模式；历史传统活动不会被保存操作隐式转换。
2. 未开启的榜单不产生前端提交模块，直接调用 POST 返回明确业务错误。
3. 同一活动的两个榜单可分别配置不同周期/总上限，且相互不消耗额度。
4. 未登录、未报名、活动不存在、榜单不存在、榜单未启用、窗口关闭、非法 URL、重复 tweet、周期上限、总上限分别返回稳定错误码。
5. 两个并发 POST 在最后一个名额时最多一条成功。
6. 按 UTC 日/周边界正确重置周期额度，累计额度不重置。
7. 个人历史只能读取本人记录；外部接口无有效 API key 返回 `401`，分页不会因新写入而跳项。
8. 外部响应不含邮箱、钱包、token 或报名内部字段。
9. X API 能返回推文正文时保存并返回展示标题；查不到、超时或限流时投稿仍成功且 `title` 为 `null`。

## 9. 已确认产品规则

1. 同一位用户可以把同一条推文提交到同一活动的**不同**榜单；同一榜单内仍禁止重复提交同一 Tweet ID。
2. 推文提交截止时间与活动结束时间一致；活动结束后，后端必须拒绝新的推文提交。
