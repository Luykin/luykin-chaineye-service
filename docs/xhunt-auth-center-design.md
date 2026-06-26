# XHunt 登录中心设计文档

## 1. 背景与目标

### 1.1 背景

当前 XHunt 已存在多套用户/登录相关数据：

- `XHuntUsers`：浏览器插件核心用户表，目前以 `twitterId` 作为主要唯一标识。
- `XHuntUserTokens`：插件用户 Token 表。
- `XHuntWebUsers` / `XHuntWebUserTokens`：早期 Web 站点 Twitter 登录方案，按 `twitterId + siteSource` 做站点隔离。

后续 XHunt 会存在多个 Web 端或业务站点，不能继续让每个站点维护一套独立登录逻辑，需要建设一个统一的认证中心。所有 XHunt Web 端都从认证中心完成登录、会话校验和用户信息获取。

### 1.2 核心目标

1. 建立独立于 `XHuntUsers` 的新登录中心用户体系。
2. 支持 4 种登录方式：
   - 账户密码
   - Gmail / Google OAuth 登录
   - EVM 钱包签名登录
   - Twitter OAuth 登录
3. 同一个登录中心用户可以同时绑定 4 种登录方式，绑定后任意一种方式都可以登录到同一个账号。
4. Twitter 登录用户可以通过 `twitterId` 与原有 `XHuntUsers` 关联，但新体系与旧 `XHuntUsers` 仍然是两套表。
5. 支持多个业务应用从登录中心认证，后续可平滑扩展为 OAuth2 / OIDC 风格的统一登录。
6. 对外展示用户名按固定优先级计算：
   `Twitter 名字 > 用户自己设置的账户名 > Gmail > EVM 地址`。

### 1.3 非目标

1. 不直接重构现有插件登录体系。
2. 不直接替换 `XHuntUsers` 的业务含义。
3. 不强制把所有历史 `XHuntWebUsers` 立即迁移到新体系，可以分阶段兼容。
4. 不把密码、OAuth Token、钱包私钥等敏感数据明文落库。

---

## 2. 总体架构

### 2.1 逻辑架构

```text
┌──────────────────────────┐
│      XHunt Web App A      │
└─────────────┬────────────┘
              │
┌─────────────▼────────────┐
│      XHunt Web App B      │
└─────────────┬────────────┘
              │
┌─────────────▼────────────┐
│      XHunt Web App N      │
└─────────────┬────────────┘
              │
              │  OAuth2/OIDC-like / JWT / UserInfo
              ▼
┌──────────────────────────────────────────────┐
│              XHunt Auth Center               │
│                                              │
│  - 用户主账号 AuthUser                       │
│  - 登录身份 AuthIdentity                     │
│  - 密码凭证 PasswordCredential               │
│  - 会话/RefreshToken Session                 │
│  - 应用 Client                               │
│  - 授权码 AuthorizationCode                  │
└──────────────────────┬───────────────────────┘
                       │
                       │ twitterId 关联
                       ▼
┌──────────────────────────────────────────────┐
│              Existing XHuntUsers             │
│     插件核心用户、KOL 排名、分类、旧业务数据      │
└──────────────────────────────────────────────┘
```

### 2.2 新旧体系关系

新登录中心的主用户表建议命名为 `AuthCenterXhuntUsers`，表示“认证中心 XHunt 用户”。命名原则是：不要以 `XHunt` 开头，而是以 `AuthCenter` 开头，同时保留 `Xhunt` 标识，便于和项目内其他认证表区分。

`AuthCenterXhuntUsers` 和原有 `XHuntUsers` 的关系：

- `AuthCenterXhuntUsers` 是新登录中心账号。
- `XHuntUsers` 是原插件体系账号。
- 当登录中心用户绑定或使用 Twitter 登录时，通过 `twitterId` 查找 `XHuntUsers`。
- 找到后，将 `AuthCenterXhuntUsers.xhuntUserId` 指向 `XHuntUsers.id`。
- 不建议登录中心默认创建 `XHuntUsers`，避免污染插件核心用户表；如后续业务需要，可增加明确的“创建/同步插件用户”流程。

---

## 3. 核心概念

### 3.1 AuthUser：登录中心主账号

一个真实用户在登录中心只有一个主账号。主账号不直接代表某一种登录方式，而是承载账号状态、展示信息、关联旧 XHunt 用户等通用信息。

### 3.2 AuthIdentity：登录身份

一个主账号可以绑定多个登录身份。

示例：

```text
AuthCenterXhuntUser: user_001
├── password identity: username = kunge
├── google identity: google sub = 123456 / email = xxx@gmail.com
├── evm identity: 0xabc...
└── twitter identity: twitterId = 987654321
```

用户绑定完成后，可以用任意身份登录到同一个 `AuthCenterXhuntUser`。

### 3.3 Client：业务应用

每个 Web 站点或业务系统都是一个 Client，例如：

| clientKey | 说明 |
|----------|------|
| `xhunt-web` | XHunt 主站 |
| `xhunt-campaign` | 活动站 |
| `xhunt-data` | 数据站 |
| `xhunt-admin-lite` | 轻后台或内部工具 |

Client 用于限制回调地址、Token audience、允许的域名和权限范围。

---

## 4. 数据模型设计

### 4.1 AuthCenterXhuntUsers

登录中心主账号表。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | UUID | 是 | 主键 |
| `accountName` | STRING | 否 | 用户自己设置的账户名，账户密码登录使用，唯一 |
| `accountNameLower` | STRING | 否 | 小写账户名，用于唯一索引和登录查询 |
| `displayName` | STRING | 否 | 用户自定义展示名，可选；最终展示名由规则计算 |
| `avatar` | STRING | 否 | 用户头像，优先使用 Twitter / Google 头像 |
| `primaryTwitterId` | STRING | 否 | 当前主要 Twitter 身份的 twitterId |
| `primaryGoogleEmail` | STRING | 否 | 当前主要 Gmail 邮箱 |
| `primaryEvmAddress` | STRING | 否 | 当前主要 EVM 地址，小写 |
| `xhuntUserId` | UUID | 否 | 关联旧表 `XHuntUsers.id` |
| `status` | STRING | 是 | `active` / `disabled` / `locked`，默认 `active` |
| `lastLoginAt` | DATE | 否 | 最后登录时间 |
| `loginCount` | INTEGER | 是 | 登录次数，默认 0 |
| `metadata` | JSON | 否 | 扩展字段 |
| `createdAt` | DATE | 是 | 创建时间 |
| `updatedAt` | DATE | 是 | 更新时间 |

建议索引：

```text
unique idx_auth_users_account_name_lower(accountNameLower) where accountNameLower is not null
idx_auth_users_xhunt_user_id(xhuntUserId)
idx_auth_users_primary_twitter_id(primaryTwitterId)
idx_auth_users_primary_evm_address(primaryEvmAddress)
idx_auth_users_status(status)
```

说明：

- `accountName` 是用户自己设置的账户名，也是账户密码登录时输入的账号。
- `accountNameLower` 用于防止 `KunGe` 和 `kunge` 被注册成两个账号。
- `displayName` 只是用户自定义资料，不高于 Twitter 名字的展示优先级。

---

### 4.2 AuthCenterXhuntIdentities

登录身份表，一种登录方式对应一条或多条身份记录。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | UUID | 是 | 主键 |
| `userId` | UUID | 是 | 关联 `AuthCenterXhuntUsers.id` |
| `provider` | STRING | 是 | `password` / `google` / `evm` / `twitter` |
| `providerSubject` | STRING | 是 | 第三方唯一 ID：用户名、Google sub、EVM 地址、twitterId |
| `providerSubjectLower` | STRING | 是 | 小写规范化值，用于唯一索引 |
| `username` | STRING | 否 | Twitter username、账户名等 |
| `displayName` | STRING | 否 | 第三方展示名 |
| `email` | STRING | 否 | Google 邮箱 |
| `emailVerified` | BOOLEAN | 否 | 邮箱是否已验证 |
| `avatar` | STRING | 否 | 第三方头像 |
| `accessTokenEncrypted` | TEXT | 否 | 第三方 access token，加密存储；不需要调用第三方时可不存 |
| `refreshTokenEncrypted` | TEXT | 否 | 第三方 refresh token，加密存储 |
| `tokenExpiry` | DATE | 否 | 第三方 token 过期时间 |
| `isPrimary` | BOOLEAN | 是 | 是否为该 provider 的主要身份，默认 true |
| `lastUsedAt` | DATE | 否 | 最近一次用该身份登录时间 |
| `createdAt` | DATE | 是 | 创建时间 |
| `updatedAt` | DATE | 是 | 更新时间 |

建议唯一约束：

```text
unique idx_auth_identity_provider_subject(provider, providerSubjectLower)
unique idx_auth_identity_user_provider(userId, provider)
idx_auth_identity_user_id(userId)
```

本期约束：同一个 `AuthCenterXhuntUser` 每种登录方式最多绑定一个身份，即最多一个账户密码、一个 Google 账号、一个 EVM 地址、一个 Twitter 账号。

不同 provider 的 `providerSubject` 取值规则：

| provider | providerSubject | providerSubjectLower |
|----------|-----------------|----------------------|
| `password` | accountName | accountName.toLowerCase() |
| `google` | Google user sub，推荐不用 email 做唯一主键 | Google sub |
| `evm` | EVM 地址 | lower-case address |
| `twitter` | twitterId | twitterId |

说明：

- Google 邮箱可能变化，唯一标识应优先使用 Google `sub`。
- EVM 地址统一小写存储和比较。
- Twitter 使用 `twitterId` 做唯一标识，username 只用于展示，会变化。

---

### 4.3 AuthCenterXhuntPasswordCredentials

账户密码凭证表。密码相关字段单独存放，便于安全控制和后续升级哈希算法。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | UUID | 是 | 主键 |
| `userId` | UUID | 是 | 关联 `AuthCenterXhuntUsers.id`，唯一 |
| `usernameLower` | STRING | 是 | 登录账户名小写，唯一 |
| `passwordHash` | TEXT | 是 | 密码哈希 |
| `passwordAlgo` | STRING | 是 | `bcrypt` / `argon2id` |
| `passwordVersion` | INTEGER | 是 | 密码策略版本，默认 1 |
| `failedAttempts` | INTEGER | 是 | 连续失败次数 |
| `lockedUntil` | DATE | 否 | 锁定到期时间 |
| `passwordChangedAt` | DATE | 是 | 密码最后修改时间 |
| `createdAt` | DATE | 是 | 创建时间 |
| `updatedAt` | DATE | 是 | 更新时间 |

建议索引：

```text
unique idx_auth_password_user_id(userId)
unique idx_auth_password_username_lower(usernameLower)
idx_auth_password_locked_until(lockedUntil)
```

密码策略建议：

- 当前项目已有 `bcryptjs`，短期可使用 bcrypt，cost 建议不低于 12。
- 中长期可升级为 `argon2id`。
- 密码不允许明文日志输出。
- 登录失败需要做 IP、设备指纹、账户维度的限流。

---

### 4.4 AuthCenterXhuntClients

接入认证中心的业务应用表。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | UUID | 是 | 主键 |
| `clientKey` | STRING | 是 | 客户端标识，例如 `xhunt-web`，唯一 |
| `clientName` | STRING | 是 | 展示名称 |
| `clientType` | STRING | 是 | `public` / `confidential` |
| `clientSecretHash` | TEXT | 否 | 服务端应用密钥哈希，public client 可为空 |
| `allowedRedirectUris` | JSON | 是 | 允许的 OAuth 回调地址列表 |
| `allowedOrigins` | JSON | 是 | 允许跨域来源列表 |
| `allowedScopes` | JSON | 是 | 允许申请的 scope |
| `isActive` | BOOLEAN | 是 | 是否启用 |
| `createdAt` | DATE | 是 | 创建时间 |
| `updatedAt` | DATE | 是 | 更新时间 |

建议索引：

```text
unique idx_auth_clients_client_key(clientKey)
idx_auth_clients_is_active(isActive)
```

---

### 4.5 AuthCenterXhuntSessions

登录会话/Refresh Token 表。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | UUID | 是 | 主键，也是 JWT payload 中的 `sessionId` |
| `userId` | UUID | 是 | 关联 `AuthCenterXhuntUsers.id` |
| `clientId` | UUID | 否 | 关联 `AuthCenterXhuntClients.id` |
| `refreshTokenHash` | TEXT | 是 | Refresh Token 哈希，不存明文 |
| `accessTokenJti` | STRING | 否 | 当前 Access Token 的 jti，用于审计/撤销 |
| `fingerprint` | TEXT | 否 | 设备指纹 |
| `userAgent` | TEXT | 否 | UA 摘要或原文 |
| `ipHash` | STRING | 否 | IP 哈希，避免直接存敏感 IP |
| `lastUsedAt` | DATE | 否 | 最近使用时间 |
| `expiresAt` | DATE | 是 | Refresh Token 过期时间 |
| `revokedAt` | DATE | 否 | 撤销时间 |
| `revokeReason` | STRING | 否 | 撤销原因 |
| `createdAt` | DATE | 是 | 创建时间 |
| `updatedAt` | DATE | 是 | 更新时间 |

建议索引：

```text
idx_auth_sessions_user_id(userId)
idx_auth_sessions_client_id(clientId)
idx_auth_sessions_expires_at(expiresAt)
idx_auth_sessions_revoked_at(revokedAt)
unique idx_auth_sessions_refresh_token_hash(refreshTokenHash)
```

Token 有效期建议：

| Token | 有效期 | 说明 |
|-------|--------|------|
| Access Token | 15 分钟 - 2 小时 | 给前端或业务站点调用 API 使用 |
| Refresh Token | 30 天 | 用于刷新 Access Token |
| OAuth Authorization Code | 5 分钟 | 一次性使用 |

如果为了兼容现有 XHunt 逻辑，也可以先保持 Access Token 30 天，但登录中心长期建议改成短 Access Token + 长 Refresh Token。

---

### 4.6 AuthCenterXhuntAuthorizationCodes

当业务应用走统一登录跳转时使用授权码表。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | UUID | 是 | 主键 |
| `codeHash` | TEXT | 是 | 授权码哈希，唯一 |
| `clientId` | UUID | 是 | 关联 Client |
| `userId` | UUID | 是 | 关联登录用户 |
| `redirectUri` | TEXT | 是 | 本次授权使用的回调地址 |
| `scope` | STRING | 否 | 授权范围 |
| `codeChallenge` | STRING | 否 | PKCE challenge |
| `codeChallengeMethod` | STRING | 否 | `S256` |
| `nonce` | STRING | 否 | OIDC nonce |
| `expiresAt` | DATE | 是 | 过期时间 |
| `consumedAt` | DATE | 否 | 使用时间 |
| `createdAt` | DATE | 是 | 创建时间 |
| `updatedAt` | DATE | 是 | 更新时间 |

建议索引：

```text
unique idx_auth_codes_code_hash(codeHash)
idx_auth_codes_client_user(clientId, userId)
idx_auth_codes_expires_at(expiresAt)
```

---

### 4.7 AuthCenterXhuntAuditLogs

认证中心审计日志表，用于安全排查。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | UUID | 是 | 主键 |
| `userId` | UUID | 否 | 用户 ID，未登录失败可为空 |
| `clientKey` | STRING | 否 | 客户端标识 |
| `eventType` | STRING | 是 | `login_success` / `login_failed` / `bind_identity` / `unbind_identity` / `logout` 等 |
| `provider` | STRING | 否 | 登录方式 |
| `success` | BOOLEAN | 是 | 是否成功 |
| `reason` | STRING | 否 | 失败原因或操作原因 |
| `fingerprint` | TEXT | 否 | 设备指纹 |
| `ipHash` | STRING | 否 | IP 哈希 |
| `metadata` | JSON | 否 | 扩展信息 |
| `createdAt` | DATE | 是 | 创建时间 |
| `updatedAt` | DATE | 是 | 更新时间 |

---

## 5. 登录与绑定流程

### 5.1 账户密码注册

```text
前端提交 accountName + password
        │
        ▼
校验 accountName 格式、密码强度、频控
        │
        ▼
检查 accountNameLower 是否已存在
        │
        ▼
创建 AuthCenterXhuntUsers
        │
        ├── accountName / accountNameLower
        │
        ▼
创建 AuthCenterXhuntIdentities(provider=password)
        │
        ▼
创建 AuthCenterXhuntPasswordCredentials(passwordHash)
        │
        ▼
创建 Session，签发 Token
```

账户名建议规则：

- 长度 3 - 32。
- 允许字母、数字、下划线、短横线。
- 不允许纯数字。
- 保留系统关键字，例如 `admin`、`root`、`system`、`xhunt` 等。
- 本期账户名注册后不允许修改；如未来要开放修改，需要单独设计历史账户名保留、风险校验和冷却时间。

### 5.2 账户密码登录

```text
输入 accountName + password
        │
        ▼
按 accountNameLower 查 PasswordCredential
        │
        ▼
检查账户状态、锁定状态、限流
        │
        ▼
bcrypt/argon2id 校验密码
        │
        ├── 失败：failedAttempts + 1，必要时 lockedUntil
        │
        └── 成功：清空 failedAttempts
        │
        ▼
更新 lastLoginAt / loginCount / identity.lastUsedAt
        │
        ▼
创建 Session，签发 Token
```

---

### 5.3 Gmail / Google OAuth 登录

```text
前端请求 Google 授权 URL
        │
        ▼
认证中心生成 state + codeVerifier，写 Redis
        │
        ▼
Google 回调 code + state
        │
        ▼
认证中心换取 Google Token，获取用户信息
        │
        ▼
用 Google sub 查 AuthCenterXhuntIdentities(provider=google)
        │
        ├── 已存在：登录该 identity 关联的 AuthUser
        │
        └── 不存在：创建 AuthUser + google identity
        │
        ▼
创建 Session，签发 Token
```

Google 身份字段建议：

| 字段 | 值 |
|------|----|
| `provider` | `google` |
| `providerSubject` | Google `sub` |
| `email` | Google email |
| `emailVerified` | Google email_verified |
| `displayName` | Google name |
| `avatar` | Google picture |

注意：

- Gmail 展示优先级低于 Twitter 和账户名。
- 登录范围支持所有 Google 账号邮箱，不限制 `@gmail.com` 后缀。
- 不建议只用 email 做唯一主键，因为 Google `sub` 更稳定。

---

### 5.4 EVM 钱包登录

钱包登录建议采用接近 SIWE（Sign-In with Ethereum / EIP-4361）的挑战消息格式，至少包含：

- domain
- address
- statement
- nonce
- issuedAt
- expirationTime
- chainId，可选
- clientKey，可选

流程：

```text
前端提交 address 请求 nonce
        │
        ▼
认证中心生成 challenge，Redis 保存 5 分钟
        │
        ▼
前端让钱包签名 challenge
        │
        ▼
认证中心用 ethers.verifyMessage 校验签名
        │
        ▼
按 lower(address) 查 AuthCenterXhuntIdentities(provider=evm)
        │
        ├── 已存在：登录该 AuthUser
        │
        └── 不存在：创建 AuthUser + evm identity
        │
        ▼
删除 nonce，创建 Session，签发 Token
```

EVM 身份字段建议：

| 字段 | 值 |
|------|----|
| `provider` | `evm` |
| `providerSubject` | 原始 checksum 地址或小写地址 |
| `providerSubjectLower` | 小写地址 |
| `username` | 短地址展示，例如 `0x1234...abcd` |

安全要求：

- nonce 一次性使用。
- challenge 必须带过期时间。
- 签名消息中必须包含当前登录域名，防止跨站复用。
- 校验 recovered address 与请求 address 完全匹配。
- 本期一个 AuthUser 只能绑定一个 EVM 地址；如已绑定 EVM，绑定新地址时必须先解绑旧地址，且解绑仍需保证账号至少保留一种登录方式。
- EVM 身份只按地址识别，不按 chainId 拆分身份。

---

### 5.5 Twitter OAuth 登录

```text
前端请求 Twitter 授权 URL
        │
        ▼
认证中心生成 state + codeVerifier，写 Redis
        │
        ▼
Twitter 回调 code + state
        │
        ▼
认证中心换取 Twitter Token，获取用户信息
        │
        ▼
按 twitterId 查 AuthCenterXhuntIdentities(provider=twitter)
        │
        ├── 已存在：登录该 AuthUser
        │
        └── 不存在：创建 AuthUser + twitter identity
        │
        ▼
按 twitterId 查旧表 XHuntUsers
        │
        ├── 找到：AuthUser.xhuntUserId = XHuntUsers.id
        │
        └── 未找到：保持为空
        │
        ▼
创建 Session，签发 Token
```

Twitter 身份字段建议：

| 字段 | 值 |
|------|----|
| `provider` | `twitter` |
| `providerSubject` | twitterId |
| `username` | Twitter username / handle |
| `displayName` | Twitter name |
| `avatar` | Twitter profile_image_url |

注意：

- Twitter username 会变化，不能作为唯一主键。
- 与 `XHuntUsers` 关联时必须使用 `twitterId`。
- 登录中心不要默认把 Twitter 用户写入 `XHuntUsers`，除非后续明确需要插件兼容。

---

## 6. 登录方式绑定与解绑

### 6.1 绑定新登录方式

绑定新登录方式必须在用户已登录的情况下进行。

通用流程：

```text
用户已登录 AuthUser
        │
        ▼
选择绑定 provider
        │
        ▼
完成 provider 验证：密码验证 / Google OAuth / 钱包签名 / Twitter OAuth
        │
        ▼
用 provider + providerSubjectLower 查询 AuthIdentity
        │
        ├── 不存在：绑定到当前 AuthUser
        │
        ├── 已存在且 userId 是当前用户：刷新资料，返回已绑定
        │
        └── 已存在但 userId 是其他用户：拒绝绑定，提示该登录方式已被占用
```

### 6.2 冲突处理

不建议自动合并两个 AuthUser，因为可能造成账号接管风险。

冲突场景示例：

- 用户 A 已绑定 Gmail。
- 用户 B 登录后尝试绑定同一个 Gmail。
- 系统应拒绝绑定，并提示“该登录方式已绑定到其他账号”。

不实现账号合并流程；后续也不规划自动或手动合并。遇到身份已被其他 AuthUser 占用时，一律拒绝绑定或登录到该身份原本所属账号。

### 6.3 解绑登录方式

解绑规则：

1. 至少保留一种可登录方式。
2. 解绑敏感身份前要求二次验证，例如重新输入密码、重新钱包签名或重新 OAuth。
3. 如果解绑 Twitter，需要同步清空或重新计算 `primaryTwitterId`。
4. 如果解绑后不再有 Twitter 身份，可以保留历史 `xhuntUserId`，但对外接口需要标识当前是否仍绑定 Twitter。

---

## 7. 展示用户名规则

### 7.1 优先级

对外展示用户名按以下优先级计算：

```text
Twitter 名字 > 用户自己设置的账户名 > Gmail > EVM 地址
```

建议实现一个统一函数，例如：

```javascript
function resolveAuthUserPublicName(user, identities) {
  const twitter = identities.find((item) => item.provider === "twitter");
  if (twitter?.username) return twitter.username;
  if (twitter?.displayName) return twitter.displayName;

  if (user.accountName) return user.accountName;

  const google = identities.find((item) => item.provider === "google");
  if (google?.email) return google.email;

  const evm = identities.find((item) => item.provider === "evm");
  if (evm?.providerSubjectLower) return shortAddress(evm.providerSubjectLower);

  return `user_${String(user.id).slice(0, 8)}`;
}
```

### 7.2 EVM 地址展示

EVM 地址不建议完整暴露为用户名，默认展示短地址：

```text
0x1234...abcd
```

### 7.3 头像规则

头像可按类似优先级处理：

```text
Twitter avatar > Google picture > 用户自定义 avatar > 默认头像
```

---

## 8. 对外认证方式

### 8.1 近期实现：JWT + UserInfo

第一阶段可以先提供简单的 JWT 认证能力，满足 XHunt 多个 Web 端接入。

核心接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/xhunt/auth-center/password/register` | 账户密码注册 |
| `POST` | `/api/xhunt/auth-center/password/login` | 账户密码登录 |
| `POST` | `/api/xhunt/auth-center/google/url` | 获取 Google 授权 URL |
| `POST` | `/api/xhunt/auth-center/google/callback` | Google 登录回调 |
| `GET` | `/api/xhunt/auth-center/wallet/nonce` | 获取钱包挑战消息 |
| `POST` | `/api/xhunt/auth-center/wallet/verify` | 钱包签名登录 |
| `POST` | `/api/xhunt/auth-center/twitter/url` | 获取 Twitter 授权 URL |
| `POST` | `/api/xhunt/auth-center/twitter/callback` | Twitter 登录回调 |
| `GET` | `/api/xhunt/auth-center/me` | 获取当前用户信息 |
| `POST` | `/api/xhunt/auth-center/token/refresh` | 刷新 Access Token |
| `POST` | `/api/xhunt/auth-center/logout` | 当前设备登出 |
| `POST` | `/api/xhunt/auth-center/logout-all` | 所有设备登出 |
| `POST` | `/api/xhunt/auth-center/identities/:provider/bind` | 绑定登录方式 |
| `DELETE` | `/api/xhunt/auth-center/identities/:identityId` | 解绑登录方式 |

### 8.2 中期实现：OAuth2 Authorization Code + PKCE

当多个独立站点都从登录中心跳转登录时，建议提供 OAuth2 风格接口。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/xhunt/auth-center/oauth/authorize` | 授权入口 |
| `POST` | `/api/xhunt/auth-center/oauth/token` | 授权码换 Token / Refresh Token |
| `GET` | `/api/xhunt/auth-center/oauth/userinfo` | 获取用户信息 |
| `GET` | `/api/xhunt/auth-center/.well-known/jwks.json` | 公钥列表，供业务站点验签 |

推荐授权参数：

```text
response_type=code
client_id=xhunt-web
redirect_uri=https://xhunt.ai/auth/callback
scope=openid profile xhunt.basic
state=random_state
code_challenge=pkce_challenge
code_challenge_method=S256
nonce=random_nonce
```

### 8.3 JWT Payload 建议

Access Token payload：

```json
{
  "sub": "auth_user_uuid",
  "sid": "session_uuid",
  "jti": "access_token_jti",
  "aud": "xhunt-web",
  "iss": "https://api.cryptohunt.ai/api/xhunt/auth-center",
  "scope": "openid profile xhunt.basic",
  "xhuntUserId": "legacy_xhunt_user_uuid_or_null",
  "providers": ["twitter", "google", "evm", "password"],
  "iat": 1710000000,
  "exp": 1710003600
}
```

UserInfo 响应：

```json
{
  "id": "auth_user_uuid",
  "username": "resolved_public_name",
  "displayName": "resolved_public_name",
  "avatar": "https://...",
  "providers": ["twitter", "google", "evm", "password"],
  "twitter": {
    "twitterId": "123456789",
    "username": "twitter_handle"
  },
  "google": {
    "email": "user@gmail.com",
    "emailVerified": true
  },
  "evm": {
    "address": "0xabc..."
  },
  "xhuntUserId": "legacy_xhunt_user_uuid_or_null",
  "isLinkedToXHuntUser": true
}
```

---

## 9. 与旧 XHuntUser 的关联策略

### 9.1 关联时机

以下场景尝试关联旧 `XHuntUsers`：

1. 用户使用 Twitter 登录认证中心。
2. 用户在认证中心绑定 Twitter。
3. 后台迁移历史数据时发现已有 Twitter identity。

### 9.2 关联逻辑

```text
拿到 twitterId
    │
    ▼
XHuntUser.findOne({ where: { twitterId } })
    │
    ├── 找到：AuthUser.xhuntUserId = XHuntUser.id
    └── 未找到：AuthUser.xhuntUserId 保持 null
```

### 9.3 数据同步范围

可以从 `XHuntUsers` 同步到登录中心响应的字段：

| 字段 | 用途 |
|------|------|
| `kolRank20W` | KOL 排名展示 |
| `classification` | 用户分类展示 |
| `avatar` | 头像兜底 |
| `username` | Twitter username 兜底 |
| `displayName` | Twitter displayName 兜底 |

不建议从登录中心反向覆盖 `XHuntUsers`，除非是 Twitter 登录时刷新 Twitter 基础资料并且确认不会影响插件业务。

---

## 10. 安全设计

### 10.1 通用安全要求

1. OAuth `state` 必须使用 Redis 保存并设置短 TTL。
2. OAuth `state` 使用后立即删除，防止重放。
3. 钱包 nonce 使用后立即删除。
4. Refresh Token 只存哈希，不存明文。
5. 第三方 OAuth Token 如需落库，必须加密后存储。
6. 密码哈希不输出日志。
7. 登录接口需要设备指纹/IP/账号维度限流。
8. 绑定和解绑身份必须写审计日志。
9. JWT 使用 `JWT_SECRET` 或独立的认证中心私钥签发，长期建议使用非对称密钥 RS256/EdDSA，并暴露 JWKS。
10. 所有接入 Client 必须校验 `redirectUri` 白名单和 `origin` 白名单。

### 10.2 账号接管风险控制

高风险操作包括：

- 修改密码
- 绑定新登录方式
- 解绑登录方式
- 修改账户名
- 全设备登出

建议这些操作要求二次验证：

- 密码用户：重新输入密码。
- 钱包用户：重新签名。
- OAuth 用户：重新走一次 OAuth。

### 10.3 登录失败限流

建议维度：

| 维度 | 示例规则 |
|------|----------|
| accountName | 5 次失败后锁定 15 分钟 |
| IP | 15 分钟 100 次 |
| fingerprint | 15 分钟 30 次 |
| provider subject | 同一个 Gmail/Twitter/EVM 频繁失败时限制 |

---

## 11. 兼容与迁移方案

### 11.1 阶段 1：新增登录中心，不影响旧接口

新增：

- `src/xhunt/models/AuthCenterXhuntUser.js`
- `src/xhunt/models/AuthCenterXhuntIdentity.js`
- `src/xhunt/models/AuthCenterXhuntPasswordCredential.js`
- `src/xhunt/models/AuthCenterXhuntClient.js`
- `src/xhunt/models/AuthCenterXhuntSession.js`
- `src/xhunt/models/AuthCenterXhuntAuthorizationCode.js`
- `src/xhunt/models/AuthCenterXhuntAuditLog.js`
- `src/xhunt/api/auth-center.js`
- `src/xhunt/middleware/auth-center-auth.js`
- 对应 migrations-pg 迁移文件

旧接口保持不变：

- `/api/xhunt/auth/*`
- `/api/xhunt/web/auth/*`

### 11.2 阶段 2：新 Web 站点接入登录中心

新站点统一走：

```text
/api/xhunt/auth-center/*
```

旧 `XHuntWebUsers` 只读保留，不继续新增业务依赖。

### 11.3 阶段 3：历史 Web 用户迁移

可写一次迁移脚本，将 `XHuntWebUsers` 中的 Twitter 用户迁移到登录中心：

```text
XHuntWebUsers.twitterId
    │
    ▼
查 AuthCenterXhuntIdentities(provider=twitter, providerSubject=twitterId)
    │
    ├── 存在：跳过或补充 client/site 记录
    └── 不存在：创建 AuthUser + Twitter Identity
```

迁移注意：

- 同一个 twitterId 在多个 siteSource 下可能有多条 `XHuntWebUsers`，新登录中心只应合并为一个 AuthUser。
- 如果已有 `xhuntUserId`，优先继承。
- 迁移前先 dry-run 输出冲突报告。

### 11.4 阶段 4：OAuth2/OIDC 化

当外部或多个独立域名站点接入增多后，补齐：

- `/oauth/authorize`
- `/oauth/token`
- `/oauth/userinfo`
- `/.well-known/jwks.json`
- `AuthCenterXhuntClients`
- `AuthCenterXhuntAuthorizationCodes`

---

## 12. 推荐目录结构

```text
src/xhunt/
├── api/
│   └── auth-center.js
├── middleware/
│   └── auth-center-auth.js
├── models/
│   ├── AuthCenterXhuntUser.js
│   ├── AuthCenterXhuntIdentity.js
│   ├── AuthCenterXhuntPasswordCredential.js
│   ├── AuthCenterXhuntClient.js
│   ├── AuthCenterXhuntSession.js
│   ├── AuthCenterXhuntAuthorizationCode.js
│   └── AuthCenterXhuntAuditLog.js
├── services/
│   ├── auth-center/
│   │   ├── displayName.js
│   │   ├── token.js
│   │   ├── password.js
│   │   ├── google.js
│   │   ├── twitter.js
│   │   ├── wallet.js
│   │   └── identity-linking.js
│   └── ...
└── constants/
    └── auth-center-clients.js
```

---

## 13. 环境变量建议

```bash
# Auth Center
AUTH_CENTER_ISSUER=https://api.cryptohunt.ai/api/xhunt/auth-center
AUTH_CENTER_ACCESS_TOKEN_TTL=1h
AUTH_CENTER_REFRESH_TOKEN_TTL_DAYS=30
AUTH_CENTER_TOKEN_ALG=HS256

# Google OAuth
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://api.cryptohunt.ai/api/xhunt/auth-center/google/callback

# Twitter OAuth，可复用或单独申请登录中心 App
AUTH_CENTER_TWITTER_CLIENT_ID=xxx
AUTH_CENTER_TWITTER_CLIENT_SECRET=xxx
AUTH_CENTER_TWITTER_REDIRECT_URI=https://api.cryptohunt.ai/api/xhunt/auth-center/twitter/callback

# Token encryption
AUTH_CENTER_TOKEN_ENCRYPTION_KEY=base64_32_bytes_key
```

说明：

- 如果短期复用现有 Twitter OAuth 配置，需要确认回调 URL 和站点授权范围。
- 长期建议登录中心使用独立 Twitter App，避免和插件登录互相影响。

---

## 14. 关键接口设计示例

### 14.1 账户密码注册

`POST /api/xhunt/auth-center/password/register`

请求：

```json
{
  "accountName": "kunge",
  "password": "StrongPassword123!",
  "clientKey": "xhunt-web"
}
```

响应：

```json
{
  "token": "access_token",
  "refreshToken": "refresh_token",
  "user": {
    "id": "uuid",
    "username": "kunge",
    "providers": ["password"],
    "xhuntUserId": null
  }
}
```

### 14.2 获取当前用户

`GET /api/xhunt/auth-center/me`

Header：

```text
Authorization: Bearer access_token
```

响应：

```json
{
  "id": "uuid",
  "username": "twitter_handle",
  "displayName": "twitter_handle",
  "avatar": "https://...",
  "providers": ["twitter", "password", "google", "evm"],
  "xhuntUserId": "legacy_xhunt_user_uuid",
  "isLinkedToXHuntUser": true,
  "twitter": {
    "twitterId": "123456789",
    "username": "twitter_handle"
  },
  "google": {
    "email": "user@gmail.com"
  },
  "evm": {
    "address": "0x1234567890abcdef..."
  }
}
```

### 14.3 绑定钱包

`POST /api/xhunt/auth-center/identities/evm/bind`

请求：

```json
{
  "address": "0x1234...abcd",
  "message": "Sign-In challenge message",
  "signature": "0xsignature"
}
```

响应：

```json
{
  "success": true,
  "providers": ["password", "evm"]
}
```

---


## 15. 前端认证中心 npm 包设计

### 15.1 目标

后续前端会把登录认证中心封装成一个 npm 包，业务站点不直接关心 OAuth、钱包签名、Token 刷新、登录 UI 状态管理等细节。

npm 包目标：

1. 提供统一登录 UI，支持账户密码、Google、EVM、Twitter 四种登录方式。
2. 封装认证中心接口调用。
3. 自动管理 Access Token、Refresh Token、过期刷新、登出。
4. 提供统一的用户信息对象和登录状态。
5. 支持多个 XHunt Web 端按 `clientKey` 接入。
6. 降低新站点接入成本，避免每个站点重复实现登录逻辑。

### 15.2 包命名建议

内部包名建议：

```text
@xhunt/auth-client
```

本期只考虑 React 生态，不规划其他框架包。

第一期直接做一个 React 包：

```text
@xhunt/auth-client
```

内部同时导出 API SDK、React Provider、Hooks 和默认登录弹窗组件。后续如确实需要无 UI SDK，也可以在同包内通过子路径导出，例如 `@xhunt/auth-client/core`，但第一期不拆成多个 npm 包。

### 15.3 前端接入方式

业务站点入口示例：

```tsx
import { XHuntAuthProvider } from "@xhunt/auth-client";

export function App() {
  return (
    <XHuntAuthProvider
      config={{
        apiBaseUrl: "https://api.cryptohunt.ai",
        authBasePath: "/api/xhunt/auth-center",
        clientKey: "xhunt-web",
        redirectUri: "https://xhunt.ai/auth/callback",
        storage: "localStorage",
      }}
    >
      <YourApp />
    </XHuntAuthProvider>
  );
}
```

页面使用示例：

```tsx
import { useXHuntAuth, XHuntLoginButton } from "@xhunt/auth-client";

function Header() {
  const { user, isAuthenticated, login, logout } = useXHuntAuth();

  if (!isAuthenticated) {
    return <XHuntLoginButton />;
  }

  return (
    <div>
      <img src={user.avatar} />
      <span>{user.username}</span>
      <button onClick={() => logout()}>Logout</button>
    </div>
  );
}
```

### 15.4 npm 包能力分层

```text
@xhunt/auth-client
├── API SDK
│   ├── request 封装
│   ├── Token 存储与刷新
│   ├── 当前用户 /me
│   ├── logout / logoutAll
│   └── 绑定 / 解绑登录方式
│
├── Provider & State
│   ├── XHuntAuthProvider
│   ├── useXHuntAuth
│   ├── useXHuntUser
│   ├── useXHuntToken
│   └── useXHuntIdentityBindings
│
├── UI Components
│   ├── XHuntLoginModal
│   ├── XHuntLoginButton
│   ├── PasswordLoginForm
│   ├── GoogleLoginButton
│   ├── TwitterLoginButton
│   ├── WalletLoginButton
│   └── IdentityBindingPanel
│
└── Utilities
    ├── shortAddress
    ├── resolveDisplayName
    ├── parseAuthCallback
    └── createAuthorizedFetch
```

### 15.5 配置项设计

```ts
export interface XHuntAuthConfig {
  apiBaseUrl: string;
  authBasePath?: string;
  clientKey: string;
  redirectUri?: string;
  scope?: string;
  storage?: "localStorage";
  tokenRefreshMode?: "auto" | "manual";
  wallet?: {
    chainId?: number;
    signStatement?: string;
  };
  ui?: {
    theme?: "light" | "dark" | "auto";
    defaultProvider?: "password" | "google" | "evm" | "twitter";
    enabledProviders?: Array<"password" | "google" | "evm" | "twitter">;
  };
  onAuthStateChange?: (state: XHuntAuthState) => void;
  onError?: (error: XHuntAuthError) => void;
}
```

关键配置说明：

| 配置 | 说明 |
|------|------|
| `apiBaseUrl` | 后端 API 根地址 |
| `authBasePath` | 登录中心 API path，默认 `/api/xhunt/auth-center` |
| `clientKey` | 当前业务应用标识，必须在后端 `AuthCenterXhuntClients` 白名单中 |
| `redirectUri` | OAuth 回调地址 |
| `storage` | Token 存储方式，本期固定使用 `localStorage` |
| `enabledProviders` | 当前站点展示哪些登录方式 |

### 15.6 核心 API 设计

```ts
export interface XHuntAuthClient {
  getCurrentUser(): Promise<XHuntAuthUser | null>;
  getAccessToken(): Promise<string | null>;
  refreshToken(): Promise<XHuntTokenSet>;
  logout(options?: { allDevices?: boolean }): Promise<void>;

  loginWithPassword(input: {
    accountName: string;
    password: string;
  }): Promise<XHuntLoginResult>;

  registerWithPassword(input: {
    accountName: string;
    password: string;
  }): Promise<XHuntLoginResult>;

  loginWithGoogle(): Promise<void>;
  handleGoogleCallback(input: OAuthCallbackInput): Promise<XHuntLoginResult>;

  loginWithTwitter(): Promise<void>;
  handleTwitterCallback(input: OAuthCallbackInput): Promise<XHuntLoginResult>;

  getWalletNonce(address: string): Promise<XHuntWalletChallenge>;
  loginWithWallet(input: {
    address: string;
    message: string;
    signature: string;
  }): Promise<XHuntLoginResult>;

  bindIdentity(provider: XHuntAuthProvider, input: unknown): Promise<XHuntAuthUser>;
  unbindIdentity(identityId: string): Promise<XHuntAuthUser>;
}
```

### 15.7 React Hooks 设计

```ts
const {
  user,
  token,
  isLoading,
  isAuthenticated,
  providers,
  login,
  logout,
  refresh,
  openLoginModal,
  closeLoginModal,
} = useXHuntAuth();
```

建议 hooks：

| Hook | 说明 |
|------|------|
| `useXHuntAuth()` | 登录状态、登录/登出动作入口 |
| `useXHuntUser()` | 获取当前用户信息 |
| `useXHuntToken()` | 获取当前 Access Token |
| `useRequireXHuntAuth()` | 页面鉴权，未登录自动弹登录框或跳转 |
| `useXHuntIdentityBindings()` | 获取和管理已绑定登录方式 |

### 15.8 Token 存储策略

本期明确使用 `localStorage` 存储 Token，npm 包统一封装读写，业务站点不要自己直接操作具体 key。

建议存储内容：

```text
localStorage["xhunt_auth_token"] = JSON.stringify({
  accessToken,
  refreshToken,
  expiresAt,
  tokenType: "Bearer",
  userSnapshot
})
```

约定：

- Access Token 和 Refresh Token 都放在 localStorage。
- npm 包启动时从 localStorage 恢复登录态。
- npm 包内部统一处理过期判断和刷新。
- `logout` 时必须清理 localStorage。
- 多标签页登录状态同步可以监听 `storage` 事件。
- 因为 localStorage 可被 XSS 读取，前端站点必须严格避免注入风险，登录包自身也不要把 Token 打到日志里。

### 15.9 authorizedFetch 设计

npm 包提供带认证的请求方法，业务站点可以直接使用：

```ts
const { authorizedFetch } = useXHuntAuth();

const res = await authorizedFetch("/api/xhunt/some-business-api", {
  method: "POST",
  body: JSON.stringify(payload),
});
```

内部逻辑：

```text
请求前获取 Access Token
        │
        ▼
自动加 Authorization: Bearer token
        │
        ▼
如果返回 401 且 refresh 可用，自动刷新一次
        │
        ▼
刷新成功后重放原请求
        │
        ▼
刷新失败则清空本地登录态并触发 onAuthStateChange
```

### 15.10 UI 设计要求

登录弹窗需要包含：

1. 账户密码登录入口。
2. Google 登录按钮。
3. Twitter 登录按钮。
4. EVM 钱包登录按钮。
5. 新用户注册入口。
6. 错误提示和 loading 状态。
7. 登录方式绑定管理入口。

绑定管理 UI 需要展示：

| 登录方式 | 状态 | 操作 |
|----------|------|------|
| 账户密码 | 已设置 / 未设置 | 设置密码；本期不支持改账户名 |
| Google | 已绑定 / 未绑定 | 绑定 / 解绑 |
| Twitter | 已绑定 / 未绑定 | 绑定 / 解绑 |
| EVM | 已绑定 / 未绑定 | 绑定 / 解绑；一个账号只能绑定一个地址 |

UI 文案需要明确：

- 一个账号最多绑定一个 EVM 地址。
- 账户名注册后暂不支持修改。
- 如果某个 Google/Twitter/EVM 已绑定到其他账号，不能再绑定到当前账号。
- 不支持账号合并。

### 15.11 OAuth 回调处理

npm 包提供统一回调解析方法：

```tsx
import { XHuntAuthCallbackPage } from "@xhunt/auth-client";

export default function AuthCallbackPage() {
  return (
    <XHuntAuthCallbackPage
      onSuccess={(result) => {
        window.location.href = "/";
      }}
      onError={(error) => {
        console.error(error);
      }}
    />
  );
}
```

内部根据 URL 中的 `provider` / `state` / `code` 判断调用 Google 或 Twitter callback 接口。

### 15.12 类型定义建议

```ts
export type XHuntAuthProvider = "password" | "google" | "evm" | "twitter";

export interface XHuntAuthUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  providers: XHuntAuthProvider[];
  xhuntUserId?: string | null;
  isLinkedToXHuntUser: boolean;
  twitter?: {
    twitterId: string;
    username?: string | null;
  } | null;
  google?: {
    email: string;
    emailVerified?: boolean;
  } | null;
  evm?: {
    address: string;
    shortAddress: string;
  } | null;
}

export interface XHuntTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: "Bearer";
}

export interface XHuntLoginResult {
  user: XHuntAuthUser;
  token: XHuntTokenSet;
  isNewUser?: boolean;
}
```

### 15.13 npm 包与后端接口契约

后端需要保证响应结构稳定，方便 npm 包封装。

所有登录接口建议统一返回：

```json
{
  "token": {
    "accessToken": "xxx",
    "refreshToken": "yyy",
    "expiresAt": 1710003600000,
    "tokenType": "Bearer"
  },
  "user": {
    "id": "uuid",
    "username": "resolved_name",
    "displayName": "resolved_name",
    "avatar": "https://...",
    "providers": ["twitter", "google"],
    "xhuntUserId": "uuid-or-null",
    "isLinkedToXHuntUser": true
  },
  "isNewUser": false
}
```

错误响应建议统一：

```json
{
  "error": "IDENTITY_ALREADY_BOUND",
  "message": "该登录方式已绑定到其他账号",
  "requestId": "req_xxx"
}
```

### 15.14 npm 包实施优先级

| 阶段 | 内容 |
|------|------|
| NPM-P0 | API SDK、Token 存储、`/me`、logout、密码登录、Twitter 登录 |
| NPM-P1 | Google 登录、EVM 登录、登录弹窗 UI |
| NPM-P2 | 登录方式绑定/解绑 UI、authorizedFetch、自动 refresh |
| NPM-P3 | OAuth2 Authorization Code + PKCE 完整跳转模式、跨站 SSO 优化 |

---

## 16. 实施优先级建议

### P0：基础表和核心登录

1. 新增 `AuthCenterXhuntUsers`。
2. 新增 `AuthCenterXhuntIdentities`。
3. 新增 `AuthCenterXhuntPasswordCredentials`。
4. 新增 `AuthCenterXhuntSessions`。
5. 实现账户密码注册/登录。
6. 实现 Twitter 登录，并关联旧 `XHuntUsers`。
7. 实现 `/me` 和 `/logout`。

### P1：补齐 4 种登录方式

1. 实现 EVM 钱包登录，并限制一个账号只能绑定一个 EVM 地址。
2. 实现 Gmail / Google OAuth 登录。
3. 实现登录方式绑定和解绑。
4. 实现展示用户名统一解析。
5. 增加审计日志。

### P2：多应用接入

1. 新增 `AuthCenterXhuntClients`。
2. 给 Token 增加 `aud/clientKey`。
3. 增加 Client 白名单校验。
4. 新 Web 站点统一接入登录中心。

### P3：OAuth2/OIDC 化

1. 实现 Authorization Code + PKCE。
2. 实现 `/oauth/token`。
3. 实现 `/oauth/userinfo`。
4. 实现 JWKS。
5. 支持更多独立站点无感 SSO。

---

## 17. 产品/技术确认结论

以下结论已确认，作为后续实现约束：

| 问题 | 结论 | 实现影响 |
|------|------|----------|
| Twitter 登录中心用户如果旧 `XHuntUsers` 不存在，是否自动创建？ | 不自动创建 | 只通过 `twitterId` 关联已有 `XHuntUsers`；未命中时 `xhuntUserId = null` |
| 账户名是否允许修改？ | 目前先不允许 | `accountName` 注册后不可改；不做改名接口 |
| Gmail 登录范围 | 支持所有 Google 邮箱账户 | 不限制 `@gmail.com` 后缀，以 Google `sub` 作为唯一标识 |
| EVM 是否区分链？ | 不区分链，只按地址 | EVM identity 唯一键使用 lower-case address，不包含 chainId |
| 一个账号是否允许多个 EVM？ | 不允许 | 一个 `AuthUser` 最多绑定一个 EVM 地址，增加 `unique(userId, provider)` 约束即可覆盖 |
| 是否实现账号合并？ | 不实现，以后也不实现 | 身份被其他账号占用时直接拒绝；不提供 merge 流程 |
| 前端 npm 包范围 | 只考虑 React | 包名建议 `@xhunt/auth-client`，提供 React Provider、Hooks、登录弹窗和 API SDK |
| Token 前端存储 | 使用 localStorage | npm 包统一封装 Token 读写、刷新和登出清理 |
| 后端表/模型命名 | 不以 XHunt 开头，但包含 Xhunt | 使用 `AuthCenterXhunt*` 命名，例如 `AuthCenterXhuntUsers` |

补充确认：前端会将登录认证中心封装为 React npm 包，包含 UI、接口调用、localStorage Token 管理和用户状态管理；业务站点通过该包完成登录并拿到用户 Token 信息。详见第 15 节。

---

## 18. 总结

本设计的核心是把“用户主账号”和“登录方式”拆开：

- `AuthCenterXhuntUsers` 表示统一登录中心账号。
- `AuthCenterXhuntIdentities` 表示账户密码、Google、EVM、Twitter 等不同登录身份。
- 用户可以绑定最多 4 类登录身份，每类一个；绑定后任意身份都能登录同一个主账号。
- Twitter 身份通过 `twitterId` 与旧 `XHuntUsers` 建立关联，既保留旧插件体系，又支持新 Web 登录中心独立演进。
- 多个 XHunt Web 端后续通过统一 Token/UserInfo/OAuth2 能力接入认证中心。
