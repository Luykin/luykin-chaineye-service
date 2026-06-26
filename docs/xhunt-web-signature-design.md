# XHunt Web 通用请求签名机制设计

## 1. 背景

当前新认证中心包含两部分：

- 前端 React 包：`packages/xhunt-auth-client`
- 后端认证中心：`src/xhunt/auth-center`

目前认证中心接口没有请求签名，只依赖：

- HTTPS
- JWT Bearer Token
- refreshToken
- OAuth state
- EVM nonce + 钱包签名
- 基础参数校验

这对登录认证本身是够用的，但对 XHunt 后续多个 Web 端统一接入来说，还需要一套轻量、统一的 Web 请求签名机制，用于降低被脚本直接刷接口、重放请求、篡改请求体的风险。

> 注意：浏览器端代码天然无法安全保存真正的私钥。因此这套机制定位是 **Web 端轻量防护 / 防重放 / 防低成本滥用**，不是强机密签名。真正强安全仍然依赖 HTTPS、JWT、OAuth state、钱包签名和后端权限校验。

---

## 2. 目标

1. 给认证中心接口增加一套独有但可复用的 Web 签名机制。
2. 后续 XHunt 的 Web 端接口也可以复用同一套机制。
3. 和插件侧 `src/xhunt/middleware/security.js` 类似，但不能完全一样，避免协议和参数混用。
4. 支持灰度上线，避免直接影响现有联调。
5. 前端 npm 包自动签名，业务项目无感接入。

---

## 3. 非目标

以下能力本期不做：

1. 不做强私钥保护。
   - 浏览器 npm 包里的任何密钥都可被查看。
2. 不复用插件侧签名头。
   - 不使用 `x-request-signature`、`x-device-fingerprint`、`x-extension-version` 等插件字段。
3. 不要求用户登录后才能签名。
   - 登录、注册、OAuth URL、钱包 nonce 等未登录接口也需要能签名。
4. 不做服务端应用之间的 confidential client 签名。
   - 后续如果有后端服务接入，可单独扩展 `clientSecret` 强签名模式。

---

## 4. 和插件签名机制的区别

| 项目 | 插件侧 security.js | Web 通用签名 |
|---|---|---|
| 使用场景 | 浏览器插件接口 | 认证中心 + 多个 Web 端 |
| Header 前缀 | `x-request-*` 等 | `x-xhunt-web-*` |
| 设备指纹 | 强依赖 Fingerprint | 可选，不作为必填 |
| 版本标识 | `v2` | `w1` |
| 签名目的 | 插件请求安全校验 | Web 请求防篡改、防重放、统一接入约束 |
| SSE 兼容 | 有特殊 query 签名 | 本期不做 SSE 特例 |
| 是否复用插件密钥 | 是插件自己的配置 | 独立环境变量 / client 配置 |

---

## 5. 协议版本

本期版本：

```txt
w1
```

所有请求都带：

```http
x-xhunt-web-sign-version: w1
```

后续如果要改 canonical string 或签名算法，升级到：

```txt
w2
```

---

## 6. 请求头设计

前端每个需要签名的请求增加以下 Header：

```http
x-xhunt-web-sign-version: w1
x-xhunt-web-client-key: xhunt-admin-web-test
x-xhunt-web-request-id: 018ff9e4-7a5b-4d21-8a5a-0a6a0f1b96b1
x-xhunt-web-timestamp: 1760000000000
x-xhunt-web-body-sha256: <hex>
x-xhunt-web-signature: <hex>
x-xhunt-web-sdk-version: 0.1.0
x-xhunt-web-page-url: https://example.com/admin/#/auth-center-test
```

字段说明：

| Header | 必填 | 说明 |
|---|---:|---|
| `x-xhunt-web-sign-version` | 是 | 签名协议版本，当前固定 `w1` |
| `x-xhunt-web-client-key` | 是 | 接入应用标识，对应认证中心 `clientKey` |
| `x-xhunt-web-request-id` | 是 | 每次请求唯一 ID，用于防重放 |
| `x-xhunt-web-timestamp` | 是 | 毫秒时间戳，用于校验时间窗口 |
| `x-xhunt-web-body-sha256` | 是 | 请求 body 的 SHA-256 hex；无 body 使用空字符串 hash |
| `x-xhunt-web-signature` | 是 | 最终签名结果 |
| `x-xhunt-web-sdk-version` | 否 | npm 包版本，用于排查问题 |
| `x-xhunt-web-page-url` | 否 | 当前页面 URL，用于日志和来源分析 |

---

## 7. Canonical String

签名前先构造标准字符串。

格式：

```txt
METHOD\n
PATH_WITH_QUERY\n
TIMESTAMP\n
REQUEST_ID\n
CLIENT_KEY\n
ORIGIN\n
BODY_SHA256\n
ACCESS_TOKEN_SHA256
```

实际拼接时是换行符 `\n`，不是空行。

示例：

```txt
POST
/api/xhunt/auth-center/password/login
1760000000000
018ff9e4-7a5b-4d21-8a5a-0a6a0f1b96b1
xhunt-admin-web-test
https://admin.example.com
e3b0c44298fc1c149afbf4c8996fb924...

```

字段说明：

| 字段 | 说明 |
|---|---|
| `METHOD` | HTTP 方法大写，例如 `GET`、`POST` |
| `PATH_WITH_QUERY` | path + 排序后的 query，不包含域名 |
| `TIMESTAMP` | Header 中的毫秒时间戳原文 |
| `REQUEST_ID` | Header 中的 request id |
| `CLIENT_KEY` | Header 中的 client key |
| `ORIGIN` | 浏览器 `Origin` header，没有则为空字符串 |
| `BODY_SHA256` | 请求 body 原文的 sha256 hex |
| `ACCESS_TOKEN_SHA256` | 如果有 Bearer token，则取 accessToken 的 sha256；未登录接口为空字符串 |

### 为什么加入 `ACCESS_TOKEN_SHA256`

登录后接口如果带了 Bearer token，把 token hash 放进 canonical string，可以让签名和当前登录态绑定。

未登录接口没有 token，该字段为空。

---

## 8. 签名算法

本期采用：

```txt
HMAC-SHA256
```

输出：

```txt
hex lowercase
```

签名伪代码：

```js
signature = hmacSha256(signingKey, canonicalString).toLowerCase()
```

---

## 9. signingKey 设计

### 9.1 public web 模式，本期默认

由于浏览器不能保存真正密钥，本期采用 **public web signing key**。

每个 `clientKey` 有一个公开签名种子：

```txt
webPublicSignSalt
```

后端可存在：

```txt
AuthCenterXhuntClients.webPublicSignSalt
```

如果数据库没有配置，使用环境变量 fallback：

```bash
XHUNT_WEB_PUBLIC_SIGN_SALT=xxx
```

前端 npm 包内通过配置或接口拿到同一 salt，用于计算签名。

派生方式：

```txt
signingKey = sha256(clientKey + ':' + webPublicSignSalt + ':xhunt-web-w1')
```

这个模式能防：

- 请求体被中间篡改后签名不匹配
- 旧请求被直接重放
- 没接入 SDK 的简单脚本直接调用接口
- 不同 clientKey 混用

不能防：

- 攻击者完整复制前端 SDK 和 salt 后模拟签名

这点符合 Web 公共客户端的现实限制。

### 9.2 confidential client 模式，后续扩展

如果以后有后端服务调用 Web API，可以增加强签名模式：

```txt
clientType = confidential
clientSecretHash != null
```

服务端应用使用真正的 `clientSecret` 做 HMAC。

本期先不实现。

---

## 10. 时间窗口和防重放

### 时间窗口

默认允许：

```txt
±5 分钟
```

环境变量：

```bash
XHUNT_WEB_SIGN_TIME_WINDOW_SECONDS=300
```

如果客户端时间和服务器时间相差超过窗口，返回：

```json
{
  "error": "WEB_SIGNATURE_EXPIRED",
  "message": "请求已过期，请刷新页面后重试"
}
```

### requestId 去重

每个请求必须有唯一：

```txt
x-xhunt-web-request-id
```

后端使用 Redis 记录：

```txt
websign:reqid:{clientKey}:{requestId}
```

TTL：

```txt
10 分钟
```

环境变量：

```bash
XHUNT_WEB_SIGN_REQUEST_ID_TTL_SECONDS=600
```

重复 requestId 返回：

```json
{
  "error": "WEB_SIGNATURE_REPLAYED",
  "message": "请求已处理，请刷新后重试"
}
```

Redis 不可用时，降级到进程内 Map，避免完全失效。

---

## 11. Body Hash

前端：

- GET / HEAD：body 为空字符串
- POST / PUT / PATCH：使用实际发送的 body 字符串

后端：

- 复用 `apiServer.js` 里 `captureRawBody` 保存的 `req.rawBody`
- 对 `req.rawBody || ''` 做 SHA-256

body hash：

```js
sha256(rawBodyText).hex()
```

避免问题：

- JSON key 顺序变化导致签名不一致
- 后端 `req.body` 解析后与前端原文不一致

---

## 12. Query 规范

`PATH_WITH_QUERY` 规则：

1. 只包含 path 和 query，不包含域名。
2. query 参数按 key 升序排序。
3. 同名 key 按 value 升序排序。
4. 排除签名相关 query 参数。
5. 使用标准 URL encode。

示例：

```txt
/api/xhunt/auth-center/wallet/nonce?address=0xabc&clientKey=xhunt-web
```

---

## 13. 后端中间件设计

建议新增独立目录：

```txt
src/xhunt/web-security/
├── middleware/
│   └── web-signature.js
└── services/
    └── web-signature.js
```

或者更简单：

```txt
src/xhunt/middleware/web-signature.js
```

为了和插件侧隔离，推荐第一种。

导出：

```js
const { webSignatureMiddleware } = require("../web-security/middleware/web-signature");
```

挂载方式：

```js
app.use(
  "/api/xhunt/auth-center",
  webSignatureMiddleware({
    scope: "auth-center",
  }),
  xHuntAuthCenterRoutes
);
```

未来 Web 接口：

```js
app.use(
  "/api/xhunt/web",
  webSignatureMiddleware({
    scope: "xhunt-web",
  }),
  xhuntWebRoutes
);
```

---

## 14. 灰度模式

必须支持三种模式：

```bash
XHUNT_WEB_SIGN_MODE=off
XHUNT_WEB_SIGN_MODE=report
XHUNT_WEB_SIGN_MODE=enforce
```

| 模式 | 行为 |
|---|---|
| `off` | 不校验 |
| `report` | 校验但不拦截，只记日志 |
| `enforce` | 校验失败直接拒绝 |

推荐上线顺序：

```txt
off -> report -> enforce
```

联调初期先用：

```bash
XHUNT_WEB_SIGN_MODE=report
```

观察日志无异常后再切：

```bash
XHUNT_WEB_SIGN_MODE=enforce
```

---

## 15. 哪些接口需要签名

认证中心建议全部签名：

| 接口 | 是否签名 | 说明 |
|---|---:|---|
| `/password/register` | 是 | 未登录注册接口 |
| `/password/login` | 是 | 未登录登录接口 |
| `/token/refresh` | 是 | refreshToken 接口 |
| `/me` | 是 | 登录态接口，同时需要 JWT |
| `/logout` | 是 | 登录态接口，同时需要 JWT |
| `/logout-all` | 是 | 登录态接口，同时需要 JWT |
| `/wallet/nonce` | 是 | 未登录 nonce 接口 |
| `/wallet/verify` | 是 | 未登录钱包验证接口 |
| `/google/url` | 是 | OAuth URL 获取 |
| `/google/callback` | 是 | 前端拿 code 后请求后端 |
| `/twitter/url` | 是 | OAuth URL 获取 |
| `/twitter/callback` | 是 | 前端拿 code 后请求后端 |
| `/bind/*` | 是 | 登录态绑定接口，同时需要 JWT |
| `/unbind/*` | 是 | 登录态解绑接口，同时需要 JWT |

如果后续存在第三方服务直接回调后端的接口，再单独加入白名单，不走 Web 签名。

---

## 16. 前端 npm 包设计

在 `packages/xhunt-auth-client` 内实现统一签名。

### 16.1 配置项

新增：

```ts
interface XHuntAuthConfig {
  clientKey: string;
  apiBaseUrl: string;
  webSignature?: {
    enabled?: boolean;
    version?: "w1";
    publicSalt?: string;
  };
}
```

默认：

```ts
webSignature.enabled = true
webSignature.version = "w1"
```

### 16.2 自动签名

`XHuntAuthClient.request()` 内部统一处理：

1. 生成 requestId。
2. 获取 timestamp。
3. 计算 bodyHash。
4. 读取 accessToken，如果有则加入 tokenHash。
5. 构造 canonical string。
6. 计算 signature。
7. 加入 Header。

业务项目不需要手动传签名参数。

### 16.3 前端 Header 示例

```ts
headers.set("x-xhunt-web-sign-version", "w1");
headers.set("x-xhunt-web-client-key", config.clientKey);
headers.set("x-xhunt-web-request-id", requestId);
headers.set("x-xhunt-web-timestamp", String(Date.now()));
headers.set("x-xhunt-web-body-sha256", bodyHash);
headers.set("x-xhunt-web-signature", signature);
headers.set("x-xhunt-web-sdk-version", packageVersion);
headers.set("x-xhunt-web-page-url", window.location.href);
```

---

## 17. 错误码设计

| 错误码 | HTTP | 说明 |
|---|---:|---|
| `WEB_SIGNATURE_REQUIRED` | 401 | 缺少签名参数 |
| `WEB_SIGNATURE_VERSION_UNSUPPORTED` | 400 | 签名版本不支持 |
| `WEB_SIGNATURE_EXPIRED` | 401 | 时间戳过期 |
| `WEB_SIGNATURE_REPLAYED` | 409 | requestId 重放 |
| `WEB_SIGNATURE_BODY_HASH_MISMATCH` | 401 | body hash 不一致 |
| `WEB_SIGNATURE_INVALID` | 401 | 签名不匹配 |
| `WEB_SIGNATURE_CLIENT_INVALID` | 401 | clientKey 不存在或禁用 |
| `WEB_SIGNATURE_ORIGIN_DENIED` | 403 | Origin 不在 client 允许范围 |
| `WEB_SIGNATURE_CONFIG_MISSING` | 500 | 后端签名配置缺失 |

前端展示时继续走友好错误映射。

---

## 18. Origin 校验

如果 `AuthCenterXhuntClients.allowedOrigins` 配置了值，则校验：

```txt
req.headers.origin in allowedOrigins
```

如果为空数组：

- `report` 模式：放行并记录 warning
- `enforce` 模式：建议仍放行，避免历史 client 未配置导致全站不可用

可通过环境变量控制严格程度：

```bash
XHUNT_WEB_SIGN_ENFORCE_ORIGIN=false
```

推荐后续逐步给每个 client 配置 allowedOrigins。

---

## 19. 日志和审计

签名失败日志不要打印完整 signature、token、body。

只记录：

```txt
clientKey
path
method
origin
requestId
timestamp diff
reason
signaturePrefix
expectedPrefix
ipHash
userAgent
```

敏感字段：

- `Authorization`
- `refreshToken`
- `password`
- `signature`

必须脱敏。

---

## 20. 环境变量

```bash
# off / report / enforce
XHUNT_WEB_SIGN_MODE=report

# 默认 public salt，client 没配置时 fallback
XHUNT_WEB_PUBLIC_SIGN_SALT=change-me

# 时间窗口，默认 300 秒
XHUNT_WEB_SIGN_TIME_WINDOW_SECONDS=300

# requestId 去重 TTL，默认 600 秒
XHUNT_WEB_SIGN_REQUEST_ID_TTL_SECONDS=600

# 是否强制校验 Origin
XHUNT_WEB_SIGN_ENFORCE_ORIGIN=false
```

---

## 21. 数据库变更建议

扩展：

```txt
AuthCenterXhuntClients
```

新增字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `webPublicSignSalt` | STRING(255) | Web public 签名 salt |
| `webSignEnabled` | BOOLEAN | 是否启用 Web 签名 |

如果想先最小改动，也可以第一期不加字段，直接使用统一环境变量：

```bash
XHUNT_WEB_PUBLIC_SIGN_SALT
```

推荐实施顺序：

1. 第一阶段：环境变量统一 salt。
2. 第二阶段：client 表支持独立 salt。

---

## 22. 实施步骤

### 阶段一：后端 report 模式

1. 新增 `src/xhunt/web-security/services/web-signature.js`。
2. 新增 `src/xhunt/web-security/middleware/web-signature.js`。
3. 在 `apiServer.js` 给 `/api/xhunt/auth-center` 挂载中间件。
4. 默认 `XHUNT_WEB_SIGN_MODE=report`。
5. 签名失败只记录日志，不拦截。

### 阶段二：前端 npm 包自动签名

1. 在 `packages/xhunt-auth-client/src/client.ts` 的 request 方法里加签名。
2. 增加 Web Crypto / fallback hash 工具。
3. 登录、注册、OAuth、钱包、刷新 token、me、logout 全部自动带签名。
4. admin-web 联调确认。

### 阶段三：开启 enforce

1. 线上观察 report 日志。
2. 处理缺失 Origin、时间偏差、body hash 不一致等问题。
3. 切换：

```bash
XHUNT_WEB_SIGN_MODE=enforce
```

---

## 23. 推荐默认策略

认证中心当前推荐：

```bash
XHUNT_WEB_SIGN_MODE=report
XHUNT_WEB_SIGN_TIME_WINDOW_SECONDS=300
XHUNT_WEB_SIGN_REQUEST_ID_TTL_SECONDS=600
XHUNT_WEB_SIGN_ENFORCE_ORIGIN=false
```

等 admin-web 和第一个正式 Web 端稳定后，再开启：

```bash
XHUNT_WEB_SIGN_MODE=enforce
```

---

## 24. 小结

这套 Web 签名机制的核心价值：

1. 统一认证中心和未来 Web 端的请求安全协议。
2. 防止普通脚本裸调接口。
3. 防止请求重放。
4. 防止请求体被篡改。
5. 通过 `clientKey + origin + requestId + timestamp + bodyHash + tokenHash` 建立基础请求可信上下文。
6. 与插件侧签名机制隔离，降低协议冲突和历史兼容风险。

本期建议先以 `report` 模式上线，再逐步切到 `enforce`。

---

## 25. Web 端独立统计、日志和性能监控扩展

### 25.1 需求理解

后端现有插件侧请求已经基于 `x-request-id`、`x-extension-version`、URL path 等做了统计和性能监控。

Web 端认证中心上线后，不应该把 Web 请求直接混进插件侧统计里，否则会出现：

1. 插件接口和 Web 接口请求量混在一起，趋势失真。
2. `x-request-id` 和 `x-xhunt-web-request-id` 语义不同，无法统一排查。
3. `/api/xhunt/stats#/perf-monitor` 只能看到通用 requestId，无法区分来源是插件、admin-web、认证中心还是其他 Web 站点。
4. 后续多个 XHunt Web 端接入后，需要按 `clientKey`、站点、签名状态、登录用户维度独立观察。

因此 Web 签名机制应同时承担 **Web 请求身份识别 + 独立统计 + 日志上下文补充** 的作用。

---

### 25.2 Web 请求身份字段

Web 签名中间件校验完成后，在 `req` 上挂一个统一上下文：

```js
req.xhuntWeb = {
  source: "web",
  signVersion: "w1",
  clientKey: "xhunt-admin-web-test",
  requestId: "...",
  pageUrl: "https://.../#/auth-center-test",
  origin: "https://...",
  sdkVersion: "0.1.0",
  signMode: "report",
  signResult: "pass", // pass / fail / skipped
  signFailReason: null,
  authCenterUserId: req.authCenter?.user?.id || null,
  xhuntUserId: req.authCenter?.user?.xhuntUserId || null,
};
```

这个上下文后续给三类系统复用：

1. morgan 入口/出口日志。
2. Redis 请求统计。
3. perf-monitor 详细 Trace。

---

### 25.3 Request ID 分层

Web 端不要复用插件侧：

```txt
x-request-id
```

Web 端统一使用：

```txt
x-xhunt-web-request-id
```

后端日志里可以统一展示成：

```txt
rid=<requestId>
source=web
client=<clientKey>
```

如果请求同时带了插件侧 `x-request-id` 和 Web 侧 `x-xhunt-web-request-id`：

- `/api/xhunt/auth-center` 只认 Web requestId。
- 插件接口只认插件 requestId。
- 避免协议串用。

---

### 25.4 独立 Redis 统计 Key

现有插件/通用统计大概使用：

```txt
version_stats:<window>
url_stats:<window>
perf:metrics:<ts>
perf:trace:index:<hour>
perf:trace:detail:<requestId>
```

Web 端建议新增独立 key，避免污染原有统计：

```txt
web_request_stats:<window>
web_url_stats:<window>
web_client_stats:<window>
web_signature_stats:<window>
```

#### web_request_stats

按 5 分钟窗口统计总体请求：

```txt
web_request_stats:2026-06-26T10:00:00.000Z
```

Hash 字段：

```txt
total
status_2xx
status_3xx
status_4xx
status_5xx
signed_pass
signed_fail
signed_skipped
```

#### web_url_stats

按接口 path 聚合：

```txt
web_url_stats:2026-06-26T10:00:00.000Z
```

Hash 字段示例：

```txt
/api/xhunt/auth-center/password/login = 120
/api/xhunt/auth-center/me = 300
/api/xhunt/auth-center/token/refresh = 80
```

#### web_client_stats

按接入应用统计：

```txt
web_client_stats:2026-06-26T10:00:00.000Z
```

Hash 字段示例：

```txt
xhunt-admin-web-test = 500
xhunt-official-web = 1200
```

#### web_signature_stats

按签名结果统计：

```txt
web_signature_stats:2026-06-26T10:00:00.000Z
```

Hash 字段示例：

```txt
pass = 1000
fail:WEB_SIGNATURE_EXPIRED = 12
fail:WEB_SIGNATURE_INVALID = 3
fail:WEB_SIGNATURE_REPLAYED = 1
skipped:mode_off = 200
```

---

### 25.5 日志优化

现有 morgan 日志建议加入 Web 上下文 token。

新增 token：

```js
morgan.token("xhunt-web", (req) => {
  const web = req.xhuntWeb;
  if (!web) return "web=-";
  return [
    `web=1`,
    `client=${web.clientKey || "-"}`,
    `rid=${web.requestId || "-"}`,
    `sign=${web.signResult || "-"}`,
    web.signFailReason ? `reason=${web.signFailReason}` : null,
    web.authCenterUserId ? `acu=${web.authCenterUserId}` : null,
    web.xhuntUserId ? `xu=${web.xhuntUserId}` : null,
  ].filter(Boolean).join(" ");
});
```

入口日志示例：

```txt
in web=1 client=xhunt-admin-web-test rid=018f... sign=pass method=POST url=/api/xhunt/auth-center/password/login
```

出口日志示例：

```txt
out cost_ms=53.2 status=200 web=1 client=xhunt-admin-web-test rid=018f... sign=pass method=POST url=/api/xhunt/auth-center/password/login
```

签名失败日志示例：

```txt
[web-signature] failed {
  clientKey: "xhunt-admin-web-test",
  path: "/api/xhunt/auth-center/password/login",
  method: "POST",
  requestId: "018f...",
  origin: "https://admin.example.com",
  reason: "WEB_SIGNATURE_INVALID",
  mode: "report",
  signaturePrefix: "a1b2c3d4...",
  expectedPrefix: "e5f6g7h8..."
}
```

注意：

- 不打印完整 signature。
- 不打印 password。
- 不打印 refreshToken。
- 不打印 Authorization 原文。

---

### 25.6 perf-monitor 扩展方案

现有 `src/lib/perf-monitor` 以 `requestId` 为核心，数据写入：

```txt
perf:events:queue
perf:metrics:<ts>
perf:trace:index:<hour>
perf:trace:detail:<requestId>
```

建议不要单独复制一套 perf-monitor，而是在现有 event 结构里增加 `source/client/sign` 字段，再通过查询参数筛选。

#### 25.6.1 中间件事件结构扩展

`src/lib/perf-monitor/middleware.js` 里 event 增加：

```js
const web = req.xhuntWeb || null;

const event = {
  requestId,
  source: web ? "web" : "legacy",
  webRequestId: web?.requestId || null,
  webClientKey: web?.clientKey || null,
  webSignVersion: web?.signVersion || null,
  webSignResult: web?.signResult || null,
  webSignFailReason: web?.signFailReason || null,
  webSdkVersion: web?.sdkVersion || null,
  authCenterUserId: web?.authCenterUserId || null,
  xhuntUserId: web?.xhuntUserId || null,
  pageUrl: web?.pageUrl || null,
  // existing fields...
};
```

`requestIdFrom` 可以保持原逻辑，但需要增强提取：

优先级：

```txt
x-xhunt-web-request-id > x-request-id > generated fallback
```

建议对 `/api/xhunt/auth-center` 必须使用 `x-xhunt-web-request-id`，这样 perf-monitor 详情可以直接用 Web requestId 搜索。

#### 25.6.2 Trace index 扩展

`perf:trace:index:<hour>` 的 scatterPoint 增加：

```js
{
  requestId,
  durationMs,
  status,
  path,
  userId,
  ip,
  source: "web",
  webClientKey: "xhunt-admin-web-test",
  webSignResult: "pass",
  webSignFailReason: null,
  hasDetail: true
}
```

这样前端散点图和表格可以按来源筛选。

#### 25.6.3 Detail 扩展

`perf:trace:detail:<requestId>` 里保留：

```txt
source
webRequestId
webClientKey
webSignVersion
webSignResult
webSignFailReason
webSdkVersion
authCenterUserId
xhuntUserId
pageUrl
origin
```

用于点击点后查看完整上下文。

---

### 25.7 `/api/xhunt/stats#/perf-monitor` 前端扩展

当前性能监控页可以按：

- userId
- path
- IP
- requestId 前缀

筛选。

建议增加一个「请求来源」筛选区：

```txt
来源：全部 / 插件 / Web / 认证中心
Client：全部 / xhunt-admin-web-test / xhunt-official-web / ...
签名：全部 / pass / fail / skipped
```

#### UI 改动建议

在高级筛选里增加：

1. `source` Select

```txt
全部
legacy/plugin
web
auth-center
```

2. `clientKey` Input 或 Select

```txt
xhunt-admin-web-test
```

3. `signResult` Select

```txt
全部
pass
fail
skipped
```

4. `signFailReason` Input

```txt
WEB_SIGNATURE_INVALID
WEB_SIGNATURE_EXPIRED
```

#### 表格列扩展

「当前窗口请求明细」增加几列：

| 列 | 说明 |
|---|---|
| 来源 | web / legacy |
| Client | webClientKey |
| 签名 | pass / fail / skipped |
| 失败原因 | webSignFailReason |
| 页面 | pageUrl，过长时 tooltip |

#### 请求详情弹窗扩展

详情弹窗顶部可以先展示摘要：

```txt
source: web
clientKey: xhunt-admin-web-test
requestId: xxx
sign: pass
user: authCenterUserId / xhuntUserId
pageUrl: xxx
```

下面再展示原始 JSON。

---

### 25.8 perf-monitor API 查询扩展

`src/lib/perf-monitor/api.js` 的接口增加筛选参数：

```txt
source=web
webClientKey=xhunt-admin-web-test
webSignResult=pass
webSignFailReason=WEB_SIGNATURE_INVALID
```

涉及接口：

```txt
GET /api/stats/perf/traces
GET /api/stats/perf/errors
GET /api/stats/perf/kpis
GET /api/stats/perf/metrics
```

第一期可以只做：

```txt
/traces
/errors
```

因为它们基于 trace index/detail，最适合排查问题。

`/metrics` 和 `/kpis` 如果要按 source/client 过滤，现有聚合结构不够，需要额外维护分维度指标。

---

### 25.9 Web 专属聚合指标

如果希望 perf-monitor 首页 KPI 能直接切换「全部 / Web / 某 client」，建议处理器额外写分维度 key：

```txt
perf:metrics:web:<ts>
perf:metrics:web-client:<clientKey>:<ts>
```

字段同现有：

```txt
request_count
total_duration
status_2xx
status_4xx
status_5xx
```

这样 `/metrics` 和 `/kpis` 可以根据参数选择 key 前缀：

```txt
source=web -> perf:metrics:web:<ts>
source=web&clientKey=xhunt-admin-web-test -> perf:metrics:web-client:xhunt-admin-web-test:<ts>
默认 -> perf:metrics:<ts>
```

注意控制 clientKey 数量，避免 Redis key 爆炸。只允许已注册 clientKey 进入该维度。

---

### 25.10 推荐实施顺序

#### 第一步：签名上下文 + 日志

1. Web 签名中间件挂 `req.xhuntWeb`。
2. morgan 增加 `:xhunt-web` token。
3. 签名失败日志结构化、脱敏。

#### 第二步：Web 独立 Redis 统计

1. 新增 `web_request_stats:<window>`。
2. 新增 `web_url_stats:<window>`。
3. 新增 `web_client_stats:<window>`。
4. 新增 `web_signature_stats:<window>`。

这一步不影响现有 perf-monitor。

#### 第三步：perf-monitor Trace 增强

1. event 增加 source/webClientKey/webSignResult。
2. trace index 增加这些字段。
3. detail 增加 Web 上下文。
4. 前端高级筛选支持 source/client/sign。

#### 第四步：perf-monitor KPI 分维度

1. 写 `perf:metrics:web:<ts>`。
2. 写 `perf:metrics:web-client:<clientKey>:<ts>`。
3. 前端增加「全部 / Web / client」视角切换。

---

### 25.11 小结

Web 签名中间件不应该只返回 pass/fail，它还应该成为 Web 请求的统一入口标记层。

最终效果：

1. 插件统计继续走原来的 `x-request-id` 体系。
2. Web 端请求走独立的 `x-xhunt-web-request-id` 体系。
3. 日志可以快速看到：哪个 client、哪个 requestId、签名是否通过、哪个用户。
4. `/api/xhunt/stats#/perf-monitor` 可以筛选 Web / 认证中心 / clientKey / 签名失败原因。
5. 后续多个 Web 端接入后，不会污染插件数据，也能独立排查性能和安全问题。
