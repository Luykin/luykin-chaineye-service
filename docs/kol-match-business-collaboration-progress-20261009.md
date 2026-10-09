# KOL Match 定向合作活动（TCC）实施进度核对

> 核对日期：2026-10-09
> 依据文档：`docs/kol-match-business-collaboration-technical-analysis-20260917.md`（下称「技术文档」）
> 核对范围：后端 `luykin-chaineye-service`（含 admin-web）、前端 `XHunt.website/apps/echohunt`
> 说明：技术文档第 12 节自带一份截至 2026-09-18 的进度记录；本文档是对当前代码的实测核对。结论：**2026-09-18 之后仅有小幅代码优化（最后一次实质提交 2026-09-29），没有新阶段推进。当前整体处于「阶段 1-3 已完成，阶段 4-6 未开始」的状态。**

## 1. 总体进度一览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 阶段 1 | 领域底座（表/模型）+ Admin 活动配置与授权 | 已完成（少量缺项，见 §4.3） |
| 阶段 2 | 商务资料扩展 + 项目方邀约 | 已完成 |
| 阶段 3 | KOL 接受/拒绝 + 项目方确认锁资 + 预算 | 已完成（预留到期缺定时扫描） |
| 阶段 4 | 审核与交付（草稿、AI 审核、人工审核、正式链接、通知） | 未开始（前后端均为 0） |
| 阶段 5 | 发放审核（grant）、可领取金额、领取入口 | 未开始（仅有预留字段） |
| 阶段 6 | 测试、灰度、监控 | 未开始 |

核心商业闭环「运营配置 TCC → 授权 → 项目方发邀约 → KOL 接受预留 → 项目方确认锁资 → 双方查看状态」已全链路可用；确认之后的「交付 → 审核 → 发放 → 领取」完全未实现。

## 2. 后端进度（luykin-chaineye-service）

### 2.1 已实现

**数据底座**（迁移全部在 2026-09-18，之后无新增）：

- `migrations-pg/20260918110000-create-business-collaboration-activities.js`：`BusinessCollaborationActivities` + `BusinessCollaborationActivityAccesses`
- `migrations-pg/20260918120000-create-business-collaboration-workflow.js`：`BusinessCollaborationInvitations`、`BusinessCollaborations`、`BusinessCollaborationBudgetLedgers`、`BusinessCollaborationAuditLogs`，并给 `XHuntKolCollaborations` 增加 `defaultPayoutAddress / payoutAddressUpdatedAt / payoutAddressVerifiedAt / payoutAddressVersion`
- `migrations-pg/20260918130000-add-project-media-to-business-collaboration-activities.js`：活动头像/banner
- 对应 Sequelize 模型在 `src/xhunt/models/`，关联在 `src/models/postgres/associations/business-collaboration.js`

**用户端 API**（`src/xhunt/api/business-collaboration.js`，挂载于 `src/xhunt/api/echohunt.js:83`）：

| 端点 | 说明 |
| --- | --- |
| `GET /activities/available` | 可管理且招募中的 TCC |
| `GET /me` | 我的管理活动 + KOL 任务 |
| `GET /activities/:activityId` | 活动详情（含邀约） |
| `POST /invitations` | 批量发邀约（1-100 人、幂等、最低报价、暂停接单校验） |
| `POST /invitations/:id/accept` | KOL 接受，事务内原子预留预算/名额 + `reserve` 账本 |
| `POST /invitations/:id/decline` | KOL 拒绝 |
| `POST /invitations/:id/confirm` | 项目方确认，预留转锁定 + 创建合作 + `lock` 账本；超时惰性转 `reservation_expired` + `release` |
| `POST /invitations/:id/decline-by-project` | 项目方取消邀约并释放预留 |
| `GET /me/payout-address` + `POST .../change/challenge` + `POST .../change/verify` | 收款地址 SIWE 风格验证：新地址签名、变更时旧地址二次签名、版本号自增 |

关键强约束已落地：`activityId + kolTwitterId` 去重、活动行锁串行化、金额 BigInt 分单位精确计算、Idempotency-Key、KOL DTO 不返回内部报价/预留金额、审计日志写入。

**Admin API**（`src/admin/api/business-collaboration.js`，挂载于 `src/apiServer/routes/admin.js:36`，全程 `requirePermission("business_collaboration_manage")`）：

- 活动 CRUD：`GET/POST /activities`、`GET/PATCH/DELETE /activities/:id`（仅无承诺 draft 可删）
- `GET /activities/:id/overview`（邀约/资金概览）
- 授权管理：`GET/POST /activities/:id/accesses`、`PATCH .../accesses/:accessId`（active/paused/revoked）
- 辅助：`GET /project-account`、`GET /internal-test-users`

### 2.2 部分实现 / 与设计有出入

- **预留到期释放**：只在项目方调用 `confirm` 时惰性触发，**没有后台定时扫描任务**主动释放过期预留（技术文档 §7.3 明确要求定时任务）。
- **审计日志**：写入完整，但 admin 侧**没有审计查询接口**。
- **地址变更审计**：用 `payoutAddressVersion` + `BusinessCollaborationAuditLogs`（`payout_address_verified`）实现，未建技术文档设计的 `KolPayoutAddressChangeRequests` 表；旧地址无法签名时的运营人工审批流程未实现。
- **活动表已预留** `claimableAmount` / `paidAmount` 字段，账本 type 已有 reserve/lock/release，但 grant/paid 无任何写入路径。
- 服务层未按技术文档建议拆分为独立模块，业务逻辑集中在两个路由文件（用户侧 982 行、admin 侧 535 行），`src/xhunt/business-collaboration/` 下目前只有 `money.js` 金额工具。

### 2.3 未实现

| 缺项 | 对应技术文档章节 |
| --- | --- |
| `BusinessCollaborationReviewRounds` / `Deliveries` / `Grants` / `Payouts` 四张表及模型 | §6.1 |
| 草稿 Google Docs 提交、匿名可读性预检（`GOOGLE_DOC_NOT_ACCESSIBLE`） | §10.1 |
| AI 审核队列/任务、结构化结果 | §10.1 |
| 人工审核（`human-decision`）、按 `reviewerMode` 分流 | §10.1 |
| 正式 X 链接提交（`published-link`） | §7.2 |
| 批量发放审核、唯一 grant、`claimableAmount` 写入 | §10.2 |
| 领取后端支撑（本期仅要求不暴露 claim、前端 TODO 占位） | §10.0 |
| 定时任务：预留到期扫描、活动结束待发放提醒 | §7.3、阶段 5 |
| 通知（邀约/接受/确认/审核结果等事件） | 阶段 4 |
| 异常处理/运营代操作端点 | §9 |
| 该领域全部测试（单元/集成/并发） | 阶段 6 |

## 3. Admin Web 进度（admin-web/）

### 3.1 已实现

- **一级 Tab「定向合作活动」**：导航 `src/config/admin-navigation.tsx:44`、路由 `src/app/router.tsx`、权限 gate `PermissionGuard` + 管理员权限分配项（`AdminUsersPage.tsx:61`），前后端权限链路完整。
- **活动列表**：按项目 X 账号分组，含状态、资金进度（可用/预留/锁定/待领取/已付）、邀约漏斗、确认进度、授权人数。
- **新建/编辑 Modal**：名称/说明、项目 X 账号查询带出快照（twitterId/handle/displayName/avatar/banner）、资金池/币种/名额/起止时间/审核方/状态、初始项目方多选、邀约默认模板（标题/内容形式/说明/Brief/数量/语言/最低报价/确认时限/必须表达事项）。
- **删除**：Popconfirm + 后端规则校验（仅无承诺 draft）。
- **授权管理**：按内部测试人员分配 `project_manager`/`agency_manager`，支持撤销。
- **数据概览 Modal**：资金汇总、确认进度、KOL 邀约明细表（只读）。

相关文件：`admin-web/src/pages/BusinessCollaborationPage.tsx`、`admin-web/src/services/business-collaboration.ts`。

### 3.2 部分实现

- 授权的「暂停/恢复」：后端 PATCH 支持 `paused`，前端 UI 只有「撤销」。
- 删除/归档：无「有承诺活动自动降级为归档」的引导，归档需手动把状态编辑为 archived。

### 3.3 未实现

进度与处置整块缺失：邀约操作（代发/调整）、合作与审核轮次管理、逐人金额明细页、账本查询、审计查询、人工审核操作、批量发放审核操作。概览页文案已自述「当前系统尚未保存 KOL 内容发布/交付的独立完成状态」。

## 4. EchoHunt 前端进度（XHunt.website/apps/echohunt）

### 4.1 已实现

- **KOL Match 邀约入口**：`components/kol-match/KolMatchPage.tsx` 拉取可管理 TCC 并按项目过滤；`ResultTable.tsx` 多选勾选列（暂停接单 KOL 禁选）；`components/business-collaboration/InvitationBasket.tsx` 候选选择篮。
- **邀约弹窗** `InvitationComposer.tsx`（Ant Design Modal）：活动模板带入、`allowedOverrideFields` 控制可改字段、逐人金额、低于最低报价（默认 100 USD）即时报错、批量报价、席位×2/资金池×2 预校验、Idempotency-Key。
- **账户页** `components/account/AccountView.tsx` + `components/business-collaboration/BusinessCollaborationHub.tsx`：
  - KOL 视图：邀约列表（进行中/历史分组）、接受/拒绝、缺地址时跳转地址设置；未受邀不显示任务模块。
  - 项目方视图：活动列表、预算/名额指标、邀约明细、确认合作按钮。
- **EVM 收款地址** `PayoutAddressCard.tsx`：challenge → `personal_sign` → verify 全流程，变更时旧地址二次签名。
- **不泄露**：无授权时邀约 UI 整体不渲染，不显示任何活动名称/预算。

### 4.2 部分实现 / 与需求有出入

- **「不合作」按钮缺失**：API 封装 `declineBusinessCollaborationInvitationByProject` 已存在，但管理表格 UI 无调用入口。
- **无授权提示文案缺失**：需求要求显示「暂无可管理的定向合作活动，请联系项目运营分配权限」，当前是选择篮静默消失，无提示。
- **邀约抽屉形态**：实现为 Modal（1040px），技术文档/原型描述为抽屉（Drawer），如产品坚持需调整。
- **KOL 任务无交付动作**：进行中任务只有状态 Tag，无草稿提交/审核/正式链接入口；已完成仅作历史展示。

### 4.3 未实现

- Google Docs 草稿提交及 `GOOGLE_DOC_NOT_ACCESSIBLE` 错误提示（无组件、无 API 封装）。
- 审核历史查看。
- 正式 X 链接提交。
- 领取入口——包括本期要求的 TODO 占位按钮也未做（现有 `claim*` 文案均属旧 campaign 业务，与 TCC 无关）。

## 5. 关键差距与建议的下一步

按技术文档分阶段计划，剩余工作自然分为两块：

1. **阶段 4：审核与交付（当前最大缺口）**
   - 后端：ReviewRounds/Deliveries 迁移与模型、草稿提交 + Google Docs 匿名预检、AI 审核队列、人工审核分流、正式链接提交、通知事件。
   - 前端：KOL 任务详情（草稿提交、审核历史、正式链接）、错误文案；admin-web 人工审核操作界面。
2. **阶段 5：发放与领取（本期只做 grant，不做支付）**
   - 后端：Grants 表、活动结束后批量发放审核端点、`claimableAmount` 写入、账本 `grant` 类型。
   - admin-web：批量发放审核操作（逐条批准/拒绝、调整金额必填原因）。
   - 前端：KOL 可见可领取金额 + 领取按钮 TODO(payment-claim) 占位。
3. **低成本补漏（可随下个迭代顺带做）**：
   - 预留到期后台扫描 job（§2.2）。
   - 前端「不合作」按钮、KOL Match 无授权提示文案（§4.2）。
   - admin 审计查询接口与页面、授权暂停/恢复 UI。
4. **阶段 6 质量保障**：状态机/预算计算/幂等/权限的单元与并发测试、feature flag 灰度、预算不变量监控——目前该领域测试为 0。

上线前仍需产品确认的事项维持技术文档 §14.2 不变：支付方案、资金池业务含义、已确认合作撤销/违约规则、授权撤销后存量邀约处置、AI 审核运营规则、邀约报价是否对 KOL 可见。
