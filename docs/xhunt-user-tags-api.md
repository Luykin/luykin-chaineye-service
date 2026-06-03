# XHunt 用户标签接口文档

## 1. 接口概览

新版用户标签配置已从 Nacos 迁移到数据库，前端不需要再读取：

```text
xhunt_built_in_tag
xhunt_built_in_tag_en
```

新版前端统一请求：

```http
GET /api/xhunt/tags
```

接口会一次性返回全部用户标签数据，前端本地按 `twitterId` 优先匹配。

---

## 2. 获取全部用户标签

### 请求

```http
GET /api/xhunt/tags
```

等价路径：

```http
GET /api/xhunt/tags/all
```

### 请求头

沿用 XHunt 插件请求头即可。

建议携带：

```http
x-request-id: caefed4d-eca8-43ce-b5ec-56049cc6c268-twid1300679567988801536
x-user-id: defiteddy2020
x-device-fingerprint: xxx
x-extension-version: xxx
```

> 说明：当前 `/api/xhunt/tags` 接口返回全量数据，不依赖某个具体用户，但仍经过现有安全中间件，所以请求头保持和其他 XHunt API 一致即可。

### 响应

#### 200 OK

```json
{
  "success": true,
  "data": {
    "version": 1780000000000,
    "count": 2,
    "generatedAt": "2026-06-04T03:12:00.000Z",
    "etag": "9c7c6d4f5f...",
    "items": [
      {
        "username": "defiteddy2020",
        "twitterId": "1300679567988801536",
        "tagsZh": ["KOL", "DeFi"],
        "tagsEn": ["KOL", "DeFi"],
        "updatedAt": "2026-06-04T03:00:00.000Z"
      },
      {
        "username": "luykinai",
        "twitterId": "123456789",
        "tagsZh": ["项目方"],
        "tagsEn": ["Project"],
        "updatedAt": "2026-06-04T03:01:00.000Z"
      }
    ],
    "byUsername": {
      "defiteddy2020": {
        "twitterId": "1300679567988801536",
        "tagsZh": ["KOL", "DeFi"],
        "tagsEn": ["KOL", "DeFi"],
        "updatedAt": "2026-06-04T03:00:00.000Z"
      }
    },
    "byTwitterId": {
      "1300679567988801536": {
        "username": "defiteddy2020",
        "tagsZh": ["KOL", "DeFi"],
        "tagsEn": ["KOL", "DeFi"],
        "updatedAt": "2026-06-04T03:00:00.000Z"
      }
    }
  }
}
```

---

## 3. 字段说明

### 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `success` | boolean | 是否成功 |
| `data` | object | 标签数据 |

### `data` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | number | 当前数据版本，通常由最新更新时间生成 |
| `count` | number | 用户标签记录总数 |
| `generatedAt` | string | 服务端生成缓存数据的时间 |
| `etag` | string | 当前数据 ETag |
| `items` | array | 全量标签数组 |
| `byUsername` | object | 以 username 为 key 的映射 |
| `byTwitterId` | object | 以 twitterId 为 key 的映射，前端推荐优先使用 |

### `items[]` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `username` | string | Twitter username，小写，不带 `@` |
| `twitterId` | string \| null | Twitter 用户 ID |
| `tagsZh` | string[] | 中文标签 |
| `tagsEn` | string[] | 英文标签 |
| `updatedAt` | string \| null | 最近更新时间 |

---

## 4. 前端推荐匹配逻辑

推荐优先按 `twitterId` 查：

```ts
function normalizeUsername(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function getUserTags(params: {
  tagData: XHuntUserTagsPayload;
  twitterId?: string | null;
  username?: string | null;
}) {
  const twitterId = String(params.twitterId || "").trim();
  if (twitterId && params.tagData.byTwitterId[twitterId]) {
    return {
      matchedBy: "twitterId" as const,
      ...params.tagData.byTwitterId[twitterId],
    };
  }

  const username = normalizeUsername(params.username);
  if (username && params.tagData.byUsername[username]) {
    return {
      matchedBy: "username" as const,
      username,
      ...params.tagData.byUsername[username],
    };
  }

  return null;
}
```

使用示例：

```ts
const tagResp = await fetch("/api/xhunt/tags").then((r) => r.json());

const matched = getUserTags({
  tagData: tagResp.data,
  twitterId: currentTwitterId,
  username: currentUsername,
});

const tags = locale === "zh" ? matched?.tagsZh || [] : matched?.tagsEn || [];
```

---

## 5. TypeScript 类型定义

```ts
export interface XHuntUserTagItem {
  username: string;
  twitterId: string | null;
  tagsZh: string[];
  tagsEn: string[];
  updatedAt: string | null;
}

export interface XHuntUserTagsPayload {
  version: number;
  count: number;
  generatedAt: string;
  etag: string;
  items: XHuntUserTagItem[];
  byUsername: Record<
    string,
    {
      twitterId: string | null;
      tagsZh: string[];
      tagsEn: string[];
      updatedAt: string | null;
    }
  >;
  byTwitterId: Record<
    string,
    {
      username: string;
      tagsZh: string[];
      tagsEn: string[];
      updatedAt: string | null;
    }
  >;
}

export interface XHuntUserTagsResponse {
  success: boolean;
  data: XHuntUserTagsPayload;
}
```

---

## 6. 缓存策略

接口有两层缓存。

### 6.1 服务端 Redis 缓存

服务端会把全量标签数据缓存在 Redis：

```text
xhunt:user-tags:all:v1
```

TTL：

```text
30 天
```

管理后台以下操作会主动刷新 Redis：

- 保存标签
- 删除标签
- 同步 ID

所以前端不需要主动清 Redis。

### 6.2 浏览器协商缓存

接口响应会带：

```http
ETag: "xxxx"
Cache-Control: public, max-age=0, must-revalidate
```

前端可以正常使用浏览器默认缓存机制。

如果要手动处理：

```ts
let cachedEtag: string | null = null;
let cachedData: XHuntUserTagsPayload | null = null;

async function fetchTags() {
  const headers: Record<string, string> = {};
  if (cachedEtag) {
    headers["If-None-Match"] = cachedEtag;
  }

  const resp = await fetch("/api/xhunt/tags", { headers });

  if (resp.status === 304 && cachedData) {
    return cachedData;
  }

  const json = await resp.json();
  cachedEtag = resp.headers.get("ETag");
  cachedData = json.data;
  return json.data;
}
```

---

## 7. 304 响应

当数据没有变化时，如果请求带了：

```http
If-None-Match: "xxxx"
```

服务端会返回：

```http
304 Not Modified
```

响应体为空。

前端应继续使用本地缓存的数据。

---

## 8. 兼容调试接口：单用户 lookup

保留了一个调试/兼容接口：

```http
GET /api/xhunt/tags/lookup?twitterId=1300679567988801536
```

或：

```http
GET /api/xhunt/tags/lookup?username=defiteddy2020
```

它仍然基于 Redis 全量缓存查询，不直接查数据库。

响应：

```json
{
  "success": true,
  "data": {
    "twitterId": "1300679567988801536",
    "username": "defiteddy2020",
    "tagsZh": ["KOL"],
    "tagsEn": ["KOL"],
    "updatedAt": "2026-06-04T03:00:00.000Z"
  },
  "matchedBy": "twitterId",
  "version": 1780000000000
}
```

如果没匹配到：

```json
{
  "success": true,
  "data": null,
  "matchedBy": null,
  "version": 1780000000000
}
```

> 正式前端推荐使用 `/api/xhunt/tags` 一次性拉全量，不推荐频繁调用 `/lookup`。

---

## 9. 错误响应

```json
{
  "success": false,
  "error": "查询标签失败"
}
```

常见 HTTP 状态：

| 状态码 | 说明 |
|---|---|
| 200 | 成功 |
| 304 | 数据未变化，使用本地缓存 |
| 403 | 安全中间件校验不通过 |
| 500 | 服务端错误 |

---

## 10. 对接建议

前端建议：

1. 插件启动或页面初始化时请求一次：

```http
GET /api/xhunt/tags
```

2. 缓存在内存/localStorage。
3. 读取当前目标用户标签时：
   - 优先 `byTwitterId[twitterId]`
   - 兜底 `byUsername[username.toLowerCase()]`
4. 根据语言展示：
   - 中文：`tagsZh`
   - 英文：`tagsEn`
5. 利用 ETag 做协商缓存，避免重复下载。
