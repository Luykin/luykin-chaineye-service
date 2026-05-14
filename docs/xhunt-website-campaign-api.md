# XHunt 网站活动前端 API 文档

> 基于当前已实现后端代码整理，面向网站前端使用。
>
> 核对时间：2026-05-13
> 
> 已确认接口已在服务中挂载：`src/apiServer.js`
>
> - `GET /api/xhunt/website/campaigns`：获取活动列表
> - `GET /api/xhunt/website/campaigns/:slug`：获取活动详情

---

## 1. 现状确认

当前后端并不是只有设计方案，公开接口已经实际存在，路由文件为：

- `src/xhunt/api/website-campaigns.js`
- `src/xhunt/services/websiteCampaignService.js`

接口挂载路径：

```text
/api/xhunt/website/campaigns
```

因此网站前端可以直接对接这两个公开接口，无需继续读取死数据。

---

## 2. 通用说明

### 2.1 返回格式

两个公开接口统一返回：

```json
{
  "success": true,
  "data": {}
}
```

或：

```json
{
  "success": true,
  "data": []
}
```

失败时：

```json
{
  "success": false,
  "error": "错误信息"
}
```

### 2.2 语言参数

支持 query 参数：`lang`

示例：

- `?lang=zh-CN`
- `?lang=en`

> 实际代码里英文判断条件是 `lang === "en"`。
> 也就是说：
>
> - 传 `en` 时返回英文优先
> - 其他值（如 `zh-CN`、`zh`、不传）都会按中文优先处理

### 2.3 对外可见活动范围

当前公开接口会过滤掉以下状态：

- `draft`
- `archived`

也就是说，只有以下状态的活动会对网站前端可见：

- `coming_soon`
- `live`
- `claim`
- `ended`

### 2.4 活动状态说明

当前后端支持的 `webStatus` 值：

- `draft`
- `coming_soon`
- `live`
- `claim`
- `ended`
- `archived`

前端网页通常只会拿到这 4 种公开状态：

- `coming_soon`
- `live`
- `claim`
- `ended`

---

## 3. 获取活动列表

### 3.1 接口

```http
GET /api/xhunt/website/campaigns
```

### 3.2 Query 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `lang` | string | 否 | 语言参数。传 `en` 返回英文优先；其他值默认中文优先。 |

### 3.3 请求示例

```http
GET /api/xhunt/website/campaigns?lang=zh-CN
```

```http
GET /api/xhunt/website/campaigns?lang=en
```

### 3.4 成功返回示例

```json
{
  "success": true,
  "data": [
    {
      "id": 12,
      "nacosCampaignId": "mantle3",
      "campaignKey": "mantle3",
      "slug": "mantle3",
      "title": "Mantle Season 3",
      "announcement": "Mantle 第三季奖励领取已开启",
      "rewardText": "奖池：10000 USDC",
      "note": "请在截止时间前完成领取",
      "status": "claim",
      "buttonText": "立即领取",
      "cardStyle": "claim",
      "leftLogo": "https://example.com/xhunt.png",
      "leftLogoAlt": "XHunt Logo",
      "rightLogo": "https://example.com/mantle.png",
      "rightLogoAlt": "Campaign Logo",
      "chestImage": "https://example.com/chest.png",
      "showCompletedBadge": false,
      "sortOrder": 2001746123,
      "startAt": "2026-03-02T00:00:00.000Z",
      "endAt": "2026-03-24T23:59:59.000Z"
    }
  ]
}
```

### 3.5 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number | 网站活动表主键 ID |
| `nacosCampaignId` | string | 对应 Nacos 活动 ID |
| `campaignKey` | string | 活动业务 key |
| `slug` | string | 网站详情页路由标识 |
| `title` | string | 活动标题 |
| `announcement` | string | 列表卡片简介文案 |
| `rewardText` | string | 列表奖励文案 |
| `note` | string \| null | 补充说明 |
| `status` | string | 当前网站状态：`coming_soon` / `live` / `claim` / `ended` |
| `buttonText` | string | 按钮文案，由状态推导 |
| `cardStyle` | string | 卡片样式标识，由状态推导 |
| `leftLogo` | string \| null | 左侧 logo |
| `leftLogoAlt` | string | 左侧 logo alt |
| `rightLogo` | string \| null | 右侧 logo |
| `rightLogoAlt` | string | 右侧 logo alt |
| `chestImage` | string \| null | 卡片宝箱图/附加图片 |
| `showCompletedBadge` | boolean | 是否显示完成标记；当前 `ended` 时为 `true` |
| `sortOrder` | number | 后端计算后的排序值，前端通常直接按接口返回顺序渲染即可 |
| `startAt` | string \| null | 活动开始时间，ISO 字符串 |
| `endAt` | string \| null | 活动结束时间，ISO 字符串 |

### 3.6 字段生成规则

#### 1）title
优先级：

1. 当前语言对应的活动名
2. 另一语言活动名
3. `campaignKey`
4. `slug`

#### 2）announcement
优先级：

1. 网站专属公告字段 `webAnnouncementZh/En`
2. Nacos 同步来的 `projectIntroductionZh/En`
3. 空字符串

#### 3）rewardText
优先级：

1. 网站专属奖励文案 `webRewardTextZh/En`
2. 后端根据 `rewardAmount + rewardUnit` 自动拼接
3. 无数据时返回空字符串

#### 4）buttonText
由 `status` 推导：

| status | 中文 | 英文 |
|---|---|---|
| `coming_soon` | 敬请期待 | Coming Soon |
| `claim` | 立即领取 | Claim Now |
| `ended` | 已结束 | Ended |
| `live` | 查看详情 | View Details |

#### 5）cardStyle
由 `status` 推导：

| status | cardStyle |
|---|---|
| `coming_soon` | `coming_soon` |
| `claim` | `claim` |
| `ended` | `ended` |
| 其他公开状态 | `live` |

#### 6）logo / 图片来源
后端会优先取网站专属 `websiteExtra.listAssets`，没有时再退回 Nacos 的 `logos`：

- `leftLogo`
- `rightLogo`
- `chestImage`

### 3.7 排序说明

列表接口返回前，后端已经按 `sortOrder` 倒序排序。

因此前端：

- **直接按接口返回顺序展示即可**
- 一般不需要自己再次排序

---

## 4. 获取活动详情

### 4.1 接口

```http
GET /api/xhunt/website/campaigns/:slug
```

### 4.2 Path 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `slug` | string | 是 | 活动详情页标识 |

### 4.3 Query 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `lang` | string | 否 | 语言参数。传 `en` 返回英文优先；其他值默认中文优先。 |

### 4.4 请求示例

```http
GET /api/xhunt/website/campaigns/mantle3?lang=zh-CN
```

### 4.5 成功返回示例

```json
{
  "success": true,
  "data": {
    "id": 12,
    "nacosCampaignId": "mantle3",
    "campaignKey": "mantle3",
    "slug": "mantle3",
    "title": "Mantle Season 3",
    "summary": "Mantle 第三季排行榜与奖励活动",
    "description": "Mantle Season 3 的奖励领取现已开启。",
    "webStatus": "claim",
    "buttonText": "立即领取",
    "guideUrl": "https://example.com/guide",
    "activeUrl": "https://example.com/active",
    "startAt": "2026-03-02T00:00:00.000Z",
    "endAt": "2026-03-24T23:59:59.000Z",
    "logos": [
      {
        "image": "https://example.com/xhunt.png",
        "url": "https://xhunt.ai/"
      },
      {
        "image": "https://example.com/mantle.png",
        "url": "https://x.com/0xMantleCN"
      }
    ],
    "reward": {
      "text": "奖池：10000 USDC",
      "amount": "10000.00000000",
      "unit": "USDC"
    },
    "claim": {
      "poiContractAddress": "0x1234567890abcdef1234567890abcdef12345678",
      "powContractAddress": null,
      "essayContractAddress": null
    },
    "pageTemplate": "standard",
    "templateConfig": {},
    "websiteExtra": {
      "listAssets": {
        "leftLogo": "https://example.com/xhunt.png",
        "rightLogo": "https://example.com/mantle.png",
        "chestImage": "https://example.com/chest.png"
      }
    },
    "nacosPayload": {}
  }
}
```

### 4.6 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number | 网站活动表主键 ID |
| `nacosCampaignId` | string | 对应 Nacos 活动 ID |
| `campaignKey` | string | 活动业务 key |
| `slug` | string | 网站详情页路由标识 |
| `title` | string | 页面标题 |
| `summary` | string | 详情页摘要/简介 |
| `description` | string | 详情页正文简介 |
| `webStatus` | string | 当前网站状态 |
| `buttonText` | string | 页面主按钮文案，由状态推导 |
| `guideUrl` | string \| null | 指南链接 |
| `activeUrl` | string \| null | 活动链接 |
| `startAt` | string \| null | 活动开始时间，ISO 字符串 |
| `endAt` | string \| null | 活动结束时间，ISO 字符串 |
| `logos` | array | 原始 logo 数组 |
| `reward.text` | string | 奖励文案 |
| `reward.amount` | string \| null | 奖励数值。注意当前实际返回通常是字符串 |
| `reward.unit` | string \| null | 奖励单位 |
| `claim.poiContractAddress` | string \| null | POI 领取合约地址 |
| `claim.powContractAddress` | string \| null | POW 领取合约地址 |
| `claim.essayContractAddress` | string \| null | Essay 领取合约地址 |
| `pageTemplate` | string | 页面模板标识，默认 `standard` |
| `templateConfig` | object | 模板配置 |
| `websiteExtra` | object | 网站扩展字段 |
| `nacosPayload` | object | Nacos 原始快照，供详情页兜底使用 |

### 4.7 字段生成规则

#### 1）summary
优先级：

1. 网站公告字段 `webAnnouncementZh/En`
2. Nacos 同步来的 `projectIntroductionZh/En`
3. `title`

#### 2）description
优先级：

1. Nacos 同步来的 `projectIntroductionZh/En`
2. 网站公告字段 `webAnnouncementZh/En`
3. 空字符串

#### 3）buttonText
与列表页一致，由 `webStatus` 推导。

#### 4）reward
- `reward.text`：优先网站奖励文案，否则自动拼接
- `reward.amount`：直接来自数据库字段，当前通常表现为字符串
- `reward.unit`：奖励单位

#### 5）claim
只有在后台配置过对应地址时才会有值；否则返回 `null`。

---

## 5. 状态码说明

### 5.1 列表接口

| HTTP 状态码 | 说明 |
|---|---|
| `200` | 请求成功 |
| `500` | 服务端异常 |

### 5.2 详情接口

| HTTP 状态码 | 说明 |
|---|---|
| `200` | 请求成功 |
| `404` | 活动不存在，或当前状态不对外公开 |
| `500` | 服务端异常 |

---

## 6. 前端对接建议

### 6.1 列表页

建议直接使用列表接口返回结果渲染：

- 不要自行拼 `buttonText`
- 不要自行拼 `cardStyle`
- 不要自行重新排序
- 不要假设 `leftLogo/rightLogo/chestImage` 一定有值

推荐最少依赖字段：

- `slug`
- `title`
- `announcement`
- `rewardText`
- `status`
- `buttonText`
- `cardStyle`
- `leftLogo`
- `rightLogo`

### 6.2 详情页

建议以详情接口为唯一数据源：

- 页面标题：`title`
- 摘要：`summary`
- 介绍：`description`
- 主按钮：`buttonText`
- 奖励区：`reward`
- 模板渲染：`pageTemplate + templateConfig`
- 特殊链上领取逻辑：`claim`

### 6.3 跳转方式

列表按钮点击后，建议统一跳转到：

```text
/activity/:slug
```

再由详情页 route 调用：

```http
GET /api/xhunt/website/campaigns/:slug
```

---

## 7. 与设计文档相比的当前实现差异

这里单独说明当前“实际代码”与设计稿之间，前端最需要知道的几点：

### 7.1 公开接口已经落地

设计文档里是“建议接口”，当前代码里这两个公开接口已经真实存在并挂载。

### 7.2 列表返回字段比设计稿更完整

当前实际列表接口除了设计稿中的基础字段外，还额外返回：

- `id`
- `leftLogoAlt`
- `rightLogoAlt`
- `chestImage`
- `showCompletedBadge`

### 7.3 详情接口当前会直接返回 `websiteExtra`

这意味着前端如果后续有特殊展示需求，可以优先和后端约定继续利用 `websiteExtra` 扩展，而不一定马上改主字段。

### 7.4 英文参数当前推荐传 `en`

虽然设计稿示例使用了 `zh-CN`，当前代码对英文只识别 `en`。

建议：

- 中文传 `zh-CN` 或不传都可以
- 英文明确传 `en`

### 7.5 `reward.amount` 当前更适合按字符串处理

数据库字段是 `DECIMAL`，在当前返回里更稳妥的前端处理方式是：

- 把 `reward.amount` 当字符串使用
- 不要假设一定是 number

---

## 8. 可直接给前端的最简版结论

### 活动列表

```http
GET /api/xhunt/website/campaigns?lang=zh-CN
```

### 活动详情

```http
GET /api/xhunt/website/campaigns/:slug?lang=zh-CN
```

### 英文版

```http
GET /api/xhunt/website/campaigns?lang=en
GET /api/xhunt/website/campaigns/:slug?lang=en
```

### 前端重点

- 列表直接用接口返回顺序
- 详情按 `slug` 获取
- 英文请传 `en`
- `reward.amount` 按字符串处理更安全
- `draft` / `archived` 状态活动不会出现在公开接口里

