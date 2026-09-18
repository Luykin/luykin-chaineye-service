# KOL Match 定向合作活动技术分析

## 1. 结论与范围

本需求是在已上线的 KOL Match 搜索能力之上，增加一套由「定向合作活动」（Targeted Collaboration Campaign，以下简称 TCC）驱动的定向商务合作闭环：运营预配置活动和授权，项目方或 Agency 从 KOL Match 中选择 KOL 并发送固定价邀约，KOL 接受邀约时原子预留预算和名额，项目方在时限内确认后将预留转为锁定；随后完成草稿 AI 初审、人工审核、正式链接提交及活动结束后的奖励领取。奖励实际支付成功才是合作完成。

首期应把它实现为独立的“商务合作域”，不要把状态塞进现有通用活动报名、KOL 搜索画像或前端 localStorage。现有模块可复用登录身份、KOL 搜索结果、商务资料、功能授权基础设施和后台权限框架；活动、邀约、预算、审核、支付、审计和异常处理需要新增持久化模型与服务。

本分析基于以下材料：

- PRD《KOL Match 商务合作业务需求文档》；
- 原型 `/Users/luykin/Documents/mac-work-new/echohuntdemo/kol-campaign-collaboration/`；
- 后端 `src/xhunt/api/kol-marketing/`、`src/xhunt/api/echohunt.js`、`src/xhunt/api/echohunt-kol-match.js` 及相关模型；
- 前端 `XHunt.website/apps/echohunt/app/kol-match/` 与 `components/kol-match/`。

本文件是实施设计，不包含代码改动或生产操作。

### 1.1 术语与可见性

- **定向合作活动 / TCC**：本需求的正式产品与领域名称。它不是面向所有 EchoHunt 用户的公开活动，也不复用通用 `CampaignRegistration` 的报名语义。
- **项目 X 配置**：每个 TCC 必须属于一个项目主体，并绑定该项目的 X 配置（至少保存项目 Twitter ID、handle 和展示名快照）。项目 X 配置用于归属和展示，不能自动赋予某个 EchoHunt 登录账号管理权。
- **活动管理授权**：运营在后台把某个 TCC 单独分配给一个认证中心用户，授予 `project_manager` 或 `agency_manager` 角色。仅这些被分配的用户可查看活动、从 KOL Match 进入邀约流程、并在个人页看到该活动及其进度。
- **KOL 任务可见性**：KOL 在收到属于自己的邀约前，不显示任务/合作模块；收到邀约后才显示该活动的任务入口。KOL 只能查看、接受、拒绝和完成自己的邀约或已确认合作。

## 2. 用一句话理解需求

项目方不是发布一个人人报名的活动，而是在运营为其分配的 TCC 中，向从 KOL Match 找到的特定 KOL 发出一份包含交付要求、Brief 和固定金额的邀约。未获分配的 EchoHunt 用户可以使用 KOL Match 搜索，但没有可选 TCC，不能进入下一步邀约；个人页也不显示 TCC 模块。KOL 有兴趣不等于合作已成立；只有项目方确认、预算锁定且地址快照有效后，合作才进入执行。审核、领取和实际付款必须以同一份合作记录为准。

## 3. P0 业务边界

### 3.1 必须交付

| 角色 | P0 能力 |
| --- | --- |
| EchoHunt 运营 | 在后台“定向合作活动”Tab 对 TCC 做增删改查；配置项目 X、资金池、起止时间、审核方；将活动管理权限授予项目方或 Agency；查看全流程与处理人工审核、异常。 |
| 项目方或 Agency | 仅查看被明确分配的 TCC；从 KOL Match 选择多个可邀约 KOL；逐人定价并发送邀约；在预算、名额、活动状态、地址均有效时确认合作；查看预算、交付和审核。 |
| KOL | 未受邀时不显示任务模块；受邀后维护商务资料及默认收款地址、查看/拒绝/接受邀约；在确认后查看完整 Brief；提交 Google Docs 草稿、查看历次意见、提交正式 X 链接、在开放日领取奖励。 |
| 系统 | 对同活动同 KOL 去重；KOL 接受时原子预留预算和名额、项目方确认时原子锁资；保留邀约快照与审核历史；领取和支付幂等；实际到账后才完成。 |

### 3.2 明确不在首期承诺内

- 文章、视频或多条内容的独立上传、逐条验收和平台内托管；P0 仅统一保存草稿 Google Docs 链接和单一正式 X 链接。
- 自动处罚、自动踢出未发文 KOL、长期未领取的过期策略。
- 2FA、邮箱验证码、Google 验证码。
- 真正的 X 重登录、钱包签名和链上/支付执行的最终产品交互，除非支付方案和验签方式先被确认。
- 在每次邀约时创建活动或编辑活动固定属性。

## 4. 当前实现与复用判断

### 4.1 可直接复用

| 现有能力 | 位置 | 在本需求中的用途 |
| --- | --- | --- |
| 认证中心及 X 身份 | `src/xhunt/auth-center/`、`src/xhunt/api/echohunt.js` | 当前用户、X Twitter ID、旧 `XHuntUser` 的统一关联。KOL 身份和项目方权限均以当前登录账号判断。 |
| KOL Match 搜索与详情 | `src/xhunt/api/echohunt-kol-match.js`、`src/xhunt/api/kol-marketing/` | 作为项目方选择候选 KOL 的上游数据源。搜索已过滤主动暂停接单的明确资料。 |
| KOL 商务资料 CRUD | `GET/PUT /api/xhunt/echohunt/me/collaboration` | 复用接单开关、Telegram、邮箱、短推/长推报价；保存后会同步到 `dev.kol_marketing_profile`，供搜索结果展示。 |
| 通用功能授权表 | `EchohuntFeatureAccesses` | 复用模型、后台鉴权和审计实现方式；但活动级项目方/Agency 权限需新增专用资源模型或明确的 feature/resource 约定。 |
| EVM nonce 和签名能力 | `src/xhunt/auth-center/api/auth-center.js` | 可复用 challenge、Redis nonce、地址格式及签名校验基础能力来实现地址变更验证，不能直接把登录钱包绑定逻辑当作收款地址变更流程。 |
| 管理后台权限模式 | `src/xhunt/api/stats-routes/`、现有 admin router | 用于活动配置、授权、审核、付款处理和审计查询。 |

### 4.2 现有实现的关键限制

| 观察 | 影响 | 设计决定 |
| --- | --- | --- |
| `src/xhunt/api/kol-marketing/index.js` 只有 `POST /search`，职责是只读向量检索与日限额。 | 不能承载邀约、预算或写操作。 | 保持搜索只读；合作 API 放到 EchoHunt 商务合作模块。 |
| `XHuntKolCollaboration` 当前只有接单状态、联系方式、短推和长推报价。 | 无 EVM 收款地址、长文/视频报价、地址版本、修改审计或合作快照。 | 以迁移扩展商务资料，并新增地址变更审计与合作内地址快照。 |
| 搜索结果页只有详情抽屉入口，`ResultTable` 没有多选或发邀约操作。 | 原型中的“选择多位 KOL 发邀约”尚未接入真实站点。 | KOL Match 新增项目方授权 gate、选择篮和邀约工作流；不重写搜索、策略和筛选。 |
| 原型把活动、权限、审核和支付状态保存在浏览器 localStorage。 | 演示可体验流程，但没有鉴权、并发控制、审计或真实付款保障。 | 原型只作为交互和字段参考，后端为唯一事实来源。 |
| `CampaignRegistration` / `XHuntWebsiteCampaign` 面向公开报名和网站活动。 | 其报名、排行榜、合约领取语义和定向合作不一致。 | 不复用为合作主表；可在后续报表层做关联，而不是混写。 |

## 5. 推荐架构

```text
EchoHunt Web
  KOL Match 搜索结果
    -> 候选选择与邀约表单
    -> 我的账户 商务合作 KOL 视图 / 我的活动 项目方视图
  Admin Web
    -> 活动配置、活动授权、人工审核、支付与异常处理

EchoHunt API
  现有 KOL Match 搜索（只读）
  商务合作 API（新）
    -> 权限服务
    -> 活动与预算服务
    -> 邀约与合作状态机
    -> 审核编排服务
    -> 领取与支付适配器
    -> 审计、通知、定时任务

PostgreSQL（唯一业务事实来源）
  活动 / 授权 / 商务资料和地址 / 邀约与合作 / 审核轮次 / 资金账本 / 支付 / 审计

Redis / 队列
  钱包验证 nonce、接口限流、幂等键、AI 审核任务、通知重试、预留到期释放与发放审核候选提醒
```

推荐将新后端代码收敛在 `src/xhunt/business-collaboration/`，路由挂载在既有 EchoHunt router 下：

```text
/api/xhunt/echohunt/business-collaboration/*
```

这样它和 `/api/xhunt/echohunt/kol-match/*` 同属 Web 登录域，但不污染 KOL 搜索服务。服务层使用事务和行锁；路由层只做身份、参数、响应与错误映射。

## 6. 核心数据模型

金额统一按最小货币单位或 `NUMERIC(20, 2)` 存储，货币字段必须显式保存。时间统一存 UTC，API 同时返回 ISO 时间和由前端按 `Asia/Shanghai` 展示的说明。所有状态改动保存操作者、请求 ID、原因和时间。

### 6.1 表与关系

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `BusinessCollaborationActivities` | `id`、`projectId`、`projectTwitterId`、`projectTwitterHandle`、`projectDisplayName`、名称/简介、`fundingPoolAmount`、`reservedAmount`、`lockedAmount`、`claimableAmount`、`paidAmount`、`reservedSeatCount`、`confirmedSeatCount`、`seatLimit`、`startAt`、`endAt`、`reviewerMode`、`status`、邀约默认模板 | 运营配置的 TCC；绑定项目 X 配置快照，保存预算聚合与 Agency 邀约表单默认值。 |
| `BusinessCollaborationActivityAccesses` | `activityId`、`authCenterUserId`、`twitterId`、`role(project_manager/agency_manager)`、`status` | 活动范围授权；一个账号可管理多个活动。建议不要只复用全局 `kol-match` 授权，因为资源和角色语义不同。 |
| `XHuntKolCollaborations` 扩展 | 默认收款地址、设置时间、版本、锁定状态 | 继续做 KOL 的商务资料主记录；增加地址后不允许普通 PUT 直接覆盖。 |
| `KolPayoutAddressChangeRequests` | KOL、旧/新地址、X 再验证结果、旧钱包签名证据、状态、人工处理人 | 地址变更审计。新地址与旧地址均保存小写规范值，展示时可保留 checksum 格式。 |
| `BusinessCollaborationInvitations` | `activityId`、`kolTwitterId`、`kolAuthCenterUserId`、`inviterAccessId`、邀约快照、`offerAmount`、`status`、`acceptedAt`、`reservationExpiresAt`、`payoutAddressSnapshot` | 一份发给一位 KOL 的邀约；以 `activityId + kolTwitterId` 保证同活动不重复。KOL 接受后暂存预算/名额预留和地址快照。 |
| `BusinessCollaborations` | `invitationId`、`activityId`、双方身份快照、`lockedAmount`、`payoutAddressSnapshot`、执行状态 | 只在项目方确认后创建，代表真实的已确认合作。 |
| `BusinessCollaborationReviewRounds` | `collaborationId`、轮次、草稿 URL、AI 状态/结果、人工状态/意见、提交人/审核人 | 每次重提是一轮，AI 通过后才能进入人工审核。 |
| `BusinessCollaborationDeliveries` | `collaborationId`、`draftUrl`、`publishedUrl`、`submittedAt` | P0 只支持一个正式 X 链接；将来多内容可拆为 deliverable item 表。 |
| `BusinessCollaborationGrants` | `activityId`、`collaborationId`、`grantAmount`、`currency`、`status(approved/rejected)`、批次 ID、审核人、审核时间、原因 | 仅由活动结束后的后台发放审核创建；它是 KOL 可见可领取金额的唯一来源。 |
| `BusinessCollaborationBudgetLedger` | `activityId`、`invitationId`、`collaborationId`、`grantId`、`type(reserve/lock/release/grant/paid/reversal)`、金额、幂等键 | 预算展示和对账的不可变流水；`grant` 只在后台批准发放时写入，活动聚合字段只用于快速读取。 |
| `BusinessCollaborationPayouts` | `collaborationId`、金额、地址快照、支付渠道/交易哈希、`status`、幂等键、失败原因 | “点击领取”不是“已付款”；支付确认成功才置 paid。 |
| `BusinessCollaborationAuditLogs` | 资源、动作、前后状态、actor、requestId、metadata | 覆盖授权、邀约、锁资、审核、地址和支付的可追溯性。 |

### 6.2 TCC 必填配置与邀约默认值

运营创建/编辑 TCC 时必须填写：活动名称、所属项目 X 账号（Twitter ID 必填，handle/展示名作快照）、活动描述、资金池金额和币种、开始/结束时间、名额、审核方、启停状态。开始时间必须早于结束时间，资金池和名额必须为正数；已发送邀约后，项目 X、币种和资金池不得以覆盖方式修改，需走受审计的调整/归档流程。

每个 TCC 还可配置一份 **邀约默认模板**，至少包含：邀约标题/说明、完整 Brief、内容形式、内容数量、语言、必须表达事项、最低单人报价、接受邀约后的项目方确认时限。Agency 发邀约时只需选择一个已分配且处于 `open` 状态的 TCC，表单自动带入这份模板；Agency 可以补充或覆盖允许编辑的邀约信息和详细要求。所有最终值在发送时写入 `invitationSnapshot`，后续修改活动默认值不会影响已经发送的邀约。

默认模板字段是否可由 Agency 覆盖应由活动配置显式控制；至少预算币种、最低报价、项目 X 归属和审核方不可由 Agency 覆盖。

### 6.3 必须保存的邀约快照

邀约不得在后续编辑活动或商务资料后改变历史含义。`BusinessCollaborationInvitations` 至少固化：活动/项目展示信息、内容形式、内容数量、内容语言、完整 Brief、邀约信息、固定报价和币种、KOL 名称/handle/Twitter ID、报价来源（KOL 资料或人工输入）、发送时的活动时间和审核方。项目方确认后，再把接受邀约时固化的收款地址复制到 `BusinessCollaborations.payoutAddressSnapshot`。

### 6.4 Admin Web：新增“定向合作活动”Tab

在 Admin Web 新增一级 Tab **定向合作活动**，作为 TCC 的唯一运营入口；不要把它混入 Nacos 公开活动配置页。该 Tab 至少包含：

1. **活动列表**：显示名称、绑定项目 X、状态、起止时间、资金池/已预留/已锁定/可领取/已支付金额、名额、已分配管理者与更新时间；支持按项目 X、状态和管理者筛选。
2. **创建与编辑**：必须选择或录入项目 X 配置，并填写名称、简介、资金池与币种、起止时间、名额、审核方、启停状态。项目 X 变更须记录审计；已有邀约后不能直接覆盖历史快照。
3. **活动授权**：按认证中心用户分配 `project_manager` / `agency_manager`，可撤销或暂停授权；授权变更立即影响 API 可见性，且必须留下操作人、原因和时间。
4. **进度与处置**：查看该 TCC 的邀约、已确认合作、审核轮次、逐人金额、账本和审计；运营可执行权限、人工审核、地址异常和活动结束后的批量发放审核。
5. **删除规则**：从未发送邀约的草稿 TCC 可删除；存在邀约、合作或账本后只允许归档/停用，保留所有历史记录和审计，避免破坏金额对账。

该 Tab 应受独立后台权限（建议 `business_collaboration_manage`）保护。所有写操作要求后台管理员身份和审计日志；前端按钮隐藏不能替代后端权限校验。

## 7. 状态机与强约束

### 7.1 活动可报名状态

```text
scheduled -> open -> closed_for_new_invitations
                           \-> execution_only
```

- `scheduled`：未到开始时间，不能发送或接受邀约。
- `open`：在活动时间内、活动启用且未满名额；可发送和接受邀约。单笔接受时再按实际报价判断可用预算。
- `closed_for_new_invitations`：活动时间结束、名额用尽或运营停止招募；只停止**发送邀约和接受邀约**。既有已接受邀约仍可由项目方确认，已确认合作仍可交付、审核和提交发布链接。
- `execution_only` 不是独立存储状态，而是对已确认合作的行为结果：即使活动已停止招募，草稿、审核、发布和后续后台发放审核仍可继续。

### 7.2 邀约与合作状态

```text
draft -> sent -> accepted -> confirmed -> executing
                  |             |             |
                  +-> kol_declined              +-> draft_submitted
                  +-> project_declined                         -> ai_rejected
                  +-> reservation_expired                        -> human_review
                                                            -> human_changes
                                                            -> approved_for_publish
                                                            -> published_submitted
                                                            -> claimable
                                                            -> payout_processing
                                                            -> paid_completed
```

实现时应区分“邀约状态”和“合作执行状态”：

- `sent/kol_declined/project_declined/reservation_expired` 是未形成合作的邀约处理；`accepted` 是 KOL 成功接受且金额、名额已预留的状态。
- `confirmed` 是事务成功、预留金额/名额已转为锁定且地址已快照的结果。
- 草稿重提后的 `ai_rejected`、`human_changes` 不是终态，必须回到同一合作并新增审核轮次。
- `published_submitted` 不等于可领取；只有活动结束时间到达、审核通过、正式链接和有效地址齐全，才转换为 `claimable`。
- `payout_processing` 和 `paid_completed` 是支付渠道接入后的后续状态；本期不进入这两个状态。任何未来重试均按幂等键处理，绝不重复支付。

### 7.3 KOL 接受邀约：预算预留的原子事务

“接受成功”必须代表该 KOL 已获得这笔预算和名额，不能只在前端检查一次余额。因此，`POST /invitations/:id/accept` 必须在一个 PostgreSQL 事务内对活动和邀约行加锁：

1. 从认证中心 token 取得当前 KOL 的 Twitter ID，并校验其是该邀约收件人；不能使用请求体传入的 KOL 身份。
2. 锁定活动后重新校验 `startAt <= now < endAt`、活动启用且状态为 `open`；结束瞬间（`now >= endAt`）即拒绝，不存在前端时钟宽限。
3. 锁定邀约，要求状态为 `sent`、报价和币种已在邀约快照中固定、且 KOL 有有效默认收款地址。重复请求使用同一幂等键时返回已有接受结果，不重复预留。
4. 计算 `availableAmount = fundingPoolAmount - reservedAmount - lockedAmount` 与 `availableSeats = seatLimit - reservedSeatCount - confirmedSeatCount`。任一不足即不改变任何数据并返回明确业务错误：`ACTIVITY_BUDGET_INSUFFICIENT` 或 `ACTIVITY_SEATS_FULL`。
5. 写入 KOL 当前地址快照、`acceptedAt` 和 `reservationExpiresAt`；写一条 `reserve` 账本，原子增加 `reservedAmount` 与 `reservedSeatCount`，再把邀约更新为 `accepted`。
6. 写审计和通知事件后提交。任何并发接受都由活动行锁串行化，因此不可能预留超额。

接受前活动未开始返回 `ACTIVITY_NOT_STARTED`，活动结束返回 `ACTIVITY_ENDED`，被停用/归档返回 `ACTIVITY_NOT_OPEN`，邀约已失效返回 `INVITATION_NOT_ACCEPTABLE`。这些是前端应直接展示的业务失败，不应显示为“接受成功后再失败”。

预留不是无限期占款：`reservationExpiresAt` 默认为活动模板配置的确认时限。KOL 拒绝、项目方拒绝、项目方未在时限内确认或运营明确取消邀约时，后台定时任务和后续写请求都必须在事务内将邀约置为 `reservation_expired`（或相应拒绝状态）、写 `release` 账本并释放金额和名额。**活动时间结束本身不释放已接受邀约，也不阻止项目方确认、KOL 交付或审核。**运营停止招募只阻止新的发送/接受；若要取消既有预留，必须显式执行带原因和审计的取消操作。

### 7.4 确认合作的原子事务

确认 API 必须在一个 PostgreSQL 事务内执行，并对活动行使用 `SELECT ... FOR UPDATE` 或等效 Sequelize 行锁：

1. 校验调用人拥有该活动的有效项目方/Agency 管理权限。
2. 锁定活动行，要求活动未归档且这笔已预留金额和名额仍存在；活动时间结束不阻止确认。
3. 锁定邀约行，要求状态是 `accepted`、预留未到期且尚未生成合作。
4. 使用接受时的地址快照；不得在确认时读取或覆盖 KOL 已变化的默认地址。
5. 创建合作、写一条 `lock` 账本、原子减少 `reservedAmount`/`reservedSeatCount` 并增加 `lockedAmount`/已确认名额、更新邀约为 `confirmed`。
6. 写审计和 outbox 通知事件后提交。

禁止仅依赖前端余额、Redis 锁或“先查再写”。活动预算不足、重复确认、并发确认时应返回可识别的业务错误而不是 500。

## 8. API 设计草案

以下为资源型接口，不是最终 URL 契约；所有写接口都需要认证、角色校验、请求 ID 和 `Idempotency-Key`。

| API | 调用方 | 核心行为 |
| --- | --- | --- |
| `GET /business-collaboration/activities/available` | 项目方/Agency | 仅返回当前账号被明确授权、且可用于发邀约的 TCC；无授权时返回空数组，不泄露其他项目活动。 |
| `POST /business-collaboration/invitations` | 项目方/Agency | 选择一场已分配的 TCC 后批量创建邀约；服务端载入活动默认模板，允许字段才可覆盖，并为每位 KOL 固化独立金额和快照。任何无效项应返回逐项错误或采用显式 all-or-nothing 策略。 |
| `GET /business-collaboration/activities/:id` | 项目方/Agency/运营 | 返回活动预算、候选人、邀约、合作、已提交内容；按角色脱敏。 |
| `POST /business-collaboration/invitations/:id/accept` | KOL | 校验邀请归属、活动时间、可用预算/名额和当前默认地址；原子写地址快照并预留金额/名额，状态改为 `accepted`。 |
| `POST /business-collaboration/invitations/:id/decline` | KOL | 记录 KOL 拒绝。 |
| `POST /business-collaboration/invitations/:id/confirm` | 项目方/Agency | 执行上述原子锁资流程。 |
| `POST /business-collaboration/invitations/:id/decline-by-project` | 项目方/Agency | 记录本次不合作，不能伪装为已确认。 |
| `GET/PUT /me/collaboration` 扩展 | KOL | 读写联系方式、接单状态和报价；普通 PUT 不可更新已设默认地址。 |
| `POST /me/collaboration/payout-address/change/*` | KOL/运营 | 分步完成 X 再验证、旧地址签名、新地址验证及人工兜底，不覆盖已支付合作快照。 |
| `POST /collaborations/:id/drafts` | KOL | 新增审核轮次并投递 AI 初审任务。 |
| `GET /collaborations/:id/reviews` | 合作双方/审核方 | 返回当前与历史审核结果、意见和链接。 |
| `POST /review-rounds/:id/human-decision` | 指定审核方 | 仅 AI 通过后允许人工通过或退回；意见必填。 |
| `POST /collaborations/:id/published-link` | KOL | 仅人工审核通过后保存正式 X 链接。 |
| `POST /collaborations/:id/claim` | KOL | 后续支付阶段接口；本期不暴露，前端领取入口为无操作 TODO。 |
| `GET/POST/PATCH/DELETE /admin/business-collaboration/activities` | 运营 | “定向合作活动”Tab 的 TCC 增删改查；已有业务记录的活动仅允许归档。 |
| `GET/POST/PATCH /admin/business-collaboration/activities/:id/accesses` | 运营 | 分配、调整、撤销该 TCC 的项目方/Agency 管理权限。 |
| `GET /admin/business-collaboration/*` | 运营 | 审核队列、付款处理、异常和审计。 |

批量邀约建议第一次实现选择“单请求、全量事务”：若任一候选重复、价格低于 100 USD、活动不可用或 KOL 暂停接单，则整批不发送并返回每人错误。若业务更希望部分发送，必须在 UI 明确显示“已发送/未发送”清单，不能把失败隐藏为成功。

## 9. 权限与数据可见性

| 动作 | KOL | 项目方/Agency | EchoHunt 运营 |
| --- | --- | --- | --- |
| 查看 KOL Match 并发邀约 | 不适用 | KOL Match 可照常搜索；仅拥有活动授权且 TCC 为 open 时可进入邀约 | 可按运营权限查看 |
| 在个人页看到 TCC 和进度 | 仅收到邀约或存在合作时 | 仅被分配为该 TCC 管理者时 | 可按运营权限查看 |
| 查看完整 Brief | 仅已确认的本人合作 | 自己管理活动 | 可查看 |
| 接受/拒绝邀约、提交内容/领取 | 仅邀约或合作归属本人 | 不可代替 KOL | 异常处理时可代操作并审计 |
| 确认合作/锁资/项目方人工审核 | 不可 | 仅该活动授权且审核方为项目方 | 可按治理权限处理 |
| EchoHunt 人工审核 | 不可 | 仅查看结果 | 仅审核方为 EchoHunt 的活动 |
| 创建活动、分配授权、人工改地址、付款处理 | 不可 | 不可 | 仅后台权限允许的运营角色 |

不能依据前端当前页面、URL 参数、项目 X handle 或客户端传来的 `role` 决定权限。后端以 token 中的认证中心用户和活动授权记录为准；访问活动详情也要做同样的 resource-level 校验。项目 X 仅是 TCC 的归属配置，不等于对该项目 X 的任何登录者自动授权。

## 10. 审核、领取与支付设计

### 10.0 已确认的一期边界（2026-09-18）

以下约定已由产品确认，优先级高于本文先前的开放问题：

1. Agency 的 `offerAmount`、活动预算预留和锁定仅是后台内部的邀约/预算承诺，不是发放记录，也不作为 KOL 的可领取金额展示。
2. 所有实际发放金额、系统发放账本和 KOL 可见的可领取金额，都只能在活动 `endAt` 到达后，由管理后台的发放审核明确批准后创建；系统不得在活动结束时自动生成。
3. 真正的领取链路将采用“EVM 钱包验证在前、X 身份认证在后”的顺序，但本期不接入钱包签名、X 重认证、链上合约或付款渠道。前端保留领取入口，点击处理函数明确标注 `TODO` 且不发起请求；后端也不得把该操作误记为领取成功、付款处理中或已付款。
4. Google Docs 草稿在发起 AI 审核前必须由后端进行匿名可读性预检。不可读取时，前端显示后端返回的明确错误并提示 KOL 将文件共享为“持有链接的任何人可查看”；不把访问失败伪装成 AI 审核失败。

金额采用 `NUMERIC(20, 2)` 加显式币种存储。`reserved`（KOL 已接受，待项目方确认）和 `locked`（已确认，待交付）是后台内部预算承诺，不能在 KOL 端作为发放/可领取金额展示；其聚合值用于防止超额邀约。活动结束后，运营在后台查看合作、交付和审核情况，批量选择记录并批准实际 `grantAmount`（默认建议等于邀约 `offerAmount`；若调整必须填写原因）。只有这一刻才创建 `BusinessCollaborationGrant`、写 `grant` 账本并增加 `claimableAmount`；KOL 才能看到该金额和未来的领取入口。`availableAmount = fundingPoolAmount - reservedAmount - lockedAmount - claimableAmount - paidAmount`，任何金额转换或批准均必须在同一事务中完成。活动汇总字段仅用于读取性能，逐人合作、发放审批和账本才是对账事实来源。

一期暂不创建真实 payout，也不允许运营或前端手工把合作置为 `paid_completed`。待支付渠道、网络、验签和到账回执确定后，再用幂等 payout 请求承接该状态转换。

### 10.1 AI 与人工审核

AI 审核应异步化：草稿 URL 入库前，服务端仅接受规范化后的 `https://docs.google.com/document/d/:id/...` 地址，并以固定 Google Docs 导出地址做一次匿名可读性预检（短超时、仅允许 Google Docs 域名、禁止跟随至非 allowlist 域名，以避免 SSRF）。预检返回 401/403、登录页、无法导出或超时时，接口返回 `GOOGLE_DOC_NOT_ACCESSIBLE` 和可展示文案“无法访问该 Google Docs，请将文件权限调整为‘持有链接的任何人可查看’后重试”。不得保存为可审核草稿，也不得投递 AI 任务。

预检通过后才创建 `pending` review round，再向队列投递任务。任务读取本轮 Brief、必须表达信息和图文要求，返回结构化结果：`pass/fail`、问题列表、摘要、模型版本、输入引用及耗时。失败时只更新本轮为 `ai_rejected`；不得让人工端绕过失败直接通过。Google 访问预检只证明匿名读取可用，不代替内容审核，也不保存 Google 登录凭证或文档全文。

AI 通过后，根据活动 `reviewerMode` 进入项目方审核队列或 EchoHunt 运营审核队列。人工退回必须有原因，KOL 重提时总是创建新轮并再次 AI 初审。双方都能读到历史，但只有具有审核权限的人能作出决定。

### 10.2 领取与真实支付

活动结束后，系统**不自动**生成可领取金额，也不因为任务仍在提交/审核而阻断后续流程。运营在管理后台的“批量发放审核”中选择合作记录，查看邀约快照、交付链接、审核状态和内部报价后，逐条批准或拒绝。批准操作必须校验 `now >= activity.endAt`、合作尚未已有已批准发放记录且地址快照有效；默认要求交付审核通过和正式链接存在，若运营要对例外记录发放，必须填写 override 原因并审计。批准成功后才创建唯一的 grant、写入 `claimableAmount`；重复提交按合作 ID/幂等键返回同一 grant，绝不重复发放。

KOL 端在 grant 批准前不返回 `claimableAmount`、发放账本或领取入口；邀约 DTO 也不返回 Agency 的内部 `offerAmount`。本期 grant 批准后的领取按钮仍是无副作用占位入口，代码需保留 `TODO(payment-claim)`，不得调用 claim API。后续支付需要先确认一种正式渠道：运营手工转账录入、托管支付 API，或链上合约；届时再实现“EVM 钱包验证 -> X 身份认证 -> 创建/复用幂等 payout 请求”。收到可信支付回执/链上确认后才将 payout 和合作更新为 `paid_completed`，同时写 `paid` 账本。若采用人工付款，后台必须要求交易哈希或凭证、经办人和时间，且与合作/地址快照绑定。

### 10.3 地址、身份与一致性防线

- 收款地址是 KOL 商务资料的受保护字段：普通 `PUT /me/collaboration` 不得覆盖；已确认合作永远使用 `BusinessCollaborations.payoutAddressSnapshot`，之后修改默认地址不会回写历史合作。
- 地址变更单独建申请与审计记录。自动路径要求当前 X 登录身份、旧地址签名（若已有地址）和新地址签名；无法取得旧地址时只能进入有材料、有操作人和有审计的人工审批，不能由客户端直接覆盖。所有地址按小写规范值比较、checksum 格式仅用于展示。
- 后端从认证中心 token 读取 `authCenterUserId` 与已绑定 Twitter identity；绝不接受 body 中的 KOL ID、Twitter ID、角色或地址快照作为授权依据。活动授权、邀约归属、合作归属均以数据库关联校验。
- 数据库必须保留 `activityId + kolTwitterId` 唯一约束、`invitationId` 唯一合作约束、地址变更版本号和账本幂等键；确认、转为可领取、将来付款均在同一事务中锁定合作与活动行。唯一冲突必须映射为业务错误，不得静默覆盖另一身份或另一笔金额。
- 原型中的 localStorage、模拟金额和前端状态机仅可用于演示，不能迁入生产读写路径。生产 API、迁移后的 PostgreSQL 记录及审计日志是唯一事实来源；功能在完整鉴权、迁移和监控就绪前保持 feature flag 关闭。

## 11. 前端落地方式

保持现有 `/kol-match` 的搜索、AI strategy、筛选和详情抽屉不动，在其外层新增项目方合作入口：

1. 当前登录账号进入 KOL Match 时请求“可管理 TCC”摘要。未被分配任何 TCC 的用户仍可搜索 KOL，但邀约选择篮和下一步入口不可用，并显示“暂无可管理的定向合作活动，请联系项目运营分配权限”；不得显示其他项目的活动名称、预算或成员。
2. 搜索结果增加可选状态和选择篮；只允许 `acceptingNewInvitations === true` 的 KOL 进入批量邀约。详情抽屉展示报价与接单状态，并提供加入选择篮。
3. 邀约页每次重新拉取活动，不恢复上次表单。活动固定信息只读；内容形式、数量、语言、Brief、邀约信息必填。金额逐人输入，默认带入匹配的报价；低于 100 USD 立即报错并禁用发送。
4. “我的账户”沿用一个账号体系：KOL 在没有邀约/合作时不显示任务模块，收到邀约后才显示“定向合作任务”中的邀约、进行中和已完成；拥有 TCC 管理权限时才额外显示“我的定向合作活动”。不以页面切换修改身份或权限。
5. KOL 商务资料页补充默认 EVM 地址与变更流程。接受邀约缺少有效地址时，跳转设置后带回原邀约；已确认合作展示地址快照而非可编辑的当前默认地址。
6. 活动详情以列表展示邀约、待确认、执行进度、审核、已提交内容和预算；按角色展示操作按钮。
7. 草稿提交失败并收到 `GOOGLE_DOC_NOT_ACCESSIBLE` 时，原地显示“无法访问该 Google Docs，请将文件权限调整为‘持有链接的任何人可查看’后重试”；不创建审核记录。领取入口本期仅保留视觉占位和 `TODO(payment-claim)` 无操作处理。

前端新增组件应与现有大体量 `KolMatchPage` 分离，例如 `components/business-collaboration/`。不要把活动状态机、预算计算或权限判断放在 `KolMatchPage.tsx`；它已有搜索和流式匹配的复杂状态，继续堆叠会显著提高回归风险。

## 12. 分阶段实施步骤

### 实施进度（2026-09-18）

| 范围 | 状态 | 记录 |
| --- | --- | --- |
| PostgreSQL 活动与活动级授权底座 | 已完成 | 已新增 `BusinessCollaborationActivities`、`BusinessCollaborationActivityAccesses` 迁移、Sequelize 模型与关联。 |
| Admin API：定向合作活动 | 已完成 | 已挂载 `/api/admin/business-collaboration/activities`，支持活动列表、创建、详情、修改及仅 draft 无金额承诺时删除。 |
| Admin API：活动授权 | 已完成 | 已支持按 Auth Center 用户授予/更新 `project_manager`、`agency_manager` 访问权；全程需 `business_collaboration_manage` 权限并写管理审计。 |
| Admin Web“定向合作活动”Tab | 已完成 | 已接入导航、路由与 `business_collaboration_manage` Gate；支持活动列表、新建、编辑、删除 draft 活动以及项目方/Agency 授权和撤销。 |
| 项目方/Agency 邀约与 KOL 任务 API | 已完成（前端未开始） | 已挂载 `/api/xhunt/echohunt/business-collaboration`：活动范围可见性、批量发邀约、KOL 接受/拒绝、项目方确认/取消、我的活动/任务查询均由认证中心 token 与活动级授权校验；KOL DTO 不返回内部报价或预留/锁定金额。 |
| 收款地址验证与合作事实底座 | 已完成 | 已新增邀约、已确认合作、预算账本、业务审计迁移与 Sequelize 模型；默认 EVM 收款地址通过当前 X 登录 + 新地址签名（变更时还要求旧地址签名）独立设置，接受时固定地址快照。 |
| EchoHunt 项目方/KOL 前端 | 已完成（首个闭环） | KOL Match 仅在当前账号有可用 TCC 时显示候选选择篮和 Ant Design 邀约抽屉；账户“商务合作”页按接口结果显示项目方活动进度、KOL 任务、接受/拒绝/确认操作和默认 EVM 地址验证。未获邀的 KOL 不显示任务模块。 |
| 结束后的批量发放审核、grant、领取 | 未开始 | 依赖合作、交付和审核模型；本轮未实现，KOL 侧没有领取入口。 |
| CR 修复：授权操作人、金额精度、权限可分配 | 已完成 | 操作人字段使用管理员 INTEGER 外键；金额改为分单位 `BigInt` 精确计算并限制 `DECIMAL(20,2)`；权限已加入管理员权限配置。 |
| CR 修复：有承诺活动的普通编辑 | 已完成 | 已允许表单回传与当前值相同的项目 X/币种，仍禁止在存在金额承诺后实际变更这两个字段；删除校验同样使用精确金额计算。 |

当前 Admin API 端点：

- `GET|POST /api/admin/business-collaboration/activities`
- `GET|PATCH|DELETE /api/admin/business-collaboration/activities/:activityId`
- `GET|POST /api/admin/business-collaboration/activities/:activityId/accesses`
- `PATCH /api/admin/business-collaboration/activities/:activityId/accesses/:accessId`

当前 EchoHunt 用户 API 端点（所有写请求需携带 `Idempotency-Key`）：

- `GET /api/xhunt/echohunt/business-collaboration/activities/available`
- `GET /api/xhunt/echohunt/business-collaboration/activities/:activityId`
- `GET /api/xhunt/echohunt/business-collaboration/me`
- `POST /api/xhunt/echohunt/business-collaboration/invitations`
- `POST /api/xhunt/echohunt/business-collaboration/invitations/:invitationId/accept|decline|confirm|decline-by-project`
- `GET /api/xhunt/echohunt/business-collaboration/me/payout-address`
- `POST /api/xhunt/echohunt/business-collaboration/me/payout-address/change/challenge|verify`

### 阶段 0：确认不可自行假设的业务决策

1. ~~确认资金的真实支付渠道、币种/网络、付款发起人与到账确认来源。~~ 本期明确不执行支付；只落库逐人可领取金额和账本，领取入口为 TODO 占位。
2. 确认报价是否仅有 USD/USDT，活动币种是否固定，以及汇率是否允许存在。
3. ~~确认名额满时的规则、活动被运营暂停后的已锁资金处理、项目方撤销合作是否允许及退款策略。~~ 名额在 KOL 接受时预留；项目方拒绝、确认超时或运营显式取消时释放未确认预留。活动结束只停止发送/接受，不中断已接受或已确认合作。项目方撤销已确认合作及退款策略仍待确认。
4. ~~确认 AI 审核模型、访问 Google Docs 的授权方案。~~ 本期使用匿名 Google Docs 可读性预检；AI 模型、数据保留期和人工审核 SLA 仍待确认。
5. ~~确认地址变更的 X 再验证实现方式、旧地址无法签名时的人工审批材料和权限。~~ 采用当前 X token + 旧/新地址签名，旧地址不可签名时走运营人工审批并审计。

这些答案会影响支付适配器、审计强度和状态机，建议在建表前定稿。

### 阶段 1：领域底座与后台配置

1. 新增上述 TCC、项目 X 配置快照、活动授权、邀约、合作、审核、账本、支付和审计迁移及 Sequelize 模型。
2. 实现活动服务、活动授权服务和 `activityId + kolTwitterId` 去重约束。
3. 在 Admin Web 新增“定向合作活动”Tab，提供 TCC 创建、编辑、草稿删除/归档、启停、项目 X、资金池、起止时间、名额和审核方配置。
4. 在该 Tab 增加项目方/Agency 的 TCC 级授权管理、活动进度、逐人金额与审计查询。
5. 为所有金额、锁资和状态更新补充事务、幂等和 outbox 事件基础能力。

验收：运营能在“定向合作活动”Tab 配置 TCC 并授权；未授权账号无法通过 API 读取或管理该活动，KOL 未受邀时也看不到任务模块。

### 阶段 2：商务资料和项目方邀约

1. 迁移扩展 `XHuntKolCollaborations` 的收款地址字段和地址版本；实现只读展示与独立变更申请流程。
2. 扩展 KOL Match 返回 DTO，稳定展示报价与明确接单状态；保持搜索侧只读。
3. 增加 KOL Match 多选、选择篮、活动选择及批量邀约页面。
4. 实现发送邀约 API，服务端校验授权、活动状态、KOL 接单状态、价格下限、去重与快照完整性。
5. 实现 KOL 邀约列表与接受/拒绝接口；接受时固化地址快照并原子预留金额和名额，活动结束、已满额或预算不足时必须明确拒绝。

验收：发送邀约不扣预算；KOL 接受后准确预留一笔金额和一个名额；同活动同 KOL 不能重复发送；后续邀约不会覆盖历史内容要求。

### 阶段 3：接受邀约、确认合作和预算

1. 实现 KOL 接受/拒绝 API、预留到期释放任务和事务级预算/名额预留。
2. 实现项目方确认/不合作 API，将预留原子转为锁资。
3. 实现账本、活动预算聚合、名额校验、并发重复接受/确认防护和失败错误码。
4. 实现项目方“我的活动”与活动详情，显示可用、已预留、已锁定、可领取和已支付金额。
5. 实现 KOL “商务合作”的邀约/进行中/已完成视图和只读 Brief。

验收：多个 KOL 并发接受同一活动时绝不超额预留；项目方确认只可消耗其已接受邀约的预留；活动关闭后不能新增邀约、接受或确认，但已确认合作仍可执行。

### 阶段 4：审核和交付

1. 接入草稿 URL 提交、审核轮次、AI 审核队列和结构化 AI 结果。
2. 实现根据 `reviewerMode` 路由的人工审核队列与通过/退回操作。
3. 实现审核历史、项目方/运营已提交内容入口、正式 X 链接提交和状态限制。
4. 增加通知：邀约、接受成功/失败、预留即将到期、确认、AI 结果、人工结果、后台批准发放和支付结果。

验收：AI 失败不能进入人工审核或正式链接提交；人工退回后的重新提交必经新的 AI 初审；历史意见可回溯。

### 阶段 5：领取资格与后续支付、运营收口

1. 本期实现活动结束后的后台批量发放审核、唯一 grant、逐人 `claimableAmount` 及 KOL 领取入口；领取点击保留无操作 TODO。
2. 在支付渠道确定后，接入确认后的支付渠道或后台人工付款流程，落实幂等、回执/交易哈希和失败重试。
3. 在支付渠道接入后，实现到账后的合作完成、预算已支付更新、运营异常工作台。
4. 加入预留到期扫描和活动结束后的待发放审核提醒；支付接入后再增加失败支付告警和对账报表。

验收（本期）：活动结束前不能批准发放或进入可领取状态；每位 KOL 的可领取金额只在后台批准后记一次，领取点击不改变任何状态。验收（支付接入后）：同一合作重复点击只产生一笔 payout；只有可靠支付成功回执使合作完成。

### 阶段 6：质量、灰度与上线

1. 添加单元测试：状态迁移、预算计算、资格判断、地址规范化、幂等键和权限判断。
2. 添加集成测试：邀约到锁资、AI 失败到重提、项目方/运营审核分流、支付回调重复投递。
3. 添加并发测试：同邀约重复确认、预算边界竞争、重复领取、地址修改与支付竞争。
4. 用 feature flag 只向内测项目方和 KOL 开放；先创建一场小资金活动进行全链路演练与账本对账。
5. 监控活动余额不变量、审核队列堆积、支付失败率、状态卡住时长和权限拒绝率。

## 13. 关键测试清单

| 场景 | 期望结果 |
| --- | --- |
| 同活动对同一 Twitter ID 再次发送邀约 | 返回明确重复错误，不创建第二条邀约。 |
| KOL 暂停接单或没有有效地址 | 暂停接单时不可邀约；没有有效地址时不可接受邀约，页面给出设置引导。 |
| 邀约金额为 99.99 | 前后端均拒绝发送。 |
| 两个 KOL 接受请求同时竞争最后 100 USDT | 至多一个成功预留，另一个得到 `ACTIVITY_BUDGET_INSUFFICIENT`。 |
| 活动结束、名额已满或预算不足时接受邀约 | 拒绝且不写地址快照、不记预留；既有已确认合作仍可提交和审核。 |
| AI 初审失败后人工点击通过 | 服务端拒绝该状态跃迁。 |
| 人工退回后重提草稿 | 创建新轮，重新走 AI 再到人工。 |
| 同一合作重复领取/支付回调重复 | 只创建或确认一笔支付，不重复记账。 |
| 默认地址在接受邀约后变更 | 预留/已确认合作的地址快照不变化；未付款合作的活动级变更按已确认流程处理。 |
| 已支付合作修改地址 | 拒绝对历史付款快照的修改，并留审计记录。 |

## 14. 风险、已定规则与待确认项

### 14.1 已确定，实施时不得回退

1. **可见性与授权**：TCC 默认对全部 EchoHunt 用户不可见；项目方/Agency 必须由后台按活动分配。项目 X 账号只是归属，不等于自动授权。
2. **活动结束边界**：活动结束只拦截发送邀约和接受邀约；既有已接受邀约可继续确认，既有合作可继续提交、审核和发布。活动结束不自动释放预留、不自动生成发放金额。
3. **预算、发放与金额可见性**：KOL 接受邀约时原子预留，项目方确认时转为锁定；预算不足、名额已满、活动未开始/结束/停用时接受失败。预留超时、拒绝或运营显式取消才释放。`reserved`/`locked` 是后台内部承诺，只有活动结束后管理后台批准 grant，才创建发放账本和 KOL 可见的 `claimableAmount`。
4. **Google Docs**：仅接受公开可读的 Google Docs；后端匿名预检失败时返回 `GOOGLE_DOC_NOT_ACCESSIBLE`，不创建审核轮次或 AI 任务。
5. **地址与身份**：普通资料更新不能覆盖收款地址；接受时固化地址快照；后续改地址不影响已有预留/合作。所有授权以认证中心 token 和数据库关联为准，不信任客户端传入身份或角色。
6. **原型隔离**：localStorage、模拟金额和前端状态机不进入生产事实链路；生产使用 PostgreSQL 事务、唯一约束、审计和 feature flag。

### 14.2 上线前仍需产品确认的事项

1. **实际支付方案（后续阶段）**：本期在后台批准后只记录 `claimableAmount`，领取按钮无操作。接入支付前仍需确定付款主体、币种/链与网络、人工还是自动支付、可信到账回执和失败重试责任；数据模型保留 `currency`，但不能先假设支付渠道。
2. **资金池的业务含义与调整权**：需确认资金池是运营承诺额度还是已实际入金/托管的余额。技术默认只允许增加；减少时不得低于 `reserved + locked + claimable + paid`，必须审计。已发送邀约后不能改币种，项目 X 变更只能归档后新建。
3. **已确认合作的撤销/违约规则**：活动结束后的流程可继续已定；但项目方撤销已确认合作、KOL 违约、人工豁免及是否释放/补偿内部锁定金额仍需明确，不能由运营直接删除记录。
4. **授权撤销后的存量邀约**：技术建议撤销 Agency 授权立即禁止其新建；该 Agency 发出的未确认邀约及预留由运营选择“转交另一管理者”或“取消并释放”，两种操作都需要审计。需确认是否接受这个运营动作。
5. **审核运营规则**：Google Docs 的公开访问策略已确定；仍需确定 AI 模型/版本、审核材料保留期、人工审核 SLA，以及 AI 服务不可用时是阻止提交还是进入待处理队列。
6. **邀约报价是否对 KOL 可见**：当前按“金额仅在后台批准后向 KOL 展示”的要求，KOL 邀约 DTO 不返回 `offerAmount`。若产品希望 KOL 在接受前看到“拟定报价”，需明确它只是不可领取的邀约条款，且不应被误展示为已发放金额。

通知渠道、文案语言和提醒频率不阻塞领域建模，可在前端和通知阶段按产品运营策略补充。

## 15. 建议的首个开发切片

优先做“运营配置 TCC、项目 X 和授权 -> 项目方选择活动并按默认模板发邀约 -> KOL 接受并预留预算 -> 项目方确认锁资 -> 双方查看状态”。这是最小但真实的商业闭环，能先验证权限、地址快照、去重和预算原子性四个最高风险点。AI 审核与支付在该基础稳定后接入，避免在没有可靠合作主记录和账本的情况下先做页面或模拟到账。
