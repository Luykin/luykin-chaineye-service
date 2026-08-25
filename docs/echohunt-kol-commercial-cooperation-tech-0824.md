# EchoHunt KOL 商务合作信息技术方案（0824）

> 基于 `/Users/luykin/Downloads/kol-commercial-cooperation-prd.md` 与当前后端、前端代码现状整理。本文不直接采信 PRD 中提到的文件路径，以实际项目结构为准。

## 1. 结论

该需求整体可行，建议按“新增私有持久化表 + EchoHunt 账号态 API + EchoHunt 前端独立子路由页面”的方式实现。

本期范围只做 KOL 本人维护商务合作信息：查看、首次填写、编辑、暂停/恢复接受邀约。不做项目方侧读取、筛选、公开展示，也不接入 KOL Match 结果页。本 PRD 第 4.2 节是范围边界说明，落地时应理解为“项目方侧信息展示/筛选/邀约使用流程另行设计”。

## 2. 当前代码核对结果

### 2.1 后端实际入口

| 事项 | 实际代码 |
| --- | --- |
| EchoHunt API 主路由 | `src/xhunt/api/echohunt.js` |
| EchoHunt API 挂载 | `src/apiServer.js` 中 `app.use("/api/xhunt/echohunt", xHuntEchohuntRoutes)` |
| KOL Match 子路由 | `src/xhunt/api/echohunt.js` 中 `router.use("/kol-match", echohuntKolMatchRoutes)` |
| Auth Center 鉴权中间件 | `src/xhunt/auth-center/middleware/auth.js`，导出 `authenticateAuthCenterToken` |
| 当前登录用户接口 | `GET /api/xhunt/echohunt/me`，前端代理后是 `/api/echohunt/me` |
| PostgreSQL 模型集中注册 | `src/models/postgres-start.js` |
| PostgreSQL migration 目录 | `migrations-pg/` |

### 2.2 后端可复用能力

`src/xhunt/api/echohunt.js` 已有以下可复用函数和模式：

- `authenticateAuthCenterToken()`：校验 EchoHunt Auth Center access token，并设置 `req.authCenter`、`req.user`。
- `getTwitterIdentityFromAuth(req)`：从 Auth Center identities 中获取 Twitter 身份，返回 `twitterId`、`username`、`displayName`、`avatar`、`authCenterUserId`、`xhuntUserId`。
- `ensureXHuntUserForEchohunt(twitterProfile, options)`：确保登录的 Twitter 用户在旧 XHunt 用户表中存在或更新。
- Binance Square 绑定相关接口可作为“账号私有设置类 API”的风格参考，例如：
  - `GET /binance-square-binding/me`
  - `POST /binance-square-binding/challenge`
  - `POST /binance-square-binding/verify`
  - `DELETE /binance-square-binding/me`

### 2.3 后端数据现状

当前未发现已有适合承载“商务联系方式、报价、本人接受邀约状态”的正式表或模型。

需要特别注意：当前 KOL Match / KOL Marketing 的 AI 接单意愿来自 `dev.kol_marketing_profile.willingness_level` 等只读画像字段，代码在：

- `src/xhunt/api/kol-marketing/search-service.js`
- `src/xhunt/api/echohunt-kol-match.js`

本需求要求“本人设置的接受邀约状态”和 AI 接单意愿分开存储，因此不能复用或覆盖 `willingness_level`。

### 2.4 前端实际入口

前端项目实际路径：`/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt`。

| 事项 | 实际代码 |
| --- | --- |
| `/account` 页面文件 | `app/account/page.tsx`，仅渲染 `<LeaderboardPage />` |
| 账户页主体 | `components/account/AccountView.tsx` |
| 总路由/视图状态 | `components/LeaderboardPage.tsx` |
| EchoHunt API helper | `lib/echohunt-api.ts` |
| API Proxy | `app/api/echohunt/[...path]/route.ts` |
| 登录发起 | `startEchohuntXLogin(returnUrl)` |
| 登录回调后视图解析 | `getRouteStateFromPath(pathname)` |

### 2.6 前端参考分支说明

用户指定可参考前端项目分支：

```text
/Users/luykin/Documents/mac-work-new/XHunt.website
branch: codex/echohunt-kol-collaboration
```

当前本地查看该分支时，分支 `codex/echohunt-kol-collaboration` 仅新增了 `apps/echohunt/docs/kol-commercial-cooperation-prd.md`，未发现已提交的商务合作 UI 组件代码或页面代码。因此实施时以当前正式代码结构为准；如果后续该分支补充了 Demo/UI 代码，只将其作为视觉布局、页面层级与交互流程参考，不直接搬运其组件实现。

前端实现原则：

1. 参考分支/评审 Demo 的布局与交互：账户页入口卡片、详情只读态、编辑表单、保存/取消流程、脏数据确认。
2. 组件实现尽量复用当前 EchoHunt 项目已经常用的结构和样式：`rounded-2xl` 卡片、现有按钮/Badge 视觉、`LoadingPanel` / `MessagePanel` 类似反馈形态、`lucide-react` 图标、当前 Tailwind 设计语言。
3. 不引入新 UI 框架、不复制 Demo 专用控件、不引入独立字体或装饰背景。
4. 新增组件只承担本需求必要职责，避免把参考 Demo 的状态 mock、示例填充、PRD 批注控件带入生产代码。

### 2.5 前端现状与 PRD 的差异

1. **不是单独的 Account Layout + 子页面体系**  
   当前 `/account/page.tsx` 只是入口壳，真实页面由 `LeaderboardPage` 内部 view state 控制。

2. **当前路由识别不支持 `/account/collaboration`**  
   `DashboardView` 当前只有：
   - `campaigns`
   - `kolMatch`
   - `account`
   - `faq`

   `getRouteStateFromPath()` 当前只识别 `/account`、`/kol-match`、`/faq`、`/campaigns/:key`。

3. **如果要支持直达 `/account/collaboration`，Next 需要真实路由文件**  
   因当前只有 `app/account/page.tsx`，建议新增 `app/account/collaboration/page.tsx`，同样渲染 `<LeaderboardPage />`，否则生产环境刷新或直达子路由可能无法命中页面。

4. **现有中英文文案不是统一字典文件模式**  
   PRD 要求“英文文案进入项目现有 i18n 配置”，但当前账户页主要通过 `LeaderboardPage.tsx` 中 `getCopy(language)` 和局部函数实现，不是独立 i18n JSON。建议本期沿用现有 `getCopy` / `AccountCopy` 模式，避免引入新 i18n 体系。

## 3. 推荐实现方案

## 3.1 后端方案

### 3.1.1 新增模型

建议新增模型：

```text
src/xhunt/models/XHuntKolCollaboration.js
```

建议表名：

```text
XHuntKolCollaborations
```

命名理由：该数据属于 XHunt / EchoHunt 用户私有设置，和现有 `XHuntUser`、`XHuntBinanceSquareBinding` 风格接近。

### 3.1.2 新增 Migration

新增 PostgreSQL migration：

```text
migrations-pg/YYYYMMDDHHMMSS-create-xhunt-kol-collaborations.js
```

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID PK | 主键 |
| `authCenterUserId` | UUID NOT NULL | 关联 `AuthCenterXhuntUsers.id`，作为当前登录主体的唯一设置记录 |
| `xhuntUserId` | UUID NULL | 关联旧 `XHuntUsers.id`，便于旧体系联动；用户不存在或后续解绑时可为空 |
| `twitterId` | STRING(64) NOT NULL | 当前 X 登录身份的 Twitter ID，后续与 KOL Match 数据按 Twitter ID 关联 |
| `twitterUsername` | STRING(255) NULL | 保存时快照，展示或排查用，不作为唯一依据 |
| `acceptingNewInvitations` | BOOLEAN NOT NULL DEFAULT true | KOL 本人是否接受新邀约 |
| `telegram` | STRING(64) NULL | 规范化后的 Telegram，例如 `@username` |
| `email` | STRING(255) NULL | 邮箱 |
| `shortPostPrice` | DECIMAL(18,2) NULL | 短推报价 |
| `shortPostCurrency` | STRING(8) NOT NULL DEFAULT `USDT` | `USDT` / `USD` |
| `threadPrice` | DECIMAL(18,2) NULL | 长推 / Thread 报价 |
| `threadCurrency` | STRING(8) NOT NULL DEFAULT `USDT` | `USDT` / `USD` |
| `metadata` | JSONB NULL | 预留扩展，例如保存来源、版本 |
| `createdAt` / `updatedAt` | DATE | Sequelize 时间戳 |

建议索引：

```text
UNIQUE(authCenterUserId)
UNIQUE(twitterId)
INDEX(acceptingNewInvitations)
```

`twitterId` 需要设置唯一约束。业务上一个 X/Twitter 账号只应对应一份 KOL 商务合作设置，后续 KOL Match 或项目方侧能力也会按 `twitterId` 做稳定关联；`authCenterUserId` 仍保留唯一约束，用于当前登录主体的快速查询与幂等 upsert。

### 3.1.3 模型注册

在 `src/models/postgres-start.js` 中：

1. require 新模型。
2. 实例化 `XHuntKolCollaboration`。
3. export 出去。
4. 可选添加关联：
   - `AuthCenterXhuntUser.hasOne(XHuntKolCollaboration, { foreignKey: "authCenterUserId", as: "kolCollaboration" })`
   - `XHuntKolCollaboration.belongsTo(AuthCenterXhuntUser, { foreignKey: "authCenterUserId", as: "authCenterUser" })`
   - `XHuntUser.hasOne(XHuntKolCollaboration, { foreignKey: "xhuntUserId", as: "kolCollaboration" })`
   - `XHuntKolCollaboration.belongsTo(XHuntUser, { foreignKey: "xhuntUserId", as: "xhuntUser" })`

本期接口可以直接查询模型，不强依赖 association；但补齐 association 有利于后续项目方侧联查。

### 3.1.4 新增 API

建议放在 `src/xhunt/api/echohunt.js`，复用 EchoHunt 私有账号 API 的鉴权与错误风格。

#### GET `/api/xhunt/echohunt/me/collaboration`

用途：当前登录 KOL 获取自己的商务合作信息。

鉴权：`authenticateAuthCenterToken()`。

逻辑：

1. 从 `req.authCenter` 获取 Auth Center 用户。
2. 通过 `getTwitterIdentityFromAuth(req)` 获取 Twitter 身份。
3. 如果没有 Twitter 身份，返回 `400 TWITTER_ID_REQUIRED`。
4. 按 `authCenterUserId` 查询 `XHuntKolCollaboration`。
5. 未找到时返回 `data: null`，代表 `UNSET`。
6. 找到时返回序列化后的记录。
7. 设置 `Cache-Control: no-store`。

响应示例：

```json
{
  "success": true,
  "data": null
}
```

```json
{
  "success": true,
  "data": {
    "status": "ACTIVE",
    "acceptingNewInvitations": true,
    "telegram": "@echohunt_kol",
    "email": "kol@example.com",
    "shortPostPrice": "800.00",
    "shortPostCurrency": "USDT",
    "threadPrice": "1500.00",
    "threadCurrency": "USDT",
    "twitterId": "123456789",
    "twitterUsername": "echohunt_kol",
    "createdAt": "2026-08-25T02:00:00.000Z",
    "updatedAt": "2026-08-25T02:00:00.000Z"
  }
}
```

#### PUT `/api/xhunt/echohunt/me/collaboration`

用途：首次保存或修改当前 KOL 商务合作信息。

鉴权：`authenticateAuthCenterToken()`。

逻辑：

1. 获取 Twitter identity；没有则 `400 TWITTER_ID_REQUIRED`。
2. 调用或复用 `ensureXHuntUserForEchohunt()`，确保旧 `XHuntUser` 关系存在。
3. 规范化并校验 payload。
4. 按 `authCenterUserId` upsert。
5. 返回保存后的序列化数据。
6. 不读写 `dev.kol_marketing_profile.willingness_level`。
7. 不打印敏感联系方式和报价到日志。

请求体建议：

```json
{
  "acceptingNewInvitations": true,
  "telegram": "https://t.me/echohunt_kol",
  "email": "kol@example.com",
  "shortPostPrice": "800",
  "shortPostCurrency": "USDT",
  "threadPrice": "1500.50",
  "threadCurrency": "USD"
}
```

### 3.1.5 后端校验规则

#### `acceptingNewInvitations`

- 只接受 boolean。
- 首次前端默认 true，但后端不能把“无记录”默认为已接受；只有 PUT 成功后才有正式状态。

#### Telegram

输入支持：

- `@username`
- `username`
- `https://t.me/username`
- 可兼容 `http://t.me/username`

建议规范化输出：`@username`。

建议校验：

```text
^[A-Za-z0-9_]{5,32}$
```

说明：Telegram username 通常 5-32 位，字母、数字、下划线。

#### Email

- trim。
- 可 lowercase 存储，便于去重和检索。
- 基础格式校验：`^[^\s@]+@[^\s@]+\.[^\s@]+$`。
- 最大 255。

#### 联系方式必填逻辑

- `acceptingNewInvitations === true` 时，Telegram / Email 至少一项必填。
- `acceptingNewInvitations === false` 时，Telegram / Email 可以都为空。
- 暂停时不自动清空已有联系方式。

#### 报价与币种

- `shortPostPrice` / `threadPrice` 可为空。
- 填写时必须：
  - 数字 > 0。
  - 最多两位小数。
  - 允许字符串输入，但需去除千分位逗号后再校验。
- 币种只允许：`USDT`、`USD`。
- 前后端默认币种均为 `USDT`。
- 保存时建议 DECIMAL 字段存储，响应时保持字符串，避免 JS 浮点精度问题。

### 3.1.6 错误码建议

| 错误码 | HTTP | 场景 |
| --- | --- | --- |
| `TOKEN_REQUIRED` | 401 | 未登录 |
| `TOKEN_EXPIRED` / `TOKEN_INVALID` | 419 | 认证过期或无效，沿用现有逻辑 |
| `TWITTER_ID_REQUIRED` | 400 | 当前登录用户没有 Twitter identity |
| `COLLABORATION_CONTACT_REQUIRED` | 400 | 接受邀约开启但 Telegram / Email 都为空 |
| `COLLABORATION_TELEGRAM_INVALID` | 400 | Telegram 格式错误 |
| `COLLABORATION_EMAIL_INVALID` | 400 | Email 格式错误 |
| `COLLABORATION_PRICE_INVALID` | 400 | 报价格式错误 |
| `COLLABORATION_CURRENCY_INVALID` | 400 | 币种非法 |
| `ECHOHUNT_COLLABORATION_FAILED` | 500 | 未预期服务端错误 |

## 3.2 前端方案

### 3.2.1 新增直达路由

新增：

```text
app/account/collaboration/page.tsx
```

内容保持和 `app/account/page.tsx` 一致：

```tsx
import LeaderboardPage from '@/components/LeaderboardPage';

export default function AccountCollaborationPage() {
  return <LeaderboardPage />;
}
```

目的：保证 `/account/collaboration` 可直接访问、刷新、登录回跳。

### 3.2.2 扩展 `LeaderboardPage` 视图状态

修改：

```text
components/LeaderboardPage.tsx
```

`DashboardView` 增加：

```ts
type DashboardView = 'campaigns' | 'kolMatch' | 'account' | 'accountCollaboration' | 'faq';
```

`getRouteStateFromPath()` 增加优先识别：

```ts
if (normalized.endsWith('/account/collaboration')) {
  return { view: 'accountCollaboration', campaignKey: null };
}
```

注意要放在 `/account` 判断之前。

`updateDashboardUrl()` 增加映射：

```ts
view === 'accountCollaboration' ? '/account/collaboration' : ...
```

新增方法：

```ts
const showAccountCollaboration = () => {
  setCurrentView('accountCollaboration');
  setRouteCampaignKey(null);
  updateDashboardUrl('accountCollaboration');
  setSelectedCampaignId(null);
  setLeaderboardTab('poi');
  setRange('all');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
```

登录回调分支增加 `accountCollaboration`，避免回调后落回 `/account`。

Topbar 标题增加：

- 中文：`商务合作`
- 英文：`Collaboration`

### 3.2.3 新增商务合作详情组件

UI 可参考前端分支 `codex/echohunt-kol-collaboration` / 已评审 Demo 的布局和交互，但组件实现应尽量使用当前项目已有的卡片、按钮、加载态、错误态和 Tailwind class 体系；不要直接复制 Demo 中的 mock 状态、示例填充按钮或临时说明控件。

建议新增：

```text
components/account/CollaborationView.tsx
```

职责：

- 未登录态：展示登录引导，点击登录时传入 `/account/collaboration`。
- 已登录态：加载 `/me/collaboration`。
- `data: null`：进入首次编辑视图，默认 `acceptingNewInvitations = true`，币种默认 `USDT`。
- 有数据：默认只读详情视图。
- 点击“修改信息”：进入编辑视图并预填。
- 点击“保存”：调用 PUT 成功后返回只读详情。
- 点击“取消”/“返回我的账户”：如果有未保存更改，二次确认。

建议 props：

```ts
type CollaborationViewProps = {
  language: EchohuntLanguage;
  authSession: EchohuntAuthSession | null;
  authBusy: boolean;
  onLogin: (returnPathOrUrl?: string) => void;
  onBack: () => void;
};
```

需要把现有 `AccountView` 的 `onLogin: () => void` 类型统一放宽为：

```ts
onLogin: (returnPathOrUrl?: string) => void;
```

### 3.2.4 我的账户页入口卡片

修改：

```text
components/account/AccountView.tsx
```

在“排名数据”卡片结束后、`<AccountActiveCampaignsSection />` 之前增加商务合作入口卡片。

当前合适位置：`AccountView` render 中主 profile/rank card 关闭后，紧接着是：

```tsx
<AccountActiveCampaignsSection ... />
```

入口卡片应插入在这之前。

入口卡片展示规则：

| 后端状态 | 展示 |
| --- | --- |
| `data: null` | badge：`New`，按钮：`去设置` / `Set up` |
| `ACTIVE` | badge：`接受邀约` / `Accepting invitations`，按钮：`查看详情` / `View details` |
| `PAUSED` | badge：`暂停邀约` / `Paused`，按钮：`查看详情` / `View details` |
| 加载失败 | 显示轻量错误与重试，不把错误当作未设置 |

入口卡片不展示联系方式、报价、不展示“已设置/未设置/完整度”等标签。

### 3.2.5 API helper

修改：

```text
lib/echohunt-api.ts
```

新增类型：

```ts
export type EchohuntKolCollaborationStatus = 'ACTIVE' | 'PAUSED';
export type EchohuntKolCollaborationCurrency = 'USDT' | 'USD';

export type EchohuntKolCollaboration = {
  status: EchohuntKolCollaborationStatus;
  acceptingNewInvitations: boolean;
  telegram?: string | null;
  email?: string | null;
  shortPostPrice?: string | null;
  shortPostCurrency: EchohuntKolCollaborationCurrency;
  threadPrice?: string | null;
  threadCurrency: EchohuntKolCollaborationCurrency;
  twitterId?: string | null;
  twitterUsername?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type EchohuntKolCollaborationInput = {
  acceptingNewInvitations: boolean;
  telegram?: string | null;
  email?: string | null;
  shortPostPrice?: string | null;
  shortPostCurrency?: EchohuntKolCollaborationCurrency;
  threadPrice?: string | null;
  threadCurrency?: EchohuntKolCollaborationCurrency;
};
```

新增函数：

```ts
export async function fetchEchohuntKolCollaboration(token: EchohuntToken, language?: EchohuntLanguage) {
  const result = await echohuntApiFetch<EchohuntApiResponse<EchohuntKolCollaboration | null>>('/me/collaboration', {
    token,
    language,
    cache: 'no-store',
  });
  if (!result.success) throw new Error(result.message || result.error || 'Failed to load collaboration settings');
  return result.data ?? null;
}

export async function saveEchohuntKolCollaboration(
  token: EchohuntToken,
  body: EchohuntKolCollaborationInput,
  language?: EchohuntLanguage
) {
  const result = await echohuntApiFetch<EchohuntApiResponse<EchohuntKolCollaboration>>('/me/collaboration', {
    method: 'PUT',
    token,
    body,
    language,
  });
  if (!result.success || !result.data) throw new Error(result.message || result.error || 'Failed to save collaboration settings');
  return result.data;
}
```

### 3.2.6 API Proxy no-store

修改：

```text
app/api/echohunt/[...path]/route.ts
```

`isRealtimePath()` 中补充：

```ts
if (first === 'me' && pathSegments?.[1] === 'collaboration') return true;
```

虽然 proxy 当前 upstream fetch 已经 `cache: 'no-store'`，但响应 header 也应显式 `cache-control: no-store`，避免账号私有数据被浏览器或中间层缓存。

### 3.2.7 前端表单校验

前端校验应与后端一致，但以后端为准：

- 接受邀约开启时，Telegram / Email 至少一个。
- Telegram 支持 `@username`、`username`、`https://t.me/username`，失焦时可规范化成 `@username`。
- Email 基础格式。
- 报价可空；填了必须 > 0 且最多两位小数。
- 价格输入允许用户输入 `2,000`，提交前去掉逗号。
- 币种只允许 `USDT`、`USD`，默认 `USDT`。
- 校验失败聚焦第一个错误字段。

### 3.2.8 前端交互状态

`CollaborationView` 建议状态机：

```text
loading
  ├─ error：显示错误 + 重试
  ├─ data === null：mode = edit, recordState = UNSET
  └─ data exists：mode = readonly, recordState = ACTIVE | PAUSED

readonly
  └─ 修改信息 -> edit

edit
  ├─ 保存中：按钮 disabled
  ├─ 保存成功：更新 record，mode = readonly
  ├─ 保存失败：保留当前输入，显示错误
  └─ 取消/返回/离开：dirty 时 confirm
```

只读详情不放状态开关；状态变更必须进入编辑并点击保存。

## 4. 隐私与权限

1. 商务联系方式和报价只允许当前登录 KOL 本人通过 `/me/collaboration` 读写。
2. 本期不提供项目方侧读取接口。
3. 不在公开个人主页、榜单、KOL Match 结果页展示联系方式和报价。
4. 未来项目方读取必须新建有权限控制的接口，不能只依赖前端隐藏。
5. 后端日志不要打印 request body，避免泄露 Telegram、Email、报价。
6. 响应和前端 proxy 均设置 `no-store`。

## 5. 与 KOL Match / AI 接单意愿的关系

本期保存商务合作信息时：

- 不修改 `dev.kol_marketing_profile.willingness_level`。
- 不修改 `willingnessScore`、`willingnessConfidence`、`willingnessReason`、`willingnessEvidence`。
- 不影响 `src/xhunt/api/kol-marketing/search-service.js` 的画像检索。
- 不影响 `src/xhunt/api/echohunt-kol-match.js` 的候选评分与展示。

未来如果要在项目方 KOL Match 中展示本人状态，可按 `twitterId` 左连接 `XHuntKolCollaborations`，并遵循优先级：

| 本人设置 | AI 接单意愿 | 展示建议 |
| --- | --- | --- |
| `acceptingNewInvitations = true` | 任意 | 接受邀约 |
| `acceptingNewInvitations = false` | 任意 | 暂停邀约 |
| 无记录 | high | 高 |
| 无记录 | medium | 中 |
| 无记录 | low | 低 |
| 无记录 | unknown | 未采集 |

## 6. 实施清单

### 6.1 后端

1. 新增模型 `src/xhunt/models/XHuntKolCollaboration.js`。
2. 新增 migration `migrations-pg/*-create-xhunt-kol-collaborations.js`。
3. 在 `src/models/postgres-start.js` 注册并导出模型。
4. 在 `src/xhunt/api/echohunt.js` 引入模型。
5. 新增序列化函数，例如 `serializeKolCollaboration(record)`。
6. 新增 normalize/validate helpers：Telegram、Email、Price、Currency。
7. 新增 `GET /me/collaboration`。
8. 新增 `PUT /me/collaboration`。
9. 设置响应 `Cache-Control: no-store`。
10. 确保接口不读写 AI willingness 字段。

### 6.2 前端

1. 新增 `app/account/collaboration/page.tsx`。
2. 参考 `codex/echohunt-kol-collaboration` 分支/评审 Demo 的布局和交互，但仅作参考；生产组件复用当前项目常见组件和样式。
3. 修改 `components/LeaderboardPage.tsx`：
   - 扩展 `DashboardView`。
   - 扩展 route parse / URL update / login callback。
   - 增加 `CollaborationView` render。
   - 增加返回我的账户逻辑。
4. 新增 `components/account/CollaborationView.tsx`。
5. 修改 `components/account/AccountView.tsx`：
   - 增加商务合作入口卡片。
   - 加载 collaboration 状态。
   - 点击入口跳转 `/account/collaboration`。
6. 修改 `lib/echohunt-api.ts`：新增类型和 fetch/save 方法。
7. 修改 `app/api/echohunt/[...path]/route.ts`：`/me/collaboration` 设置 no-store。
8. 补充中英文文案：沿用 `getCopy(language)` / `AccountCopy` 当前模式。

## 7. 测试建议

不自动运行开发服务或构建，由项目负责人自行控制。建议实施后按以下方式验证：

### 7.1 后端验证

1. 运行 migration：
   ```bash
   yarn db:migrate:pg
   ```
2. 已登录 token 调用：
   - `GET /api/xhunt/echohunt/me/collaboration`，无记录返回 `data: null`。
   - `PUT /api/xhunt/echohunt/me/collaboration`，保存成功返回 `ACTIVE` 或 `PAUSED`。
   - 再次 GET 返回已保存数据。
3. 校验错误：
   - 开启接受邀约且无 Telegram/Email -> 400。
   - 非法 Telegram -> 400。
   - 非法 Email -> 400。
   - 价格 0、负数、三位小数 -> 400。
   - 非 `USDT|USD` 币种 -> 400。
4. 确认保存时没有更新 `dev.kol_marketing_profile.willingness_level`。

### 7.2 前端验证

1. 未登录访问 `/account/collaboration`，应跳登录；登录成功后返回 `/account/collaboration`。
2. 未设置用户进入后展示编辑态，默认接受邀约开启、币种 USDT。
3. 首次保存后进入只读详情。
4. 返回 `/account` 后，排名数据下方、活动区块上方显示商务合作入口卡片。
5. 已保存用户再次进入 `/account/collaboration` 默认只读，不直接编辑。
6. 修改信息、取消 dirty form、保存失败、认证过期等流程正常。
7. 390px 移动宽度无横向滚动。
8. 只读详情和入口卡片不展示多余“已设置/未设置/完整度”标签。

## 8. 待确认问题

1. **是否允许无 Twitter identity 的 Auth Center 用户使用该功能？**  
   PRD 目标用户是“已使用 X 登录 EchoHunt 的 KOL”，当前建议没有 Twitter identity 就返回 `TWITTER_ID_REQUIRED`。

2. **Telegram username 是否严格按 5-32 位校验？**  
   这是 Telegram 常见规则。若产品希望兼容更多格式，需要放宽。

3. **Email 是否 lowercase 存储？**  
   技术上建议 lowercase，展示上通常无影响；如果要保留用户大小写输入，需要明确。

4. **报价是否需要上限？**  
   PRD 只要求 >0 且最多两位小数。技术上 DECIMAL(18,2) 足够，但是否需要产品层限制极大值需确认。

5. **未来如果发生 Twitter 身份迁移/解绑，商务合作记录归属如何处理？**  
   `twitterId` 已明确需要唯一约束，因此需要在账号身份解绑、换绑或异常重复数据修复时保证同一个 Twitter ID 只保留一份有效商务合作记录。

6. **未来项目方侧读取权限模型**  
   本期不做，但未来需要明确哪些项目方、运营、内部账号可见联系方式和报价，以及是否需要审计日志。

## 9. 需求与现实不符/需要调整点

1. PRD 提到“现有 i18n 配置”，但 EchoHunt 当前账户相关文案实际集中在 `LeaderboardPage.tsx` 的 `getCopy(language)` 和组件局部 copy 类型中，建议不要为了本需求新建一套 i18n。
2. PRD 希望 `/account/collaboration`，这符合产品诉求，但当前前端不是天然子路由页面，需要新增 `app/account/collaboration/page.tsx` 并扩展 `LeaderboardPage` 内部 view state。
3. 后端没有现成商务合作表，不能只改前端或复用 AI willingness 字段，必须新增正式持久化表和 migration，并对 `twitterId` 建唯一索引。
4. KOL Match 现有接单意愿是 AI 推断信号，本期不能把 KOL 本人“接受邀约/暂停邀约”写入该字段，否则会混淆数据来源。
5. 本期不应在 KOL Match、公开主页或榜单中展示联系方式/报价；PRD 中未来展示优先级只能作为后续项目方侧需求参考。
