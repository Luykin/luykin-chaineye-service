# Ghost Following API 前端使用文档

> 本文档描述 `ghost-following.js` 模块提供的前端 API 接口

## 目录

- [概述](#概述)
- [认证方式](#认证方式)
- [额度说明](#额度说明)
- [API 接口](#api-接口)
  - [1. 查询额度](#1-查询额度)
  - [2. 分析用户推文](#2-分析用户推文)
  - [3. 获取关注列表](#3-获取关注列表)
- [分页查询示例](#分页查询示例)
- [错误码说明](#错误码说明)

---

## 概述

Ghost Following 模块提供以下功能：
- 查询用户推文分析额度
- 分析指定 Twitter 用户的最新推文
- 获取指定 Twitter 用户的关注列表（Following）

**Base URL**: `/api/xhunt/ghost-following`

---

## 认证方式

所有接口都需要 JWT Token 认证，同时需要 Pro 用户权限。

**请求头格式**:
```
Authorization: Bearer <your_jwt_token>
```

---

## 额度说明

本模块有两套独立的额度系统：

### 1. Analyze 额度（推文分析）
- 普通用户：每月 2000 次
- VIP 用户：每月 5000 次
- 周期：30 天
- 额度用尽后需等待冷却期结束才能重新申请

### 2. Following 额度（关注列表查询）
- 所有用户：每月 100 次
- 周期：30 天
- 与 Analyze 额度完全独立

---

## API 接口

### 1. 查询额度

获取当前用户的 **analyze** 和 **following** 两套额度信息。

**请求方式**: `GET`

**请求路径**: `/api/xhunt/ghost-following/quota`

**请求参数**: 无

**响应示例**:

```json
{
  "success": true,
  "data": {
    "isVip": false,
    "analyze": {
      "status": "active",
      "quota": {
        "total": 2000,
        "remaining": 1850,
        "used": 150
      },
      "appliedAt": 1704067200000,
      "expiresAt": 1706659200000,
      "nextApplyAt": null,
      "waitDays": 0,
      "canApplyNow": true,
      "expiresInDays": 25
    },
    "following": {
      "status": "active",
      "quota": {
        "total": 100,
        "remaining": 95,
        "used": 5
      },
      "resetAt": 1706745600000,
      "expiresInDays": 30
    }
  }
}
```

**字段说明**:

| 字段 | 说明 |
|------|------|
| `isPro` | 是否为 Pro 用户（付费订阅或老用户 Pro） |
| `isVip` | 是否为 VIP 用户（在白名单中的用户，影响 analyze 额度上限） |
| `analyze` | 推文分析额度详情 |
| `following` | 关注列表查询额度详情 |

**Pro vs VIP 说明**:

- **Pro**: 通过付费订阅或老用户名单获得，用于接口访问权限控制
- **VIP**: 通过 `XHUNT_VIP` 白名单判定，仅影响 analyze 额度上限（VIP 5000次/月，普通 2000次/月）

**Analyze 状态说明**:

| status 值 | 含义 |
|-----------|------|
| `none` | 无额度记录，从未申请 |
| `cooldown` | 冷却期，本月额度已用完 |
| `active` | 额度有效且剩余 > 0 |
| `exhausted` | 额度已用完但未过期 |
| `expired` | 额度已过期 |

**Following 状态说明**:

| status 值 | 含义 |
|-----------|------|
| `none` | 无额度记录 |
| `active` | 额度有效且剩余 > 0 |
| `exhausted` | 额度已用完 |
| `expired` | 额度已过期（会自动重置） |

---

### 2. 分析用户推文

分析指定 Twitter 用户的最新推文，自动扣除额度。

**请求方式**: `POST`

**请求路径**: `/api/xhunt/ghost-following/analyze`

**请求体参数**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | Twitter 用户 ID（纯数字字符串） |

**请求示例**:

```json
{
  "user_id": "1234567890123456789"
}
```

**成功响应**:

```json
{
  "success": true,
  "data": {
    "quota": {
      "total": 2000,
      "remaining": 1849,
      "appliedAt": 1704067200000,
      "expiresAt": 1706659200000,
      "expiresInDays": 25,
      "isNewQuota": false
    },
    "result": {
      "id": "1234567890123456789",
      "create_time": "2024-01-01T12:00:00Z",
      "html": "<p>Tweet content...</p>",
      "twitter_user_id": "1234567890123456789"
    }
  }
}
```

**无推文响应**:

```json
{
  "success": true,
  "data": {
    "quota": { ... },
    "result": {
      "id": null,
      "create_time": null,
      "html": null,
      "twitter_user_id": "1234567890123456789",
      "message": "No tweets found for this user"
    }
  }
}
```

**额度耗尽响应** (HTTP 403):

```json
{
  "success": false,
  "error": {
    "code": "QUOTA_COOLDOWN",
    "message": "本月额度已用完",
    "data": {
      "total": 2000,
      "used": 2000,
      "nextApplyAt": 1706745600000,
      "waitDays": 5,
      "waitHours": 120
    }
  }
}
```

---

### 3. 获取关注列表

获取指定 Twitter 用户的 Following 列表，支持分页查询。

**请求方式**: `POST`

**请求路径**: `/api/xhunt/ghost-following/following`

**请求体参数**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | Twitter 用户 ID（纯数字字符串） |
| cursor | string | 否 | 分页游标，首次请求不传，后续传入上一次返回的 `next` 值 |

**请求示例**:

```json
// 首次请求
{
  "user_id": "1234567890123456789"
}

// 分页请求
{
  "user_id": "1234567890123456789",
  "cursor": "1844487597424303530|2030170517931032524"
}
```

**响应结构**:

```json
{
  "success": true,
  "data": {
    "quota": {
      "total": 100,
      "remaining": 95,
      "used": 5,
      "resetAt": 1706745600000
    },
    "result": {
      "code": 200,
      "message": "get data success",
      "data": {
        "next": "1844487597424303530|2030170517931032524",
        "previous": "-1|2030170517931032577",
        "profiles": [
          {
            "created_at": "2020-06-01T03:50:56Z",
            "description": "Bio text...",
            "followers_count": 52422,
            "following_count": 788,
            "id": "1267302544839188480",
            "is_blue_verified": true,
            "listed_count": 106,
            "location": "",
            "name": "User Name",
            "pinned_tweet_id": ["2029814682610192489"],
            "profile_banner_url": "https://pbs.twimg.com/profile_banners/...",
            "profile_image_url": "https://pbs.twimg.com/profile_images/...",
            "protected": false,
            "tweets_count": 3031,
            "url": "http://example.com",
            "username": "username",
            "verified": false
          }
        ]
      }
    }
  }
}
```

**Profile 字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | Twitter 用户 ID |
| name | string | 显示名称 |
| username | string | Twitter 用户名（@后面的部分） |
| description | string | 个人简介 |
| created_at | string | 账号创建时间（ISO 8601 格式） |
| followers_count | number | 粉丝数 |
| following_count | number | 关注数 |
| tweets_count | number | 推文数 |
| listed_count | number | 被列表收录数 |
| is_blue_verified | boolean | 是否蓝 V 认证 |
| verified | boolean | 是否官方认证（旧版） |
| protected | boolean | 是否为私密账号 |
| location | string | 位置信息 |
| url | string | 主页链接 |
| profile_image_url | string | 头像 URL |
| profile_banner_url | string | 横幅图片 URL |
| pinned_tweet_id | array | 置顶推文 ID 列表 |

**分页说明**:

- 每次返回 **50 条**记录
- 当 `result.data.next` 不为空时，表示还有更多数据
- 将 `next` 值作为 `cursor` 参数传入下一次请求
- 当 `next` 为空字符串或不存在时，表示已到最后一页

**额度耗尽响应** (HTTP 403):

```json
{
  "success": false,
  "error": {
    "code": "FOLLOWING_QUOTA_EXHAUSTED",
    "message": "本月关注列表查询额度已用完",
    "data": {
      "total": 100,
      "used": 100,
      "remaining": 0,
      "resetAt": 1706745600000,
      "waitDays": 12
    }
  }
}
```

---

## 分页查询示例

以下是获取完整 Following 列表的 JavaScript 示例：

```javascript
async function fetchAllFollowing(userId, token) {
  const baseUrl = '/api/xhunt/ghost-following/following';
  const allProfiles = [];
  let cursor = '';
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: userId,
        cursor: cursor // 首次为空字符串
      })
    });

    const data = await response.json();

    if (!data.success) {
      console.error('请求失败:', data.error);
      break;
    }

    // 提取用户信息
    const profiles = data.data.result.data.profiles;
    allProfiles.push(...profiles);

    // 检查是否还有更多数据
    const nextCursor = data.data.result.data.next;
    if (nextCursor && nextCursor !== '') {
      cursor = nextCursor;
      // 添加延迟避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      hasMore = false;
    }

    // 打印额度信息
    const quota = data.data.quota;
    console.log(`剩余额度: ${quota.remaining}/${quota.total}`);
  }

  return allProfiles;
}

// 使用示例
fetchAllFollowing('1234567890123456789', 'your_jwt_token')
  .then(profiles => {
    console.log(`共获取 ${profiles.length} 个关注用户`);
  });
```

---

## 错误码说明

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 401 | 未授权，Token 无效或过期 |
| 403 | 额度不足或权限不足 |
| 500 | 服务器内部错误 |

### 业务错误码

| 错误码 | 说明 | 处理方式 |
|--------|------|----------|
| `QUOTA_COOLDOWN` | Analyze 额度已用完，处于冷却期 | 等待 `waitDays` 天后重试或升级 VIP |
| `FOLLOWING_QUOTA_EXHAUSTED` | Following 额度已用完 | 等待下月额度重置 |
| `INTERNAL_ERROR` | 服务器内部错误 | 稍后重试 |
| `EXTERNAL_API_ERROR` | 外部 API 调用失败 | 稍后重试 |

### 参数验证错误

当请求参数不合法时，返回 HTTP 400：

```json
{
  "success": false,
  "errors": [
    {
      "msg": "user_id is required",
      "param": "user_id",
      "location": "body"
    }
  ]
}
```

---

## 注意事项

1. **额度独立**: `analyze` 和 `following` 的额度完全独立，互不影响
2. **Pro 权限**: 两个接口都需要 Pro 用户权限才能调用
3. **Rate Limit**: 建议分页查询时添加适当延迟（如 500ms），避免触发限流
4. **Cursor 格式**: `cursor` 是字符串格式，包含特殊字符 `|` 和 `-`，传递时保持原样即可
