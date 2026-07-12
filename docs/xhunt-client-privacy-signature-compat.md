# XHunt 插件隐私字段移除：后端兼容改造文档

最后更新：2026-07-12

## 0. 背景

XHunt 浏览器插件新版本为了降低用户对敏感信息上传的顾虑，已经调整全局请求链路：

1. **全局 API 请求头不再发送当前页面完整 URL**：删除 `x-window-location-href`。
2. **全局 API 请求头不再发送设备标识**：删除 `x-device-fingerprint`。
3. **v2 签名原文删除设备标识行**：从旧版 7 行变为新版 6 行。
4. **错误报告上传模块已删除**：新客户端不会再请求 `/api/xhunt/report/errors`。
5. **活动报名业务 payload 不变**：`registrationUrl` 仍由活动报名接口按原业务逻辑传递，不在本次后端改造范围内。

关键要求：**后端必须同时兼容已升级客户端和未升级客户端**。兼容期内不能只支持新版，否则老插件会失败；也不能只支持旧版，否则新插件会全部验签失败。

---

## 1. 项目结构定位

当前后端项目是 Node.js + Express 服务，XHunt 插件相关逻辑主要在以下位置：

| 模块 | 路径 | 本次关注点 |
| --- | --- | --- |
| API 服务入口 | `src/apiServer.js` | CORS 允许头、性能监控字段、morgan 日志字段 |
| XHunt 安全中间件 | `src/xhunt/middleware/security.js` | browserOnly、v2 验签、SSE 验签、DAU/request stats、安全日志 |
| XHunt 登录 token 中间件 | `src/xhunt/middleware/auth.js` | v2 `x-tw-id` 与 token twitterId 一致性校验 |
| 请求身份工具 | `src/xhunt/utils/request-identity.js` | effective identity、fingerprint fallback、限流 identity |
| 错误报告接口 | `src/xhunt/api/report.js` | 新客户端不再调用，接口可保留兼容旧客户端 |
| 活动报名接口 | `src/xhunt/api/campaign.js`、`src/xhunt/api/mantle.js` | `registrationUrl` 保持业务 payload，不因本次全局请求头改造删除 |
| 现有 v2 签名设计文档 | `docs/xhunt-v2-signature-backend-technical-design.md` | 旧文档仍有 fingerprint 参与签名的描述，需要以本文为准更新实现 |
| 旧 fingerprint 兼容设计 | `docs/xhunt-identity-fingerprint-twid-compatibility-design.md` | 原本是 deadbeef 兼容方案；新客户端进一步删除 fingerprint 字段 |

---

## 2. 新旧客户端差异

### 2.1 未升级客户端（旧客户端）

旧客户端仍发送：

```http
x-device-fingerprint: <32位指纹或历史兼容值>
x-window-location-href: <当前页面URL或background-script>
x-request-signature: <signature>
x-signature-version: v2
x-request-id: <uuid>
x-request-timestamp: <timestamp-ms>
x-tw-id: <twitter-id>
```

旧客户端 v2 canonical payload 是 **7 行**：

```text
METHOD
PATH_WITH_QUERY
TIMESTAMP
REQUEST_ID
DEVICE_FINGERPRINT
BODY_SHA512_HEX
TW_ID
```

### 2.2 已升级客户端（新客户端）

新客户端不再发送：

```http
x-device-fingerprint
x-window-location-href
```

新客户端仍发送：

```http
x-request-id: <uuid>
x-request-timestamp: <timestamp-ms>
x-request-signature: <signature>
x-signature-version: v2
x-extension-version: <extension-version>
x-user-id: <username>
x-tw-id: <twitter-id>
x-language: <language>
authorization: Token <token, optional>
```

新客户端 v2 canonical payload 是 **6 行**：

```text
METHOD
PATH_WITH_QUERY
TIMESTAMP
REQUEST_ID
BODY_SHA512_HEX
TW_ID
```

---

## 3. 必须改造点总览

### P0：`browserOnlyMiddleware` 不能再强依赖 `x-window-location-href`

现状：`src/xhunt/middleware/security.js` 中 `validateBrowserEnvironment()` 会通过 `isBrowserEnvironment(userAgent, windowLocationHref)` 校验，`isBrowserEnvironment` 当前要求 `windowLocationHref` 必须存在。新客户端不再发送该头，因此会在安全验签前被 403 拦截。

要求：

- legacy 请求仍保持原逻辑。
- 对 `x-signature-version === "v2"` 的请求，不能因为缺少 `x-window-location-href` 直接拒绝。
- 建议 v2 请求在 browserOnly 阶段只做轻量检查，例如：存在浏览器 UA + 存在 v2 签名必要公共字段，然后交给 `securityMiddleware` 做真正验签。

建议逻辑：

```js
// validateBrowserEnvironment(req)
if (signatureVersion === "v2") {
  // v2 请求不再要求 x-window-location-href。
  // 这里只放行到 securityMiddleware，真正安全性由签名校验保证。
  return hasBrowserUserAgent(userAgent) && hasBasicV2SignatureHeaders(req);
}

// 非 v2 / legacy 继续走旧逻辑
return isBrowserEnvironment(userAgent, windowLocationHref);
```

注意：不要把缺少 `x-window-location-href` 作为 v2 请求失败原因。

### P0：`validateV2SecurityParams` 兼容 6 行和 7 行签名

现状：`src/xhunt/middleware/security.js` 中 `validateV2SecurityParams()` 当前把 `fingerprint` 当作必填，并且 canonical payload 固定包含 fingerprint：

```js
const canonicalPayload = [
  req.method.toUpperCase(),
  pathWithQuery,
  timestampRaw,
  requestId,
  fingerprint,
  bodyHash,
  twId,
].join("\n");
```

要求改为：

- `x-device-fingerprint` 对 v2 不再是必填。
- 如果请求携带 `x-device-fingerprint`，说明大概率是旧客户端，按旧版 7 行签名验签。
- 如果请求不携带 `x-device-fingerprint`，说明是新版客户端，按新版 6 行签名验签。
- 不要因为缺少 fingerprint 返回 `MISSING_SIGNATURE_HEADERS`。

推荐实现：

```js
const fingerprint = normalizeOptionalSignedValue(
  getRequestParam(req, "device-fingerprint", allowQueryParams)
);
const hasFingerprint = Boolean(fingerprint);

// v2 必填字段里删除 fingerprint
if (
  signatureVersion !== V2_SIGNATURE_VERSION ||
  !requestId ||
  !timestampRaw ||
  !signature ||
  !version ||
  !userId ||
  !language
) {
  return { isValid: false, error: "MISSING_SIGNATURE_HEADERS" };
}

// 只有携带 fingerprint 的旧客户端才校验 fingerprint 格式
if (hasFingerprint && !isValidFingerprint(fingerprint)) {
  return { isValid: false, error: "400-1" };
}

const commonPayloadParts = [
  req.method.toUpperCase(),
  pathWithQuery,
  timestampRaw,
  requestId,
];

const canonicalPayload = hasFingerprint
  ? [...commonPayloadParts, fingerprint, bodyHash, twId].join("\n") // 旧客户端 7 行
  : [...commonPayloadParts, bodyHash, twId].join("\n");       // 新客户端 6 行

const expectedSignature = generateV2Signature(canonicalPayload, signingKey);
```

securityContext 建议增加字段，方便日志和灰度观测：

```js
{
  signatureVersion: "v2",
  signaturePayloadVersion: hasFingerprint ? "v2-7line-fingerprint" : "v2-6line-no-fingerprint",
  fingerprint: fingerprint || null,
  rawFingerprint: fingerprint || null,
  // 其他原字段保持
}
```

### P0：SSE v2 query 参数同样要兼容

`validateV2SecurityParams(req, { allowQueryParams: true })` 也会用于 SSE。SSE 新客户端同样不会带 `x-device-fingerprint`，所以 query 参数读取逻辑也要按同一规则兼容：

- query 中有 `x-device-fingerprint` / `x_device_fingerprint`：旧 7 行。
- query 中没有 fingerprint：新 6 行。

### P1：身份、限流、DAU 不再依赖 fingerprint

`src/xhunt/utils/request-identity.js` 已经有 effective identity 逻辑：

```text
req.user.twitterId > x-tw-id > real fingerprint > anonymous
```

新客户端没有 fingerprint 后，应确保：

- 登录态接口：优先使用 `req.user.twitterId`。
- 未完成 auth 但带 v2 签名的接口：优先使用 `x-tw-id`。
- 老客户端且无 twId 的极老场景：才 fallback 到真实 fingerprint。
- 不要把空 fingerprint / missing fingerprint 写成同一个共享身份。

`getRateLimitIdentity()` 当前已有 `tw-id` fallback，整体方向正确；需要重点确认缺少 fingerprint 时不会所有用户落到同一个 key。

### P1：日志、性能监控不要继续采集敏感字段

#### `src/apiServer.js`

当前性能监控里仍配置了：

```js
collectDetailedInfo: {
  fingerprint: ["headers", "x-device-fingerprint"],
  location: ["headers", "x-window-location-href"],
}
```

建议：

- 删除 `fingerprint` 和 `location` 的采集，或改为只采集布尔值/来源状态。
- 保留非敏感字段：`version`、`twId`、`requestId`。

例如：

```js
collectDetailedInfo: {
  version: ["headers", "x-extension-version"],
  twId: ["headers", "x-tw-id"],
  ua: ["get", "user-agent"],
}
```

当前 morgan token 里也有：

```js
fingerprint=${fingerprint} location=${windowLocationHref}
```

建议改为：

```js
return `request_id=${requestId} user_id=${userId} tw_id=${twId} version=${version}`;
```

旧客户端传来的 `x-window-location-href` 不建议继续写日志或落库。

### P1：安全违规日志不要要求 fingerprint

`SecurityViolationLogger` / `securityViolationLogger.logViolation()` 当前可能记录 fingerprint、location。兼容期建议：

- 新版缺 fingerprint 时不要标记为异常。
- 旧客户端传来的 location 不再记录完整值；如必须排查，只记录是否存在或 origin/path 的脱敏版本。
- 签名失败日志不要输出完整 canonical payload，不要输出完整 signature。

### P1：CORS allowedHeaders 保持兼容

`src/apiServer.js` 的 `allowedHeaders` 可以继续包含：

```js
"x-device-fingerprint",
"x-window-location-href",
```

原因：旧客户端仍会发送。不要为了新版立刻移除，否则旧客户端可能被 CORS 预检挡住。

### P2：错误报告接口处理

新客户端已经删除错误报告上传模块，不再请求：

```text
POST /api/xhunt/report/errors
```

后端可以：

- 保留接口，兼容旧客户端。
- 或仅返回成功但不转发外部系统。

不建议立即删除路由，避免旧客户端报错。

### P2：活动报名 `registrationUrl` 保持不变

本次只删除全局请求头中的页面 URL。活动报名业务 payload 里的 `registrationUrl` 仍保留，后端接口不需要因为本次改造删除：

- `src/xhunt/api/campaign.js`
- `src/xhunt/api/mantle.js`

注意：这些文件里当前有从 `x-window-location-href` 兜底生成报名页面 URL 的逻辑。新客户端不会提供该 header，因此只能使用 body 里的 `registrationUrl`；如果 body 也没有，则按 null 处理即可。

---

## 4. 推荐验签流程

后端 v2 验签推荐流程：

```text
1. 读取 signatureVersion、requestId、timestamp、signature、extensionVersion、userId、language、twId。
2. 校验 signatureVersion 必须为 v2。
3. 校验 requestId、timestamp、signature、extensionVersion、userId、language、twId 必填。
4. 读取 fingerprint，但不作为新版必填。
5. 如果 fingerprint 存在，校验格式，并按旧版 7 行 payload 验签。
6. 如果 fingerprint 不存在，按新版 6 行 payload 验签。
7. 校验 twId 格式。
8. 校验 timestamp 时间窗口。
9. 计算 pathWithQuery，保持现有 query 排序规则。
10. 计算 bodyHash = SHA-512(rawBody || "")。
11. HMAC-SHA512 对比签名。
12. 设置 securityContext，并进入 requestId 防重放、auth、业务逻辑。
```

兼容期内不要仅靠 `x-signature-version: v2` 区分新旧，因为新旧客户端都是 v2。

---

## 5. 推荐测试用例

### 5.1 新客户端普通 API：无 fingerprint、无 location

请求头：

```http
x-signature-version: v2
x-request-id: <uuid>
x-request-timestamp: <now-ms>
x-request-signature: <6行签名>
x-extension-version: <version>
x-user-id: <username>
x-tw-id: <twitter-id>
x-language: en
```

预期：

- browserOnly 通过。
- v2 6 行验签通过。
- 不因为缺 `x-device-fingerprint` 或 `x-window-location-href` 报错。

### 5.2 旧客户端普通 API：有 fingerprint、有 location

请求头包含：

```http
x-device-fingerprint: <32位指纹>
x-window-location-href: <页面URL或background-script>
x-request-signature: <7行签名>
x-signature-version: v2
```

预期：

- 旧 7 行验签通过。
- CORS 不阻断旧 header。

### 5.3 新客户端 SSE：query 无 fingerprint

EventSource URL query 带 v2 公共参数，但不带 fingerprint。

预期：

- SSE 安全中间件按 6 行验签。
- 不因 fingerprint 缺失失败。

### 5.4 旧客户端 SSE：query 有 fingerprint

预期：

- SSE 安全中间件按 7 行验签。

### 5.5 签名失败日志

预期：

- 只记录 requestId、twId、payloadVersion、signature 前后缀。
- 不打印完整 URL、完整 signature、完整 canonical payload。

---

## 6. 改造优先级清单

### 必须先改（否则新客户端请求会失败）

- [ ] `src/xhunt/middleware/security.js`：`validateBrowserEnvironment` 允许 v2 请求缺少 `x-window-location-href`。
- [ ] `src/xhunt/middleware/security.js`：`validateV2SecurityParams` 删除 fingerprint 必填校验。
- [ ] `src/xhunt/middleware/security.js`：v2 canonical payload 兼容旧 7 行与新 6 行。
- [ ] `src/xhunt/middleware/security.js`：SSE v2 走同一套 6/7 行兼容逻辑。

### 建议同步改（避免继续采集敏感字段）

- [ ] `src/apiServer.js`：性能监控不再采集 `x-device-fingerprint` 和 `x-window-location-href` 明文。
- [ ] `src/apiServer.js`：morgan 日志不再打印 fingerprint 和完整 location。
- [ ] `src/xhunt/middleware/security.js`：安全违规日志不要把旧客户端 location 完整落库。

### 可以保留兼容

- [ ] CORS `allowedHeaders` 继续允许 `x-device-fingerprint`、`x-window-location-href`，兼容旧客户端。
- [ ] `src/xhunt/api/report.js` 保留路由，兼容旧客户端；新客户端不会再调用。
- [ ] 活动报名 `registrationUrl` 保持不变。

---

## 7. 风险与回滚

### 风险 1：browserOnly 提前拦截新版请求

如果只改验签，不改 browserOnly，新客户端会在验签前 403。

解决：先放行 v2 缺 location 的请求到 securityMiddleware。

### 风险 2：只支持 6 行导致旧客户端失败

旧客户端仍按 7 行签名，必须保留旧 7 行分支。

### 风险 3：只支持 7 行导致新客户端失败

新客户端不再有 fingerprint，必须支持 6 行分支。

### 风险 4：继续记录旧 location

旧客户端仍会传 `x-window-location-href`，如果日志继续输出，会继续出现用户敏感 URL 采集问题。

解决：即使为了兼容读取，也不要落库/日志输出完整值。

### 回滚建议

如果新版验签上线后异常：

1. 保留旧 7 行分支不动。
2. 临时在 `validateV2SecurityParams` 中对无 fingerprint 请求输出灰度日志，定位是否 6 行签名构造不一致。
3. 不建议回滚到强制要求 fingerprint，因为会直接阻断新版客户端。

---

## 8. 给后端实现者的核心结论

一句话版本：

> v2 验签需要根据 `x-device-fingerprint` 是否存在兼容两套 canonical payload；同时 browserOnly 不能再要求 `x-window-location-href`，日志/监控不要继续记录 fingerprint 和完整页面 URL。

最终兼容规则：

```text
有 x-device-fingerprint  => 旧客户端 => 7 行签名
无 x-device-fingerprint  => 新客户端 => 6 行签名
缺 x-window-location-href => 新客户端正常情况，不能拒绝
```
