# Twitter Crawler Client

统一封装项目内对 Twitter crawler 的 HTTP 调用。Social Listening、EchoHunt E2E 和管理后台调试器都应通过本模块访问 crawler，避免地址、鉴权和超时配置在不同业务中漂移。

## 使用方式

```javascript
const {
  getTwitterCrawlerUrl,
  requestTwitterCrawler,
} = require("./services/twitter-crawler");

const response = await requestTwitterCrawler("tweet_detail", {
  tweet_id: "1990342951638335613",
});

console.log(getTwitterCrawlerUrl());
console.log(response.data);
```

`requestTwitterCrawler(endpoint, params, options)` 会自动：

- 向请求体注入 `endpoint`；
- 添加 `Content-Type: application/json`；
- 在配置了 key 时添加 `apikey` 请求头；
- 使用统一的地址解析和超时策略；
- 返回原始 Axios response，业务调用方自行解析数据或处理降级。

可通过 `options.timeoutMs` 为单次请求覆盖默认超时：

```javascript
await requestTwitterCrawler("tweet_quotes", {
  tweet_id: "1990342951638335613",
  count: 50,
  cursor: "next-page-cursor",
}, {
  timeoutMs: 20000,
});
```

## 配置

默认完整地址：

```text
http://xhuntapi.internal.biteye.info/external/crawler
```

配置优先级如下，高优先级有值时不再读取后续配置：

| 用途 | 环境变量优先级 |
| --- | --- |
| 完整请求地址 | `TWITTER_CRAWLER_URL` → `SOCIAL_LISTENING_CRAWLER_URL` → `TWITTER_CLIENT_URL` → 默认地址 |
| 基础地址（自动追加 `/crawler`） | `TWITTER_CRAWLER_BASE_URL` → `SOCIAL_LISTENING_CRAWLER_BASE_URL` → `CRYPTOHUNT_CRAWLER_BASE_URL` → `CRAWLER_TWITTER_BASE_URL` |
| API Key | `TWITTER_CRAWLER_API_KEY` → `SOCIAL_LISTENING_CRAWLER_API_KEY` → `PRO_API_KEY` |
| 超时 | `TWITTER_CRAWLER_TIMEOUT_MS` → `SOCIAL_LISTENING_CRAWLER_TIMEOUT_MS` → `18000` 毫秒 |

完整请求地址优先于基础地址。旧环境变量暂时保留兼容，新配置应优先使用 `TWITTER_CRAWLER_*` 命名。

## 错误约定

- `endpoint` 为空时抛出 `TWITTER_CRAWLER_ENDPOINT_REQUIRED`。
- 网络错误、超时和非 2xx 响应保持 Axios 原始错误结构并向调用方抛出。
- 模块不会吞掉错误或返回伪造数据；是否降级、记录诊断信息或转为业务错误由调用方决定。
- 日志和管理后台不得展示真实 `apikey`。
