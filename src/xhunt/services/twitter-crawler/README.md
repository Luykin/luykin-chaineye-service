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

## 返回值

公共方法返回原始 Axios response，而不是只返回 crawler 的业务数据：

```javascript
const response = await requestTwitterCrawler("tweet_detail", {
  tweet_id: "1990342951638335613",
});

response.status;     // HTTP 状态码，例如 200
response.statusText; // HTTP 状态文本
response.headers;    // 下游响应头
response.data;       // crawler 返回的原始 JSON body
```

crawler 的业务数据可能直接位于 `response.data`，也可能包装在 `response.data.data` 中。兼容读取方式：

```javascript
const body = response.data || {};
const payload = body.data || body;
const tweet =
  payload.tweet ||
  (Array.isArray(payload.tweets) ? payload.tweets[0] : payload);
```

### `tweet_detail` 返回字段

`tweet_detail` 当前返回的 Tweet 对象包含以下主要字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | Tweet ID |
| `text` | string | Tweet 正文 |
| `created_at` / `time_parsed` | string | 发布时间 |
| `permanent_url` | string | Tweet 永久链接 |
| `user_id` | string | Tweet 作者的 Twitter ID |
| `username` | string | Tweet 作者 Handle，部分响应可能只在 `user_profile.username` 中提供 |
| `user_profile` | object | 作者资料，常用字段包括 `id`、`username`、`name`、`profile_image_url` |
| `likes` | number | 点赞数 |
| `views` | number | 浏览数 |
| `reply_count` | number | 回复数 |
| `retweet_count` | number | 转推数 |
| `quote_count` | number | 引用数 |
| `bookmark_count` | number | 收藏数 |
| `is_reply` | boolean | 是否为回复 |
| `in_reply_to_status_id` | string/null | 被直接回复的 Tweet ID |
| `is_quoted` | boolean | 是否为引用 Tweet |
| `quoted_status_id` | string/null | 被引用的 Tweet ID |
| `quoted_status` | object/null | 被引用 Tweet 的详情快照 |
| `conversation_id` | string/null | 会话根 Tweet ID |
| `thread` | array/object/null | crawler 返回的线程信息 |

E2E 验证互动关系时：

- 评论必须使用 `in_reply_to_status_id` 与活动 Tweet ID 比较；
- 引用必须使用 `quoted_status_id` 与活动 Tweet ID 比较；
- 作者身份优先读取 `user_profile.id`，兼容读取顶层 `user_id`；
- 不应只使用 `conversation_id` 判断直接回复关系。

示例：

```javascript
const profile = tweet.user_profile || {};
const authorId = String(profile.id || tweet.user_id || "");
const isDirectReply =
  tweet.is_reply === true &&
  String(tweet.in_reply_to_status_id || "") === campaignTweetId;
const isQuote =
  tweet.is_quoted === true &&
  String(tweet.quoted_status_id || "") === campaignTweetId;
```

其他 endpoint（如 `tweet_quotes`、`tweet_replies`）的业务结构由 crawler 决定，公共模块不做字段改写，调用方应从 `response.data` 读取原始结果。

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
