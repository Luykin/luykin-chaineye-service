# XHunt v2 签名后端技术方案

> 文档日期：2026-06-17  
> 适用范围：XHunt 插件后端、安全中间件、SSE、安全日志、JWT 鉴权、请求防重放  
> 前端协议依据：`tweet-hunt-extension/docs/backend-v2-signature-brief.md`  
> 目标：在保持 legacy 签名约 1 个月兼容的前提下，新增 v2 签名协议验签能力，并统一 content、background-script、SSE 三类请求。

---

## 1. 背景

当前 XHunt 后端签名逻辑集中在：

```text
src/xhunt/middleware/security.js
```

现有协议主要有两套逻辑：

| 场景 | 当前算法 | 特点 |
|------|----------|------|
| 普通网页请求 | HMAC-SHA256 | 使用 `req.body` JSON stringify 后参与签名 |
| SSE / background-script | FNV-1a 自定义签名 | 参数可从 query 读取，方便 EventSource 使用 |

v2 协议要求统一升级为：

```text
BODY_SHA512_HEX = SHA-512(raw body text)
SIGNATURE = HMAC-SHA512(APP_SIGNING_KEY, canonicalPayload)
```

并新增：

- `x-signature-version: v2` 作为分流标识；
- `x-tw-id` 必传且参与签名；
- query 使用 WHATWG URL / URLSearchParams 语义排序；
- 普通 API 与 SSE 使用不同防重放策略；
- 登录接口需校验 `x-tw-id` 与 JWT 用户 `twitterId` 一致。

---

## 2. 设计目标

### 2.1 必须满足

1. **协议分流**
   - `x-signature-version === "v2"`：走 v2 验签；
   - 缺失或非 `v2`：继续走 legacy 验签。

2. **覆盖全部插件请求来源**
   - content 请求：v2；
   - background-script 请求：v2；
   - SSE：v2，安全参数通过 query 传输。

3. **保留 legacy 兼容**
   - 约 1 个月兼容期；
   - legacy 原验签、时间窗口、错误码尽量不动，降低回归风险。

4. **v2 使用 raw body**
   - 后端必须保存客户端实际发送的 body 字符串；
   - 禁止通过 JSON parse 后 stringify 结果计算 v2 body hash。

5. **防重放策略分场景**
   - 普通 API：纯 `x-request-id` 严格去重；
   - SSE：允许同一 `requestId + signature + twId` 在时间窗口内重连。

6. **登录态强一致**
   - 有 JWT 登录态的接口，必须校验：

```text
req.securityContext.twId === req.user.twitterId
```

### 2.2 非目标

本次不做：

- 完全移除 legacy 签名；
- 重构全部安全中间件；
- 改变业务接口响应结构；
- 调整 admin / RootDataPro / 非 XHunt 业务接口签名逻辑；
- 引入新的设备指纹机制。

---

## 3. 协议概览

### 3.1 v2 必传安全参数

普通请求通过 header 传：

```http
x-signature-version: v2
x-request-id: <uuid-v4>
x-request-timestamp: <unix-ms-timestamp>
x-device-fingerprint: <fingerprint>
x-request-signature: <hex-hmac-sha512>
x-tw-id: <twitter-id>
x-extension-version: <extension-version>
x-user-id: <username>
x-language: <language>
```

SSE 请求由于 `EventSource` 不能设置自定义 header，以上 `x-*` 安全参数通过 query 传输，同时保留 `token` query。

### 3.2 Canonical Payload

v2 固定 7 行，用 `\n` 拼接：

```text
METHOD
PATH_WITH_QUERY
TIMESTAMP
REQUEST_ID
DEVICE_FINGERPRINT
BODY_SHA512_HEX
TW_ID
```

字段说明：

| 字段 | 来源 | 处理规则 |
|------|------|----------|
| `METHOD` | `req.method` | 大写 |
| `PATH_WITH_QUERY` | `req.path + sorted query` | WHATWG URLSearchParams 排序序列化 |
| `TIMESTAMP` | `x-request-timestamp` | 字符串形式参与签名 |
| `REQUEST_ID` | `x-request-id` | UUID v4 |
| `DEVICE_FINGERPRINT` | `x-device-fingerprint` | raw 值参与签名 |
| `BODY_SHA512_HEX` | `req.rawBody` | 无 body 用空字符串 |
| `TW_ID` | `x-tw-id` | v2 必传，数字字符串 |

### 3.3 签名算法

```text
expectedSignature = hex(HMAC-SHA512(APP_SIGNING_KEY, canonicalPayload))
```

输出小写 hex。

建议后端新增环境变量：

```text
XHUNT_V2_SIGNING_KEY=<v2 signing key>
```

legacy 继续使用现有：

```text
XHUNT_API_SECRET=<legacy signing key>
```

---

## 4. 后端改造范围

### 4.1 主要修改文件

| 文件 | 改造内容 |
|------|----------|
| `src/apiServer.js` | 为 JSON body parser 增加 `verify`，保存 `req.rawBody` |
| `src/xhunt/middleware/security.js` | 新增 v2 验签、query 规范化、防重放分流、错误码映射 |
| `src/xhunt/middleware/auth.js` | 登录态接口增加 `x-tw-id` 与 token `twitterId` 强一致校验 |
| `nginx/kb.cryptohunt.ai.conf` | 补充 v2 请求头 CORS 白名单；SSE query 敏感参数日志脱敏/关闭 |
| `docs/xhunt-v2-signature-backend-technical-design.md` | 本技术方案文档 |

### 4.2 可选新增文件

如需降低 `security.js` 文件复杂度，可新增工具文件：

```text
src/xhunt/utils/signature-v2.js
```

建议拆分函数：

```js
buildV2PathWithQuery(req, options)
hashBodySha512(rawBody)
buildV2CanonicalPayload(input)
generateV2Signature(canonicalPayload)
safeCompareHex(a, b)
```

如为了最小改动，也可以先直接放在 `security.js` 内部。

---

## 5. raw body 捕获方案

### 5.1 当前问题

当前全局 JSON parser：

```js
app.use(express.json({ limit: "200kb" }));
```

Express 解析后只保留 `req.body`，无法保证重新 stringify 后与客户端原始 body 一致。

v2 必须使用客户端实际发送的 body text：

```text
SHA-512(bodyText)
```

### 5.2 建议实现

新增统一 verify 函数：

```js
function captureRawBody(req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || "utf8");
  } else {
    req.rawBody = "";
  }
}
```

应用到所有 XHunt 可能走 v2 的 JSON parser：

```js
app.use(express.json({
  limit: "200kb",
  verify: captureRawBody,
}));

app.use("/api/xhunt/report", express.json({
  limit: "1000kb",
  verify: captureRawBody,
}));

app.use("/api/xhunt/stats/nacos/config", express.json({
  limit: "2000kb",
  verify: captureRawBody,
}));
```

如果路由内部单独使用 `express.json()`，也需要补充 `verify`。

### 5.3 注意事项

1. 无 body 请求应视为：

```js
req.rawBody || ""
```

2. `GET` / `HEAD` 通常无 body，body hash 应等于空字符串 SHA-512：

```text
cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e
```

3. 不建议为了 v2 临时读取 stream，因为 body parser 已经消费 request stream。

---

## 6. Query 规范化方案

### 6.1 普通请求规则

普通请求 `PATH_WITH_QUERY` 包含：

- 业务 query；
- 公共 query：`x-language=<language>`。

普通请求安全参数通过 header 传，不会出现在 query 中；如果异常出现在 query，原则上不作为普通请求传输方式使用。

排序规则：

1. 按 decoded key 升序；
2. 同 key 多值按 decoded value 升序；
3. 用 `URLSearchParams` 重新序列化；
4. `pathname + search` 参与签名。

示例：

```text
/api/demo?b=2&a=1&b=1&x-language=en
=> /api/demo?a=1&b=1&b=2&x-language=en
```

### 6.2 SSE 特别规则

SSE 最终 URL 会带安全传输 query，例如：

```text
x-signature-version
x-request-id
x-request-timestamp
x-device-fingerprint
x-request-signature
x-tw-id
x-extension-version
x-user-id
token
```

这些参数 **不反向加入签名**，否则会出现“签名本身参与签名”的循环问题。

SSE 签名时 `PATH_WITH_QUERY` 只包含：

- 业务 query；
- `x-language`。

### 6.3 SSE 安全参数过滤集合

建议后端写死以下过滤集合：

```js
const V2_SSE_TRANSPORT_QUERY_KEYS = new Set([
  "x-signature-version",
  "x_request_signature_version",
  "x-request-id",
  "x_request_id",
  "x-request-timestamp",
  "x_request_timestamp",
  "x-device-fingerprint",
  "x_device_fingerprint",
  "x-request-signature",
  "x_request_signature",
  "x-tw-id",
  "x_tw_id",
  "x-extension-version",
  "x_extension_version",
  "x-user-id",
  "x_user_id",
  "token",
]);
```

注意：不要过滤 `x-language`。

### 6.4 推荐实现伪代码

```js
function buildV2PathWithQuery(req, { isSSE = false } = {}) {
  const pathname = `${req.baseUrl || ""}${req.path || ""}`;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(req.query || {})) {
    if (isSSE && isV2SseTransportKey(key)) {
      continue;
    }

    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      params.append(key, item == null ? "" : String(item));
    }
  }

  const sortedEntries = Array.from(params.entries()).sort(([ak, av], [bk, bv]) => {
    if (ak !== bk) return ak < bk ? -1 : 1;
    if (av !== bv) return av < bv ? -1 : 1;
    return 0;
  });

  const sortedParams = new URLSearchParams();
  for (const [key, value] of sortedEntries) {
    sortedParams.append(key, value);
  }

  const search = sortedParams.toString();
  return search ? `${pathname}?${search}` : pathname;
}
```

---

## 7. v2 验签流程

### 7.1 参数读取

复用现有 `getRequestParam(req, paramName, allowQueryParams)`。

普通 API：

```js
allowQueryParams = false
```

SSE：

```js
allowQueryParams = true
```

### 7.2 分流判断

在 `validateSecurityParams` 开始阶段读取：

```js
const signatureVersion = getRequestParam(req, "signature-version", allowQueryParams);
```

分流：

```js
if (signatureVersion === "v2") {
  return validateV2SecurityParams(req, { allowQueryParams });
}

return validateLegacySecurityParams(req, allowQueryParams);
```

为降低风险，建议先把当前 `validateSecurityParams` 的 legacy 主体迁移成 `validateLegacySecurityParams`，逻辑不变。

### 7.3 v2 校验步骤

1. 校验必传参数：
   - `x-signature-version`
   - `x-request-id`
   - `x-request-timestamp`
   - `x-device-fingerprint`
   - `x-request-signature`
   - `x-tw-id`
   - `x-extension-version`
   - `x-user-id`
   - `x-language`
2. 校验 `x-tw-id` 为合法 Twitter ID。
3. 校验 request id 为 UUID v4。
4. 校验 timestamp 在 5 分钟窗口内。
5. 构造排序后的 `PATH_WITH_QUERY`。
6. 使用 `req.rawBody || ""` 计算 `BODY_SHA512_HEX`。
7. 拼接 canonical payload。
8. 使用 `XHUNT_V2_SIGNING_KEY` 计算 HMAC-SHA512。
9. 使用 constant-time compare 对比签名。
10. 返回 `securityContext`，包含：
    - `signatureVersion: "v2"`
    - `requestId`
    - `timestamp`
    - `fingerprint`
    - `signature`
    - `twId`
    - `version`
    - `pathWithQuery`

### 7.4 v2 时间窗口

新增 v2 专用时间窗口：

```js
const V2_SECURITY_TIME_WINDOW_MS = 5 * 60 * 1000;
```

legacy 保持现有：

```js
const SECURITY_TIME_WINDOW_MS = 30 * 60 * 1000;
```

### 7.5 Twitter ID 格式

建议规则：

```js
/^[1-9]\d{4,24}$/
```

说明：

- 只允许数字字符串；
- 不允许 0 开头；
- 长度预留到 25 位，避免未来 ID 增长问题；
- legacy 不要求 `x-tw-id`。

如需完全兼容历史特殊值，可先放宽为：

```js
/^\d{5,25}$/
```

---

## 8. 防重放设计

### 8.1 当前 legacy 逻辑

当前后端 dedup key 由以下字段组成：

```text
requestId | timestamp | signature | fingerprint
```

legacy 继续保留，避免影响老版本。

### 8.2 v2 普通 API

普通 API 必须按纯 request id 严格去重：

```text
security:reqid:v2:api:<requestId>
```

Redis：

```js
SET key 1 NX EX 600
```

TTL 建议：

```text
5-10 分钟
```

推荐使用 10 分钟，略大于 v2 timestamp 窗口。

### 8.3 v2 SSE

SSE 允许 EventSource 自动重连同一个 URL，因此不能纯 request id 拒绝。

SSE dedup key：

```text
security:reqid:v2:sse:<requestId>:<signature>:<twId>
```

同一 key 在时间窗口内允许重复通过；或者不做拒绝，只记录/续期。

推荐实现：

```js
if (securityContext.signatureVersion === "v2" && isSSE) {
  return { allowed: true, source: "sse-v2-reconnect-allowed" };
}
```

如需观测重连次数，可 Redis `INCR` 一个统计 key，但不阻断请求。

### 8.4 reserveRequestId 入参扩展

建议扩展为：

```js
reserveRequestId(req, securityContext, {
  allowReconnect: false,
  isSSE: false,
})
```

构造 key 时根据：

```text
securityContext.signatureVersion
isSSE
```

选择 legacy / v2 api / v2 sse 策略。

---

## 9. 登录态 `x-tw-id` 强一致校验

### 9.1 校验原则

v2 验签只能证明请求来自掌握签名 key 的客户端，并且 `x-tw-id` 未被中途篡改。

对于有 JWT 登录态的接口，还必须保证：

```text
x-tw-id == token 对应的 twitterId
```

否则用户 A 可能在可签名的前提下声明用户 B 的 `x-tw-id`。

### 9.2 推荐位置

建议放在 JWT auth middleware 内，而不是纯签名函数内。

原因：

- 签名中间件不一定已经解析 JWT；
- 部分公开接口可能没有登录态；
- 职责更清晰：签名验证请求完整性，auth 验证用户身份一致性。

### 9.3 伪代码

在 `src/xhunt/middleware/auth.js` 成功解析 `req.user` 后增加：

```js
function enforceV2TwitterIdConsistency(req, res) {
  const ctx = req.securityContext;
  if (!ctx || ctx.signatureVersion !== "v2") {
    return true;
  }

  const signedTwId = String(ctx.twId || "").trim();
  const tokenTwId = String(req.user?.twitterId || "").trim();

  if (signedTwId && tokenTwId && signedTwId !== tokenTwId) {
    res.status(403).json({
      error: "TWITTER_ID_MISMATCH",
    });
    return false;
  }

  return true;
}
```

如果某些接口允许 token 用户不存在，则只在 `req.user.twitterId` 存在时强校验。

---

## 10. 错误码设计

### 10.1 v2 推荐错误码

| HTTP 状态 | error | 场景 |
|----------|-------|------|
| 400 | `MISSING_SIGNATURE_HEADERS` | 缺少 v2 必传参数 |
| 400 | `MISSING_TWITTER_ID` | 缺少 `x-tw-id` |
| 400 | `INVALID_TWITTER_ID` | `x-tw-id` 格式非法 |
| 400 | `INVALID_REQUEST_ID` | request id 非 UUID v4 |
| 400 | `SIGNATURE_EXPIRED` | timestamp 超出 5 分钟窗口 |
| 409 | `REPLAY_REQUEST` | 普通 API request id 重复 |
| 411 | `INVALID_SIGNATURE` | 签名不匹配 |
| 500 | `SIGNING_KEY_NOT_CONFIGURED` | v2 signing key 未配置 |
| 403 | `TWITTER_ID_MISMATCH` | 登录 token 与 `x-tw-id` 不一致 |

### 10.2 legacy 错误码

legacy 继续返回现有错误码：

```text
400
400-1
400-2
400-3
409
411
```

避免老版本前端异常。

---

## 11. 安全日志与观测

### 11.1 安全日志字段

`SecurityViolationLogger` 建议记录以下 v2 字段：

```js
{
  signatureVersion: "v2",
  twId,
  requestId,
  timestamp,
  extensionVersion,
  userId,
  language,
  pathWithQuery,
  reasonCode,
}
```

不要记录：

- `x-request-signature` 完整值；
- `authorization`；
- `token` query；
- cookie。

签名如需排查，可只记录前后缀：

```text
abcdef12...12345678
```

### 11.2 请求统计

现有 `requestStatsManager` 可继续使用 `x-extension-version` 统计插件版本。

新增可选统计：

```text
signatureVersion=v2 / legacy
```

用于观察灰度进度。

### 11.3 灰度指标

建议观察：

- v2 请求量占比；
- v2 签名失败率；
- v2 timestamp 过期数量；
- v2 request id 重放数量；
- `TWITTER_ID_MISMATCH` 数量；
- SSE 重连次数。

---

## 12. 测试方案

### 12.1 固定测试向量

前端文档已提供 3 个固定向量：

1. GET + query 排序；
2. POST + JSON body；
3. SSE GET。

后端需要写最小脚本或单测校验：

- `bodyHash` 一致；
- `pathWithQuery` 一致；
- canonical payload 一致；
- expected signature 一致。

### 12.2 建议新增本地校验脚本

可新增：

```text
scripts/verify-xhunt-v2-signature-vectors.js
```

运行：

```bash
node scripts/verify-xhunt-v2-signature-vectors.js
```

不依赖数据库、不启动服务。

### 12.3 接口级测试点

| 测试项 | 预期 |
|--------|------|
| v2 GET query 乱序 | 验签成功 |
| v2 POST body 字段顺序保持原样 | 验签成功 |
| v2 POST body 被服务端 stringify 后不同 | 仍按 rawBody 验签成功 |
| 缺少 `x-tw-id` | `MISSING_TWITTER_ID` |
| `x-tw-id` 不参与签名 | `INVALID_SIGNATURE` |
| timestamp 超过 5 分钟 | `SIGNATURE_EXPIRED` |
| 普通 API 重复 request id | 第二次 `REPLAY_REQUEST` |
| SSE 同 URL 自动重连 | 不因 request id 重复失败 |
| token twitterId 与 x-tw-id 不一致 | `TWITTER_ID_MISMATCH` |
| legacy 无 `x-signature-version` | 继续旧逻辑 |

---

## 13. 发布与回滚方案

### 13.1 发布步骤

1. 后端上线 raw body 捕获和 v2 验签代码，但前端尚未切流。
2. 配置生产环境：

```text
XHUNT_V2_SIGNING_KEY=<正式 v2 key>
```

3. 前端灰度发送 `x-signature-version: v2`。
4. 观察 v2 签名失败率、安全日志、SSE 重连情况。
5. 稳定后扩大 v2 覆盖比例。
6. legacy 兼容期结束后，再评估移除 legacy。

### 13.2 回滚策略

如 v2 大面积失败：

- 前端停止发送 `x-signature-version: v2`，自动回到 legacy；
- 后端保留 legacy 不受影响；
- 如 signing key 配错，可只修正环境变量后重启 API 服务。

### 13.3 风险控制

上线前必须确认：

- 生产环境 `XHUNT_V2_SIGNING_KEY` 与前端一致；
- SSE query 过滤规则与前端一致；
- body parser 已捕获 raw body；
- `x-language` 没有被 SSE 过滤掉；
- login token 与 `x-tw-id` mismatch 不误伤匿名接口。

---

## 14. 实现顺序建议

建议按以下顺序改造：

1. **raw body 捕获**
   - 修改 `src/apiServer.js`；
   - 确保所有 XHunt JSON parser 都设置 `verify`。

2. **v2 工具函数**
   - 实现 body hash、query 排序、canonical payload、HMAC-SHA512、constant-time compare。

3. **验签分流**
   - 将 legacy 逻辑保留；
   - `x-signature-version === "v2"` 时进入 v2。

4. **防重放分流**
   - 普通 API 纯 request id 去重；
   - SSE 允许重连。

5. **JWT 强一致校验**
   - 在 auth middleware 解析用户后校验 `x-tw-id`。

6. **测试向量校验**
   - 用 3 个固定向量验证算法完全一致。

7. **灰度观测**
   - 观察 v2 错误码和签名失败日志。

---

## 15. 关键实现清单

### 15.0 Nginx / 代理层

- [ ] `Access-Control-Allow-Headers` 增加 `x-signature-version`。
- [ ] `Access-Control-Allow-Headers` 增加 `x-language`。
- [ ] SSE location 不记录完整 query，避免 `token` / `x-request-signature` 进入 access log。
- [ ] SSE location 保持 `proxy_buffering off`、`proxy_cache off`、`proxy_request_buffering off`。
- [ ] 确认代理层不改写参与签名的 pathname。
- [ ] 确认 Nginx 不丢弃带下划线的 query 参数；v2 header 统一使用 hyphen 形式。

### 15.1 配置

- [ ] 新增 `XHUNT_V2_SIGNING_KEY` 环境变量。
- [ ] 确认 `.env-dev` / 生产环境均配置。

### 15.2 raw body

- [ ] 全局 `express.json` 增加 `verify`。
- [ ] `/api/xhunt/report` parser 增加 `verify`。
- [ ] `/api/xhunt/stats/nacos/config` parser 增加 `verify`。
- [ ] 检查路由内部单独 `express.json()`。

### 15.3 v2 验签

- [ ] 读取 `x-signature-version`。
- [ ] v2 必传头校验。
- [ ] `x-tw-id` 格式校验。
- [ ] 5 分钟 timestamp 校验。
- [ ] query 排序。
- [ ] raw body SHA-512。
- [ ] canonical payload。
- [ ] HMAC-SHA512。
- [ ] constant-time compare。

### 15.4 防重放

- [ ] 普通 API：`v2:api:<requestId>` 严格去重。
- [ ] SSE：允许同一 URL 重连，不按纯 request id 阻断。
- [ ] legacy：保持旧策略。

### 15.5 登录一致性

- [ ] JWT 成功解析后校验 `x-tw-id === req.user.twitterId`。
- [ ] 匿名/公开接口不误伤。

### 15.6 测试

- [ ] 三个固定测试向量全部通过。
- [ ] 普通 API replay 测试通过。
- [ ] SSE reconnect 测试通过。
- [ ] legacy 请求仍通过。

---

## 16. 附录：v2 核心伪代码

```js
function validateV2SecurityParams(req, { allowQueryParams = false } = {}) {
  const signatureVersion = getRequestParam(req, "signature-version", allowQueryParams);
  const requestId = getRequestParam(req, "request-id", allowQueryParams);
  const timestampRaw = getRequestParam(req, "request-timestamp", allowQueryParams);
  const fingerprint = getRequestParam(req, "device-fingerprint", allowQueryParams);
  const signature = getRequestParam(req, "request-signature", allowQueryParams);
  const extensionVersion = getRequestParam(req, "extension-version", allowQueryParams);
  const userId = getRequestParam(req, "user-id", allowQueryParams);
  const language = getRequestParam(req, "language", allowQueryParams);
  const twId = getRequestParam(req, "tw-id", allowQueryParams);

  if (!signatureVersion || !requestId || !timestampRaw || !fingerprint ||
      !signature || !extensionVersion || !userId || !language) {
    return { isValid: false, error: "MISSING_SIGNATURE_HEADERS" };
  }

  if (!twId) {
    return { isValid: false, error: "MISSING_TWITTER_ID" };
  }

  if (!isValidTwitterId(twId)) {
    return { isValid: false, error: "INVALID_TWITTER_ID" };
  }

  if (!isValidRequestId(requestId)) {
    return { isValid: false, error: "INVALID_REQUEST_ID" };
  }

  if (!isV2TimestampValid(Number(timestampRaw))) {
    return { isValid: false, error: "SIGNATURE_EXPIRED" };
  }

  const isSSE = allowQueryParams;
  const pathWithQuery = buildV2PathWithQuery(req, { isSSE });
  const bodyText = req.rawBody || "";
  const bodyHash = crypto.createHash("sha512").update(bodyText).digest("hex");

  const canonicalPayload = [
    req.method.toUpperCase(),
    pathWithQuery,
    String(timestampRaw),
    requestId,
    fingerprint,
    bodyHash,
    String(twId),
  ].join("\n");

  const expectedSignature = crypto
    .createHmac("sha512", process.env.XHUNT_V2_SIGNING_KEY)
    .update(canonicalPayload)
    .digest("hex");

  if (!safeCompareHex(signature, expectedSignature)) {
    return { isValid: false, error: "INVALID_SIGNATURE" };
  }

  return {
    isValid: true,
    securityContext: attachIdentityToSecurityContext(req, {
      signatureVersion: "v2",
      requestId,
      timestamp: Number(timestampRaw),
      fingerprint,
      version: extensionVersion,
      signature,
      twId: String(twId),
      userId,
      language,
      pathWithQuery,
    }, { allowQueryParams }),
  };
}
```

---

## 17. 架构边界情况与风险审查

本节从落地实现角度补充容易遗漏的边界情况，作为开发和 Code Review 检查项。

### 17.1 `x-language` 的来源必须统一

v2 canonical query 要求包含：

```text
x-language=<language>
```

但普通请求中 `x-language` 可能只通过 header 传递，不一定真实存在于 URL query。

因此后端构造 `PATH_WITH_QUERY` 时不能只遍历 `req.query`，还需要：

1. 优先读取 URL query 中已有的 `x-language`；
2. 如果 query 中没有，则从 header/query 安全参数读取 `x-language` 后追加到待签名 query；
3. 避免重复追加两个 `x-language`。

否则会出现前端签名包含 `x-language`，后端验签缺失 `x-language` 的问题。

### 17.2 Express 可能提前消费 body，rawBody 捕获必须全链路一致

项目中除了 `apiServer.js` 全局 JSON parser，还有路由级 parser：

```text
src/xhunt/api/website-campaigns.js
```

如果某个路由在全局 parser 之后再次声明 `express.json()`，通常不会重新解析已消费 body；但如果该路由未来调整到全局 parser 之前，或新增特殊 content-type parser，就可能丢失 `req.rawBody`。

Code Review 要求：

- 所有新增 XHunt JSON parser 都必须带 `verify: captureRawBody`；
- 如支持 `text/plain`、`application/octet-stream`、multipart 等非 JSON body，需要单独定义 v2 raw body 策略；
- 当前 v2 优先限定 JSON / 无 body 请求，避免多 content-type 复杂度扩散。

### 17.3 `req.query` 与原始 URL 的编码差异

Express 的 `req.query` 已经过解析，可能丢失原始 query 的部分编码细节，例如：

```text
%20 vs +
空值 a vs a=
重复 key 的顺序
```

v2 已约定使用 WHATWG `URLSearchParams` 语义，因此后端可以基于 decoded 后的 `req.query` 重建 query，但必须接受以下事实：

- 不以原始 URL 字节作为 canonical 来源；
- 前后端都必须使用 URLSearchParams 重新序列化；
- 不允许一端用原始 search，另一端用解析后对象。

如未来发现 Express query parser 对数组/嵌套对象处理与 URLSearchParams 不一致，应改为基于 `req.originalUrl` 的 raw search 自行解析。

### 17.4 query 参数数组和对象必须收敛为字符串数组

Express query parser 可能产生：

```js
{ a: ["1", "2"] }
{ a: { b: "1" } }
```

v2 只支持 URLSearchParams 能表达的扁平 key-value 模型。

建议策略：

- `string`：直接 append；
- `string[]`：逐个 append；
- `null/undefined`：按空字符串；
- `object`：v2 直接拒绝或按 `String(value)` 处理，但推荐拒绝并记录日志。

推荐后端不要支持嵌套 query，避免不同 parser 之间出现 canonical 不一致。

### 17.5 `x-signature-version` 的大小写和空格

Header 名大小写由 Node 统一处理，但 header value 需要明确：

```text
trim(value) === "v2"
```

建议：

- 对 version value 做 trim；
- 不做大小写兼容，避免 `"V2"`、`"v2 "` 等非标准输入长期存在；
- 如为了灰度容错，可短期接受 trim 后的 `"v2"`。

### 17.6 constant-time compare 要处理长度不一致

`crypto.timingSafeEqual` 要求 Buffer 长度一致，否则会 throw。

推荐实现：

```js
function safeCompareHex(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  if (!/^[a-f0-9]+$/i.test(actual)) return false;
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(actual.toLowerCase(), "hex"),
    Buffer.from(expected.toLowerCase(), "hex")
  );
}
```

### 17.7 v2 signing key 缺失时不要隐式 fallback 到 legacy key

如果 `XHUNT_V2_SIGNING_KEY` 未配置，后端应直接返回：

```text
SIGNING_KEY_NOT_CONFIGURED
```

不要 fallback 到 `XHUNT_API_SECRET`，否则会造成：

- 前后端 key 管理边界不清；
- 灰度问题难排查；
- legacy/v2 无法独立轮换 key。

### 17.8 SSE 的安全 query 会进入日志和代理层

SSE 由于使用 query 传输 token 和签名参数，天然更容易被访问日志、Nginx、CDN、APM 记录。

必须确认：

- morgan / Nginx / 代理日志不要完整记录 `token`；
- `SecurityViolationLogger` 不记录 token 和完整 signature；
- 如可行，SSE token 使用短期 token 或专用 token，而不是长期 JWT。

当前项目 morgan 会打印 `url=:url`，这会包含 SSE query。上线前需要评估是否对 SSE URL 做脱敏日志，至少隐藏：

```text
token
x-request-signature
```

### 17.9 SSE 重连允许策略不能变成无限重放通道

文档建议 SSE 允许同一 `requestId + signature + twId` 重连，但仍需受 timestamp 窗口限制。

要求：

- 每次 SSE 重连仍重新校验 timestamp 是否在 5 分钟内；
- 超过窗口后，即使 requestId/signature 相同也应拒绝；
- 避免被截获 URL 后长期复用。

### 17.10 普通 API requestId 纯去重可能影响并发重试

普通 API 按纯 `x-request-id` 严格去重是正确的防重放策略，但前端如果对同一请求做自动 retry，必须生成新的 requestId 和 signature。

需要同步前端约束：

```text
普通 API 每次实际发起 HTTP 请求，都生成新的 requestId。
SSE 自动重连除外。
```

### 17.11 `x-tw-id` 与 token 一致性对匿名接口的影响

有些接口可能是 optional auth：

```text
有 token 就解析，无 token 也放行
```

一致性校验应只在 `req.user.twitterId` 存在时强制执行。

推荐判断：

```js
if (ctx.signatureVersion === "v2" && req.user?.twitterId) {
  assert(ctx.twId === req.user.twitterId)
}
```

不要因为匿名接口没有 `req.user` 就误报 `TWITTER_ID_MISMATCH`。

### 17.12 token 用户缺少 twitterId 的历史数据

如果历史用户数据中存在 `req.user.twitterId` 为空，但 v2 请求有 `x-tw-id`，需要明确策略：

- 保守策略：不做强一致校验，只记录 warn；
- 严格策略：拒绝请求，要求重新登录修复用户资料。

建议初期采用保守策略，避免历史脏数据导致用户不可用，同时增加日志观察。

### 17.13 `x-device-fingerprint` 固定 deadbeef 与 v2 签名兼容

新版本可能继续传：

```text
deadbeefdeadbeefdeadbeefdeadbeef
```

v2 验签阶段应允许该值作为 raw fingerprint 参与签名；业务身份、限流、DAU 仍按现有 effective identity 方案使用 `x-tw-id` 优先。

不要在 v2 签名层拒绝 deadbeef。

### 17.14 路径来源要避免 `req.path` 丢失挂载前缀

Express 子路由中 `req.path` 不包含 `baseUrl`。

构造签名路径必须使用：

```js
`${req.baseUrl || ""}${req.path || ""}`
```

或者从 `req.originalUrl` 提取 pathname。

不要只使用 `req.path`，否则挂载在 `/api/xhunt/...` 下的路由会验签失败。

### 17.15 反向代理路径重写风险

如果 Nginx/CDN 对路径做 rewrite，例如：

```text
/xhunt/api -> /api/xhunt
```

前端签名的 pathname 必须与 Node 最终看到的 pathname 一致。

当前建议：

- v2 canonical path 以 Node Express 实际收到的路径为准；
- 不在代理层做影响 pathname 的 rewrite；
- 如必须 rewrite，需要在前端签名路径和后端验签路径之间建立明确映射。

### 17.16 HEAD / DELETE / GET with body 的处理

协议允许任意 method，但实现需要明确：

- GET/HEAD 无 body：按空字符串 hash；
- DELETE 如果带 JSON body：按 raw body hash；
- GET with body 不推荐，但如果客户端真的发送 body，后端 body parser 是否消费取决于 content-type，可能导致不一致。

建议前端约束：

```text
GET/HEAD 不发送 body。
POST/PUT/PATCH/DELETE 如有 body，必须设置 application/json。
```

### 17.17 失败日志可能暴露 canonical payload

签名失败时不要直接打印完整 canonical payload，因为其中可能包含业务 query 或敏感参数。

建议只在本地开发环境打印完整 payload；生产环境只打印：

- path；
- requestId；
- twId；
- timestamp 偏移；
- signature 前后缀；
- expectedSignature 前后缀。

### 17.18 兼容期结束需要有明确开关

建议预留环境变量：

```text
XHUNT_LEGACY_SIGNATURE_ENABLED=true
```

兼容期内开启；兼容期结束后可先在灰度环境关闭验证影响，再正式移除 legacy 代码。

这样比直接删代码更安全。
