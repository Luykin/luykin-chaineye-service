# KOL Match 定向合作活动（TCC）实施进度核对

> 核对日期：2026-10-10（取代 2026-10-09 版）
> 依据文档：`docs/kol-match-business-collaboration-technical-analysis-20260917.md`（下称「技术文档」）
> 核对范围：后端 `luykin-chaineye-service`（含 admin-web）、前端 `XHunt.website/apps/echohunt`
> 结论：**阶段 1-4 已完成（阶段 4 于 2026-10-10 收尾，迁移待 DB 可达后执行、端到端联调待进行），阶段 5-6 未开始。**

## 1. 总体进度一览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 阶段 1 | 领域底座（表/模型）+ Admin 活动配置与授权 | 已完成 |
| 阶段 2 | 商务资料扩展 + 项目方邀约 | 已完成 |
| 阶段 3 | KOL 接受/拒绝 + 项目方确认锁资 + 预算 | 已完成（预留到期缺定时扫描） |
| 阶段 4 | 审核与交付（草稿、AI 审核、人工审核、正式链接、通知） | 已完成（2026-10-10 收尾，迁移未执行、待联调） |
| 阶段 5 | 发放审核（grant）、可领取金额、领取入口 | 未开始（仅有预留字段） |
| 阶段 6 | 测试、灰度、监控 | 未开始 |

## 2. 2026-10-09 核对后的新变更

### 2.1 后端（luykin-chaineye-service）

- `4ad5b715`：KOL 邀约 DTO 现在返回 `offerAmount`/`currency` 作为「拟定报价」（2026-10-09 产品确认，已记入技术文档 §14.2.6）。前端必须明确它只是不可领取的邀约条款，不得展示为已发放金额。
- `362e6d61`：`serializeKolInvitation` 移除按 `confirmed` 状态的门禁，`brief` 与 `requiredPoints` 全状态返回——邀约条款是 KOL 接受前必须知晓的信息。

### 2.2 前端（XHunt.website/apps/echohunt）

- `8691aab`：邀约选择篮重构为固定悬浮条（毛玻璃、进场动画），候选项改为可单独移除的 KOL chips（头像 + 名称），含 `+N` 溢出徽标。
- `d460394`：KOL 邀约列表重构为独立 `KolInvitationCard`（项目头像、报价、内容形式/语言/必须表达点摘要）；新增 `InvitationRequirementsModal` 展示完整邀约详情并可在弹窗内接受/拒绝；新增一组 `invitationSnapshot` 兜底取值函数防止详情缺失时 UI 空白。
- `321d95f`：账户页邀约 Tab 待处理角标改为悬浮红点；嵌入模式合作表单紧凑布局；`LoadingPanel` 支持 embedded 变体。

### 2.3 进度口径修订

- 上一版 §4.2「KOL DTO 不返回内部报价」的表述已过时：按产品决定，`offerAmount` 作为拟定报价对 KOL 可见（仍不返回预留/锁定等内部预算聚合）。
- 技术文档 §14.2.6「邀约报价是否对 KOL 可见」已确认，不再属于待确认项。

### 2.4 2026-10-10 阶段 4 落地清单（本轮新增）

#### 后端（luykin-chaineye-service，未提交）

- 迁移 `migrations-pg/20261010100000-create-business-collaboration-review.js`：新建 `BusinessCollaborationReviewRounds`（轮次、AI/人工状态、幂等键）与 `BusinessCollaborationDeliveries`（每合作一条，草稿/正式链接）。
- 模型与注册：`src/xhunt/models/BusinessCollaborationReviewRound.js`、`BusinessCollaborationDelivery.js`，已挂入 `src/models/postgres/registry.js` 与关联 `associations/business-collaboration.js`。
- `src/xhunt/business-collaboration/google-doc.js`：Google Docs 链接规范化（支持多账号 `/u/:n/` 路径）+ 匿名导出预检（限制跟随重定向至 `*.googleusercontent.com` 与 `docs.google.com` 域名，防 SSRF 同时兼容 Google 导出 307 重定向）。
- `src/xhunt/business-collaboration/ai-review.js`：复用 `src/lib/llm` structuredChat 的 AI 初审，fire-and-forget；失败/异常落 `error` 状态允许重提，并写审计日志。
- 用户端 API（`src/xhunt/api/business-collaboration.js`）：`POST /collaborations/:id/drafts`（预检不过返回 `GOOGLE_DOC_NOT_ACCESSIBLE`，增加超时 10 分钟卡 pending 允许重新提交草稿防卡死）、`GET /collaborations/:id/reviews`（项目方授权或 KOL 本人可见）、`POST /review-rounds/:id/human-decision`（reviewerMode=project）、`POST /collaborations/:id/published-link`（X 链接格式校验 + 幂等）。
- Admin API（`src/admin/api/business-collaboration.js`）：`GET /review-rounds`（reviewerMode=echohunt 队列）、`POST /review-rounds/:id/human-decision`（消除 PostgreSQL outer join lock 隐患并补全决策返回的 invitation snapshot）、`GET /audit-logs` 审计查询。

#### admin-web（未提交）

- `BusinessCollaborationPage.tsx` 新增「审核队列」弹窗：AI 初审结果、草稿链接、Brief 摘要，支持通过/退回（退回必填意见）。
- `services/business-collaboration.ts`：审核结论请求添加自动生成幂等键，避免管理员双击或网络重试导致非预期重放。

#### 前端（XHunt.website/apps/echohunt，未提交）

- `CollaborationReviewModal.tsx` 新组件：KOL 模式（提交草稿、审核历史、正式链接提交、`GOOGLE_DOC_NOT_ACCESSIBLE` 原地报错）与项目方审核模式（通过/退回）。
- `BusinessCollaborationHub.tsx`：KOL 卡片「交付」入口、项目方邀约表格「审核交付」入口；**本轮补**：项目方「不合作」按钮（sent/accepted 状态，必填原因弹窗，调用 decline-by-project）。
- `KolMatchPage.tsx`：**本轮补** AI 结果页无授权提示「暂无可管理的定向合作活动，请联系项目运营分配权限」（i18n key `kolMatch.invitation.noAccess`，登录且已校验项目账号、活动列表加载完成后仍无匹配授权时展示）。

#### 验证状态

- 后端 7 个改动/新增文件 `node --check` 通过；admin-web `tsc -b` 与 echohunt `tsc --noEmit` 通过。
- `20261010100000` 迁移**未执行**：`config-pg.json` 指向的 150.5.158.179 当前连接失败，待 DB 可达后运行 `yarn db:migrate:pg`。
- 端到端联调（草稿提交 → AI 初审 → 人工审核 → 正式链接）尚未进行。

#### 2026-10-10 复核修正记录

- Google Docs 导出改为手动跟随重定向（最多 3 跳、逐跳校验 https + Google 域名白名单），并支持 `/document/u/:n/d/:id` 多账号链接——解决公开文档被 307 误判不可访问的问题。注意白名单实际含全部 `*.google.com`，比「仅 googleusercontent」略宽（均为 Google 域，风险可接受）。
- Admin 人工决策接口改为两阶段查询（无锁读关联 → 主键加锁），规避 PostgreSQL `FOR UPDATE cannot be applied to the nullable side of an outer join`。
- **修正**：原实现用 `round.collaboration = initial.collaboration` 普通属性赋值补关联，经实测该赋值不进 `toJSON()`，且嵌套 invitation/activity 同样序列化不到——决策接口返回的邀约元数据仍为空。已改为幂等重放直接返回带完整关联的 `initial`、非重放决策后按主键重取带关联记录。
- **修正**：`ai-review.js` 写结果前复核轮次仍为 `processing`，丢弃被「卡顿兜底」重提后的过期 AI 结果，避免覆盖新一轮流程状态。
- 草稿提交新增卡顿兜底：上一轮 AI 卡在 pending/processing 超 10 分钟时允许重提并自动标记旧轮次 error。
- admin-web 决策请求自动生成 idempotencyKey（注意：每次调用生成新键，双击防护实际依赖后端 409 与按钮 loading 态）。

## 3. 后端现状（截至本次核对）

### 3.1 已实现（无变化部分，详见 2026-09-18 以来记录）

- 数据底座：`BusinessCollaborationActivities/Accesses/Invitations/Collaborations/BudgetLedgers/AuditLogs` + `XHuntKolCollaborations` 地址字段扩展。
- 用户端 API（`src/xhunt/api/business-collaboration.js`，挂载 `src/xhunt/api/echohunt.js:83`）：可管理活动、`/me`、活动详情、批量邀约、接受（原子预留 + reserve 账本）、拒绝、确认（预留转锁定 + lock 账本 + 超时惰性释放）、项目方取消、收款地址 SIWE 风格验证。
- Admin API（`src/admin/api/business-collaboration.js`）：活动 CRUD、概览、授权管理、项目账号查询、内部测试用户。

### 3.2 仍存在的部分实现 / 缺项

- 预留到期释放仍只有 confirm 时的惰性触发，无后台定时扫描。
- ~~审计日志仍无 admin 查询接口。~~ 已补 `GET /api/admin/business-collaboration/audit-logs`（2026-10-10）。
- `claimableAmount`/`paidAmount` 与账本 `grant`/`paid` 类型仍无写入路径。
- 服务层仍集中在两个路由文件，`src/xhunt/business-collaboration/` 只有 `money.js`（阶段 4 将新增 google-doc 预检与 AI 审核模块）。

### 3.3 未实现

| 缺项 | 对应技术文档章节 | 状态 |
| --- | --- | --- |
| `BusinessCollaborationReviewRounds` / `Deliveries` 表及模型 | §6.1 | 已完成（迁移待执行） |
| 草稿 Google Docs 提交 + 匿名可读性预检（`GOOGLE_DOC_NOT_ACCESSIBLE`） | §10.1 | 已完成 |
| AI 审核（结构化结果，异步任务） | §10.1 | 已完成（`ai-review.js`，复用 structuredChat） |
| 人工审核、按 `reviewerMode` 分流 | §10.1 | 已完成（用户端 project 模式 + admin 端 echohunt 模式） |
| 正式 X 链接提交 | §7.2 | 已完成 |
| `Grants`/`Payouts` 表、批量发放审核、`claimableAmount` 写入 | §10.2 | 阶段 5 |
| 领取入口（前端 TODO(payment-claim) 占位） | §10.0 | 阶段 5 |
| 定时任务：预留到期扫描、活动结束待发放提醒 | §7.3、阶段 5 | 阶段 5 顺带 |
| 通知事件 | 阶段 4 | 已落审计日志，通知渠道待产品确认 |
| 异常处理/运营代操作端点 | §9 | 阶段 5-6 |
| 测试（单元/集成/并发） | 阶段 6 | 阶段 6 |

## 4. Admin Web 现状

已实现：一级 Tab、活动列表（资金进度/邀约漏斗）、新建/编辑/删除、授权管理（含撤销）、数据概览、**EchoHunt 人工审核队列与操作界面（2026-10-10 补）**。
仍缺：授权暂停/恢复 UI、邀约代操作、逐人金额明细、账本/审计查询 UI（API 已有）、批量发放审核（阶段 5）。

## 5. EchoHunt 前端现状

已实现：KOL Match 邀约入口与悬浮选择篮、邀约弹窗、账户页 KOL/项目方双视图、收款地址验证全流程、邀约卡片与要求详情弹窗、**KOL 任务交付（草稿提交/审核历史/正式链接，`CollaborationReviewModal`）、项目方人工审核操作、「不合作」按钮、KOL Match 结果页无授权提示（2026-10-10 补）**。
仍缺：领取入口占位（阶段 5）。

## 6. 阶段 4 研发范围完成度（2026-10-10 收尾核对）

1. 后端迁移与模型：`BusinessCollaborationReviewRounds`、`BusinessCollaborationDeliveries` —— 已完成，迁移文件待 DB 可达后执行。
2. 用户端 API（drafts / reviews / human-decision / published-link）—— 已完成。
3. AI 初审（structuredChat + 失败轮次不进人工 + `error` 可重提）—— 已完成。
4. Admin API（echohunt 审核队列、人工审核、审计日志查询）—— 已完成。
5. 前端（KOL 交付、项目方审核、`GOOGLE_DOC_NOT_ACCESSIBLE` 原地报错、「不合作」按钮、无授权提示）—— 已完成。
6. admin-web 人工审核队列与操作界面 —— 已完成。

通知（邀约/审核结果等）仍仅落审计日志，渠道待产品确认；阶段 6 统一补测试。下一步：执行迁移、端到端联调后进入阶段 5（发放审核与领取）。
