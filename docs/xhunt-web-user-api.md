# XHunt Web User API 文档

## 接口列表

### 1. 获取 Twitter 授权 URL

```http
POST /api/xhunt/web/auth/twitter/url
Content-Type: application/json
```

**请求参数：**
```json
{
  "siteSource": "https://xhunt.ai"
}
```

**响应：**
```json
{
  "url": "https://twitter.com/i/oauth2/authorize?...",
  "siteSource": "https://xhunt.ai"
}
```

---

### 2. Twitter 登录回调

```http
POST /api/xhunt/web/auth/twitter/callback
Content-Type: application/json
```

**请求参数：**
```json
{
  "code": "授权码",
  "state": "状态码"
}
```

> **注意**：`siteSource` 不再需要前端传递，后端会从授权时存储的 state 缓存中自动获取。
```

**响应：**
```json
{
  "token": "jwt_token_string",
  "user": {
    "id": "uuid",
    "twitterId": "123456789",
    "siteSource": "https://xhunt.ai",
    "username": "twitter_handle",
    "displayName": "Display Name",
    "avatar": "https://...",
    "xhuntUserId": "uuid_or_null",
    "xhuntKolRank": 100,
    "classification": "KOL",
    "isLinkedToXHunt": false,
    "loginCount": 5,
    "isNewUser": false
  }
}
```

---

### 3. 获取当前用户信息

```http
GET /api/xhunt/web/auth/me?siteSource=https://xhunt.ai
Authorization: Bearer {jwt_token}
```

**响应：**
```json
{
  "id": "uuid",
  "twitterId": "123456789",
  "siteSource": "https://xhunt.ai",
  "username": "twitter_handle",
  "displayName": "Display Name",
  "avatar": "https://...",
  "xhuntUserId": "uuid_or_null",
  "xhuntKolRank": 100,
  "classification": "KOL",
  "isLinkedToXHunt": true,
  "lastLoginAt": "2026-03-04T14:32:24.907Z",
  "loginCount": 5,
  "createdAt": "2026-03-01T10:00:00.000Z"
}
```

---

### 4. 登出

```http
POST /api/xhunt/web/auth/logout
Content-Type: application/json
Authorization: Bearer {jwt_token}
```

**请求参数：**
```json
{
  "siteSource": "https://xhunt.ai"
}
```

**响应：**
```json
{
  "success": true
}
```

---

## 站点标识（siteSource）

| 标识 | 说明 |
|------|------|
| `https://xhunt.ai` | XHunt 主站 |
| `https://xhunt.ai/vote2026` | 投票活动页面 |

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| `INVALID_SITE_SOURCE` | 无效的站点来源 |
| `SITE_SOURCE_MISMATCH` | 站点来源与授权时不一致 |
| `TOKEN_SITE_MISMATCH` | Token 不属于当前站点 |
| `TOKEN_REQUIRED` | 需要提供 Token |
| `TOKEN_INVALID` | Token 无效或已撤销 |
| `TOKEN_EXPIRED` | Token 已过期 |

---
