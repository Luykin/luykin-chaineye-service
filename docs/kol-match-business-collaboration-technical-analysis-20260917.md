# KOL Match 定向合作活动技术分析

## 1. 结论与范围

本需求是在已上线的 KOL Match 搜索能力之上，增加一套由「定向合作活动」（Targeted Collaboration Campaign，以下简称 TCC）驱动的定向商务合作闭环：运营预配置活动和授权，项目方或 Agency 从 KOL Match 中选择 KOL 并发送固定价邀约，KOL 表达兴趣后由项目方确认并锁定预算；随后完成草稿 AI 初审、人工审核、正式链接提交及活动结束后的奖励领取。奖励实际支付成功才是合作完成。

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
| KOL | 未受邀时不显示任务模块；受邀后维护商务资料及默认收款地址、查看/拒绝/表达邀约兴趣；在确认后查看完整 Brief；提交 Google Docs 草稿、查看历次意见、提交正式 X 链接、在开放日领取奖励。 |
| 系统 | 对同活动同 KOL 去重；确认合作时原子锁资；保留邀约快照与审核历史；领取和支付幂等；实际到账后才完成。 |

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
  钱包验证 nonce、接口限流、幂等键、AI 审核任务、通知重试、到期和领取开放任务
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
| `BusinessCollaborationActivities` | `id`、`projectId`、`projectTwitterId`、`projectTwitterHandle`、`projectDisplayName`、名称/简介、`fundingPoolAmount`、`lockedAmount`、`claimableAmount`、`paidAmount`、`startAt`、`endAt`、`seatLimit`、`reviewerMode`、`status` | 运营配置的 TCC；绑定项目 X 配置快照，活动自身不存每次邀约的内容要求。 |
| `BusinessCollaborationActivityAccesses` | `activityId`、`authCenterUserId`、`twitterId`、`role(project_manager/agency_manager)`、`status` | 活动范围授权；一个账号可管理多个活动。建议不要只复用全局 `kol-match` 授权，因为资源和角色语义不同。 |
| `XHuntKolCollaborations` 扩展 | 默认收款地址、设置时间、版本、锁定状态 | 继续做 KOL 的商务资料主记录；增加地址后不允许普通 PUT 直接覆盖。 |
| `KolPayoutAddressChangeRequests` | KOL、旧/新地址、X 再验证结果、旧钱包签名证据、状态、人工处理人 | 地址变更审计。新地址与旧地址均保存小写规范值，展示时可保留 checksum 格式。 |
| `BusinessCollaborationInvitations` | `activityId`、`kolTwitterId`、`kolAuthCenterUserId`、`inviterAccessId`、邀约快照、`offerAmount`、`status`、`interestedAt` | 一份发给一位 KOL 的邀约；以 `activityId + kolTwitterId` 保证同活动不重复。 |
| `BusinessCollaborations` | `invitationId`、`activityId`、双方身份快照、`lockedAmount`、`payoutAddressSnapshot`、执行状态 | 只在项目方确认后创建，代表真实的已确认合作。 |
| `BusinessCollaborationReviewRounds` | `collaborationId`、轮次、草稿 URL、AI 状态/结果、人工状态/意见、提交人/审核人 | 每次重提是一轮，AI 通过后才能进入人工审核。 |
| `BusinessCollaborationDeliveries` | `collaborationId`、`draftUrl`、`publishedUrl`、`submittedAt` | P0 只支持一个正式 X 链接；将来多内容可拆为 deliverable item 表。 |
| `BusinessCollaborationBudgetLedger` | `activityId`、`collaborationId`、`type(lock/release/claimable/paid/reversal)`、金额、幂等键 | 预算展示和对账的不可变流水；活动聚合字段只用于快速读取。 |
| `BusinessCollaborationPayouts` | `collaborationId`、金额、地址快照、支付渠道/交易哈希、`status`、幂等键、失败原因 | “点击领取”不是“已付款”；支付确认成功才置 paid。 |
| `BusinessCollaborationAuditLogs` | 资源、动作、前后状态、actor、requestId、metadata | 覆盖授权、邀约、锁资、审核、地址和支付的可追溯性。 |

### 6.3 Admin Web：新增“定向合作活动”Tab

在 Admin Web 新增一级 Tab **定向合作活动**，作为 TCC 的唯一运营入口；不要把它混入 Nacos 公开活动配置页。该 Tab 至少包含：

1. **活动列表**：显示名称、绑定项目 X、状态、起止时间、资金池/已锁定/可领取/已支付金额、名额、已分配管理者与更新时间；支持按项目 X、状态和管理者筛选。
2. **创建与编辑**：必须选择或录入项目 X 配置，并填写名称、简介、资金池与币种、起止时间、名额、审核方、启停状态。项目 X 变更须记录审计；已有邀约后不能直接覆盖历史快照。
3. **活动授权**：按认证中心用户分配 `project_manager` / `agency_manager`，可撤销或暂停授权；授权变更立即影响 API 可见性，且必须留下操作人、原因和时间。
4. **进度与处置**：查看该 TCC 的邀约、已确认合作、审核轮次、逐人金额、账本和审计；运营可执行权限、人工审核和地址异常的受控处理。
5. **删除规则**：从未发送邀约的草稿 TCC 可删除；存在邀约、合作或账本后只允许归档/停用，保留所有历史记录和审计，避免破坏金额对账。

该 Tab 应受独立后台权限（建议 `business_collaboration_manage`）保护。所有写操作要求后台管理员身份和审计日志；前端按钮隐藏不能替代后端权限校验。

### 6.2 必须保存的邀约快照

邀约不得在后续编辑活动或商务资料后改变历史含义。`BusinessCollaborationInvitations` 至少固化：活动/项目展示信息、内容形式、内容数量、内容语言、完整 Brief、邀约信息、固定报价和币种、KOL 名称/handle/Twitter ID、报价来源（KOL 资料或人工输入）、发送时的活动时间和审核方。项目方确认后，再把实际使用的收款地址复制到 `BusinessCollaborations.payoutAddressSnapshot`。

## 7. 状态机与强约束

### 7.1 活动可报名状态

```text
scheduled -> open -> closed
                    \-> execution_only
```

- `scheduled`：未到开始时间，不能邀约或确认。
- `open`：在起止时间内、活动启用、可用预算大于零且未满名额；可邀约和确认。
- `closed`：到期、预算用尽、名额用尽或运营停用；停止新邀约与新确认。
- `execution_only` 不是独立存储状态，而是对已确认合作的行为结果：即使活动关闭，草稿、审核、发布、领取仍继续。

### 7.2 邀约与合作状态

```text
draft -> sent -> interested -> confirmed -> executing
                  |              |             |
                  +-> kol_declined              +-> draft_submitted
                  +-> project_declined                         -> ai_rejected
                  +-> expired                                    -> human_review
                                                            -> human_changes
                                                            -> approved_for_publish
                                                            -> published_submitted
                                                            -> claimable
                                                            -> payout_processing
                                                            -> paid_completed
```

实现时应区分“邀约状态”和“合作执行状态”：

- `sent/interested/kol_declined/project_declined/expired` 是邀约处理，不占预算。
- `confirmed` 是事务成功、名额与预算已锁定且地址已快照的结果。
- 草稿重提后的 `ai_rejected`、`human_changes` 不是终态，必须回到同一合作并新增审核轮次。
- `published_submitted` 不等于可领取；只有活动结束时间到达、审核通过、正式链接和有效地址齐全，才转换为 `claimable`。
- `payout_processing` 和 `paid_completed` 是支付渠道接入后的后续状态；本期不进入这两个状态。任何未来重试均按幂等键处理，绝不重复支付。

### 7.3 确认合作的原子事务

确认 API 必须在一个 PostgreSQL 事务内执行，并对活动行使用 `SELECT ... FOR UPDATE` 或等效 Sequelize 行锁：

1. 校验调用人拥有该活动的有效项目方/Agency 管理权限。
2. 锁定活动行，重新计算活动是否仍可确认、可用预算、已确认名额。
3. 锁定邀约行，要求状态是 `interested` 且尚未生成合作。
4. 校验 KOL 地址仍有效；把地址写入合作快照。
5. 创建合作、写一条 `lock` 账本、原子增加 `lockedAmount`、更新邀约为 `confirmed`。
6. 写审计和 outbox 通知事件后提交。

禁止仅依赖前端余额、Redis 锁或“先查再写”。活动预算不足、重复确认、并发确认时应返回可识别的业务错误而不是 500。

## 8. API 设计草案

以下为资源型接口，不是最终 URL 契约；所有写接口都需要认证、角色校验、请求 ID 和 `Idempotency-Key`。

| API | 调用方 | 核心行为 |
| --- | --- | --- |
| `GET /business-collaboration/activities/available` | 项目方/Agency | 仅返回当前账号被明确授权、且可用于发邀约的 TCC；无授权时返回空数组，不泄露其他项目活动。 |
| `POST /business-collaboration/invitations` | 项目方/Agency | 批量创建邀约；每位 KOL 独立金额和快照，任何无效项应返回逐项错误或采用显式 all-or-nothing 策略。 |
| `GET /business-collaboration/activities/:id` | 项目方/Agency/运营 | 返回活动预算、候选人、邀约、合作、已提交内容；按角色脱敏。 |
| `POST /business-collaboration/invitations/:id/interest` | KOL | 校验邀请归属与当前默认地址；将地址快照写入邀约，状态改为 `interested`。 |
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
| 表达兴趣/拒绝/提交内容/领取 | 仅邀约或合作归属本人 | 不可代替 KOL | 异常处理时可代操作并审计 |
| 确认合作/锁资/项目方人工审核 | 不可 | 仅该活动授权且审核方为项目方 | 可按治理权限处理 |
| EchoHunt 人工审核 | 不可 | 仅查看结果 | 仅审核方为 EchoHunt 的活动 |
| 创建活动、分配授权、人工改地址、付款处理 | 不可 | 不可 | 仅后台权限允许的运营角色 |

不能依据前端当前页面、URL 参数、项目 X handle 或客户端传来的 `role` 决定权限。后端以 token 中的认证中心用户和活动授权记录为准；访问活动详情也要做同样的 resource-level 校验。项目 X 仅是 TCC 的归属配置，不等于对该项目 X 的任何登录者自动授权。

## 10. 审核、领取与支付设计

### 10.0 已确认的一期边界（2026-09-18）

以下约定已由产品确认，优先级高于本文先前的开放问题：

1. 后端必须记录每位 KOL 在每个已确认合作中的金额；金额不能只存在邀约表单、前端状态或支付备注中。
2. 领取最早只能在活动 `endAt` 到达后开放；不再额外默认等待七天。活动未结束时，无论预算是否充足、稿件是否审核通过，均不得领取。
3. 真正的领取链路将采用“EVM 钱包验证在前、X 身份认证在后”的顺序，但本期不接入钱包签名、X 重认证、链上合约或付款渠道。前端保留领取入口，点击处理函数明确标注 `TODO` 且不发起请求；后端也不得把该操作误记为领取成功、付款处理中或已付款。
4. Google Docs 草稿在发起 AI 审核前必须由后端进行匿名可读性预检。不可读取时，前端显示后端返回的明确错误并提示 KOL 将文件共享为“持有链接的任何人可查看”；不把访问失败伪装成 AI 审核失败。

金额采用 `NUMERIC(20, 2)` 加显式币种存储。确认合作时把 `offerAmount` 写入合作快照及不可变 `lock` 账本；满足“活动已结束、人工审核通过、正式 X 链接已提交、地址快照有效”后，在一个事务内将该笔金额写入 `claimableAmount` 和 `claimable` 账本。活动汇总的 `lockedAmount`、`claimableAmount`、`paidAmount` 只是读性能用聚合，逐人合作记录和账本才是对账事实来源。

一期暂不创建真实 payout，也不允许运营或前端手工把合作置为 `paid_completed`。待支付渠道、网络、验签和到账回执确定后，再用幂等 payout 请求承接该状态转换。

### 10.1 AI 与人工审核

AI 审核应异步化：草稿 URL 入库前，服务端仅接受规范化后的 `https://docs.google.com/document/d/:id/...` 地址，并以固定 Google Docs 导出地址做一次匿名可读性预检（短超时、仅允许 Google Docs 域名、禁止跟随至非 allowlist 域名，以避免 SSRF）。预检返回 401/403、登录页、无法导出或超时时，接口返回 `GOOGLE_DOC_NOT_ACCESSIBLE` 和可展示文案“无法访问该 Google Docs，请将文件权限调整为‘持有链接的任何人可查看’后重试”。不得保存为可审核草稿，也不得投递 AI 任务。

预检通过后才创建 `pending` review round，再向队列投递任务。任务读取本轮 Brief、必须表达信息和图文要求，返回结构化结果：`pass/fail`、问题列表、摘要、模型版本、输入引用及耗时。失败时只更新本轮为 `ai_rejected`；不得让人工端绕过失败直接通过。Google 访问预检只证明匿名读取可用，不代替内容审核，也不保存 Google 登录凭证或文档全文。

AI 通过后，根据活动 `reviewerMode` 进入项目方审核队列或 EchoHunt 运营审核队列。人工退回必须有原因，KOL 重提时总是创建新轮并再次 AI 初审。双方都能读到历史，但只有具有审核权限的人能作出决定。

### 10.2 领取与真实支付

领取开放条件应由服务端计算：`now >= activity.endAt`、人工已通过、正式链接存在、合作地址快照有效、尚未 paid。预算提前耗尽不能提前开放领取。条件首次成立时，服务端在事务中写入 KOL 对应的 `claimableAmount`；重复计算必须按合作 ID 幂等，不能重复累计活动的可领取汇总。

本期领取按钮是无副作用占位入口，代码需保留 `TODO(payment-claim)`，不得调用 claim API。后续支付需要先确认一种正式渠道：运营手工转账录入、托管支付 API，或链上合约；届时再实现“EVM 钱包验证 -> X 身份认证 -> 创建/复用幂等 payout 请求”。收到可信支付回执/链上确认后才将 payout 和合作更新为 `paid_completed`，同时写 `paid` 账本。若采用人工付款，后台必须要求交易哈希或凭证、经办人和时间，且与合作/地址快照绑定。

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
5. KOL 商务资料页补充默认 EVM 地址与变更流程。表达兴趣缺少有效地址时，跳转设置后带回原邀约；已确认合作展示地址快照而非可编辑的当前默认地址。
6. 活动详情以列表展示邀约、待确认、执行进度、审核、已提交内容和预算；按角色展示操作按钮。
7. 草稿提交失败并收到 `GOOGLE_DOC_NOT_ACCESSIBLE` 时，原地显示“无法访问该 Google Docs，请将文件权限调整为‘持有链接的任何人可查看’后重试”；不创建审核记录。领取入口本期仅保留视觉占位和 `TODO(payment-claim)` 无操作处理。

前端新增组件应与现有大体量 `KolMatchPage` 分离，例如 `components/business-collaboration/`。不要把活动状态机、预算计算或权限判断放在 `KolMatchPage.tsx`；它已有搜索和流式匹配的复杂状态，继续堆叠会显著提高回归风险。

## 12. 分阶段实施步骤

### 阶段 0：确认不可自行假设的业务决策

1. ~~确认资金的真实支付渠道、币种/网络、付款发起人与到账确认来源。~~ 本期明确不执行支付；只落库逐人可领取金额和账本，领取入口为 TODO 占位。
2. 确认报价是否仅有 USD/USDT，活动币种是否固定，以及汇率是否允许存在。
3. 确认名额满时的规则、活动被运营暂停后的已锁资金处理、项目方撤销合作是否允许及退款策略。
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
5. 实现 KOL 邀约列表与表达兴趣/拒绝接口；表达兴趣时固化地址快照。

验收：发送邀约不扣预算；同活动同 KOL 不能重复发送；后续邀约不会覆盖历史内容要求。

### 阶段 3：确认合作和预算

1. 实现项目方确认/不合作 API 和事务级锁资。
2. 实现账本、活动预算聚合、名额校验、并发重复确认防护和失败错误码。
3. 实现项目方“我的活动”与活动详情，显示可用、已锁定、可领取和已支付金额。
4. 实现 KOL “商务合作”的邀约/进行中/已完成视图和只读 Brief。

验收：两个项目方并发确认同一活动时绝不超额锁资；活动关闭后不能新增邀约或确认，但已确认合作仍可执行。

### 阶段 4：审核和交付

1. 接入草稿 URL 提交、审核轮次、AI 审核队列和结构化 AI 结果。
2. 实现根据 `reviewerMode` 路由的人工审核队列与通过/退回操作。
3. 实现审核历史、项目方/运营已提交内容入口、正式 X 链接提交和状态限制。
4. 增加通知：邀约、兴趣、确认、AI 结果、人工结果、领取开放和支付结果。

验收：AI 失败不能进入人工审核或正式链接提交；人工退回后的重新提交必经新的 AI 初审；历史意见可回溯。

### 阶段 5：领取资格与后续支付、运营收口

1. 本期实现服务端领取资格计算、逐人 `claimableAmount` 及领取页面倒计时/开放时间；领取点击保留无操作 TODO。
2. 在支付渠道确定后，接入确认后的支付渠道或后台人工付款流程，落实幂等、回执/交易哈希和失败重试。
3. 在支付渠道接入后，实现到账后的合作完成、预算已支付更新、运营异常工作台。
4. 加入到期扫描、领取开放扫描；支付接入后再增加失败支付告警和对账报表。

验收（本期）：活动结束前不能进入可领取状态；每位 KOL 的可领取金额只记一次，领取点击不改变任何状态。验收（支付接入后）：同一合作重复点击只产生一笔 payout；只有可靠支付成功回执使合作完成。

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
| KOL 暂停接单或没有有效地址 | 不可邀约或不可表达兴趣；页面给出设置引导。 |
| 邀约金额为 99.99 | 前后端均拒绝发送。 |
| 两个确认请求同时竞争最后 100 USDT | 至多一个成功锁资，另一个得到预算不足。 |
| 到期或预算用尽后发送/确认 | 拒绝；既有合作仍可提交和审核。 |
| AI 初审失败后人工点击通过 | 服务端拒绝该状态跃迁。 |
| 人工退回后重提草稿 | 创建新轮，重新走 AI 再到人工。 |
| 同一合作重复领取/支付回调重复 | 只创建或确认一笔支付，不重复记账。 |
| 默认地址在表达兴趣后变更 | 旧合作地址快照不变化；未付款合作的活动级变更按已确认流程处理。 |
| 已支付合作修改地址 | 拒绝对历史付款快照的修改，并留审计记录。 |

## 14. 风险与待确认项

1. **支付定义未定**：PRD 规定“到账才完成”，但没有定义谁付款、通过何种通道、如何确认到账。这个问题不能用前端“领取成功”文案替代。
2. **Google Docs 审核可访问性**：仅保存 URL 时，AI 未必有读取权限。需要决定 OAuth 授权、共享权限要求，或仅由 KOL 提交内容文本/导出文件。
3. **地址变更安全性**：普通资料 PUT 不能覆盖地址；必须有短期 nonce、签名用途绑定、一次性消费、审计和人工例外路径。
4. **身份覆盖问题**：搜索画像以 Twitter ID 为中心，但 KOL 未必已注册 EchoHunt。邀约应先以 Twitter ID 作为收件人稳定键，登录后再绑定 `authCenterUserId`，不要以空用户 ID 阻塞邀约。
5. **数据一致性**：`XHuntKolCollaborations` 同步到 `dev.kol_marketing_profile` 是跨库非原子操作，适合搜索展示，不可作为合作、预算或支付的真实来源。
6. **原型与生产差异**：原型的 Web Lock/localStorage 能演示并发和流程，但生产必须使用 PostgreSQL 事务、唯一索引、审计和后端权限。

## 15. 建议的首个开发切片

优先做“运营配置活动和授权 -> 项目方发邀约 -> KOL 表达兴趣 -> 项目方确认锁资 -> 双方查看状态”。这是最小但真实的商业闭环，能先验证权限、地址快照、去重和预算原子性四个最高风险点。AI 审核与支付在该基础稳定后接入，避免在没有可靠合作主记录和账本的情况下先做页面或模拟到账。
