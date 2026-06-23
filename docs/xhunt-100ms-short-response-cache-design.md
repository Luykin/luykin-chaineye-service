# XHunt 指定接口 100ms 短响应缓存技术方案

## 1. 背景

部分 XHunt 接口在浏览器插件或前端页面中，可能因为重复触发、组件并发渲染、快速切换、网络重试等原因，在极短时间内产生完全相同的请求。

本方案目标不是做长期业务缓存，而是做一个 **100ms 级别的短响应缓存 / 请求合并机制**：

- 相同用户、相同接口、相同参数的请求在 100ms 内复用同一份响应；
- 如果第一个请求仍在执行，后续相同请求可等待第一个请求结果并复用；
- 返回响应时通过 HTTP Header 明确标识是否命中该短缓存；
- 尽量不改变业务代码语义，不影响接口原有响应结构。

## 2. 目标接口范围

第一阶段仅对以下接口开启 100ms 短响应缓存：

| 接口 | 方法 | 建议缓存 | 说明 |
|---|---|---:|---|
| `/api/xhunt/campaigns/me` | GET | 是 | 当前用户活动信息查询 |
| `/api/xhunt/proxy/public/fetch/ai/rank` | GET/POST 按实际路由 | 是 | AI rank 代理查询 |
| `/api/xhunt/proxy/public/fetch/twitter/rank` | GET/POST 按实际路由 | 是 | Twitter rank 代理查询 |
| `/api/xhunt/proxy/public/pro/api/e2es` | GET/POST 按实际路由 | 是 | Pro e2es 查询 |

> 注意：如果上述 proxy 接口实际使用 POST 且 body 中包含查询参数，则缓存 key 必须包含 request body hash。

## 3. 推荐实现位置

推荐在 **Node/Express 层**实现，而不是 Nginx 层。

原因：

1. Node 层可以直接拿到 `req.user`、认证信息、query、body，缓存 key 更安全；
2. 可以精确白名单控制接口，不影响全局 `/api`；
3. 可以更容易做 pending request 合并，即 singleflight；
4. 可以只缓存符合条件的 JSON 成功响应；
5. 日志、调试、灰度、回滚都更简单。

Nginx/OpenResty 更适合统一网关限流或普通缓存，但这个需求属于应用层的极短窗口响应复用，放 Node 层更稳。

## 4. 核心设计

### 4.1 缓存模型

维护两个内存 Map：

```js
completedCache: Map<string, CachedResponse>
pendingCache: Map<string, Promise<CachedResponse>>
```

含义：

- `completedCache`：已经完成的响应，TTL 100ms；
- `pendingCache`：正在执行中的请求，用于合并并发相同请求。

### 4.2 请求处理流程

```text
请求进入
  │
  ├─ 判断是否属于白名单接口
  │   └─ 否：直接 next()
  │
  ├─ 生成 cache key
  │
  ├─ 查询 completedCache
  │   └─ 命中：直接返回缓存响应，Header 标记 HIT
  │
  ├─ 查询 pendingCache
  │   └─ 命中：等待第一个请求完成，返回同一份响应，Header 标记 HIT-PENDING
  │
  └─ 未命中：当前请求成为 owner，继续执行真实 handler
      │
      ├─ 捕获响应体
      ├─ 判断是否可缓存
      ├─ 写入 completedCache，TTL=100ms
      └─ resolve pending promise
```

### 4.3 缓存窗口

默认配置：

```text
TTL: 100ms
Pending 最大等待: 100ms - 150ms
最大缓存响应体: 256KB
只缓存状态码: 200
只缓存 Content-Type: application/json
```

如果 pending 请求等待超时，建议降级为继续访问真实后端逻辑，而不是报错。

## 5. Cache Key 设计

缓存 key 必须避免用户串数据。

推荐 key 组成：

```text
keyPrefix
userIdentity
method
originalUrl
bodyHash
```

### 5.1 用户维度

按优先级取：

```js
req.user?.id
req.user?.twitterId
req.headers.authorization
req.headers['x-device-fingerprint']
req.ip + user-agent
```

对于 `/campaigns/me` 这类强用户相关接口，必须包含用户身份。

### 5.2 GET 请求

GET key 示例：

```text
xhunt-short-cache|userId|GET|/api/xhunt/campaigns/me?campaignId=xxx|
```

### 5.3 POST 请求

POST key 必须包含 body hash：

```text
xhunt-short-cache|userId|POST|/api/xhunt/proxy/public/fetch/ai/rank|md5(body)
```

如果 POST body 中字段顺序可能不稳定，建议用稳定 JSON stringify 后再 hash。

## 6. 响应标识设计

### 6.1 推荐使用 Header 标识

建议新增响应头：

```http
X-XHunt-Short-Cache: MISS
X-XHunt-Short-Cache: HIT
X-XHunt-Short-Cache: HIT-PENDING
X-XHunt-Short-Cache: BYPASS
X-XHunt-Short-Cache: SKIP
```

含义：

| Header 值 | 含义 |
|---|---|
| `MISS` | 未命中缓存，本请求执行真实业务逻辑，并可能写入缓存 |
| `HIT` | 命中 100ms completed cache |
| `HIT-PENDING` | 命中正在执行的 pending 请求，等待后复用响应 |
| `BYPASS` | 接口、方法或配置不满足短缓存条件，直接放行 |
| `SKIP` | 请求进入短缓存流程，但响应不符合缓存条件，未写缓存 |

可选增加：

```http
X-XHunt-Short-Cache-TTL: 100
X-XHunt-Short-Cache-Key: disabled-in-prod
```

生产环境不建议返回 cache key，避免暴露用户维度或参数信息。

### 6.2 HTTP 状态码建议

不建议为了短缓存命中修改原接口 HTTP 状态码。

原因：

1. HTTP 语义中没有“命中应用内 100ms 短缓存”的标准状态码；
2. 前端、插件、代理、监控系统通常依赖原状态码判断业务成功失败；
3. 如果原接口成功是 `200`，缓存命中也应该继续返回 `200`；
4. 使用非标准状态码如 `299` 可能被部分客户端、网关、监控系统误处理。

推荐策略：

```text
缓存命中时：保持原始 statusCode，例如 200
通过 X-XHunt-Short-Cache: HIT / HIT-PENDING 标识来源
```

如果一定需要“特定状态码”，可以考虑内部调试环境使用：

```http
208 Already Reported
```

但不推荐生产使用，因为 `208` 属于 WebDAV 语义，和本场景不完全匹配。

最终建议：**生产只用 Header，不改 statusCode。**

## 7. 可缓存响应条件

只有同时满足以下条件才写入缓存：

```text
statusCode === 200
Content-Type 包含 application/json
响应体大小 <= 256KB
没有 Set-Cookie
没有 Cache-Control: no-store / private 强约束
请求未被客户端提前断开
```

不缓存：

- 4xx / 5xx；
- 登录、授权、token 类响应；
- 写入型接口响应；
- 大响应体；
- 文件、流式响应、SSE；
- 带 `Set-Cookie` 的响应。

## 8. 建议新增文件

```text
src/xhunt/middleware/short-response-cache.js
```

职责：

- 提供 `createShortResponseCache(options)`；
- 生成安全 cache key；
- 管理 completed/pending Map；
- 捕获 `res.send` / `res.json` 响应；
- 写入短缓存；
- 给响应添加 `X-XHunt-Short-Cache` header；
- 提供日志或 debug 能力。

## 9. 建议接入方式

### 9.1 在 apiServer.js 或对应路由挂载处接入

优先选择精确路径接入，不建议全局 `/api/xhunt` 接入。

示例：

```js
const { createShortResponseCache } = require('./xhunt/middleware/short-response-cache');

const xhunt100msCache = createShortResponseCache({
  ttlMs: 100,
  pendingWaitMs: 120,
  maxBodyBytes: 256 * 1024,
  headerName: 'X-XHunt-Short-Cache',
  routes: [
    '/api/xhunt/campaigns/me',
    '/api/xhunt/proxy/public/fetch/ai/rank',
    '/api/xhunt/proxy/public/fetch/twitter/rank',
    '/api/xhunt/proxy/public/pro/api/e2es',
  ],
});

app.use(xhunt100msCache);
```

### 9.2 或在具体 router 内接入

如果这些接口分散在不同 router，建议在具体 router 中对目标路径单独挂载。

示例：

```js
router.get('/me', shortResponseCacheForCampaigns, async (req, res) => {
  // existing handler
});
```

精确挂载可降低误缓存风险。

## 10. 配置建议

建议使用代码默认值即可，后续如需要可接环境变量：

```text
XHUNT_SHORT_CACHE_ENABLED=true
XHUNT_SHORT_CACHE_TTL_MS=100
XHUNT_SHORT_CACHE_PENDING_WAIT_MS=120
XHUNT_SHORT_CACHE_MAX_BODY_BYTES=262144
```

建议默认只在生产和预发开启，开发环境可通过环境变量开启方便调试。

## 11. 日志与观测

建议每个请求响应头包含：

```http
X-XHunt-Short-Cache: MISS|HIT|HIT-PENDING|BYPASS|SKIP
```

可选低频日志：

```text
[short-cache] HIT GET /api/xhunt/campaigns/me user=xxx age=42ms
[short-cache] HIT-PENDING GET /api/xhunt/proxy/public/fetch/ai/rank wait=31ms
[short-cache] SKIP status=500 path=/api/xhunt/campaigns/me
```

不建议打印完整 key、Authorization、body。

## 12. 风险与规避

| 风险 | 说明 | 规避 |
|---|---|---|
| 用户串数据 | key 缺少用户维度 | key 必须包含 `req.user` 或 Authorization |
| 错误响应被缓存 | 短时间放大错误 | 只缓存 200 JSON |
| 写接口被缓存 | 影响业务副作用 | 第一阶段只白名单指定查询接口 |
| 大响应占内存 | Map 短时间占用较大 | 限制 256KB，TTL 100ms |
| 多实例不共享 | 多 Node worker 各自缓存 | 100ms 需求可接受，必要时再上 Redis |
| 非标准状态码兼容问题 | 客户端可能不识别 | 生产保持原始状态码，只加 Header |

## 13. 验收标准

### 13.1 功能验收

对同一用户连续请求目标接口：

1. 第一次请求：

```http
X-XHunt-Short-Cache: MISS
HTTP/1.1 200 OK
```

2. 100ms 内第二次相同请求，且第一次已完成：

```http
X-XHunt-Short-Cache: HIT
HTTP/1.1 200 OK
```

3. 100ms 内第二次相同请求，且第一次仍在执行：

```http
X-XHunt-Short-Cache: HIT-PENDING
HTTP/1.1 200 OK
```

4. 超过 100ms 后再次请求：

```http
X-XHunt-Short-Cache: MISS
HTTP/1.1 200 OK
```

### 13.2 安全验收

- 用户 A 和用户 B 请求 `/api/xhunt/campaigns/me` 不得互相命中；
- 不同 query/body 的请求不得互相命中；
- 4xx/5xx 不得写入缓存；
- 带 `Set-Cookie` 的响应不得写入缓存。

## 14. 推荐最终方案

第一版建议：

```text
Node 层实现
白名单精确匹配 4 个目标接口
TTL 100ms
pending 请求合并
缓存 200 JSON 小响应
响应状态码保持原样
使用 X-XHunt-Short-Cache Header 标识 MISS/HIT/HIT-PENDING/SKIP
```

这套方案对业务侵入小、可控性高、回滚简单，适合当前 XHunt 指定接口的短时间重复请求优化。
