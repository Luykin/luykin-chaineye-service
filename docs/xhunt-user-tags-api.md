# XHunt 用户标签接口

## 获取全部标签

```http
GET /api/xhunt/tags
```

等价：

```http
GET /api/xhunt/tags/all
```

返回一次性全量数据，前端本地按 `twitterId` 优先匹配。

## 返回示例

```json
{
  "success": true,
  "data": {
    "version": 1780000000000,
    "count": 2,
    "byUsername": {
      "defiteddy2020": {
        "tagsZh": ["KOL", "DeFi"],
        "tagsEn": ["KOL", "DeFi"]
      }
    },
    "byTwitterId": {
      "1300679567988801536": {
        "tagsZh": ["KOL", "DeFi"],
        "tagsEn": ["KOL", "DeFi"]
      }
    }
  }
}
```

## 字段

| 字段 | 说明 |
|---|---|
| `version` | 数据版本，数据变化时会变 |
| `count` | 用户数量 |
| `byUsername` | username -> tags 映射 |
| `byTwitterId` | twitterId -> tags 映射，前端优先用这个 |
| `tagsZh` | 中文标签 |
| `tagsEn` | 英文标签 |

## 前端匹配建议

```ts
function getTags(data, twitterId?: string, username?: string, lang: 'zh' | 'en' = 'zh') {
  const key = lang === 'en' ? 'tagsEn' : 'tagsZh';

  if (twitterId && data.byTwitterId?.[twitterId]) {
    return data.byTwitterId[twitterId][key] || [];
  }

  const name = String(username || '').trim().replace(/^@+/, '').toLowerCase();
  if (name && data.byUsername?.[name]) {
    return data.byUsername[name][key] || [];
  }

  return [];
}
```

## 缓存

响应头：

```http
Cache-Control: public, max-age=300, stale-while-revalidate=60
ETag: "xxxx"
```

含义：

- 5 分钟内浏览器直接用本地缓存，不请求后端。
- 5 分钟后走 ETag 协商。
- 数据没变返回 `304 Not Modified`。

## TypeScript 类型

```ts
export interface XHuntUserTagsPayload {
  version: number;
  count: number;
  byUsername: Record<string, { tagsZh: string[]; tagsEn: string[] }>;
  byTwitterId: Record<string, { tagsZh: string[]; tagsEn: string[] }>;
}

export interface XHuntUserTagsResponse {
  success: boolean;
  data: XHuntUserTagsPayload;
}
```
