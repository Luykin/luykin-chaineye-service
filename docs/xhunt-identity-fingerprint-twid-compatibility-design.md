# XHunt 新旧版本身份归因与 Fingerprint 兼容方案

> 文档日期：2026-06-16  
> 适用范围：XHunt 插件后端、安全中间件、DAU 统计、限流、身份归因、相关管理后台统计  
> 背景：前端新版本已移除 FingerprintJS，`x-device-fingerprint` 固定传 `deadbeefdeadbeefdeadbeefdeadbeef`，仅保留字段兼容旧协议。

---

## 1. 背景与问题

### 1.1 现状

旧版本插件会生成真实设备指纹，并通过请求头传递：

```http
x-device-fingerprint: <真实 32 位 fingerprint>
```

后端多个模块曾把 fingerprint 当作：

- 请求安全协议字段；
- DAU 统计维度；
- 匿名身份归因维度；
- 部分接口限流 key；
- token 设备绑定依据；
- 安全日志排查字段。

新版本前端已移除 FingerprintJS，但为了兼容旧协议，仍会固定传：

```http
x-device-fingerprint: deadbeefdeadbeefdeadbeefdeadbeef
```

同时，新版本会尽量提供 Twitter ID：

```http
x-tw-id: <twitterId>
```

### 1.2 核心风险

如果后端继续把固定值 `deadbeefdeadbeefdeadbeefdeadbeef` 当作真实 fingerprint，会产生严重问题：

1. **统计污染**
   - 所有新版本用户会被归到同一个设备指纹下。
   - DAU、留存、活跃设备数会严重失真。

2. **限流误伤**
   - AI、KOL Chat、内容检测等按 fingerprint 限流的接口，会把所有新版本用户视为同一用户。
   - 结果是一个用户触发限流，所有新版本用户都可能被误伤。

3. **身份归因错误**
   - 活动访问、匿名行为、风控日志如果使用 deadbeef，会把不同用户合并为同一个身份。

4. **设备绑定安全语义失效**
   - 新版本 fingerprint 固定后，不能再承担“设备识别”职责。
   - 如果继续强绑定，既不安全，也容易导致兼容问题。

---

## 2. 架构目标

### 2.1 必须满足

1. **协议兼容**
   - `x-device-fingerprint` 字段继续存在。
   - 新版本固定值必须能通过基础格式校验与签名校验。

2. **身份归因优先级调整**
   - 优先使用 `x-tw-id`。
   - 没有 `x-tw-id` 时，才 fallback 到老版本真实 fingerprint。
   - 遇到 deadbeef 固定值时，不用于统计、不用于身份识别。

3. **新老版本兼容**
   - 新版本：`x-tw-id` 为主要身份。
   - 老版本：真实 fingerprint 继续可用。
   - 极老数据：管理后台统计解析继续兼容旧格式。

4. **避免散点判断**
   - 不允许各模块自行判断 `deadbeef`。
   - 应提供统一 helper / context，让统计、限流、归因使用一致规则。

### 2.2 非目标

本方案不试图：

- 恢复 FingerprintJS；
- 引入新的设备指纹方案；
- 把 IP 作为强身份标识；
- 立即迁移所有历史 Redis / DB 统计数据；
- 改变活动报名表里的 `twitterId` 主业务逻辑。

---

## 3. 关键架构判断

### 3.1 raw fingerprint 与 effective identity 必须分离

`x-device-fingerprint` 在新版本中只剩协议意义，不再有身份意义。

因此后端需要区分两个概念：

| 概念 | 来源 | 用途 | 是否允许 deadbeef |
|------|------|------|------------------|
| raw fingerprint | 请求头 / query 原始字段 | 协议兼容、签名校验、日志排查 | 允许 |
| real fingerprint | raw fingerprint 过滤 deadbeef 后 | 老版本 fallback 身份 | 不允许 |
| effective identity | `x-tw-id` 优先，否则 real fingerprint | 统计、归因、限流 | 不允许 |

结论：

> 协议校验可以使用 raw fingerprint；业务身份必须使用 effective identity。

### 3.2 Twitter ID 成为新主身份

新版本应以 `x-tw-id` 为主身份维度。

优先级：

```text
req.user.twitterId > x-tw-id > 老版本真实 fingerprint > anonymous / ip fallback
```

其中：

- `req.user.twitterId` 是登录态最可信身份；
- `x-tw-id` 是新版本前端上报身份；
- 真实 fingerprint 只用于老版本无 `x-tw-id` 的兼容场景；
- deadbeef 不参与身份归因。

### 3.3 deadbeef 不能作为任何业务 key

固定值：

```text
deadbeefdeadbeefdeadbeefdeadbeef
```

只能存在于：

- raw 请求上下文；
- 签名验证输入；
- 安全日志原始字段。

不能出现在：

- DAU Redis member；
- 用户归因 key；
- fingerprint 限流 key；
- AI/KOL/内容检测用户级限流 key；
- 注册/报名身份判断；
- 管理后台统计展示的有效用户标识。

---

## 4. 统一身份解析设计

建议新增统一 helper，位置可选：

```text
src/xhunt/utils/request-identity.js
```

或合并到：

```text
src/xhunt/middleware/security.js
```

更推荐独立 utils，避免 security.js 继续膨胀。

### 4.1 常量

```js
const DEAD_FINGERPRINT = "deadbeefdeadbeefdeadbeefdeadbeef";
```

### 4.2 helper 设计

```js
function normalizeHeaderValue(value) {
  return String(value || "").trim();
}

function isDeadFingerprint(fingerprint) {
  return normalizeHeaderValue(fingerprint).toLowerCase() === DEAD_FINGERPRINT;
}

function getRawFingerprint(req, { allowQueryParams = false } = {}) {
  return normalizeHeaderValue(
    req?.securityContext?.fingerprint ||
    req?.headers?.["x-device-fingerprint"] ||
    (allowQueryParams ? req?.query?.["device-fingerprint"] || req?.query?.deviceFingerprint : "")
  );
}

function getRealFingerprint(req, options) {
  const fingerprint = getRawFingerprint(req, options);
  if (!fingerprint) return "";
  if (isDeadFingerprint(fingerprint)) return "";
  return fingerprint;
}

function getRequestTwitterId(req, { allowQueryParams = false } = {}) {
  return normalizeHeaderValue(
    req?.user?.twitterId ||
    req?.headers?.["x-tw-id"] ||
    (allowQueryParams ? req?.query?.["tw-id"] || req?.query?.twId : "")
  );
}

function getEffectiveIdentity(req, options) {
  const twitterId = getRequestTwitterId(req, options);
  if (twitterId) {
    return {
      type: "twitterId",
      value: twitterId,
      key: `tw:${twitterId}`,
      source: req?.user?.twitterId ? "auth" : "header",
    };
  }

  const realFingerprint = getRealFingerprint(req, options);
  if (realFingerprint) {
    return {
      type: "fingerprint",
      value: realFingerprint,
      key: `fp:${realFingerprint}`,
      source: "fingerprint",
    };
  }

  return {
    type: "anonymous",
    value: "",
    key: "",
    source: "none",
  };
}
```

### 4.3 securityContext 增强

`securityMiddleware` 校验成功后，建议挂载：

```js
req.securityContext = {
  ...req.securityContext,
  fingerprint: rawFingerprint,
  rawFingerprint,
  realFingerprint,
  twitterId,
  effectiveIdentity,
};
```

这样下游模块不需要重复解析 header。

---

## 5. 模块改造方案

### 5.1 安全参数校验

#### 保持现状

`x-device-fingerprint` 仍是协议字段。

- 缺失时：按现有逻辑处理；
- 格式错误时：继续拒绝；
- `deadbeef...` 是 32 位 hex，应允许通过格式校验；
- 签名校验继续使用 raw fingerprint。

#### 关键点

不要在 `isValidFingerprint()` 中拒绝 deadbeef。

原因：

- 新版本会固定传该值；
- 前端签名串可能包含该值；
- 如果安全层拒绝，会导致新版本接口不可用。

### 5.2 DAU 统计

当前逻辑需要重点改造。

旧逻辑大致是：

```js
uniqueIdentifier = `${fingerprint},${xUserId}`;
```

新逻辑应改为：

```js
const identity = req.securityContext?.effectiveIdentity || getEffectiveIdentity(req);
if (!identity.key) return;

const uniqueIdentifier = identity.key;
```

Redis member 建议使用：

```text
tw:<twitterId>
fp:<realFingerprint>
```

#### 行为示例

| 请求 | DAU member |
|------|------------|
| `x-tw-id=123`, `fingerprint=deadbeef...` | `tw:123` |
| 无 `x-tw-id`, `fingerprint=真实 fp` | `fp:<真实 fp>` |
| 无 `x-tw-id`, `fingerprint=deadbeef...` | 不写入 |

#### cache key 同步调整

`DauCacheManager` 当前按 fingerprint + xUserId 做 cache key，也应改为 identity key：

```js
const cacheKey = `${today}_${identity.key}`;
```

避免 deadbeef 进入缓存维度。

### 5.3 管理后台 DAU 解析

管理后台需要兼容旧 Redis member。

需要支持：

| 格式 | 说明 |
|------|------|
| `tw:123456` | 新格式，Twitter ID |
| `fp:abcdef...` | 新格式，真实 fingerprint fallback |
| `fingerprint,x-user-id` | 旧格式 |
| `fingerprint` | 更旧格式 |

解析策略：

```js
function parseDauMember(member) {
  if (member.startsWith("tw:")) {
    return { identityType: "twitterId", twitterId: member.slice(3), fingerprint: null };
  }

  if (member.startsWith("fp:")) {
    const fp = member.slice(3);
    if (isDeadFingerprint(fp)) return null;
    return { identityType: "fingerprint", fingerprint: fp, twitterId: null };
  }

  const [fingerprint, userId] = member.split(",");
  if (isDeadFingerprint(fingerprint)) return null;
  return { identityType: "legacy", fingerprint, userId: userId || null };
}
```

### 5.4 限流 key

需要检查并调整以下模块：

- `src/xhunt/middleware/security.js`
  - `fingerprintLimiter`
  - `SecurityIdentifierCollector`
- `src/xhunt/middleware/aiContentRateLimit.js`
- `src/xhunt/api/ai-detect.js`
- `src/xhunt/api/kol-chat.js`

推荐统一限流身份优先级：

```text
req.user.twitterId > x-tw-id > real fingerprint > ip
```

示例：

```js
function getRateLimitIdentity(req) {
  const identity = req.securityContext?.effectiveIdentity || getEffectiveIdentity(req);
  if (identity.key) return identity.key;
  return `ip:${req.ip}`;
}
```

严禁出现：

```text
fingerprint:deadbeefdeadbeefdeadbeefdeadbeef
```

### 5.5 AI / KOL / 内容检测类接口

这类接口通常有成本，应避免新版本用户共用 deadbeef 限流桶。

建议 key：

```js
const identity = req.securityContext?.effectiveIdentity || getEffectiveIdentity(req);
const userKey = identity.key || `ip:${req.ip}`;
```

如果接口有登录态，则优先：

```js
req.user?.twitterId || req.user?.id
```

### 5.6 token fingerprint 绑定

当前 token 表里仍有 fingerprint 字段：

```text
XHuntUserToken.fingerprint
XHuntWebUserToken.fingerprint
```

需要兼容处理。

建议：

1. 登录/签发 token 时，如果请求 fingerprint 是 deadbeef：
   - 可以继续保存 raw 值用于协议兼容；
   - 但不要把它当设备安全因子。

2. 验证 token 时：
   - 如果请求 fingerprint 是真实老 fingerprint，则保持旧校验；
   - 如果请求 fingerprint 是 deadbeef，则跳过 fingerprint 强绑定；
   - 如果 token 里存的是 deadbeef，也不执行设备唯一性判断。

伪代码：

```js
if (requestFingerprint && !isDeadFingerprint(requestFingerprint)) {
  // 老版本真实 fingerprint：执行旧校验
  assertTokenFingerprintMatches();
} else {
  // 新版本 fixed fingerprint：跳过设备强绑定
}
```

这样兼顾：

- 老版本设备绑定能力；
- 新版本协议兼容；
- 不把 deadbeef 误当安全能力。

### 5.7 campaign.js 活动模块

`src/xhunt/api/campaign.js` 报名主链路当前以登录用户为主：

- `req.user.twitterId`
- `CampaignRegistration.twitterId`
- 防重复：`xHuntUserId` 或 `twitterId`

这部分应继续保持。

需要重点检查的是：

- 活动访问统计；
- 未登录预校验；
- 自定义榜单用户态接口；
- 内测可见性判断；
- 任何 fallback 到 fingerprint 的匿名逻辑。

原则：

```text
req.user.twitterId > x-tw-id > real fingerprint > none
```

如果只有 deadbeef，没有 `x-tw-id`，则不应识别为任何用户。

---

## 6. 数据格式设计

### 6.1 Redis DAU member 新格式

```text
tw:<twitterId>
fp:<realFingerprint>
```

### 6.2 为什么不用旧格式 `fingerprint,x-user-id`

旧格式的问题：

- fingerprint 在新版本固定后不再可靠；
- `x-user-id` 多数是 username，不如 twitterId 稳定；
- 组合格式不利于扩展更多身份类型。

新格式优点：

- 明确身份类型；
- 易于解析；
- 避免 deadbeef 污染；
- 后续可扩展 `web:<id>` / `wallet:<address>`。

---

## 7. 兼容矩阵

| 客户端版本 | x-device-fingerprint | x-tw-id | 后端身份 | DAU | 限流 |
|------------|----------------------|---------|----------|-----|------|
| 新版本已登录/有 Twitter ID | deadbeef... | 有 | `tw:<id>` | 记录 | 按 Twitter ID |
| 新版本无 Twitter ID | deadbeef... | 无 | anonymous | 不记录或按业务匿名 | fallback IP |
| 老版本有真实 fingerprint | 真实 fp | 无 | `fp:<fp>` | 记录 | 按真实 fp |
| 老版本也传 x-tw-id | 真实 fp | 有 | `tw:<id>` | 记录 | 按 Twitter ID |
| 异常请求 | deadbeef... | 无 | anonymous | 不记录 | fallback IP |

---

## 8. 迁移策略

### 8.1 不做历史数据迁移

不建议迁移旧 Redis DAU 数据。

原因：

- Redis 日统计数据生命周期有限；
- 旧格式可在读取时兼容；
- 迁移成本大于收益。

### 8.2 灰度发布

建议按以下顺序上线：

1. 发布统一 helper，但暂不改变行为；
2. securityContext 增加 `realFingerprint / twitterId / effectiveIdentity`；
3. DAU 写入改新格式；
4. 管理后台解析兼容新旧格式；
5. 限流模块改用 effective identity；
6. token fingerprint 绑定兼容 deadbeef；
7. 观察日志与统计。

### 8.3 观测指标

上线后重点观察：

- DAU 是否异常下降；
- `tw:*` member 占比；
- `fp:*` member 占比；
- deadbeef 是否仍进入 Redis / 限流 key；
- AI/KOL 接口误限流是否下降；
- 安全违规日志中 deadbeef 请求比例。

---

## 9. 架构师审查意见

### 9.1 方案优点

1. **职责清晰**
   - raw fingerprint 只负责协议兼容；
   - effective identity 负责业务身份。

2. **兼容性好**
   - 不破坏新版本固定 fingerprint；
   - 老版本真实 fingerprint 仍可使用。

3. **风险可控**
   - 不需要大规模数据迁移；
   - 可分阶段上线。

4. **可扩展**
   - `tw:* / fp:*` 格式未来可扩展更多身份类型。

### 9.2 主要风险

#### 风险 1：`x-tw-id` 可信度

`x-tw-id` 是前端请求头，理论上可伪造。

缓解：

- 已登录接口优先使用 `req.user.twitterId`；
- 敏感操作不能只信 `x-tw-id`；
- `x-tw-id` 主要用于统计/归因/限流，不应作为授权依据。

#### 风险 2：匿名新版本用户统计缺失

如果新版本没有 `x-tw-id`，且 fingerprint 是 deadbeef，该请求不会进入 DAU 用户维度。

这是合理取舍：

- 记录 deadbeef 会污染统计；
- fallback IP 可用于粗粒度限流，但不适合作为 DAU 用户数。

#### 风险 3：限流 fallback 到 IP 可能影响 NAT 用户

当无有效身份时 fallback IP，可能对同一出口 IP 用户产生影响。

缓解：

- 只在无 `x-tw-id` 且无真实 fingerprint 时 fallback；
- 这类请求通常可信度低，适合保守限流；
- 可为高价值接口要求登录或 `x-tw-id`。

#### 风险 4：token fingerprint 校验语义变化

新版本跳过 deadbeef 设备强绑定后，设备级安全能力下降。

缓解：

- 这是前端移除 FingerprintJS 后的必然结果；
- 旧版本真实 fingerprint 继续保留校验；
- 后续如需要设备级安全，应设计新的设备标识机制，而不是复用 deadbeef。

### 9.3 架构结论

推荐采用该方案。

核心原则：

> fingerprint 字段继续作为协议字段存在，但不再默认等价于身份。所有统计、归因、限流必须切换到 effective identity。

---

## 10. 实施清单

### 10.1 新增工具

- [ ] 新增 `src/xhunt/utils/request-identity.js`
  - [ ] `DEAD_FINGERPRINT`
  - [ ] `isDeadFingerprint`
  - [ ] `getRawFingerprint`
  - [ ] `getRealFingerprint`
  - [ ] `getRequestTwitterId`
  - [ ] `getEffectiveIdentity`
  - [ ] `getRateLimitIdentity`

### 10.2 security middleware

- [ ] `securityMiddleware` 校验成功后写入：
  - [ ] `req.securityContext.rawFingerprint`
  - [ ] `req.securityContext.realFingerprint`
  - [ ] `req.securityContext.twitterId`
  - [ ] `req.securityContext.effectiveIdentity`
- [ ] `isValidFingerprint` 继续允许 deadbeef。
- [ ] 签名校验继续使用 raw fingerprint。

### 10.3 DAU

- [ ] `handleDAUTracking` 改为使用 effective identity。
- [ ] `DauCacheManager` cache key 改为 identity key。
- [ ] Redis member 改为 `tw:* / fp:*`。
- [ ] 无 effective identity 时不写 DAU。

### 10.4 管理后台统计

- [ ] DAU 解析兼容：
  - [ ] `tw:*`
  - [ ] `fp:*`
  - [ ] `fingerprint,x-user-id`
  - [ ] `fingerprint`
- [ ] 过滤 deadbeef。

### 10.5 限流

- [ ] `fingerprintLimiter` 使用 `x-tw-id > real fingerprint > ip`。
- [ ] `aiContentRateLimit` 使用 effective identity。
- [ ] `ai-detect` 使用 effective identity。
- [ ] `kol-chat` 使用 effective identity。
- [ ] `SecurityIdentifierCollector` 不收集 deadbeef 作为 fp identifier。

### 10.6 token fingerprint 兼容

- [ ] auth token 校验遇到 deadbeef 时跳过设备 fingerprint 强绑定。
- [ ] 真实 fingerprint 继续走旧校验。
- [ ] 登录签发 token 时记录 raw fingerprint，但不要把 deadbeef 当设备安全能力。

### 10.7 campaign 模块

- [ ] 检查所有 campaign 相关匿名归因逻辑。
- [ ] 已登录逻辑继续使用 `req.user.twitterId`。
- [ ] 未登录统计/归因使用 effective identity。
- [ ] deadbeef 不参与活动身份判断。

---

## 11. 测试用例

### 11.1 新版本请求

请求：

```http
x-device-fingerprint: deadbeefdeadbeefdeadbeefdeadbeef
x-tw-id: 123456789
```

预期：

- 安全校验通过；
- `realFingerprint = ""`；
- `effectiveIdentity.key = "tw:123456789"`；
- DAU 写入 `tw:123456789`；
- 限流 key 使用 `tw:123456789`。

### 11.2 老版本请求

请求：

```http
x-device-fingerprint: abcdefabcdefabcdefabcdefabcdefab
```

预期：

- 安全校验通过；
- `realFingerprint = abcdef...`；
- `effectiveIdentity.key = fp:abcdef...`；
- DAU 写入 `fp:abcdef...`。

### 11.3 deadbeef 且无 tw-id

请求：

```http
x-device-fingerprint: deadbeefdeadbeefdeadbeefdeadbeef
```

预期：

- 安全校验按协议通过；
- `realFingerprint = ""`；
- `effectiveIdentity.key = ""`；
- DAU 不写入；
- 限流 fallback 到 IP。

### 11.4 管理后台解析旧数据

Redis member：

```text
abcdefabcdefabcdefabcdefabcdefab,luoyukun4
```

预期：

- 正常识别为 legacy；
- fingerprint 可展示；
- userId 可展示。

### 11.5 管理后台过滤 deadbeef

Redis member：

```text
deadbeefdeadbeefdeadbeefdeadbeef,xxx
```

预期：

- 不作为有效用户统计；
- 可选：在调试信息中标记为 invalid placeholder。

---

## 12. 后续演进建议

如果未来需要恢复设备级能力，不建议继续使用浏览器 FingerprintJS 作为核心安全因子。

可考虑：

1. 登录后服务端下发 device session id；
2. 与 JWT / refresh token 绑定；
3. 支持设备列表与撤销；
4. 对匿名接口仅做 IP + 行为限流，不做强设备归因。

这会比客户端指纹更可控，也更符合隐私与浏览器生态趋势。
