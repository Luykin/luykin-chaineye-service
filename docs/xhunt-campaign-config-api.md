# XHunt Campaign Config API

获取插件活动配置，支持按展示领域过滤活动列表。

## 接口信息

| 项目 | 说明 |
|------|------|
| Method | `GET` |
| Path | `/api/xhunt/campaign/config` |
| Auth | 可选 JWT；未登录也可访问 |
| Content-Type | `application/json` |

## 请求参数

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `domain` | string | 否 | 展示领域过滤。支持：`web3`、`ai`。不传返回全部可展示活动。 |
| `displayDomain` | string | 否 | `domain` 的兼容别名。与 `domain` 同时传时优先使用 `domain`。 |

### Header 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `Authorization` | string | 否 | JWT Token，格式：`Bearer <token>`。 |
| `x-user-id` | string | 否 | Twitter handle，用于判断是否命中测试活动白名单。普通客户端通常无需传。 |

## 请求示例

```http
GET /api/xhunt/campaign/config?domain=web3
```

```http
GET /api/xhunt/campaign/config?domain=ai
```

## 成功响应

```json
{
  "success": true,
  "version": 3,
  "source": "database",
  "domain": "web3",
  "includeTesting": false,
  "campaigns": [
    {
      "id": "mantle-2026",
      "campaignKey": "mantle",
      "enabled": true,
      "testingPhase": false,
      "sortWeight": 100,
      "enrollmentWindow": {
        "startAt": "2026-01-01T00:00:00.000Z",
        "endAt": "2026-02-01T00:00:00.000Z"
      },
      "displayName": {
        "zh": "Mantle 活动",
        "en": "Mantle Campaign"
      },
      "projectIntroduction": {
        "zh": "项目介绍",
        "en": "Project introduction"
      },
      "links": {
        "guideUrl": "https://example.com/guide",
        "activeUrl": "https://example.com"
      },
      "displayDomains": ["web3"],
      "tasks": [],
      "tags": [],
      "logos": []
    }
  ]
}
```

## 返回字段说明

### 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 请求是否成功。 |
| `version` | number | 配置结构版本，当前为 `3`。 |
| `source` | string | 数据来源，当前为 `database`。 |
| `domain` | string \| null | 本次过滤的领域；未传领域时为 `null`。 |
| `includeTesting` | boolean | 本次结果中是否包含测试阶段活动。仅命中测试白名单时可能为 `true`。 |
| `campaigns` | array | 活动配置列表，已按 `sortWeight` 和开始时间排序。 |

### campaigns 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 活动 ID。 |
| `campaignKey` | string | 活动业务 key，用于报名、统计等业务识别。 |
| `enabled` | boolean | 活动是否启用。接口只返回启用活动。 |
| `testingPhase` | boolean | 是否为测试阶段活动。 |
| `sortWeight` | number | 排序权重，值越大越靠前。 |
| `enrollmentWindow.startAt` | string | 报名开始时间，ISO 时间字符串。 |
| `enrollmentWindow.endAt` | string | 报名结束时间，ISO 时间字符串。 |
| `displayName.zh/en` | string | 活动中英文名称。 |
| `projectIntroduction.zh/en` | string | 项目中英文介绍。 |
| `copy` | object | 前端展示文案配置。 |
| `links.guideUrl` | string | 活动说明/教程链接。 |
| `links.activeUrl` | string | 活动跳转链接。 |
| `writingThemes` | array | 写作主题列表。 |
| `logos` | array | 活动 Logo 资源列表。 |
| `tasks` | array | 活动任务配置列表。 |
| `tags` | array | 活动标签列表。 |
| `targetUserIds` | array | 目标用户 ID 列表。 |
| `testList` | array | 测试白名单 Twitter handle 列表。 |
| `displayDomains` | array | 活动展示领域，可包含 `web3`、`ai`。 |
| `hotTweetsKey` | string | 热门推文查询 key，默认使用 `campaignKey`。 |
| `includeCreator` | boolean | 是否包含创作者相关数据。 |
| `threshold` | number \| object \| null | 活动阈值配置，具体结构由活动配置决定。 |
| `allowEmailRegistration` | boolean | 是否允许邮箱报名。 |
| `showExtraComponents` | boolean | 是否展示额外组件。 |
| `showSponsoredPolicy` | boolean | 是否展示赞助政策。 |
| `riskConfirmHtml` | string \| null | 风险确认 HTML 文案。 |
| `leaderboardMode` | string | 榜单模式：`traditional` 或 `custom`。 |

传统榜单模式还可能返回奖励字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `rewardAmount` | string \| number \| null | 奖励总额。 |
| `rewardParticipantCount` | number \| null | 奖励人数。 |
| `rewardDistributionType` | string | 奖励分配方式。 |
| `rewardUnit` | string | 奖励单位。 |
| `enablePowLeaderboard` | boolean | 是否启用 PoW 榜单。 |
| `powAmount` | number \| string \| null | PoW 奖励金额。 |
| `powWinnerCount` | number \| null | PoW 获奖人数。 |
| `powDistributionType` | string | PoW 分配方式。 |
| `powUnit` | string | PoW 奖励单位。 |
| `enableEssayContest` | boolean | 是否启用征文活动。 |
| `essayContestAmount` | number \| string \| null | 征文奖励金额。 |
| `essayContestWinnerCount` | number \| null | 征文获奖人数。 |
| `essayContestUnit` | string | 征文奖励单位。 |
| `essayContestWinners` | array | 征文获奖名单。 |

自定义榜单模式还可能返回：

| 字段 | 类型 | 说明 |
|------|------|------|
| `leaderboardApiUrl` | string | 自定义榜单接口地址。 |
| `userActivityApiUrl` | string | 用户活动数据接口地址。 |
| `customLeaderboards` | array | 自定义榜单配置。 |

## 错误响应

### domain 非法

```json
{
  "success": false,
  "error": "Invalid domain. Supported values: web3, ai"
}
```

状态码：`400`

### 服务异常

```json
{
  "success": false,
  "error": "获取活动配置失败"
}
```

状态码：`500`
