# EchoHunt 活动多链钱包报名技术分析

> 状态：代码已实施，待数据库迁移、真实钱包联调与发布
> 日期：2026-11-07  
> 管理后台：`/Users/luykin/Documents/mac-work/luykin-chaineye-service/admin-web`  
> 后端：`/Users/luykin/Documents/mac-work/luykin-chaineye-service`  
> EchoHunt 前端：`/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt`

## 1. 目标与已确认规则

本次改造为活动报名增加多链钱包能力，支持以下主网：

| 配置值 | 展示名称 | 钱包协议 | 地址类型 |
| --- | --- | --- | --- |
| `solana` | Solana | Solana Wallet Standard | Base58 公钥 |
| `sui` | Sui | Sui Wallet Standard | 32 字节十六进制地址 |
| `monad` | Monad | EVM / EIP-1193 | 20 字节 EVM 地址 |
| `bsc` | BNB Chain | EVM / EIP-1193 | 20 字节 EVM 地址 |

已确认的产品与技术规则：

1. 每个活动可独立配置支持哪些链。
2. 每个活动可独立配置报名时是否必须签名。
3. 启用多链钱包报名后，用户先选择网络，再连接该网络对应的钱包。
4. 最终提交前明确提示：`本次活动绑定后不可更换`。
5. 签名消息中的活动名称展示活动英文标题 `displayName.en`，不向用户展示 `campaignKey`。
6. 服务端仍以 `campaignKey` 作为真实活动标识；一次性 `challengeId` 在服务端关联 `campaignKey`，避免仅靠可重复或可修改的英文标题识别活动。
7. 报名查询接口在活动启用 `walletRegistration.enabled` 时返回链、钱包地址和验证状态等对应数据。
8. 配置字段统一使用正确拼写 `walletRegistration.enabled`；不引入 `enabel` 兼容字段。
9. 一期只在 EchoHunt Web 实现钱包报名；插件统一跳转 EchoHunt，插件报名接口对启用新模式的活动强制拒绝。
10. 移动端纳入一期，但只覆盖本期明确的钱包和四条目标链，不建设通用钱包市场或尽可能多的钱包兼容。
11. 报名查询接口按现有产品决定返回完整钱包地址，不做地址掩码。
12. 链 ID、CAIP 标识、RPC 和钱包切链参数由统一链常量维护，上线前以各链官方主网配置复核。

本期仅改造通用活动报名，不包含 E2E 互动任务的独立报名表，也不包含发奖交易、代用户发起链上交易或托管私钥。

### 1.1 评估结论

结论：**技术上可行，没有架构级阻塞；整体难度中高，主要成本在多协议签名验证、移动端钱包返回链路和新旧报名兼容，不在管理后台配置本身。**

| 范围 | 难度 | 判断 |
| --- | --- | --- |
| 管理后台活动配置 | 低到中 | `nacosPayload` 已是 JSONB，可扩展配置；重点是发布校验和已有报名后的配置锁定 |
| 数据模型与查询兼容 | 中 | 需要新增通用钱包字段、部分唯一索引，并同时保留历史 `evmAddress` 消费者 |
| EVM（Monad、BNB Chain） | 中 | 两条链可复用 EIP-1193、切链和 `personal_sign` 验证，差异集中在统一链参数 |
| Solana | 中 | 需要独立 Wallet Standard/签名验证适配，不能复用 EVM adapter |
| Sui | 中高 | 使用独立钱包协议和 personal-message 验证，移动端 Deep Link/内置浏览器联调风险最高 |
| EchoHunt 移动端最小方案 | 中高 | WalletConnect、Universal Link/Deep Link 受钱包版本与系统返回行为影响，必须真机联调 |
| 插件兼容与发布 | 中 | 服务端先拒绝新模式旧接口、插件再更新跳转，可避免旧插件绕过签名规则 |

关键风险已有明确收敛手段：钱包 SDK 按协议隔离并动态加载；签名消息由服务端生成并用一次性 challenge 验证；重复报名由数据库唯一约束兜底；移动端只承诺首批钱包；后端拒绝逻辑先于插件跳转发布。按本文限定范围实施，预计 10–14 人日可以完成开发和首轮联调，第三方钱包兼容性仍需保留发布缓冲。

## 2. 当前实现与改造原因

### 2.1 活动配置

当前数据库版活动编辑页为 `admin-web/src/pages/NacosCampaignsPage.tsx`。新活动默认：

- `allowEmailRegistration: false`；
- 未开启 Email 报名时必须填写 EVM 地址；
- 开启 Email 报名后允许 EVM 地址和 Email 二选一。

活动主配置保存在 `XHuntWebsiteCampaign.nacosPayload` JSONB 中。新增 `walletRegistration` 属于 JSON 配置扩展，不需要为活动表增加列。

### 2.2 报名服务

当前 `src/xhunt/services/campaignRegistrationService.js` 仅接收：

```json
{
  "evmAddress": "0x...",
  "email": null
}
```

地址校验固定为 `^0x[a-fA-F0-9]{40}$`，数据库写入 `CampaignRegistration.evmAddress`。该结构不能表达 Solana、Sui，也不能区分同一个 EVM 地址来自 Monad 还是 BNB Chain。

### 2.3 EchoHunt 前端

当前 `components/campaign/SignupPanel.tsx` 是手动输入 `evmAddress`，没有通用活动钱包连接和签名流程。`本次活动绑定后不可更换` 的确认弹窗只存在于独立的 E2E 页面，不能直接覆盖通用活动报名。

EchoHunt 当前也没有 EVM、Solana、Sui 钱包 SDK，需要新增客户端钱包适配层。

### 2.4 报名查询

当前报名数据主要经以下接口返回：

| 接口 | 使用方 | 当前报名数据来源 |
| --- | --- | --- |
| `GET /api/xhunt/echohunt/campaigns/:campaignKey/me` | EchoHunt 当前用户 | `serializeRegistration` |
| `POST /api/xhunt/echohunt/campaigns/:campaignKey/register` | EchoHunt 报名结果 | `serializeRegistration` |
| `GET /api/xhunt/campaign/registrations` | 现有报名列表消费者 | `serializeCampaignRegistration` |
| `GET /api/xhunt/campaign/me?campaign=...` | 插件当前用户 | Sequelize 报名记录 |
| `GET /api/xhunt/campaign/internal/registrations` | 管理后台 | `serializeCampaignRegistration` |

管理后台报名名单目前只有 `EVM` 和 `Email` 列，无法展示链、通用地址或签名状态。

## 3. 活动配置契约

在活动 `nacosPayload` 顶层新增：

```json
{
  "walletRegistration": {
    "enabled": true,
    "supportedChains": ["solana", "sui", "monad", "bsc"],
    "signatureRequired": true
  }
}
```

字段定义：

| 字段 | 类型 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否启用连接钱包报名 |
| `supportedChains` | string[] | `[]` | 只接受 `solana`、`sui`、`monad`、`bsc`，去重后至少一项 |
| `signatureRequired` | boolean | `true` | 是否要求地址所有权签名 |

兼容规则：

- `walletRegistration` 缺失或 `enabled !== true`：继续使用原有 EVM/Email 报名。
- `walletRegistration.enabled === true`：钱包路径只接受新的通用钱包结构，不接受把 Solana/Sui 地址放入 `evmAddress`。
- `allowEmailRegistration === true` 时，Email 仍可作为独立报名方式；选择 Email 时不要求连接钱包或签名。
- `signatureRequired` 只作用于钱包报名路径，不作用于 Email 报名路径。
- 不把历史 `evmAddress` 自动判断为 Monad 或 BNB Chain，因为仅凭地址无法确定来源网络。

### 3.1 管理后台校验

发布配置前必须校验：

1. `enabled === true` 时 `supportedChains` 至少包含一条合法链。
2. 支持链数组去重并使用稳定枚举值，不保存展示文案。
3. 启用多链钱包报名时，`displayName.en` 必填；该字段是签名消息的活动展示标题。
4. 新启用的活动默认 `signatureRequired: true`。
5. 关闭签名时显示提示：`未签名只能校验地址格式，无法证明报名用户拥有该地址。`
6. 活动已有报名记录后，锁定 `enabled`、`supportedChains` 和 `signatureRequired`；如确需迁移，走单独的数据迁移流程，避免同一活动同时存在含义不一致的报名记录。

### 3.2 对外活动配置

EchoHunt 活动列表和详情中的 `registrationConfig` 扩展为：

```json
{
  "registrationConfig": {
    "allowEmailRegistration": false,
    "threshold": 200000,
    "includeCreator": false,
    "walletRegistration": {
      "enabled": true,
      "supportedChains": ["solana", "sui", "monad", "bsc"],
      "signatureRequired": true,
      "echohuntRegistrationUrl": "https://app.echohunt.ai/campaigns/example-campaign"
    }
  }
}
```

历史活动也返回归一化后的配置：

```json
{
  "walletRegistration": {
    "enabled": false,
    "supportedChains": [],
    "signatureRequired": false,
    "echohuntRegistrationUrl": null
  }
}
```

稳定返回完整结构可以减少前端对缺失字段的分支判断；后端实际报名逻辑仍以服务端读取到的活动配置为准。

`echohuntRegistrationUrl` 由服务端使用 EchoHunt Web 基础地址和 `campaignKey` 生成，不能复用活动的 `activeUrl`：`activeUrl` 可能指向项目官网或外部活动页，并不保证是 EchoHunt 报名页面。

## 4. 签名消息与 challenge 协议

### 4.1 核心约束

签名消息由服务端生成，前端只能原样展示和签名。前端不得自行拼接标题、地址、nonce 或时间。

用户可见的活动字段使用 `displayName.en`：

```text
Campaign: XStable Creator Campaign
```

消息中不展示 `campaignKey`。服务端创建 challenge 时保存以下绑定关系：

```text
challengeId -> campaignKey + authCenterUserId + twitterId + chain + address + titleSnapshot
```

因此即使两个活动英文标题相同，或活动后续修改了英文标题，已签名 challenge 也只能用于创建它最初绑定的活动报名记录。

### 4.2 英文标题来源

签名标题只读取活动原始配置 `displayName.en`，不按请求语言切换，也不接受前端传入标题。

生成消息前执行：

1. `trim()`；
2. 将 `\r`、`\n`、连续空白规范化为单个空格，防止消息结构注入；
3. 限制最大长度，例如 160 个 Unicode 字符；
4. 字段为空时拒绝创建 challenge，返回 `CAMPAIGN_ENGLISH_TITLE_REQUIRED`。

challenge 中保存 `titleSnapshot`，验证签名时使用快照，不重新读取可能已修改的活动标题。

### 4.3 消息模板

所有链使用相同的 UTF-8 文本和 `\n` 换行：

```text
XHunt Campaign Wallet Registration

Campaign: {displayName.en}
Network: {networkDisplayName}
Wallet Address: {canonicalAddress}

This wallet will be bound to this campaign and cannot be changed after registration.
This request does not trigger a blockchain transaction or cost gas.

Request ID: {challengeId}
Nonce: {nonce}
Issued At: {issuedAtIso}
Expiration Time: {expiresAtIso}
Origin: {expectedOrigin}
```

字段顺序、大小写、空行和换行符是签名协议的一部分。后续改消息模板时增加 `messageVersion`，不能静默修改同一版本。

### 4.4 Challenge 接口

新增：

```text
POST /api/xhunt/echohunt/campaigns/:campaignKey/wallet-registration/challenge
Authorization: Bearer <Auth Center access token>
```

请求：

```json
{
  "chain": "solana",
  "address": "..."
}
```

响应：

```json
{
  "success": true,
  "data": {
    "challengeId": "uuid",
    "messageVersion": 1,
    "message": "XHunt Campaign Wallet Registration\n...",
    "chain": "solana",
    "address": "canonical address",
    "signatureType": "solana_signMessage",
    "expiresAt": "2026-11-07T10:05:00.000Z"
  }
}
```

服务端流程：

1. 校验 Auth Center 登录态和 Twitter 身份。
2. 读取服务端活动配置并确认活动允许报名。
3. 确认 `walletRegistration.enabled === true`、链在 `supportedChains` 内、`signatureRequired === true`。
4. 按链校验并规范化地址。
5. 使用服务端配置生成英文标题、消息、nonce 和 `challengeId`。
6. 将 challenge 写入 Redis，TTL 建议 5 分钟。
7. 同一个用户、活动、链、地址短时间内重复申请时覆盖或废弃旧 challenge，避免多个有效签名并存。

### 4.5 签名与验证

| 链 | 前端签名 | 服务端验证 |
| --- | --- | --- |
| Monad | `personal_sign` | EVM message recovery，恢复地址必须等于报名地址 |
| BNB Chain | `personal_sign` | EVM message recovery，恢复地址必须等于报名地址 |
| Solana | `signMessage` | Ed25519 验证，公钥必须等于报名地址 |
| Sui | `signPersonalMessage` | Sui personal-message 验证，恢复公钥派生地址必须等于报名地址 |

EVM 普通消息签名只能证明地址控制权，不能单独证明用户当前连接在哪条 EVM 链。因此前端还必须切换并校验目标 chain ID，服务端将目标链写入签名消息和报名记录；服务端不把客户端自报的 chain ID 当成地址所有权证明。

Redis challenge 必须一次性原子消费。以下任一情况拒绝报名：

- challenge 不存在、已过期或已消费；
- challenge 绑定的活动、用户、链或地址与报名请求不一致；
- 签名算法与链不匹配；
- 签名验证失败；
- 活动配置在 challenge 创建后被关闭或改变为不支持该链；
- 当前用户已经报名；
- 当前链地址已被同一活动的其他报名记录使用。

## 5. 报名接口契约

### 5.1 启用钱包报名时

`POST /api/xhunt/echohunt/campaigns/:campaignKey/register` 请求扩展为：

```json
{
  "wallet": {
    "chain": "solana",
    "address": "canonical-or-raw-address",
    "walletName": "Phantom",
    "challengeId": "uuid",
    "signature": "base58/base64/0x signature according to chain"
  },
  "agreements": {
    "terms": true,
    "disclosure": true
  },
  "taskState": {},
  "registrationUrl": "https://..."
}
```

当 `signatureRequired === false` 时，请求省略 `challengeId` 和 `signature`，但仍必须通过连接钱包得到地址：

```json
{
  "wallet": {
    "chain": "sui",
    "address": "0x...",
    "walletName": "Slush"
  }
}
```

服务端不信任 `walletName`，该字段只用于运营分析；地址、链、签名状态必须由服务端校验后写入。

### 5.2 历史模式

`walletRegistration.enabled !== true` 时继续接受：

```json
{
  "evmAddress": "0x..."
}
```

历史模式不接受 Solana/Sui 地址，也不把 `evmAddress` 自动映射为 `wallet.chain`。

### 5.3 Email 路径

活动同时满足以下条件时可继续 Email 报名：

```text
allowEmailRegistration === true
walletRegistration.enabled === true
```

请求只传 `email`，不同时传 `wallet`。钱包和 Email 同时存在返回 `CONTACT_CONFLICT`。

## 6. 数据模型与迁移

### 6.1 CampaignRegistration 新字段

建议通过 PostgreSQL 迁移增加：

```text
walletChain                VARCHAR(32)  NULL
walletAddress              VARCHAR(128) NULL
walletAddressNormalized    VARCHAR(128) NULL
walletSignatureRequired    BOOLEAN      NULL
walletVerified             BOOLEAN      NULL
walletVerifiedAt           TIMESTAMPTZ  NULL
walletVerification         JSONB        NULL
```

`walletVerification` 建议结构：

```json
{
  "messageVersion": 1,
  "challengeId": "uuid",
  "signatureType": "solana_signMessage",
  "signature": "...",
  "message": "signed message snapshot",
  "titleSnapshot": "XStable Creator Campaign",
  "walletName": "Phantom",
  "verifiedAt": "2026-11-07T10:00:10.000Z"
}
```

签名不是密码或私钥，但公开接口不返回原始 `signature`、完整签名消息、nonce 或 `challengeId`。这些字段仅用于服务端审计和争议排查。

### 6.2 地址规范化

- Monad、BNB Chain：用 EVM 地址库校验；比较值保存为小写，展示值可保存校验和格式。
- Solana：解析为公钥后重新输出标准 Base58；Base58 大小写敏感。
- Sui：规范化为小写 `0x` 加 64 位十六进制。

增加唯一索引：

```sql
UNIQUE (campaign, walletChain, walletAddressNormalized)
WHERE walletAddressNormalized IS NOT NULL
```

该约束防止并发请求绕过“先查询、后插入”的应用层唯一性检查。

### 6.3 旧字段兼容

- 保留 `evmAddress` 和现有索引，避免破坏插件与历史消费者。
- 新模式下 Monad/BNB 报名可在过渡期同步写入 `evmAddress`，但新代码以 `walletAddress` 为权威值。
- Solana/Sui 不写入 `evmAddress`。
- Solana/Sui 地址不写入 `XHuntUser.evmAddresses`。
- 本期不把活动报名地址升级为用户账号级通用钱包身份；地址只绑定当前活动报名。

## 7. 报名查询接口返回规则

### 7.1 统一序列化结构

活动启用 `walletRegistration.enabled` 且报名记录通过钱包路径创建时，报名对象增加：

```json
{
  "walletRegistration": {
    "chain": "solana",
    "networkName": "Solana",
    "address": "...",
    "signatureRequired": true,
    "verified": true,
    "verifiedAt": "2026-11-07T10:00:10.000Z",
    "signatureType": "solana_signMessage",
    "walletName": "Phantom"
  }
}
```

不返回：

- 原始签名；
- nonce；
- challenge ID；
- 完整签名消息；
- Redis key 或内部验证错误详情。

当活动未启用新模式时，保持现有 `evmAddress`、`email` 返回，不强行构造 `walletRegistration`。当活动已启用但记录是迁移前的历史报名时返回：

```json
{
  "walletRegistration": null,
  "legacyEvmAddress": "0x..."
}
```

正常情况下应通过“已有报名后锁定配置”避免产生这种混合状态。

### 7.2 EchoHunt 活动配置接口

以下接口必须返回活动级 `registrationConfig.walletRegistration`：

| 接口 | 返回内容 |
| --- | --- |
| `GET /api/xhunt/echohunt/campaigns` | 每个活动的开关、支持链、是否签名 |
| `GET /api/xhunt/echohunt/campaigns/:campaignKey` | 当前活动完整钱包报名配置 |
| `GET /api/xhunt/campaign/config` | 插件侧兼容配置；未支持新流程的插件据此禁用或隐藏报名 |

### 7.3 EchoHunt 当前用户接口

`GET /api/xhunt/echohunt/campaigns/:campaignKey/me`：

- 未报名：`registration: null`，仍返回活动级配置的接口负责告知前端如何报名。
- 已通过钱包报名：`registration.walletRegistration` 返回链、地址和验证状态。
- 已通过 Email 报名：`registration.email` 保持现有返回，`registration.walletRegistration` 为 `null`。

`POST /api/xhunt/echohunt/campaigns/:campaignKey/register` 的成功响应使用相同序列化结构，避免前端报名成功后还需立即重新查询。

### 7.4 管理后台报名查询

`GET /api/xhunt/campaign/internal/registrations` 在启用钱包报名的活动中为每行返回：

```json
{
  "walletRegistration": {
    "chain": "bsc",
    "networkName": "BNB Chain",
    "address": "0x...",
    "signatureRequired": true,
    "verified": true,
    "verifiedAt": "...",
    "signatureType": "evm_personal_sign",
    "walletName": "MetaMask"
  }
}
```

管理后台表格调整为：

```text
用户 | 网络 | 钱包地址 | 签名状态 | Email | 报名时间 | ...
```

签名状态建议使用：

- `已验证`：要求签名且验证成功；
- `未要求签名`：配置关闭签名，地址仅做格式校验；
- `历史记录`：活动当前启用新模式，但记录缺少新字段；
- `-`：Email 报名。

### 7.5 现有报名列表和插件当前用户接口

以下接口同步使用统一序列化器，避免不同入口返回不同字段：

- `GET /api/xhunt/campaign/registrations`
- `GET /api/xhunt/campaign/me?campaign=...`

公开或弱鉴权列表返回链、完整钱包地址和 `verified`，不做地址掩码；仍不返回 `walletName`、`signatureType` 等非必要审计信息。完整地址返回是本期已确认的产品规则，如后续要收紧公开范围，应另行调整接口权限，不能只在前端隐藏。

### 7.6 序列化实现建议

把钱包返回结构集中在服务层，例如：

```javascript
serializeRegistrationWallet(record, campaignConfig, { audience })
```

`audience` 至少区分：

- `self`：当前报名用户；
- `admin`：管理后台；
- `public`：公开列表；
- `legacyPlugin`：旧插件兼容。

路由不重复拼装字段。序列化器以服务端活动配置和数据库记录为输入，不使用客户端传来的 `walletRegistration.enabled`。

## 8. 前端钱包适配方案

### 8.1 依赖建议

本次按最小移动端范围采用轻量协议适配，不引入通用钱包市场：

- Monad / BNB Chain：EIP-6963 + EIP-1193 注入钱包；
- Solana：Phantom / OKX 注入 provider；
- Sui：Wallet Standard；
- 移动端：无法在系统浏览器直接连接时，通过钱包官方 Universal Link / Deep Link 打开同一活动页，并在钱包内置浏览器完成连接和签名。

xStable 的公开前端资源同样采用 EVM、Solana、Sui 多 adapter 结构，不能把四条链视为一个钱包协议。公开 npm 当前没有独立的 `@reown/appkit-adapter-sui`，Sui 仍需要单独适配或定制 adapter。

### 8.2 首批钱包名单

一期只明确支持下列钱包，不承诺其它钱包即使能被 Wallet Standard、EIP-6963 或 WalletConnect 发现也一定可用：

| 网络 | 桌面端 | 移动端最小支持 |
| --- | --- | --- |
| Monad | MetaMask、OKX Wallet | MetaMask、OKX Wallet，通过官方 Universal Link / Deep Link 打开钱包内置浏览器 |
| BNB Chain | Binance Wallet、MetaMask、OKX Wallet | Binance Wallet、MetaMask、OKX Wallet，通过官方 Universal Link / Deep Link 打开钱包内置浏览器 |
| Solana | Phantom、OKX Wallet | Phantom、OKX Wallet，通过钱包官方 Universal Link / Deep Link 打开钱包内置浏览器 |
| Sui | Slush、OKX Wallet | Slush、OKX Wallet，优先跳转钱包内置浏览器并通过 Wallet Standard 连接 |

该名单的目标是覆盖每条链至少一个主流原生钱包，并复用 OKX Wallet 的多链能力降低移动端适配数量。未列入的钱包可在后续按实际用户需求增加。

### 8.3 移动端最小方案

移动端纳入一期，但采用最小可用实现：

1. EVM 和 Solana 优先使用注入钱包；移动端系统浏览器未发现 provider 时，通过目标钱包的 Universal Link / Deep Link 打开当前活动页。
2. Sui 只适配 Slush、OKX Wallet；优先用官方 Deep Link 打开钱包内置 DApp 浏览器，再由 Wallet Standard 完成连接和签名。
3. 不建设全量钱包搜索、钱包推荐、社交登录、内嵌钱包、法币入口或多账户管理。
4. 钱包未安装时只展示对应官方安装/打开入口，不实现自建钱包下载市场。
5. 首期验收机型覆盖一台 iOS 和一台 Android；每条链至少有一个钱包完成连接、签名、拒签和返回网页测试。

移动端跳转前保存活动路径和待选链；钱包返回网页后重新读取连接状态。challenge 在用户真正连接并取得地址后再申请，避免 App 切换期间提前过期。

### 8.4 统一接口

在 EchoHunt 前端新增活动钱包模块，对 `SignupPanel` 暴露统一状态：

```ts
type CampaignWalletConnection = {
  chain: 'solana' | 'sui' | 'monad' | 'bsc';
  address: string;
  walletName: string;
  connectedChainId?: string | number;
};

interface CampaignWalletAdapter {
  connect(chain: CampaignWalletChain): Promise<CampaignWalletConnection>;
  signMessage(message: string): Promise<string>;
  disconnect(): Promise<void>;
}
```

钱包模块是 client-only 组件，并通过动态加载降低活动首屏体积。活动页面和排行榜静态内容不应因为钱包 SDK 全部变为客户端渲染。

### 8.5 报名交互

推荐流程：

```text
选择活动支持的网络
  -> 展示该网络可用钱包
  -> 连接钱包并读取地址
  -> 展示网络、钱包名称、完整地址
  -> 完成任务和协议勾选
  -> 打开最终确认弹窗
  -> 按配置签名或直接报名
```

最终确认弹窗必须展示：

```text
确认报名

本次活动绑定后不可更换，请确认网络与钱包地址无误。

活动：{displayName.en}
网络：Solana
地址：完整地址

[返回修改] [确认并签名]
```

`signatureRequired === false` 时按钮改为 `确认报名`，提醒仍然保留。

以下状态变化必须清空已有 challenge 和签名：

- 用户切换钱包账号；
- 用户切换网络；
- 钱包断开；
- 活动切换；
- challenge 过期；
- 服务端返回活动配置已变化。

用户拒绝连接、拒绝签名、网络不匹配、地址格式错误和 challenge 过期分别显示明确错误，不统一显示“报名失败”。

## 9. 后端模块划分

建议新增或调整：

```text
src/xhunt/
├── constants/
│   └── campaign-wallet-chains.js
├── services/
│   ├── campaignRegistrationService.js
│   ├── campaignWalletConfigService.js
│   ├── campaignWalletChallengeService.js
│   └── campaignWalletVerificationService.js
├── models/
│   └── CampaignRegistration.js
└── api/
    ├── echohunt.js
    └── campaign.js
```

职责：

- `campaignWalletConfigService`：配置归一化、支持链判断、英文标题校验。
- `campaignWalletChallengeService`：生成消息、Redis TTL、一次性消费。
- `campaignWalletVerificationService`：地址规范化和三类签名验证。
- `campaignRegistrationService`：统一钱包/Email/历史 EVM 联系方式，完成唯一性校验和写表。
- 路由：认证、参数读取、调用服务、返回统一错误结构。

### 9.1 统一链常量

管理后台只保存 `solana`、`sui`、`monad`、`bsc` 枚举，不保存 RPC URL、chain ID 或钱包参数。后端和前端从同一份受控定义生成运行配置，至少包含：

```ts
type CampaignWalletChainConfig = {
  key: 'solana' | 'sui' | 'monad' | 'bsc';
  displayName: string;
  namespace: 'solana' | 'sui' | 'eip155';
  caipNetworkId: string;
  chainId?: number;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  signatureType: string;
};
```

已知主网标识可作为实现初值，但正式发布前必须用官方文档逐项复核：

| 网络 | 预期标识 | 发布前检查 |
| --- | --- | --- |
| Solana | `solana:mainnet` | RPC、钱包网络标识、Explorer URL |
| Sui | `sui:mainnet` | RPC、Wallet Standard chain、Explorer URL |
| Monad | `eip155:143` | chain ID、RPC、原生币、Explorer、`wallet_addEthereumChain` 参数 |
| BNB Chain | `eip155:56` | chain ID、RPC、原生币、Explorer、`wallet_addEthereumChain` 参数 |

RPC 通过环境配置或受控公共配置注入，不在组件中散落硬编码。钱包切链只读取统一常量；任一官方参数变化只改一处并覆盖对应测试。

## 10. 插件兼容边界

一期只在 EchoHunt Web 实现钱包连接和签名。现有插件仍只会提交 `evmAddress`，因此插件采用“前端跳转 + 后端拒绝”的双保险方案。

### 10.1 插件前端

插件从活动配置读取：

```json
{
  "walletRegistration": {
    "enabled": true,
    "echohuntRegistrationUrl": "https://app.echohunt.ai/campaigns/example-campaign"
  }
}
```

当 `enabled === true`：

1. 不展示旧的 EVM 地址输入框和插件内报名确认流程。
2. 报名按钮文案改为 `前往 EchoHunt 报名` / `Continue on EchoHunt`。
3. 点击后打开服务端返回的 `echohuntRegistrationUrl`。
4. 插件不自行拼接域名，避免测试、预发布和生产环境地址不一致。

### 10.2 插件报名接口强制拒绝

插件报名接口 `POST /api/xhunt/campaign/register` 读取服务端活动配置后，如果 `walletRegistration.enabled === true`，必须在处理 `evmAddress`、排名校验和写表之前返回 HTTP `403`：

```json
{
  "success": false,
  "error": "ECHOHUNT_WEB_REGISTRATION_REQUIRED",
  "message": "该活动需要连接钱包，请前往 EchoHunt 网页完成报名。",
  "messageEn": "This campaign requires a wallet connection. Continue on EchoHunt to register.",
  "redirectUrl": "https://app.echohunt.ai/campaigns/example-campaign"
}
```

这样旧版本插件即使没有识别新配置、仍然调用旧接口，也无法绕过钱包签名规则。该拒绝只作用于启用新模式的活动；历史活动继续使用原插件报名逻辑。

EchoHunt Web 报名接口不接受插件 token 代替 Auth Center token。插件打开网页后，用户按 EchoHunt 正常登录流程完成报名。

## 11. 错误码

建议新增稳定错误码：

| 错误码 | HTTP | 含义 |
| --- | --- | --- |
| `WALLET_REGISTRATION_NOT_ENABLED` | 400 | 活动未启用新钱包流程 |
| `WALLET_CHAIN_REQUIRED` | 400 | 缺少网络 |
| `WALLET_CHAIN_NOT_SUPPORTED` | 400 | 当前活动不支持该网络 |
| `WALLET_ADDRESS_REQUIRED` | 400 | 缺少钱包地址 |
| `WALLET_ADDRESS_INVALID` | 400 | 地址格式不符合所选链 |
| `WALLET_SIGNATURE_REQUIRED` | 400 | 当前活动要求签名 |
| `WALLET_SIGNATURE_INVALID` | 400 | 签名无法验证到报名地址 |
| `WALLET_CHALLENGE_INVALID` | 400 | challenge 不存在或绑定信息不一致 |
| `WALLET_CHALLENGE_EXPIRED` | 410 | challenge 已过期 |
| `WALLET_CHALLENGE_USED` | 409 | challenge 已使用 |
| `WALLET_ADDRESS_ALREADY_USED` | 409 | 同一活动下该链地址已报名 |
| `CAMPAIGN_ENGLISH_TITLE_REQUIRED` | 400/502 | 活动缺少签名所需英文标题 |
| `ECHOHUNT_WEB_REGISTRATION_REQUIRED` | 403 | 插件不能报名该活动，需跳转 EchoHunt Web |

错误响应不暴露签名恢复结果、Redis key 或内部堆栈。

## 12. 测试与验收

### 12.1 配置

1. 历史活动缺少 `walletRegistration` 时仍可按原 EVM/Email 流程报名。
2. 后台只能保存四个合法链值，数组去重且启用后至少一条。
3. 启用钱包报名但缺少 `displayName.en` 时禁止发布。
4. 活动已有报名后不能直接改变钱包报名核心规则。
5. 活动列表、详情和插件配置返回归一化钱包配置。

### 12.2 Challenge 与签名

1. 签名消息 `Campaign` 行为英文标题，不出现 `campaignKey`。
2. challenge 服务端记录正确关联 `campaignKey`，相同英文标题的两个活动不能互用 challenge。
3. 修改活动标题后，已签发 challenge 仍按 `titleSnapshot` 验证。
4. Monad、BNB Chain、Solana、Sui 的合法签名分别通过，错误地址或错误签名失败。
5. challenge 过期、重复使用、跨用户、跨活动、跨链、换地址均失败。
6. 前端不能通过自行构造消息绕过服务端 challenge。

### 12.3 报名和唯一性

1. 签名开启时缺少 challenge 或签名失败不能写表。
2. 签名关闭时保存 `verified: false` 和 `signatureRequired: false`。
3. 同活动、同链、同规范化地址的并发请求最多一条成功。
4. EVM 大小写变化不能绕过唯一约束。
5. Solana 大小写敏感地址按标准 Base58 比较。
6. Sui 短格式和完整格式规范化后不能重复报名。
7. Email 与钱包同时提交返回冲突错误。
8. Solana/Sui 地址不会进入 `XHuntUser.evmAddresses`。

### 12.4 查询接口

1. EchoHunt `me` 和报名成功响应返回一致的钱包对象。
2. 活动启用 `walletRegistration.enabled` 时，活动列表、详情、当前用户、报名成功响应、现有报名列表和管理后台查询均按各自 audience 返回约定的钱包数据。
3. 管理后台返回网络、完整钱包地址、签名状态、验证时间和必要审计字段。
4. 当前用户和公开报名列表返回完整钱包地址，不做地址掩码。
5. 公开报名列表不返回原始签名、nonce、challenge 或完整消息。
6. Email 报名返回 `walletRegistration: null`。
7. 历史活动的既有消费者仍可读取 `evmAddress`。
8. 插件当前用户接口和现有报名列表使用统一序列化器，不出现同一记录在不同接口字段含义不一致的情况。

### 12.5 插件跳转与接口拒绝

1. 插件读取到 `walletRegistration.enabled === true` 后不再展示旧 EVM 报名表单，按钮跳转服务端返回的 `echohuntRegistrationUrl`。
2. `echohuntRegistrationUrl` 在开发、预发布和生产环境分别指向对应 EchoHunt Web，不复用项目 `activeUrl`。
3. 新旧版本插件调用 `POST /api/xhunt/campaign/register` 报名新模式活动时，均返回 HTTP `403`、`ECHOHUNT_WEB_REGISTRATION_REQUIRED` 和正确的 `redirectUrl`，且不写入报名记录。
4. 历史模式活动继续使用原插件报名流程，不被误拒绝。
5. EchoHunt Web 报名接口拒绝使用插件 token 冒充 Auth Center token。

### 12.6 Web 钱包矩阵

以下组合是一期必须完成的真实钱包验收范围：

| 网络 | 钱包 | 连接 | 切链/网络校验 | 签名 | 拒签恢复 | 报名查询 |
| --- | --- | --- | --- | --- | --- | --- |
| Monad | MetaMask | 必测 | 必测 | 必测 | 必测 | 必测 |
| Monad | OKX Wallet | 必测 | 必测 | 必测 | 必测 | 必测 |
| BNB Chain | Binance Wallet | 必测 | 必测 | 必测 | 必测 | 必测 |
| BNB Chain | MetaMask | 必测 | 必测 | 必测 | 必测 | 必测 |
| BNB Chain | OKX Wallet | 必测 | 必测 | 必测 | 必测 | 必测 |
| Solana | Phantom | 必测 | 必测 | 必测 | 必测 | 必测 |
| Solana | OKX Wallet | 必测 | 必测 | 必测 | 必测 | 必测 |
| Sui | Slush | 必测 | 必测 | 必测 | 必测 | 必测 |
| Sui | OKX Wallet | 必测 | 必测 | 必测 | 必测 | 必测 |

同一 EVM 钱包需要分别验证 Monad 和 BNB Chain，不能因地址相同而跳过网络切换与目标 chain ID 校验。未列入的钱包不作为一期上线阻塞项。

### 12.7 EchoHunt Web 交互

1. 只展示管理后台配置的网络和本期明确支持的钱包。
2. 连接钱包后地址只读，不能手工编辑。
3. 切换账号或网络会清空 challenge 和签名。
4. 最终提交前明确展示 `本次活动绑定后不可更换`、英文活动标题、网络和完整地址。
5. 签名要求开启和关闭时按钮文案与流程正确。
6. 钱包拒绝、网络错误、challenge 过期均有就近错误反馈和重试入口。

### 12.8 移动端最小验收

1. 至少使用一台 iOS 和一台 Android 真机验收，不以桌面浏览器模拟移动端替代。
2. Monad 至少完成 MetaMask 或 OKX Wallet 的连接、切链、签名、拒签和返回网页。
3. BNB Chain 至少完成 Binance Wallet、MetaMask 或 OKX Wallet 中一个钱包的连接、切链、签名、拒签和返回网页。
4. Solana 至少完成 Phantom 或 OKX Wallet 的连接、签名、拒签和返回网页。
5. Sui 至少完成 Slush 或 OKX Wallet 的 Deep Link、钱包内置浏览器连接、签名、拒签和回到活动页。
6. 钱包未安装时显示对应官方安装/打开入口；取消跳转或返回网页后页面可继续操作。
7. App 切换期间活动路径和已选网络能够恢复；过期 challenge 不会继续提交，而是明确提示并允许重新申请。

### 12.9 链参数与发布前复核

1. 前后端和钱包切链逻辑均只从统一链常量读取网络参数，业务组件内不得散落 RPC、chain ID 或 Explorer URL。
2. 自动化测试固定校验 Solana `solana:mainnet`、Sui `sui:mainnet`、Monad `eip155:143`、BNB Chain `eip155:56` 的映射关系。
3. 上线前按官方主网文档逐项人工复核 RPC、chain ID/网络标识、Explorer、原生币和 `wallet_addEthereumChain` 参数，并记录复核日期和来源。
4. 四条链分别通过真实主网钱包的连接、网络识别和签名验证；不要求发起链上交易，也不应产生 Gas。

## 13. 实施顺序与工作量

建议顺序：

1. 增加配置归一化、统一链常量、后台控件和发布校验。
2. 增加数据库迁移、模型字段和统一序列化器。
3. 实现 challenge、链地址规范化和三类签名验证。
4. 改造 EchoHunt 报名接口、插件报名拒绝逻辑与所有报名查询接口。
5. 接入 EchoHunt Web 多 adapter 钱包模块、最小移动端跳转和最终确认弹窗。
6. 更新插件，使新模式活动隐藏旧表单并跳转服务端返回的 EchoHunt URL。
7. 使用测试活动完成桌面钱包矩阵和 iOS/Android 最小移动端真机联调。
8. 发布前按官方资料复核统一链常量并冻结上线版本。
9. 按数据库迁移、后端、管理后台、EchoHunt Web、插件跳转更新的顺序发布；后端拒绝逻辑必须先于或同时早于插件跳转更新上线。

工作量估算：

- 后端、迁移、管理后台和插件兼容：约 4–6 人日；
- EchoHunt Web 桌面端多链钱包接入：约 3–4 人日；
- iOS/Android 最小移动端 WalletConnect、Universal Link/Deep Link 适配与真机联调：约 3–4 人日；
- 合计约 10–14 人日，建议按 2 名开发配合测试安排约 1.5–2 周日历时间，并预留第三方钱包兼容性波动。

估算不包含第三方钱包自身缺陷修复、正式 RPC 采购、全量钱包市场、独立安全审计或历史报名数据清洗。若真实钱包联调发现某钱包的移动端协议能力与官方说明不一致，应优先保证每条链至少一个已确认钱包可用，再单独评估该钱包兼容成本。

生产环境迁移和发布由用户确认后执行；本文档不授权自动运行迁移、构建、服务重启或生产写操作。

## 14. 已确认实施范围

1. 一期只在 EchoHunt Web 完成钱包报名；插件统一跳转 EchoHunt，旧插件接口对新模式活动强制返回 `403 ECHOHUNT_WEB_REGISTRATION_REQUIRED`。
2. 首批钱包限定为：Monad 的 MetaMask、OKX Wallet；BNB Chain 的 Binance Wallet、MetaMask、OKX Wallet；Solana 的 Phantom、OKX Wallet；Sui 的 Slush、OKX Wallet。
3. 移动端纳入一期，采用最小可用方案，只覆盖上述四条链和首批钱包，不建设通用钱包市场。
4. 报名查询接口按 audience 返回约定的钱包数据；需要返回地址的现有接口返回完整钱包地址，不做掩码，但始终排除签名、nonce、challenge 和完整签名消息。
5. Monad 和 BNB Chain 的生产 RPC、chain ID 和钱包切链参数由统一链常量管理，上线前以官方主网配置复核。
6. 用户可见签名消息使用活动英文标题 `displayName.en`；真实 `campaignKey` 仅由服务端 challenge 内部关联，不能由前端标题替代服务端活动标识。
7. 正式配置字段统一为 `walletRegistration.enabled`，不增加错误拼写 `enabel` 的兼容分支。
