# EchoHunt 活动分榜单投稿地址技术分析

> 状态：已按需求变更版完成本地实现，待迁移演练、部署和联调
> 初始日期：2026-11-07
> 修订日期：2026-11-09
> 原型：https://yzi-s2.alphahan.win/
> 管理后台：`/Users/luykin/Documents/mac-work/luykin-chaineye-service/admin-web`
> 后端：`/Users/luykin/Documents/mac-work/luykin-chaineye-service`
> EchoHunt 前端：`/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt`

## 1. 需求结论

本需求不是多链钱包接入，也不是针对 Nym、XStable 或某种钱包开发专用逻辑，而是一个可供管理人员配置的通用活动能力：**决定地址是在报名阶段填写，还是在投稿阶段按榜单分别填写。**

管理后台提供两种模式：

| 模式 | 含义 | 行为 |
| --- | --- | --- |
| 报名时填写地址（旧模式） | 保持现有活动行为 | 用户报名时填写 EVM 地址，地址保存在 `CampaignRegistration.evmAddress` |
| 投稿时按榜单填写地址（新模式） | 地址与投稿榜单绑定 | 报名时不填写地址；用户第一次向某个榜单投稿时，填写该榜单自己的地址 |

新能力采用严格白名单式开关：**只有服务端活动配置明确满足 `addressCollectionMode === "leaderboard_submission"` 时才启用。** 字段缺失、空值、未知值或明确选择 `registration_evm`，全部按现有旧模式处理，不得根据榜单中是否存在 `addressInput` 等其它字段猜测开启新功能。

新模式必须满足以下前置条件：

1. 活动使用自定义榜单。
2. 至少一个榜单开启“主动投稿”。
3. 只有开启主动投稿的榜单才显示地址输入配置。
4. 每个开启投稿的榜单分别配置支持的链、输入框名称、占位文案、提示语和确认文案。
5. 前后端根据榜单配置的链类型执行对应的地址格式校验，后端校验结果为准。
6. 每个榜单的地址独立保存，不从另一个榜单自动复制。

新模式仍然是普通地址输入，不接入具体钱包。系统只对管理员配置的链类型和地址格式负责：

- 不连接钱包；
- 不请求签名；
- 可以配置并选择系统已支持的链类型；
- 可以按链类型校验和规范化地址；
- 不根据项目名称写任何业务分支；
- 不校验用户是否拥有该地址；
- 不校验用户是否在第三方平台完成交互。

系统负责展示后台配置的链选项和提示语、接收用户输入、执行前后端地址格式校验、按活动和榜单保存，并保证首次投稿后不可由用户修改。链地址校验与钱包接入是两件事：校验地址格式不需要连接钱包、签名或切换网络。

### 1.1 典型配置效果

Nym 榜单可以配置：

```text
输入框名称：Nym 收款地址
支持链：BSC
占位文案：请输入活动奖励收款地址
提示语：获奖后，奖励将发放至此地址。
确认文案：我已核对收款地址，提交后不可修改。
```

XStable 榜单可以配置：

```text
输入框名称：XStable 交互及收款地址
支持链：BSC、Solana、Sui；推荐 BSC
占位文案：请输入你在 XStable 参与交易的钱包地址
提示语：交互地址与奖励收款地址须一致，获奖资格将由 XStable 核验。
确认文案：我确认地址无误，提交后不可修改。
```

这些都是普通配置文案。后端不理解“Nym”“XStable”“交互地址”或“收款地址”的业务含义。

### 1.2 评估结论

结论：**现有投稿服务已经使用 `campaignKey + leaderboardKey` 区分榜单，适合扩展为通用的分榜单地址采集。地址不应继续扩展在报名表中，也不应重复写进每条投稿，而应建立一条用户在某活动、某榜单下的地址绑定记录。**

| 范围 | 难度 | 判断 |
| --- | --- | --- |
| 活动级模式选择 | 低到中 | 增加配置和历史默认值，旧活动行为保持不变 |
| 榜单链类型与文案配置 | 低到中 | 依附于现有 `tweetSubmission` 配置，仅投稿开启时展示 |
| 统一地址校验器 | 中 | 前后端共享链枚举和测试向量，后端负责最终校验与规范化 |
| 榜单地址绑定 | 中 | 需要迁移、唯一约束、首次投稿原子写入和不可修改规则 |
| 投稿服务改造 | 中 | 在现有投稿事务中创建或复用地址绑定 |
| EchoHunt 前端 | 中 | 报名表和投稿表根据模式切换，不涉及钱包 SDK |
| 管理后台与导出 | 中 | 展示配置、用户填写值和绑定时间 |

预计开发与首轮联调约 4–6 人日。

## 2. 当前实现与改造原因

### 2.1 报名服务

当前 `src/xhunt/services/campaignRegistrationService.js` 使用以下联系方式报名：

```json
{
  "evmAddress": "0x...",
  "email": null
}
```

未开启 Email 报名时，服务端强制要求 EVM 地址，并把地址写入 `CampaignRegistration.evmAddress`。这就是需要保留的旧模式。

新模式下，报名服务不再要求 `evmAddress`。地址延后到用户向具体榜单投稿时填写，因此：

- 报名记录中没有本次投稿地址；
- Nym 和 XStable 等不同榜单可以填写不同的值；
- 地址字段的显示含义由榜单配置文案决定；
- 投稿地址不写入 `XHuntUser.evmAddresses`。

### 2.2 投稿服务

当前 `src/xhunt/services/campaignTweetSubmissionService.js` 已经具备：

- 按 `customLeaderboards[].id` 识别 `leaderboardKey`；
- 校验用户已经报名；
- 校验推文属于当前登录的 X 账号；
- 按榜单执行周期和累计投稿限额；
- 在 `XhuntCampaignTweetSubmissions` 中保存投稿记录。

同一用户可以向一个榜单投稿多次。地址只需在第一次投稿时填写一次，后续投稿复用，因此不应把地址值重复保存到每条投稿记录中。

## 3. 领域关系与锁定粒度

```text
CampaignRegistration（活动报名）
  ├── LeaderboardAddressBinding（榜单 A 的地址）
  │     ├── TweetSubmission 1
  │     └── TweetSubmission 2
  └── LeaderboardAddressBinding（榜单 B 的地址）
        ├── TweetSubmission 3
        └── TweetSubmission 4
```

地址绑定唯一键：

```text
campaignKey + leaderboardKey + xHuntUserId
```

由此保证：

- 一个用户在一个活动的一个榜单下只有一个地址；
- 不同榜单必须分别填写，不自动继承或复制；
- 同一榜单的后续投稿复用首次投稿保存的地址；
- 地址不是用户账号级钱包，也不是整场活动共用字段；
- 用户不能通过修改请求替换已经绑定的地址。

本期不要求不同榜单的地址值在文本上必须不同。业务要求是“分别填写、分别保存”，不是强制两个字符串不相等。

### 3.1 地址绑定是不可变数据

地址绑定一旦创建即永久锁定，这是固定业务规则，不提供活动配置开关：

1. 锁定范围为 `campaignKey + leaderboardKey + xHuntUserId`。
2. `chain`、`address`、`addressNormalized`、所属活动、所属榜单和所属用户均不可修改。
3. 用户端、管理后台和内部业务接口都不提供修改、重新绑定或删除能力。
4. 后续投稿只能读取并复用已有绑定；请求携带不同链或地址时必须返回 `LEADERBOARD_ADDRESS_LOCKED`。
5. 用户切换到另一个榜单时创建另一条独立绑定，不影响已绑定榜单。
6. 前端隐藏编辑入口只是交互表现，真正约束必须由后端和数据库共同保证。

如果用户首次填写错误，本期也不能自行修改，应在提交前通过完整链、完整地址和确认文案让用户二次核对。任何人工纠错能力都属于新的产品需求，不能通过管理后台直接编辑数据库记录实现。

## 4. 活动配置契约

### 4.1 活动级地址填写模式

在活动配置顶层增加：

```json
{
  "addressCollectionMode": "leaderboard_submission"
}
```

支持值：

| 配置值 | 管理后台文案 | 行为 |
| --- | --- | --- |
| `registration_evm` | 报名时填写 EVM 地址（旧模式） | 使用现有报名 EVM/Email 逻辑 |
| `leaderboard_submission` | 投稿时按榜单填写地址 | 报名不要求 EVM，第一次向各榜单投稿时填写 |

兼容规则：

- 字段缺失、空值、未知值或 `registration_evm` 时都按旧模式处理，确保历史活动和选择旧模式的新活动不变。
- `allowEmailRegistration` 继续只服务旧模式的现有 Email 报名逻辑。
- 新模式不把投稿地址当作报名联系方式，也不写入报名表 `evmAddress`。
- 活动产生第一条报名记录后锁定 `addressCollectionMode`，避免同一活动同时存在两种含义的报名记录。

### 4.2 选择新模式的前置校验

管理后台只有同时满足以下条件时才允许选择 `leaderboard_submission`：

```text
leaderboardMode === "custom"
并且
至少一个 customLeaderboards[].tweetSubmission.enabled === true
```

交互规则：

1. 尚未开启任何主动投稿榜单时，新模式选项置灰，并提示“请先开启至少一个榜单的主动投稿”。
2. 已选择新模式后，如果管理员关闭最后一个主动投稿榜单，阻止保存并提示恢复投稿或切回旧模式。
3. 传统榜单模式不能选择新模式。
4. 关闭某个榜单的主动投稿时，该榜单的地址输入配置不再生效；如已有地址绑定或投稿记录，应阻止直接关闭并提示先处理历史数据。

### 4.3 新旧流程隔离

服务端统一使用严格判断函数，例如：

```javascript
function isLeaderboardSubmissionAddressEnabled(campaign) {
  return campaign?.addressCollectionMode === "leaderboard_submission";
}
```

只有该函数返回 `true` 时，才允许执行以下新逻辑：

- 读取和校验 `tweetSubmission.addressInput`；
- 要求第一次投稿传入链和地址；
- 查询或写入榜单地址绑定表；
- 写入投稿记录的 `addressBindingId`；
- 在本人投稿查询中返回 `addressInput` 和 `addressBinding`。

旧模式必须保持现有执行路径：

1. 报名请求、EVM/Email 校验和数据库写入逻辑不变。
2. 投稿请求仍只接收现有 `tweetUrl`，不要求链、地址或确认字段。
3. 不读取、校验或查询 `addressInput` 和榜单地址绑定表。
4. 投稿列表和详情响应保持现有字段结构，不附加值为 `null` 的新字段。
5. 不增加额外数据库 join、查询或锁，不产生旧活动的性能变化。
6. 插件、EchoHunt 和管理后台现有活动交互保持不变。

管理后台新建活动时默认使用 `registration_evm`。只有管理员主动选择并成功保存 `leaderboard_submission` 后，才视为开启新能力。

## 5. 榜单地址输入配置

### 5.1 配置位置

地址输入配置放在每个榜单自己的 `tweetSubmission` 下：

```json
{
  "addressCollectionMode": "leaderboard_submission",
  "leaderboardMode": "custom",
  "customLeaderboards": [
    {
      "id": "nym",
      "name": { "zh": "Nym", "en": "Nym" },
      "tweetSubmission": {
        "enabled": true,
        "period": "day",
        "periodLimit": 3,
        "totalLimit": 20,
        "addressInput": {
          "supportedChains": ["bsc"],
          "recommendedChain": "bsc"
        }
      }
    },
    {
      "id": "xstable",
      "name": { "zh": "XStable", "en": "XStable" },
      "tweetSubmission": {
        "enabled": true,
        "period": "day",
        "periodLimit": 3,
        "totalLimit": 20,
        "addressInput": {
          "supportedChains": ["bsc", "solana", "sui"],
          "recommendedChain": "bsc"
        }
      }
    }
  ]
}
```

### 5.2 字段定义

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `supportedChains` | string[] | 是 | 当前榜单允许选择的链，至少一项，只接受系统链注册表中的枚举值 |
| `recommendedChain` | string/null | 否 | 前端标记为“推荐”的链，必须包含在 `supportedChains` 中 |

输入框标题、占位文案、提示语和不可修改确认文案不属于活动配置。EchoHunt 前端按当前语言统一展示通用文案，避免运营为每个活动重复填写，也避免不同活动对“不可修改”的描述不一致。

输入配置不包含以下钱包接入字段：

- 钱包类型；
- RPC、chain ID 或 CAIP 标识；
- 钱包连接或签名方式；
- 项目专用代码标识。

### 5.3 管理后台展示条件

榜单内的“投稿地址输入”配置区域只在以下条件全部成立时展示：

```text
活动 addressCollectionMode === "leaderboard_submission"
并且
当前榜单 tweetSubmission.enabled === true
```

保存配置时校验：

1. 新模式下，每个开启主动投稿的榜单都必须配置至少一个 `supportedChains`。
2. `supportedChains` 去重后只允许系统链注册表中的枚举值。
3. `recommendedChain` 为空或属于当前 `supportedChains`。
4. 已有投稿地址绑定后，不能删除当前榜单、修改榜单 ID，或删除已有绑定使用的链。

### 5.4 统一链注册表与地址校验器

链能力由一份受控的共享注册表维护，例如 `shared/xhunt/submission-address-chains.json`。活动配置只保存链 key，不保存正则、RPC 或钱包参数：

```json
{
  "bsc": {
    "displayName": { "zh": "BSC", "en": "BSC" },
    "addressType": "evm"
  },
  "solana": {
    "displayName": { "zh": "Solana", "en": "Solana" },
    "addressType": "solana"
  },
  "sui": {
    "displayName": { "zh": "Sui", "en": "Sui" },
    "addressType": "sui"
  }
}
```

首期校验规则：

| 链 key | 地址类型 | 后端校验与规范化 |
| --- | --- | --- |
| `bsc` | `evm` | 使用成熟 EVM 地址库校验 20 字节地址；比较值保存小写，展示值可保存 checksum 格式 |
| `solana` | `solana` | Base58 解码后必须为 32 字节，再输出标准 Base58 |
| `sui` | `sui` | 使用 Sui 官方地址规范化逻辑，保存为小写 `0x` + 64 位十六进制 |

实现要求：

1. 后端提供按链 key 分派的权威校验器，例如 `validateSubmissionAddress(chain, address)`。
2. 前端使用同一份链枚举和等价校验规则提供即时反馈，但不能代替后端校验。
3. 前后端共享有效、无效和边界地址测试向量，避免校验语义漂移。
4. 多条 EVM 链可以复用 `evm` 地址校验器，但链 key 仍分别保存，便于展示和业务核验。
5. 增加新链时先扩展注册表、后端校验器、前端校验器和测试向量，再允许管理后台选择。
6. 链注册表不包含钱包品牌、RPC、Explorer、chain ID 或切链参数，因为本功能不发起链上交互。

## 6. 报名接口改造

### 6.1 旧模式

`addressCollectionMode` 缺失或为 `registration_evm` 时保持现有请求和校验：

```json
{
  "evmAddress": "0x...",
  "email": null
}
```

现有 EVM 格式、Email、唯一性和 `XHuntUser.evmAddresses` 同步规则不变。

### 6.2 新模式

`addressCollectionMode === "leaderboard_submission"` 时，报名请求不传地址：

```json
{
  "agreements": {
    "terms": true,
    "disclosure": true
  },
  "taskState": {},
  "registrationUrl": "https://..."
}
```

`registerCampaignParticipant` 根据服务端活动配置执行：

1. 不要求 `evmAddress`。
2. `CampaignRegistration.evmAddress` 保存为 `NULL`。
3. 排名门槛、X 账号质量、重复报名、任务和协议等既有校验保持不变。
4. 请求如果传入 `evmAddress`，返回 `REGISTRATION_ADDRESS_NOT_ALLOWED`，避免旧客户端把地址写到错误阶段。
5. 后续榜单地址不回写 `CampaignRegistration.evmAddress` 或 `XHuntUser.evmAddresses`。

## 7. 投稿接口契约

### 7.1 第一次向榜单投稿

现有接口路径保持不变：

```text
POST /api/xhunt/echohunt/campaigns/:campaignKey/leaderboards/:leaderboardKey/tweet-submissions
```

新模式下，第一次向当前榜单投稿时请求增加：

```json
{
  "tweetUrl": "https://x.com/example/status/1234567890",
  "chain": "bsc",
  "submissionAddress": "0x...",
  "addressConfirmed": true
}
```

服务端接收用户选择的 `chain`，但链是否允许以及使用哪种地址校验器以服务端活动配置和统一链注册表为准。展示文案由 EchoHunt 前端统一维护；服务端不接收钱包类型、客户端自定义正则或提示语。

第一次投稿流程：

1. 校验登录态、Twitter 身份、报名记录和投稿窗口。
2. 读取当前榜单的 `tweetSubmission.addressInput` 配置。
3. 确认 `chain` 属于当前榜单的 `supportedChains`。
4. 通过统一地址校验器校验并规范化 `submissionAddress`。
5. 校验推文链接、推文作者、重复投稿和限额。
6. 要求 `addressConfirmed === true`。
7. 在现有投稿事务内创建榜单地址绑定和投稿记录。
8. 投稿记录写入新建的 `addressBindingId`。

地址与第一次投稿在同一事务中提交：任何一步失败都不保存地址。这样可以避免用户只保存了一个不可修改地址，却因为推文无效而没有成功投稿。

### 7.2 后续投稿

当前用户在该榜单已经存在地址绑定时，请求只需提交推文：

```json
{
  "tweetUrl": "https://x.com/example/status/2345678901"
}
```

服务端读取并复用现有绑定。若客户端仍传入地址：

- 链和规范化地址均与已绑定值一致：可忽略并继续处理；
- 链或规范化地址不同：返回 `LEADERBOARD_ADDRESS_LOCKED`；
- 不提供用户修改或删除接口。

### 7.3 输入与地址校验

`submissionAddress` 先执行通用输入校验：

1. 必须是字符串。
2. `trim()` 后不能为空。
3. 长度不超过固定安全上限，例如 256 个 Unicode 字符。
4. 拒绝换行和不可见控制字符。
5. `chain` 必须是当前榜单配置允许的单个字符串。

通用校验通过后，再按链注册表选择 EVM、Solana、Sui 等地址校验器。服务端保存用户展示值和规范化比较值。地址格式通过只代表字符串符合该链地址规则，不代表用户拥有该地址，也不代表用户完成了任何链上或第三方平台交互。

## 8. 查询接口

现有接口：

```text
GET /api/xhunt/echohunt/campaigns/:campaignKey/tweet-submissions
```

每个榜单摘要增加：

```json
{
  "leaderboardKey": "xstable",
  "config": {
    "period": "day",
    "periodLimit": 3,
    "totalLimit": 20
  },
  "addressInput": {
    "supportedChains": ["bsc", "solana", "sui"],
    "recommendedChain": "bsc"
  },
  "addressBinding": {
    "chain": "bsc",
    "address": "0x...",
    "lockedAt": "2026-11-09T10:00:00.000Z"
  },
  "usage": {},
  "submissions": []
}
```

规则：

- 接口只返回链配置，不返回输入框文案；前端使用自身中英文通用文案。
- 尚未第一次投稿时返回 `addressBinding: null`。
- 以上新字段只在活动明确开启新模式时返回；旧模式保持当前响应结构，不增加 `addressInput` 或 `addressBinding` 字段。
- 新模式中未开启主动投稿的榜单不构造地址配置。
- 用户只能查询自己的完整链和地址值。

## 9. 数据模型与迁移

### 9.0 生产环境现状核对（2026-11-09，只读）

已通过生产 PostgreSQL 元数据和聚合查询确认：

| 项目 | 生产现状 |
| --- | --- |
| `CampaignRegistrations` 记录数 | 约 2,273 条 |
| 旧方案钱包字段 | 已存在 `walletChain`、`walletAddress`、`walletAddressNormalized`、`walletSignatureRequired`、`walletVerified`、`walletVerifiedAt`、`walletVerification` |
| 旧方案钱包字段数据 | 上述 7 个字段的非空记录数全部为 0 |
| 旧方案钱包索引 | 已存在 `idx_campaign_reg_campaign_wallet` 和部分唯一索引 `ux_campaign_reg_campaign_wallet` |
| 生产迁移记录 | 已执行 `20261107120000-add-wallet-registration-to-campaign-registrations.js` |
| 本地当前分支 | 该迁移文件和旧钱包代码已回滚；后续开发以当前本地代码为基线 |
| `XhuntCampaignTweetSubmissions` | 约 289 条历史记录，尚无 `addressBindingId` |
| `XHuntWebsiteCampaigns` | 15 条；`walletRegistration`、`addressCollectionMode` 配置数量均为 0 |

结论：**可以假设旧钱包报名数据为干净状态，不需要迁移或回填任何旧钱包数据；但不能假设生产表结构与本地一致。**

处理原则：

1. 新方案不能复用报名表中的旧钱包字段，因为它们属于“每次报名一个地址”的旧粒度，无法表达“每个榜单独立绑定”。
2. 新方案仍创建独立的榜单地址绑定表，并只给投稿表增加可空 `addressBindingId`。
3. 生产报名表中的 7 个空字段和 2 个空索引作为历史残留保留；新模型和业务代码完全忽略，不恢复旧代码，也不在本次功能中清理。
4. 不恢复本地已回滚的旧迁移文件。生产 `SequelizeMeta` 中保留已执行记录，后续迁移使用新的、更晚的文件名继续向前执行。
5. 新迁移不得依赖旧钱包字段存在，也不得尝试创建、修改或删除这些字段。这样生产环境有旧字段、新环境没有旧字段，两种 schema 都能运行同一份新代码。
6. 除非未来单独提出数据库清理需求，否则不再处理这些历史残留字段和索引。
7. 本次只读核对没有在生产执行迁移、SQL 写入、代码修改、重启或配置变更。

### 9.1 新增榜单地址绑定表

已新增 `XhuntCampaignLeaderboardAddressBindings`：

```text
id                         UUID         PRIMARY KEY
campaignKey                VARCHAR(128) NOT NULL
leaderboardKey             VARCHAR(128) NOT NULL
campaignRegistrationId     UUID         NOT NULL
xHuntUserId                UUID         NOT NULL
authCenterUserId           UUID         NULL
twitterId                  VARCHAR(64)  NULL
chain                      VARCHAR(32)  NOT NULL
address                    VARCHAR(256) NOT NULL
addressNormalized          VARCHAR(256) NOT NULL
promptSnapshot             JSONB        NOT NULL
lockedAt                   TIMESTAMPTZ  NOT NULL
createdAt                  TIMESTAMPTZ  NOT NULL
updatedAt                  TIMESTAMPTZ  NOT NULL
```

该表按不可变记录处理：`updatedAt` 创建时与 `createdAt` 相同，正常业务流程中不再变化。

`promptSnapshot` 保存第一次投稿时实际使用的链配置，例如：

```json
{
  "supportedChains": ["bsc", "solana", "sui"],
  "recommendedChain": "bsc"
}
```

该表保存用户选择的链、展示地址和规范化地址，但不保存 `walletType`、`walletName`、`verified`、`signature` 或 `challenge`。`chain` 只表示地址使用的链类型，不表示前端实际连接或切换到了该网络。

### 9.2 索引与约束

```sql
UNIQUE (campaignKey, leaderboardKey, xHuntUserId)
INDEX  (campaignRegistrationId)
INDEX  (campaignKey, leaderboardKey, lockedAt)
```

不对 `chain + addressNormalized` 建立跨用户唯一索引。格式校验不代表业务上禁止多人填写同一地址；如果某个活动需要地址查重，应另行配置或由运营、合作方核验流程处理，不能写死在通用功能中。

除唯一约束外，迁移 `20261109120000-add-campaign-leaderboard-address-bindings.js` 已增加保护触发器，拒绝修改或删除绑定记录。数据库禁止更新：

```text
campaignKey, leaderboardKey, campaignRegistrationId, xHuntUserId,
authCenterUserId, twitterId, chain, address, addressNormalized,
promptSnapshot, lockedAt
```

这样即使后续代码误用 `update`、管理接口或批量操作，也不能绕过不可修改规则。正常业务代码只允许 `INSERT` 和 `SELECT`。

### 9.3 投稿表字段

为 `XhuntCampaignTweetSubmissions` 增加：

```text
addressBindingId UUID NULL
```

- 新模式下新增投稿必须关联当前榜单地址绑定。
- 旧模式和历史投稿允许为空。
- 外键删除策略使用 `RESTRICT`，避免投稿失去当时使用的地址依据。

### 9.4 迁移兼容要求

数据库迁移必须是纯增量的：

1. 只新增榜单地址绑定表和投稿表的可空 `addressBindingId`。
2. 不回填、不修改、不删除任何历史报名或投稿数据。
3. 不给历史行增加新的非空约束。
4. 不重建或改变现有 `CampaignRegistration.evmAddress` 索引和唯一性语义。
5. 旧模式创建的新投稿继续允许 `addressBindingId = NULL`。
6. 新表为空时不影响现有服务启动、旧活动查询或投稿。
7. 本次新功能迁移不删除、重命名或复用生产已有的旧钱包字段和索引。
8. 新迁移时间戳必须晚于已执行的 `20261107120000`，并在当前生产 schema 上进行迁移前演练。

### 9.5 事务与并发

第一次投稿在同一个数据库事务中：

1. 锁定活动报名记录。
2. 获取当前 `campaignKey + leaderboardKey + xHuntUserId` 的事务锁。
3. 查询或创建地址绑定。
4. 执行现有重复投稿和限额校验。
5. 创建投稿并写入 `addressBindingId`。

数据库唯一约束负责兜底并发请求。两个不同地址的并发首次投稿最多一个可以建立绑定；另一个返回地址已锁定。

## 10. 管理后台交互

### 10.1 活动级选项

活动报名配置中增加：

```text
地址填写阶段
○ 报名时填写 EVM 地址（旧模式）
○ 投稿时按榜单分别填写地址
```

第二项在没有开启主动投稿榜单时置灰，并展示前置条件说明。

### 10.2 榜单级配置

在自定义榜单的“主动投稿”区域中：

1. 先开启 `主动投稿`。
2. 活动选择新模式后，显示“投稿地址输入”配置。
3. 管理员从系统链注册表中选择当前榜单支持的链，并可标记一个推荐链。
4. 管理员分别填写输入框名称、占位文案、提示语、确认文案的多语言内容。
5. 实时预览用户投稿时看到的链选择和输入区域。

不配置钱包品牌、RPC、签名或自定义地址正则。地址格式由选中的系统链类型决定。

### 10.3 地址与投稿管理

投稿管理列表增加：

```text
用户 | 榜单 | 链 | 投稿地址 | 绑定时间 | 推文 | 投稿时间
```

导出列至少包括：

```text
campaignKey, leaderboardKey, twitterId, username,
chain, submissionAddress, lockedAt, tweetId, tweetUrl, submittedAt
```

通用管理后台展示配置链和地址，但不显示钱包品牌或“所有权已验证”。

## 11. EchoHunt 前端交互

### 11.1 旧模式

报名表继续展示现有 EVM 地址输入逻辑，投稿区域不额外要求分榜单地址。

### 11.2 新模式

报名阶段：

- 不展示 EVM 地址输入框；
- 报名完成后才显示主动投稿区域。

第一次向某榜单投稿：

```text
选择榜单
  -> 展示后台配置的支持链和前端统一维护的通用文案
  -> 用户选择链；只有一条链时可直接展示并默认选中
  -> 用户填写文本地址
  -> 前端按所选链执行即时格式校验
  -> 勾选前端统一的“地址确认后不可修改”文案
  -> 填写推文链接
  -> 一次提交地址与推文
```

投稿成功后：

- 当前榜单展示已绑定的完整地址，只读；
- 同时展示已绑定的链，只读；
- 不展示修改或删除入口；
- 后续投稿只要求填写推文链接；
- 切换另一个榜单时，使用该榜单自己的配置和绑定状态。

前端状态必须按 `leaderboardKey` 隔离：

- 输入框文案；
- 已选链；
- 尚未提交的地址值；
- 已绑定地址；
- 确认勾选状态；
- 投稿链接；
- 投稿限额和历史；
- 错误信息。

不能使用一个全局地址状态在多个榜单间复用。

### 11.3 无钱包逻辑

本期前端不引入或调用：

- `wagmi`、`viem`；
- Solana Wallet Adapter；
- Sui dApp Kit；
- WalletConnect/Reown；
- 浏览器注入钱包；
- 移动端钱包 Deep Link；
- 网络切换或签名 API。

桌面端和移动端都是同一个“链选择 + 普通地址输入”表单流程。前端校验用于即时反馈，提交时仍必须由后端使用同一链规则重新校验。

## 12. 权限与数据边界

1. 系统只能证明某个登录用户在第一次投稿时选择了链并填写了格式合法的地址，不能证明地址所有权。
2. 可以返回 `chain` 和格式校验后的地址，但不使用 `verified`、`ownershipVerified`、`walletName` 等可能造成所有权已验证误解的字段。
3. 完整链和地址值只返回给当前用户本人、管理后台和鉴权后的内部接口。
4. 无鉴权的公开投稿接口不返回 `address`、`addressNormalized`、`addressBindingId` 或文案快照。
5. 客户端传入的提示语、榜单配置或锁定状态全部忽略，服务端只读取活动配置。
6. 常规日志记录 `requestId`、活动、榜单、用户和错误码，不打印完整地址值。

## 13. 错误码

| 错误码 | HTTP | 含义 |
| --- | --- | --- |
| `REGISTRATION_ADDRESS_NOT_ALLOWED` | 400 | 新模式报名请求错误地携带了 EVM 地址 |
| `LEADERBOARD_SUBMISSION_MODE_UNAVAILABLE` | 400 | 未开启主动投稿，不能使用新模式 |
| `LEADERBOARD_NOT_FOUND` | 404 | 榜单不存在 |
| `TWEET_SUBMISSION_DISABLED` | 400 | 当前榜单未开启主动投稿 |
| `LEADERBOARD_ADDRESS_CONFIG_INVALID` | 502 | 当前榜单缺少有效的地址输入配置 |
| `LEADERBOARD_ADDRESS_CHAIN_REQUIRED` | 400 | 第一次投稿缺少链类型 |
| `LEADERBOARD_ADDRESS_CHAIN_NOT_SUPPORTED` | 400 | 所选链不在当前榜单配置范围内 |
| `LEADERBOARD_ADDRESS_REQUIRED` | 400 | 第一次投稿缺少地址文本 |
| `LEADERBOARD_ADDRESS_INVALID` | 400 | 地址为空、过长、含控制字符或不符合所选链格式 |
| `LEADERBOARD_ADDRESS_CONFIRMATION_REQUIRED` | 400 | 未勾选配置的确认文案 |
| `LEADERBOARD_ADDRESS_LOCKED` | 409 | 当前榜单地址已绑定，不能替换 |
| `CAMPAIGN_REGISTRATION_REQUIRED` | 403 | 尚未完成活动报名 |

错误响应不包含其他用户数据、数据库记录 ID、完整地址、内部 SQL 或堆栈。

## 14. 兼容策略

### 14.1 历史活动

- `addressCollectionMode` 缺失、空值、未知值或 `registration_evm` 时均按旧模式处理。
- 现有 `CampaignRegistration.evmAddress` 和索引保持不变。
- 历史报名地址不迁移为榜单地址，因为无法确定它对应哪个榜单。
- 历史投稿的 `addressBindingId` 保持 `NULL`。
- 历史活动不查询新表、不增加新校验、不改变接口响应结构。
- 新模式只影响明确保存 `addressCollectionMode: "leaderboard_submission"` 的活动。

### 14.2 使用旧模式新建的活动

新建活动默认选择 `registration_evm`。管理员保持默认值或明确选择旧模式时：

- 报名页面继续展示现有 EVM/Email 输入；
- 报名服务继续执行现有联系方式校验和写表；
- 投稿页面和接口不展示或要求榜单地址；
- 即使榜单配置中误留 `addressInput`，服务端也必须忽略；
- 不查询或写入 `XhuntCampaignLeaderboardAddressBindings`；
- 不返回新模式专属响应字段。

### 14.3 配置变更

- 活动有报名后禁止切换地址填写模式。
- 榜单有地址绑定或投稿后禁止修改榜单 ID 或删除榜单。
- 榜单已有绑定后不能删除绑定记录正在使用的链；新增支持链只影响尚未首次投稿的用户。
- 修改提示语不修改已有绑定的 `promptSnapshot`。
- 关闭主动投稿时，如果已有绑定或投稿，必须先阻止保存并提示风险，不能让数据静默失去入口。

### 14.4 插件

新模式依赖 EchoHunt 的主动投稿页面。未支持该模式的插件：

- 不展示旧的 EVM 报名输入框；
- 报名入口跳转 EchoHunt；
- 旧插件调用报名接口并传 EVM 地址时，由服务端返回 `REGISTRATION_ADDRESS_NOT_ALLOWED` 或统一的 EchoHunt 跳转错误；
- 上述跳转或拒绝只允许发生在明确开启新模式的活动；
- 历史活动和使用旧模式新建的活动继续使用原插件报名逻辑。

## 15. 测试与验收

### 15.1 管理后台配置

1. 历史活动默认展示并保持旧模式。
2. 没有主动投稿榜单时不能选择新模式。
3. 开启一个榜单的主动投稿后可以选择新模式。
4. 关闭最后一个主动投稿榜单时阻止保存新模式配置。
5. 地址输入配置只在新模式且当前榜单开启投稿时展示。
6. 每个投稿榜单分别保存自己的支持链、推荐链和多语言文案。
7. 非法链 key、空支持链、推荐链不在支持链中时不能发布。
8. 缺少必填文案、文案过长或语言配置不完整时不能发布。
9. 管理后台不出现钱包品牌、RPC、签名或自定义正则配置。

### 15.2 报名

1. 旧模式继续要求现有 EVM/Email 联系方式。
2. 新模式不填写地址即可报名。
3. 新模式报名记录的 `evmAddress` 为 `NULL`。
4. 新模式报名请求携带 `evmAddress` 时拒绝。
5. 新模式报名页面不显示地址输入框。

### 15.3 第一次投稿

1. 每个开启投稿的榜单展示自己配置的输入文案。
2. 未选择链、选择榜单不支持的链时被拒绝。
3. 空字符串、只有空格、超长文本和控制字符被拒绝。
4. BSC/EVM、Solana、Sui 的合法测试地址分别通过，错误格式分别失败。
5. 前端和后端使用同一组有效、无效和边界测试向量。
6. 未勾选确认文案时不能提交。
7. 推文校验失败时地址绑定也不写入。
8. 投稿成功时在同一事务中创建地址绑定和投稿记录。
9. Nym 和 XStable 等不同榜单分别创建绑定，互不复用。

### 15.4 后续投稿与并发

1. 后续投稿不再要求输入地址。
2. 后续投稿复用当前榜单的 `addressBindingId`。
3. 客户端尝试传入另一个链或地址时返回 `LEADERBOARD_ADDRESS_LOCKED`。
4. 两个不同链或地址的并发首次投稿最多一个建立绑定。
5. 不同榜单可以填写相同文本，系统不做跨榜单或跨用户唯一性校验。
6. 现有推文作者、重复推文、周期限额和累计限额逻辑不回归。
7. 用户端、管理后台和内部业务 API 均不存在修改、重新绑定或删除入口。
8. 直接通过 ORM 更新链、地址或所属关系时被拒绝。
9. 直接执行数据库 `UPDATE` 或 `DELETE` 时被不可变保护触发器拒绝。

### 15.5 查询与权限

1. 用户查询按榜单返回支持链、本地化提示语和自己的链及绑定地址。
2. 管理后台展示和导出链、地址、绑定时间及投稿记录。
3. 公开投稿接口不返回地址或绑定 ID。
4. 提示语修改后，已有绑定保留原文案快照。
5. 日志和错误响应不泄露完整地址值。

### 15.6 旧模式零影响回归

分别使用一个未包含 `addressCollectionMode` 的历史活动和一个明确配置 `registration_evm` 的新活动验证：

1. 报名请求参数、校验结果、错误码和数据库写入与改造前一致。
2. 投稿请求仍只传 `tweetUrl` 即可成功，不要求链、地址或确认字段。
3. 报名、活动详情、本人投稿和公开投稿响应不增加新模式字段。
4. 不产生榜单地址绑定表的查询或写入。
5. 投稿记录的 `addressBindingId` 保持 `NULL`。
6. 插件与 EchoHunt 页面继续展示原有流程，不出现新模式入口或提示。
7. 旧活动即使意外带有 `tweetSubmission.addressInput`，服务端也忽略该配置。
8. 对关键旧接口保存改造前响应快照或契约测试，防止字段和错误码回归。

## 16. 实施结果与后续工作

本地实现已完成：

1. 增加活动级 `addressCollectionMode` 的归一化、管理后台选项和依赖校验。
2. 增加共享链注册表、后端地址校验器、前端即时校验器和共享测试向量。
3. 在现有榜单 `tweetSubmission` 配置中增加支持链和推荐链编辑；输入框与确认话术由 EchoHunt 前端统一维护。
4. 增加榜单地址绑定表、投稿表 `addressBindingId` 和数据库迁移。
5. 改造报名服务，按活动模式决定是否要求 EVM 地址。
6. 在投稿服务中实现链校验、地址规范化、第一次投稿原子创建绑定、后续复用和锁定检查。
7. 扩展本人查询、管理后台列表和鉴权导出。
8. 改造 EchoHunt 报名与投稿界面。
9. 增加链地址、首次绑定、后续复用、拒绝换地址、旧模式隔离和报名模式测试。

实际落地的迁移是：

```text
migrations-pg/20261109120000-add-campaign-leaderboard-address-bindings.js
```

该迁移只新增榜单地址绑定表、投稿表的可空 `addressBindingId`、索引、外键和不可变触发器；不读取、修改或删除生产已有的旧钱包字段，也不回填历史投稿。

已执行的本地验证：

- 后端针对性 Node 测试通过；
- Admin Web TypeScript `--noEmit` 检查通过；
- EchoHunt TypeScript `--noEmit` 检查通过；
- 两个仓库 `git diff --check` 通过。

仍需在部署前后完成：

- 在与生产同结构的临时库执行迁移 up/down 演练；
- 先部署数据库迁移，再部署后端、Admin Web 和 EchoHunt 前端；
- 使用一场无报名数据的新活动完成 BSC、Solana、Sui 首次投稿和后续投稿联调；
- 抽查旧活动报名、投稿及公开投稿查询响应，确认无新增字段和额外行为。

生产环境迁移和发布由用户确认后执行；本文档不授权自动运行迁移、构建、服务重启或生产写操作。

## 17. 明确不做的内容

以下内容不属于这个通用功能：

- 为 Nym、XStable 或其它项目写专用判断；
- 为 MetaMask、Phantom、OKX 等具体钱包写适配；
- 允许活动配置任意自定义地址正则或可执行校验逻辑；
- 同一地址跨用户唯一性校验；
- 钱包连接、账户监听和网络切换；
- challenge、nonce、Redis 一次性消费；
- `personal_sign`、`signMessage` 或其它签名；
- WalletConnect、Deep Link 或移动端钱包兼容；
- 地址所有权验证；
- 第三方平台交互资格验证。

本需求的核心是：**管理员选择地址填写阶段；新模式仅依赖主动投稿；每个投稿榜单配置支持链和输入提示；前后端按统一链注册表校验地址；用户第一次投稿时填写并锁定该榜单的链和地址。**
