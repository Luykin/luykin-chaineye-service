# XHunt Web User API - AI 对接文档

> 本文档专为 AI/大模型设计，帮助快速理解和对接 XHunt Web 用户认证系统

## 1. 系统概述

### 1.1 什么是 XHunt Web User？
XHunt Web User 是 XHunt 插件的**周边网站用户系统**。用户通过 Twitter OAuth 登录各种周边站点（如空投站、活动站等），与插件用户体系独立但可关联。

### 1.2 核心概念

| 概念 | 说明 |
|------|------|
| **站点 (siteSource)** | 用户所属的网站标识，如 `airdrop` `activity` `data` |
| **用户隔离** | 同一 Twitter 账号在不同站点是完全独立的用户 |
| **Token 隔离** | 每个站点的 Token 不能跨站使用 |
| **XHunt 关联** | Web 用户可关联到 XHunt 插件账号（通过 twitterId 匹配） |

### 1.3 站点白名单

环境变量 `XHUNT_WEB_ALLOWED_SITES` 配置允许的站点：
- `https://xhunt.ai`
- `https://xhunt.ai/vote2026`

---

## 2. 对接流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          登录流程                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  前端页面                              后端 API        Twitter      │
│     │                                     │              │          │
│     │  1. POST /twitter/url              │              │          │
│     │     { siteSource: "airdrop" }     │              │          │
│     │ ─────────────────────────────────>│              │          │
│     │                                     │              │          │
│     │  2. 返回 { url: "https://twitter.com/..." }       │          │
│     │ <─────────────────────────────────│              │          │
│     │                                     │              │          │
│     │  3. 跳转 Twitter 授权页面          │              │          │
│     │ ────────────────────────────────────────────────>│          │
│     │                                     │              │          │
│     │  4. 用户授权后，Twitter 回调前端    │              │          │
│     │     携带 code 和 state             │              │          │
│     │ <────────────────────────────────────────────────│          │
│     │                                     │              │          │
│     │  5. POST /twitter/callback         │              │          │
│     │     { code, state }                │              │          │
│     │ ─────────────────────────────────>│              │          │
│     │                                     │              │          │
│     │  6. 返回 { token, user }           │              │          │
│     │ <─────────────────────────────────│              │          │
│     │                                     │              │          │
│     ▼                                     ▼              ▼          │
│  【存储 token，后续请求携带 Authorization: Bearer {token}】        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 接口详解

### 3.1 获取 Twitter 授权 URL

```
POST /api/xhunt/web/auth/twitter/url
```

**用途**：获取 Twitter OAuth 授权页面的 URL

**请求参数**：
```json
{
  "siteSource": "https://xhunt.ai"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| siteSource | string | 是 | 站点标识，如 "airdrop" |

**请求头**：
```
Content-Type: application/json
```

**成功响应 (200)**：
```json
{
  "url": "https://twitter.com/i/oauth2/authorize?state=xxx&code_challenge=yyy...",
  "siteSource": "airdrop"
}
```

**错误响应 (400)**：
```json
{
  "error": "INVALID_SITE_SOURCE",
  "message": "无效的站点来源",
  "allowedSites": ["https://xhunt.ai", "https://xhunt.ai/vote2026"]
}
```

**完整 curl 示例**：
```bash
curl -X POST https://api.xhunt.ai/api/xhunt/web/auth/twitter/url \
  -H "Content-Type: application/json" \
  -d '{"siteSource": "https://xhunt.ai/vote2026"}'
```

---

### 3.2 Twitter 登录回调

```
POST /api/xhunt/web/auth/twitter/callback
```

**用途**：用户授权后，用 Twitter 返回的 code 完成登录

**请求参数**：
```json
{
  "code": "V0dheWJMZ19wX3VCRHJi...",
  "state": "emhhbmdzYW4..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | Twitter 返回的授权码 |
| state | string | 是 | Twitter 返回的状态码（与请求时一致） |

> **注意**：`siteSource` 不再需要前端传递，后端会从 state 对应的缓存数据中自动获取。

**请求头**：
```
Content-Type: application/json
```

**成功响应 (200)**：
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "twitterId": "1234567890",
    "siteSource": "airdrop",
    "username": "alice",
    "displayName": "Alice Chen",
    "avatar": "https://pbs.twimg.com/profile_images/xxx.jpg",
    "xhuntUserId": null,
    "xhuntKolRank": 1500,
    "classification": "KOL",
    "isLinkedToXHunt": false,
    "loginCount": 1,
    "isNewUser": true
  }
}
```

**关键字段说明**：
| 字段 | 说明 |
|------|------|
| token | JWT Token，后续请求需携带 |
| user.id | Web 用户唯一ID（UUID） |
| user.twitterId | Twitter 用户ID |
| user.siteSource | 所属站点 |
| user.xhuntUserId | 关联的插件用户ID（可能为null） |
| user.isLinkedToXHunt | 是否已关联插件账号 |
| user.isNewUser | 是否首次注册 |

**错误响应**：
```json
// 400 - 无效或过期的 state
{
  "error": "无效或过期的 state"
}

// 500 - 服务器错误
{
  "error": "登录失败，请稍后再试"
}
```

**完整 curl 示例**：
```bash
curl -X POST https://api.xhunt.ai/api/xhunt/web/auth/twitter/callback \
  -H "Content-Type: application/json" \
  -d '{
    "code": "V0dheWJMZ19wX3VCRHJi...",
    "state": "emhhbmdzYW4..."
  }'
```

---

### 3.3 获取当前用户信息

```
GET /api/xhunt/web/auth/me?siteSource={siteSource}
```

**用途**：用 Token 获取当前登录用户的详细信息

**请求参数（Query）**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| siteSource | string | 是 | 站点标识，用于验证Token所属站点 |

**请求头**：
```
Authorization: Bearer {jwt_token}
```

**成功响应 (200)**：
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "twitterId": "1234567890",
  "siteSource": "airdrop",
  "username": "alice",
  "displayName": "Alice Chen",
  "avatar": "https://pbs.twimg.com/profile_images/xxx.jpg",
  "xhuntUserId": null,
  "xhuntKolRank": 1500,
  "classification": "KOL",
  "isLinkedToXHunt": false,
  "lastLoginAt": "2026-03-04T14:32:24.907Z",
  "loginCount": 5,
  "createdAt": "2026-03-01T10:00:00.000Z"
}
```

**错误响应**：
```json
// 401 - 未提供 Token
{
  "error": "TOKEN_REQUIRED"
}

// 419 - Token 无效或过期
{
  "error": "TOKEN_EXPIRED"
}

// 403 - Token 站点不匹配
{
  "error": "TOKEN_SITE_MISMATCH",
  "message": "该 Token 不属于当前站点",
  "tokenSite": "activity",
  "requestedSite": "airdrop"
}
```

**完整 curl 示例**：
```bash
curl -X GET "https://api.xhunt.ai/api/xhunt/web/auth/me?siteSource=https://xhunt.ai" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 3.4 登出

```
POST /api/xhunt/web/auth/logout
```

**用途**：撤销当前 Token，使用户登出

**请求参数**：
```json
{
  "siteSource": "airdrop"
}
```

**请求头**：
```
Content-Type: application/json
Authorization: Bearer {jwt_token}
```

**成功响应 (200)**：
```json
{
  "success": true
}
```

**完整 curl 示例**：
```bash
curl -X POST https://api.xhunt.ai/api/xhunt/web/auth/logout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{"siteSource": "https://xhunt.ai"}'
```

---

## 4. 完整对接示例（JavaScript）

```javascript
// ==================== 配置 ====================
const API_BASE = 'https://api.xhunt.ai';
const SITE_SOURCE = 'https://xhunt.ai/vote2026'; // 你的站点标识

// ==================== 步骤1：获取授权URL ====================
async function getAuthUrl() {
  const res = await fetch(`${API_BASE}/api/xhunt/web/auth/twitter/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteSource: SITE_SOURCE })
  });
  const data = await res.json();
  return data.url; // 跳转到此URL让用户授权
}

// ==================== 步骤2：处理回调（页面加载时） ====================
async function handleCallback() {
  // 从URL解析 code 和 state
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  
  if (!code || !state) return;
  
  const res = await fetch(`${API_BASE}/api/xhunt/web/auth/twitter/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state })
  });
  
  const data = await res.json();
  
  // 存储 Token
  localStorage.setItem('xhunt_token', data.token);
  localStorage.setItem('xhunt_user', JSON.stringify(data.user));
  
  return data.user;
}

// ==================== 步骤3：获取用户信息 ====================
async function getUserInfo() {
  const token = localStorage.getItem('xhunt_token');
  
  const res = await fetch(
    `${API_BASE}/api/xhunt/web/auth/me?siteSource=${SITE_SOURCE}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );
  
  if (res.status === 419) {
    // Token 过期，需要重新登录
    localStorage.removeItem('xhunt_token');
    throw new Error('Token expired');
  }
  
  return await res.json();
}

// ==================== 步骤4：登出 ====================
async function logout() {
  const token = localStorage.getItem('xhunt_token');
  
  await fetch(`${API_BASE}/api/xhunt/web/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ siteSource: SITE_SOURCE })
  });
  
  localStorage.removeItem('xhunt_token');
  localStorage.removeItem('xhunt_user');
}

// ==================== 封装好的请求方法（带Token） ====================
async function xhuntApi(endpoint, options = {}) {
  const token = localStorage.getItem('xhunt_token');
  
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (res.status === 419) {
    localStorage.removeItem('xhunt_token');
    window.location.href = '/login'; // 跳转登录页
    throw new Error('Token expired');
  }
  
  return res.json();
}
```

---

## 5. 错误码速查表

| 错误码 | HTTP状态码 | 含义 | 处理方式 |
|--------|-----------|------|----------|
| `INVALID_SITE_SOURCE` | 400 | 无效的站点标识 | 检查 siteSource 是否在白名单中 |
| `SITE_SOURCE_MISMATCH` | 400 | 站点与授权时不一致 | 确保 callback 时 siteSource 与 url 请求时一致 |
| `TOKEN_SITE_MISMATCH` | 403 | Token 不属于当前站点 | 检查请求的 siteSource 参数是否正确 |
| `TOKEN_REQUIRED` | 401 | 未提供 Token | 在请求头添加 Authorization: Bearer {token} |
| `TOKEN_INVALID` | 419 | Token 无效或已撤销 | 清除本地 Token，重新登录 |
| `TOKEN_EXPIRED` | 419 | Token 已过期 | 清除本地 Token，重新登录 |

---

## 6. 常见问题（FAQ）

### Q1: 为什么同一 Twitter 账号在不同站点要重新登录？
**A**: 这是设计特性。站点隔离确保每个站点的用户数据独立，同一 Twitter 账号在 `airdrop` 和 `activity` 是两个独立用户。

### Q2: 如何判断用户是否已关联 XHunt 插件账号？
**A**: 检查响应中的 `isLinkedToXHunt` 字段或 `xhuntUserId` 是否非空。

### Q3: Token 有效期多久？
**A**: 30 天。过期后需要重新走登录流程。

### Q4: 可以刷新 Token 吗？
**A**: 当前版本不支持刷新，过期后需要重新登录。

### Q5: 为什么登出接口也要传 siteSource？
**A**: 用于验证 Token 所属站点，防止跨站操作。

---

## 7. 环境变量配置（后端）

```bash
# Twitter OAuth 配置（独立的 Web 应用）
XHUNT_WEB_TWITTER_CLIENT_ID=your_web_app_client_id
XHUNT_WEB_TWITTER_CLIENT_SECRET=your_web_app_client_secret
XHUNT_WEB_TWITTER_CALLBACK_URL=https://your-domain.com/auth/callback

# 允许的站点白名单
XHUNT_WEB_ALLOWED_SITES=https://xhunt.ai,https://xhunt.ai/vote2026
```

---

## 8. 数据库表结构

### XHuntWebUsers 表
```sql
- id (UUID, PK)
- twitterId (STRING, 非空)
- siteSource (STRING, 非空)
- username (STRING, 非空)
- displayName (STRING)
- avatar (STRING)
- xhuntUserId (UUID, 可空) -- 关联 XHuntUser
- xhuntKolRank (INTEGER)
- classification (STRING)
- lastLoginAt (DATE)
- loginCount (INTEGER, 默认0)
- 复合唯一索引: (twitterId, siteSource)
```

### XHuntWebUserTokens 表
```sql
- id (UUID, PK)
- userId (UUID, FK -> XHuntWebUsers)
- siteSource (STRING, 非空)
- accessToken (TEXT) -- JWT Token
- tokenExpiry (DATE)
- isRevoked (BOOLEAN, 默认false)
```

---

**文档版本**: 1.0  
**最后更新**: 2026-03-05  
**API 基础路径**: `/api/xhunt/web/auth`
