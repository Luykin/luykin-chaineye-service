# EchoHunt 测试/正式环境代码分离方案

> 日期：2026-08-21  
> 目标：在保留现有正式链路稳定的前提下，让测试环境可以优先运行未发布到正式环境的新逻辑。  
> 适用范围：EchoHunt 相关接口，优先从 KOL Match 开始落地。

---

## 1. 背景

当前 KOL Match 的测试/正式环境主要是通过请求头区分：

```http
x-echohunt-app-env: test | production
```

后端同一套代码会根据该 header 读取不同配置：

```text
production 请求 -> 读取 Nacos envs.production 配置
test 请求       -> 读取 Nacos envs.test 配置
```

这种方式适合区分：

- Prompt
- 模型
- quota
- 返回数量
- timeout
- batchSize

但不适合区分「业务逻辑」。

例如测试环境想先试：

- 新召回算法
- 新排序算法
- 新返回字段
- 新 SSE 阶段
- 新鉴权策略
- 新候选深评流程

如果仍然只有一套 handler，代码里会出现大量：

```js
if (appEnv === "test") {
  // 测试逻辑
} else {
  // 正式逻辑
}
```

后续会很难维护，也容易误伤正式环境。

---

## 2. 核心设计

推荐采用：

```text
同一个对外接口
+ 测试环境优先查找 test handler
+ 没有 test handler 时自动回退正式 handler
+ 配置仍然按 production/test 分离
```

也就是：

```text
app.echohunt.ai
  -> /api/xhunt/echohunt/kol-match/ai-search/stream
  -> production handler
  -> production config


test-app.echohunt.ai
  -> /api/xhunt/echohunt/kol-match/ai-search/stream
  -> 如果存在 test handler：走 test handler
  -> 如果不存在 test handler：走 production handler + test config
```

重点：**前端调用路径可以不变，后端自动按环境分发。**

---

## 3. 为什么不建议主流程直接用 `/xxx_test`

可以保留 `/xxx_test` 作为调试接口，但不建议测试前端长期依赖它。

不推荐主流程这样：

```text
正式环境调用 /ai-search/stream
测试环境调用 /ai-search/stream_test
```

原因：

1. 前端到处都要判断 test/prod。
2. 接口文档会越来越乱。
3. 测试链路和正式链路 URL 不一致，验证不够真实。
4. 容易有人误把 `_test` 接口暴露给正式用户。

更推荐：

```text
/ai-search/stream       正常入口，根据 appEnv 自动分发
/ai-search/stream_test  可选，仅内部强制调试入口
```

---

## 4. 推荐文件结构

以 KOL Match 为例，建议逐步拆成：

```text
src/xhunt/api/echohunt-kol-match/
├── index.js
├── config.js
├── prompts.js
├── schemas.js
├── handlers/
│   ├── strategy.js
│   ├── strategy.test.js
│   ├── ai-search.js
│   ├── ai-search.test.js
│   ├── filter-search.js
│   └── filter-search.test.js
└── shared/
    ├── quota.js
    ├── scoring.js
    ├── search.js
    ├── sse.js
    └── response.js
```

含义：

| 文件 | 说明 |
|---|---|
| `index.js` | 路由入口，只负责挂中间件和分发 handler |
| `handlers/*.js` | 正式/通用接口逻辑 |
| `handlers/*.test.js` | 测试环境专用逻辑，可选存在 |
| `shared/*` | 正式和测试都能复用的公共能力 |
| `config.js` | 继续负责 appEnv 识别、Nacos 配置读取 |

---

## 5. 最小例子：handler 分发器

新增一个通用分发函数：

```js
function dispatchByEnv(routeName, handlers) {
  return async function dispatch(req, res, next) {
    const appEnv = req.echohuntAppEnv?.value || "production";
    const hasTestHandler = typeof handlers.test === "function";

    if (appEnv === "test" && hasTestHandler) {
      req.echohuntRouteVariant = `${routeName}:test`;
      return handlers.test(req, res, next);
    }

    req.echohuntRouteVariant = `${routeName}:production`;
    return handlers.production(req, res, next);
  };
}
```

用法：

```js
const strategyHandler = require("./handlers/strategy");
const strategyTestHandler = require("./handlers/strategy.test");

router.post(
  "/strategy",
  dispatchByEnv("strategy", {
    production: strategyHandler,
    test: strategyTestHandler,
  })
);
```

如果某个接口暂时没有测试逻辑，就不要传 test：

```js
const filterSearchHandler = require("./handlers/filter-search");

router.post(
  "/filter-search",
  dispatchByEnv("filter-search", {
    production: filterSearchHandler,
  })
);
```

这样测试环境访问 `/filter-search` 时，会自动走正式 handler，但仍然读取 test 配置。

---

## 6. 更安全的例子：动态加载 test handler

为了避免每个文件都手写 try/catch，可以做一个 helper：

```js
const path = require("path");

function optionalRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}

function loadEnvHandlers(name) {
  const production = require(`./handlers/${name}`);
  const test = optionalRequire(`./handlers/${name}.test`);
  return { production, test };
}
```

路由写法就变成：

```js
router.post("/strategy", dispatchByEnv("strategy", loadEnvHandlers("strategy")));
router.post("/ai-search/stream", dispatchByEnv("ai-search-stream", loadEnvHandlers("ai-search-stream")));
router.post("/filter-search", dispatchByEnv("filter-search", loadEnvHandlers("filter-search")));
```

效果：

```text
handlers/strategy.test.js 存在
  -> test 环境优先走 strategy.test.js

handlers/filter-search.test.js 不存在
  -> test 环境自动回退 filter-search.js
```

---

## 7. 示例：正式 handler

```js
// handlers/strategy.js

async function strategyHandler(req, res) {
  const config = req.kolMatchConfig;

  const data = await generateKolMatchStrategy({
    body: req.body,
    config,
    mode: "production",
  });

  return res.json({
    success: true,
    data: {
      ...data,
      meta: {
        appEnv: req.echohuntAppEnv?.value,
        routeVariant: req.echohuntRouteVariant,
        configVersion: config.version,
        configSource: config.configSource,
      },
    },
  });
}

module.exports = strategyHandler;
```

---

## 8. 示例：测试 handler

```js
// handlers/strategy.test.js

async function strategyTestHandler(req, res) {
  const config = req.kolMatchConfig;

  // 测试环境可以使用新算法、新 prompt 拼接方式、新输出字段。
  const data = await generateKolMatchStrategyV2({
    body: req.body,
    config,
    mode: "test",
    enableExperimentalPlanner: true,
  });

  return res.json({
    success: true,
    data: {
      ...data,
      experimental: {
        planner: "v2",
        enabledAt: "2026-08-21",
      },
      meta: {
        appEnv: req.echohuntAppEnv?.value,
        routeVariant: req.echohuntRouteVariant,
        configVersion: config.version,
        configSource: config.configSource,
      },
    },
  });
}

module.exports = strategyTestHandler;
```

测试环境会走：

```text
strategy.test.js
```

正式环境永远走：

```text
strategy.js
```

---

## 9. 示例：SSE 接口怎么做

正式：

```js
// handlers/ai-search-stream.js

async function aiSearchStreamHandler(req, res) {
  setupSseHeaders(res);

  const emit = createSseEmitter(res);

  const data = await runAiMatch(req, req.body || {}, emit, {
    mode: "production",
  });

  writeSse(res, "final", {
    success: true,
    data: {
      ...data,
      meta: {
        ...data.meta,
        routeVariant: req.echohuntRouteVariant,
      },
    },
  });

  res.end();
}

module.exports = aiSearchStreamHandler;
```

测试：

```js
// handlers/ai-search-stream.test.js

async function aiSearchStreamTestHandler(req, res) {
  setupSseHeaders(res);

  const emit = createSseEmitter(res);

  await emit({
    stage: "experimental_router",
    status: "running",
    title: "测试环境实验逻辑",
    message: "当前请求正在使用 test handler。",
  });

  const data = await runAiMatchV2(req, req.body || {}, emit, {
    mode: "test",
    enableNewRanking: true,
    enableNewEvaluator: true,
  });

  writeSse(res, "final", {
    success: true,
    data: {
      ...data,
      meta: {
        ...data.meta,
        routeVariant: req.echohuntRouteVariant,
        experimentalFeatures: ["new-ranking", "new-evaluator"],
      },
    },
  });

  res.end();
}

module.exports = aiSearchStreamTestHandler;
```

这样测试环境页面不需要换 URL，仍然请求：

```text
/api/xhunt/echohunt/kol-match/ai-search/stream
```

但后端实际执行：

```text
handlers/ai-search-stream.test.js
```

---

## 10. 可选：保留 `_test` 强制调试接口

为了方便后端或管理后台直接验证 test handler，可以额外挂一个强制入口：

```js
router.post("/strategy_test", requireInternalDebug, strategyTestHandler);
router.post("/ai-search/stream_test", requireInternalDebug, aiSearchStreamTestHandler);
```

注意：这些接口必须加更强限制，不建议普通用户可访问。

例如：

```js
function requireInternalDebug(req, res, next) {
  const isAdmin = req.adminUser || req.user?.isAdmin;
  const tokenOk = req.headers["x-internal-debug-token"] === process.env.ECHOHUNT_INTERNAL_DEBUG_TOKEN;

  if (!isAdmin && !tokenOk) {
    return res.status(403).json({
      success: false,
      error: "FORBIDDEN_TEST_ENDPOINT",
    });
  }

  return next();
}
```

---

## 11. 安全要求：不能只相信 `x-echohunt-app-env`

当前 header：

```http
x-echohunt-app-env: test
```

只能作为业务分流，不适合作为安全边界。

如果以后 test handler 里有更高成本、更宽权限、未正式发布的逻辑，必须防伪造。

推荐让测试前端的 Next.js 代理额外注入签名：

```http
x-echohunt-app-env: test
x-echohunt-proxy-timestamp: 1787282000000
x-echohunt-proxy-signature: sha256-hmac
```

后端校验通过才允许进入 test handler。

示例：

```js
const crypto = require("crypto");

function verifyEchohuntProxySignature(req) {
  const timestamp = String(req.headers["x-echohunt-proxy-timestamp"] || "");
  const signature = String(req.headers["x-echohunt-proxy-signature"] || "");
  const secret = process.env.ECHOHUNT_TEST_PROXY_SECRET;

  if (!secret || !timestamp || !signature) return false;

  const skewMs = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(skewMs) || skewMs > 5 * 60 * 1000) return false;

  const payload = [
    req.method,
    req.originalUrl || req.url,
    timestamp,
  ].join("\n");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

环境解析升级为：

```js
function normalizeEchohuntAppEnv(req) {
  const raw = String(req.headers["x-echohunt-app-env"] || "").trim();

  if (raw === "test" && verifyEchohuntProxySignature(req)) {
    return {
      raw,
      value: "test",
      trusted: true,
    };
  }

  return {
    raw,
    value: "production",
    trusted: false,
  };
}
```

这样即使外部用户伪造：

```http
x-echohunt-app-env: test
```

只要没有签名，也不会进入 test handler。

---

## 12. 配置分离和逻辑分离的关系

最终应该有两层分离：

### 12.1 配置分离

适合小调整：

```text
Prompt
模型
数量
quota
timeout
batchSize
```

由 Nacos 控制：

```json
{
  "envs": {
    "production": {
      "limits": {},
      "prompts": {}
    },
    "test": {
      "limits": {},
      "prompts": {}
    }
  }
}
```

### 12.2 代码逻辑分离

适合大调整：

```text
新召回算法
新排序算法
新接口返回结构
新 SSE 流程
新评测模型调用方式
新缓存策略
```

由 test handler 控制：

```text
handlers/ai-search-stream.js       正式逻辑
handlers/ai-search-stream.test.js  测试逻辑
```

---

## 13. 请求流转完整例子

### 13.1 正式环境

```text
app.echohunt.ai
  -> Next.js proxy
  -> x-echohunt-app-env: production
  -> Express
  -> resolveEchohuntAppEnv = production
  -> resolveKolMatchRuntimeConfig = envs.production
  -> dispatchByEnv
  -> handlers/ai-search-stream.js
```

### 13.2 测试环境：没有 test handler

```text
test-app.echohunt.ai
  -> Next.js proxy
  -> x-echohunt-app-env: test
  -> Express
  -> resolveEchohuntAppEnv = test
  -> resolveKolMatchRuntimeConfig = envs.test
  -> dispatchByEnv
  -> 没有 handlers/filter-search.test.js
  -> 回退 handlers/filter-search.js
```

结果：

```text
逻辑仍然是正式逻辑
配置使用测试配置
```

### 13.3 测试环境：有 test handler

```text
test-app.echohunt.ai
  -> Next.js proxy
  -> x-echohunt-app-env: test
  -> Express
  -> resolveEchohuntAppEnv = test
  -> resolveKolMatchRuntimeConfig = envs.test
  -> dispatchByEnv
  -> 找到 handlers/ai-search-stream.test.js
  -> 执行测试逻辑
```

结果：

```text
逻辑是测试逻辑
配置也是测试配置
```

---

## 14. 返回字段建议

所有 EchoHunt 测试/正式可分流接口，都建议返回调试字段：

```json
{
  "meta": {
    "appEnv": "test",
    "routeVariant": "ai-search-stream:test",
    "configVersion": "kol-match-2026-08-21-123456-001",
    "configSource": "nacos",
    "testHandlerEnabled": true
  }
}
```

这样排查时一眼能看出：

- 当前是 test 还是 production
- 是否真的走了 test handler
- 用的是哪个配置版本
- 配置来源是不是 Nacos

---

## 15. 落地顺序建议

### 阶段 1：不改业务逻辑，只加可观测性

1. 返回 `routeVariant`。
2. 日志打印 `appEnv`、`routeVariant`、`configVersion`。
3. 确认 `test-app.echohunt.ai` 请求后端时真的是 `appEnv=test`。

### 阶段 2：加 handler 分发框架

1. 新增 `dispatchByEnv`。
2. 先只接一个接口，例如 `/strategy`。
3. 没有 `.test.js` 时自动回退正式 handler。

### 阶段 3：KOL Match 接入测试 handler

优先拆：

```text
/strategy
/ai-search/stream
```

然后再拆：

```text
/filter-search
/kols/:twitterUserId
/quota
```

### 阶段 4：加测试代理签名

1. test-app 的 Next.js proxy 注入签名。
2. 后端校验签名。
3. 签名失败时，即使 header 是 test，也降级为 production 或直接拒绝。

### 阶段 5：约束 `_test` 接口

如需 `_test` 强制接口，只给内部调试使用：

```text
/strategy_test
/ai-search/stream_test
```

并加：

```text
admin 权限 / internal token / IP 白名单 / proxy signature
```

---

## 16. 和坤哥提议的关系

坤哥的想法是：

```text
如果没有额外说明，还是走一个接口，只是配置不同；
一旦某个接口定义了 /xxxx_test，测试环境优先走这个接口，走不同逻辑。
```

我建议稍微调整成：

```text
如果没有额外测试 handler，走同一个正式 handler，只是配置不同；
一旦某个接口定义了 handlers/xxxx.test.js，测试环境自动优先走这个 handler；
/xxxx_test 可以保留为内部强制调试入口，但不作为测试前端主入口。
```

这样好处是：

1. 前端 URL 不用变。
2. 测试逻辑和正式逻辑在文件上隔离。
3. 没有测试逻辑的接口自动复用正式逻辑。
4. 可以逐个接口迁移，不需要一次性大改。
5. 返回 `routeVariant` 后很好排查。
6. 后续加签名后，测试逻辑不会被外部伪造 header 触发。

---

## 17. 最终推荐结论

推荐最终形成这套规则：

```text
1. 正式环境永远走 production handler + production config。
2. 测试环境默认走 production handler + test config。
3. 如果存在 test handler，则测试环境优先走 test handler + test config。
4. _test 接口只作为内部强制调试入口，不作为前端常规入口。
5. 进入 test handler 必须有可信代理签名，不能只靠 x-echohunt-app-env。
```

这套方案既保留了现在配置分流的便利性，也能支持后续真正的逻辑分离。
