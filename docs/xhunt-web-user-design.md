# XHunt Web User 模块设计文档

## 1. 背景与目标

### 1.1 背景
XHunt 插件目前有一套完整的用户体系（XHuntUser），用户通过 Twitter OAuth 登录插件。随着业务发展，需要开发 XHunt 周边网站（如活动页面、数据展示页面等），这些网站也需要用户登录功能。

### 1.2 为什么要新建表？
- **用户来源区分**：有些用户可能先通过周边网站登录，而非先安装插件。需要区分用户最初来源
- **站点隔离**：不同周边站点（如空投站、活动站、数据站）需要独立管理用户
- **数据隔离**：网站用户和插件用户的业务逻辑、权限体系可能不同
- **关联关系**：网站用户后续可能绑定/关联到插件账号，需要独立记录

### 1.3 目标
- 建立独立的 Web 用户表，支持 Twitter OAuth 登录
- 支持多站点用户隔离（同一 Twitter 账号在不同站点是独立用户）
- 支持与 XHuntUser（插件用户）的关联
- 提供完整的登录和用户信息查询接口
- 使用独立的 Twitter 应用配置

---

## 2. 数据模型设计

### 2.1 XHuntWebUser 表

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | UUID | 是 | 主键，默认 UUIDV4 |
| twitterId | STRING | 是 | Twitter 用户 ID |
| siteSource | STRING | 是 | 站点来源标识（如 'airdrop', 'activity', 'data'） |
| username | STRING | 是 | Twitter 用户名（@handle） |
| displayName | STRING | 否 | Twitter 显示名称 |
| avatar | STRING | 否 | 头像 URL |
| xhuntUserId | UUID | 否 | 关联的 XHuntUser.id（可能为空） |
| xhuntKolRank | INTEGER | 否 | XHunt KOL 排名（从 XHuntUser 同步或外部 API 获取） |
| classification | STRING | 否 | 用户分类（KOL/项目方/机构/个人） |
| twitterAccessToken | TEXT | 否 | Twitter OAuth Access Token |
| twitterRefreshToken | TEXT | 否 | Twitter OAuth Refresh Token |
| tokenExpiry | DATE | 否 | Token 过期时间 |
| lastLoginAt | DATE | 否 | 最后登录时间 |
| loginCount | INTEGER | 否 | 登录次数统计，默认 0 |
| isActive | BOOLEAN | 否 | 账号是否激活，默认 true |

**复合唯一约束：** `(twitterId, siteSource)` - 确保同一 Twitter 账号在同一站点只有一个记录

### 2.2 XHuntWebUserToken 表

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | UUID | 是 | 主键 |
| userId | UUID | 是 | 关联 XHuntWebUser.id |
| siteSource | STRING | 是 | 站点来源标识（与 user 表一致，用于验证） |
| accessToken | TEXT | 是 | JWT Token |
| fingerprint | TEXT | 否 | 设备指纹 |
| tokenExpiry | DATE | 是 | Token 过期时间 |
| lastUsed | DATE | 否 | 最后使用时间 |
| isRevoked | BOOLEAN | 否 | 是否已撤销，默认 false |
| createdAt | DATE | 是 | 创建时间 |

### 2.3 索引设计

**XHuntWebUser 索引：**
- `idx_twitter_site` (twitterId, siteSource, unique) - 复合唯一索引
- `idx_site_source` (siteSource) - 站点查询
- `idx_xhunt_user_id` (xhuntUserId) - 关联查询
- `idx_username` (username) - 用户名搜索

**XHuntWebUserToken 索引：**
- `idx_user_id` (userId) - 用于用户 Token 查询
- `idx_site_source` (siteSource) - 站点 Token 查询
- `idx_token_expiry` (tokenExpiry) - 用于过期 Token 清理

---

## 3. 站点标识（siteSource）设计

### 3.1 预定义站点标识

| siteSource | 说明 | 示例场景 |
|------------|------|----------|
| `airdrop` | 空投活动站点 | 空投领取页面 |
| `activity` | 通用活动站点 | 营销活动页面 |
| `data` | 数据展示站点 | 数据分析平台 |
| `referral` | 邀请返利站点 | 邀请好友系统 |

### 3.2 站点隔离原则

1. **用户数据隔离**：同一 Twitter 账号在不同站点是完全独立的用户记录
2. **Token 隔离**：Token 包含 siteSource 声明，不能跨站点使用
3. **接口隔离**：每个站点调用接口时必须明确传递 siteSource 参数

### 3.3 同一 Twitter 账号的多站点示例

```
Twitter账号: @alice

├─ XHuntWebUser (siteSource='airdrop')
│   ├─ id: uuid-1
│   ├─ loginCount: 3
│   └─ 独立的数据和设置
│
├─ XHuntWebUser (siteSource='activity')
│   ├─ id: uuid-2
│   ├─ loginCount: 1
│   └─ 独立的数据和设置
│
└─ XHuntUser (插件用户)
    └─ id: uuid-3
```

---

## 4. 接口设计

### 4.1 Twitter OAuth 登录流程

```
┌─────────────┐     ┌─────────────────────┐     ┌─────────────┐     ┌─────────────┐
│   前端页面   │────▶│ 请求授权URL(带site)  │────▶│ Twitter授权  │────▶│  回调页面   │
│ (带site标识) │     │ POST /twitter/url   │     │             │     │             │
└─────────────┘     └─────────────────────┘     └─────────────┘     └──────┬──────┘
                                                                           │
                              ┌────────────────────────────────────────────┘
                              ▼
┌─────────────┐     ┌─────────────────────┐     ┌─────────────┐     ┌─────────────┐
│  返回JWT     │◀────│  创建/更新WebUser   │◀────│ 获取用户信息 │◀────│ 发送code    │
│  和用户详情  │     │  (按site+twitterId) │     │ 和Tokens    │     │ + site      │
└─────────────┘     └─────────────────────┘     └─────────────┘     └─────────────┘
```

### 4.2 接口列表

#### 4.2.1 POST /api/xhunt/web/auth/twitter/url
获取 Twitter 授权 URL

**请求参数：**
```json
{
  "siteSource": "airdrop"
}
```

**参数说明：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| siteSource | string | 是 | 站点来源标识，如 'airdrop', 'activity' |

**验证规则：**
- siteSource 必须是允许的站点标识（白名单校验）

**Redis 存储：**
```javascript
// state 存储时包含 siteSource 信息
cacheKey = `twitter_web_oauth_state:${state}`
value = JSON.stringify({ 
  codeVerifier, 
  siteSource,  // 记录站点来源
  createdAt: Date.now() 
})
TTL = 480  // 8分钟
```

**响应：**
```json
{
  "url": "https://twitter.com/i/oauth2/authorize?...",
  "state": "state_string"
}
```

---

#### 4.2.2 POST /api/xhunt/web/auth/twitter/callback
Twitter OAuth 回调处理，完成登录

**请求参数：**
```json
{
  "code": "授权码",
  "state": "状态码",
  "siteSource": "airdrop"
}
```

**参数说明：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | Twitter 返回的授权码 |
| state | string | 是 | 与请求授权URL时返回的 state 一致 |
| siteSource | string | 是 | 必须与请求授权URL时传入的 siteSource 一致 |

**处理逻辑：**
1. 验证 state 有效性（从 Redis 获取并删除）
2. **校验 siteSource**：请求参数的 siteSource 必须与 Redis 中存储的一致
3. 使用 code 换取 Twitter AccessToken 和 RefreshToken
4. 获取 Twitter 用户信息（id, username, name, avatar）
5. **查询或创建 XHuntWebUser 记录**（按 `twitterId + siteSource` 查找）
6. 调用外部 API 获取用户排名和分类信息
7. 创建 XHuntWebUserToken 记录（记录 siteSource）
8. 签发 JWT Token（30天有效期，payload 包含 siteSource）
9. 尝试匹配 XHuntUser（通过 twitterId），更新 xhuntUserId 字段

**JWT Payload：**
```json
{
  "userId": "uuid",
  "tokenId": "token_uuid",
  "siteSource": "airdrop",
  "iat": 1646400000,
  "exp": 1648992000
}
```

**成功响应：**
```json
{
  "token": "jwt_token_string",
  "user": {
    "id": "uuid",
    "twitterId": "123456789",
    "siteSource": "airdrop",
    "username": "twitter_handle",
    "displayName": "Display Name",
    "avatar": "https://...",
    "xhuntUserId": "uuid_or_null",
    "xhuntKolRank": 100,
    "classification": "KOL",
    "isLinkedToXHunt": false,
    "loginCount": 5
  }
}
```

**错误响应：**
```json
// siteSource 不匹配
{
  "error": "SITE_SOURCE_MISMATCH",
  "message": "站点来源与授权时传入的不一致"
}

// siteSource 未授权
{
  "error": "INVALID_SITE_SOURCE",
  "message": "无效的站点来源"
}
```

---

#### 4.2.3 GET /api/xhunt/web/auth/me
获取当前登录用户信息

**认证方式：** Bearer Token (JWT)

**请求参数（Query）：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| siteSource | string | 是 | 站点来源标识，用于验证 Token 是否属于该站点 |

**验证逻辑：**
1. 从 JWT 中解析出 `siteSource` 声明
2. 对比 Query 参数传入的 `siteSource`
3. 如果不匹配，返回 403 错误（防止跨站点使用 Token）

**响应：**
```json
{
  "id": "uuid",
  "twitterId": "123456789",
  "siteSource": "airdrop",
  "username": "twitter_handle",
  "displayName": "Display Name",
  "avatar": "https://...",
  "xhuntUserId": "uuid_or_null",
  "xhuntKolRank": 100,
  "classification": "KOL",
  "isLinkedToXHunt": true,
  "lastLoginAt": "2026-03-04T14:32:24.907Z",
  "loginCount": 5
}
```

**错误响应：**
```json
// Token 站点不匹配
{
  "error": "TOKEN_SITE_MISMATCH",
  "message": "该 Token 不属于当前站点"
}
```

---

#### 4.2.4 POST /api/xhunt/web/auth/logout
登出接口

**认证方式：** Bearer Token (JWT)

**请求参数（Body）：**
```json
{
  "siteSource": "airdrop"
}
```

**验证逻辑：**
- 验证 JWT 中的 siteSource 与请求参数的 siteSource 一致

**处理逻辑：** 将当前 Token 标记为 isRevoked = true

**响应：**
```json
{
  "success": true
}
```

---

## 5. 环境变量配置

需要新增以下环境变量（使用独立的 Twitter 应用）：

```bash
# XHunt Web User Twitter OAuth 配置
XHUNT_WEB_TWITTER_CLIENT_ID=your_web_app_client_id
XHUNT_WEB_TWITTER_CLIENT_SECRET=your_web_app_client_secret
XHUNT_WEB_TWITTER_CALLBACK_URL=https://your-domain.com/auth/callback

# 允许的站点来源白名单（逗号分隔）
XHUNT_WEB_ALLOWED_SITES=airdrop,activity,data,referral

# JWT 配置（可与现有 XHunt 共用或独立）
# 如果希望 Web User 和插件用户 Token 不互通，使用不同的 SECRET
# JWT_SECRET_WEB=your_jwt_secret_for_web
```

---

## 6. 技术实现要点

### 6.1 Twitter OAuth 服务
- 复用现有的 `src/xhunt/services/twitter.js` 逻辑
- 但使用新的 Client ID/Secret（通过参数传入或新封装）

### 6.2 用户关联机制
```javascript
// 登录时尝试关联 XHuntUser（跨站点统一关联）
const xhuntUser = await XHuntUser.findOne({
  where: { twitterId: twitterUser.id }
});

if (xhuntUser) {
  await webUser.update({
    xhuntUserId: xhuntUser.id,
    xhuntKolRank: xhuntUser.kolRank20W,
    classification: xhuntUser.classification
  });
}
// 注意：xhuntUserId 关联对所有站点的该用户都相同
```

### 6.3 站点验证中间件
```javascript
// 验证 siteSource 是否在白名单中
function validateSiteSource(siteSource) {
  const allowedSites = process.env.XHUNT_WEB_ALLOWED_SITES?.split(',') || [];
  return allowedSites.includes(siteSource);
}

// 验证 Token 站点匹配
function verifyTokenSite(tokenPayload, requestedSite) {
  return tokenPayload.siteSource === requestedSite;
}
```

### 6.4 安全考虑
- 与现有 XHunt 接口保持相同的安全级别
- **站点隔离**：Token 包含 siteSource 声明，防止跨站点使用
- **白名单校验**：siteSource 必须在允许列表中
- 设备指纹验证（可选）
- 速率限制（按站点 + IP 或指纹）
- Token 有效期 30 天

---

## 7. 文件结构

```
src/xhunt/
├── models/
│   ├── XHuntWebUser.js          # 新建：Web 用户表（含 siteSource）
│   └── XHuntWebUserToken.js     # 新建：Web 用户 Token 表（含 siteSource）
├── api/
│   └── web-auth.js              # 新建：Web 用户认证路由
├── services/
│   ├── twitter.js               # 复用：Twitter OAuth 服务
│   └── site-validator.js        # 可选：站点验证工具
├── middleware/
│   ├── auth.js                  # 复用/修改：认证中间件（支持 site 验证）
│   └── site-check.js            # 可选：站点来源验证中间件
└── constants/
    └── web-sites.js             # 可选：站点白名单常量
```

---

## 8. 后续扩展建议

1. **账号绑定功能**：允许 Web 用户手动绑定/解绑 XHunt 插件账号
2. **数据同步**：定期同步 xhuntKolRank 和 classification 字段
3. **权限体系**：为不同站点设计独立的权限/角色系统
4. **统计埋点**：按站点统计用户访问行为和转化漏斗
5. **跨站点 SSO**：允许用户在已登录某站点后，快速登录其他站点（需用户授权）

---

## 9. 与现有 XHuntUser 的对比

| 特性 | XHuntUser（插件） | XHuntWebUser（网站） |
|------|------------------|---------------------|
| 用户来源 | 浏览器插件 | 周边网站（多站点） |
| 唯一标识 | twitterId | twitterId + siteSource |
| Twitter 应用 | 插件应用 | 独立的 Web 应用 |
| 跨站点共享 | 不适用 | 同 Twitter 账号在不同站点是独立用户 |
| XHunt 关联 | 本身就是 | 通过 xhuntUserId 关联 |
| evmAddresses | 支持 | 暂不支持（可扩展） |
| inviteCode | 支持 | 暂不支持 |
| Pro 订阅 | 支持 | 可复用或独立 |
| 核心场景 | 插件功能使用 | 网页浏览、活动参与 |

---

**文档版本：** 1.1  
**更新日期：** 2026-03-04  
**作者：** AI Assistant
