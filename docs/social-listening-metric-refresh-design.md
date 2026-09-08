# Social Listening 最近 30 天互动指标回刷方案

> 状态：待实现  
> 适用范围：仅 `monitoring` 状态看板

## 目标

持续刷新已入库推文的浏览、点赞、转发、引用、评论等互动指标，保证 Social Listening 的 24H / 7D / 30D 展示和预警使用较新的数据。

不重新召回推文、不重新跑 AI、不覆盖正文、作者信息或既有 AI 结果。

## 调度策略

- 调度器每 **20 分钟**触发一次。
- 每次只取已到期的帖子，按“发布时间越近，优先级越高”处理。
- 每轮默认最多刷新 `1,000` 条；按批次回源和写库，采集任务优先，禁止同看板并发。
- 不做“最近 30 天全量数据每 20 分钟全部回刷”：以当前约 3 万条数据计算，这会产生约 290 万次更新/天。

| 推文年龄 | 刷新间隔 | 优先级 |
|---|---:|---:|
| 0–12 小时 | 20 分钟 | 1 |
| 12–36 小时 | 1 小时 | 2 |
| 36 小时–7 天 | 5 小时 | 3 |
| 7–30 天 | 18 小时 | 4 |

原需求中的 `7–8 天` 没有覆盖区间；为避免遗漏，统一归入最后一档，按 18 小时刷新。

查询按优先级、`metricsRefreshedAt` 升序、发布时间降序排序；各优先级需保留配额，避免新帖持续涌入时旧帖永久得不到刷新。

## 数据路径

```text
EchohuntSocialListeningPosts（本地到期帖子）
  → dev.tweet（按 tweetId 批量只读查询 statistic / metric_observed_at）
  → EchohuntSocialListeningPosts（仅更新互动指标）
  → 看板快照与依赖互动指标的聚合数据
```

源库查询必须是轻量查询，只读取：`id`、`statistic`、`metric_observed_at`。不 join `dev.twitter_user`，不读取正文、作者画像或 AI 字段。

本地仅更新：

```text
viewsCount / likesCount / repostsCount / quotesCount / repliesCount
metricsRefreshedAt / rawTweet.metricObservedAt
updatedAt
```

源库中已删除或暂不可见的 tweetId 不删除本地记录，记录为本轮未命中即可。

## 数据模型与任务

### 帖子表

新增 `metricsRefreshedAt TIMESTAMPTZ NULL`，表示最后一次完成源库指标回查的时间；不得使用通用 `updatedAt` 判断到期。

新增索引建议：

```text
(boardId, postCreatedAt DESC)
(metricsRefreshedAt, postCreatedAt DESC)
```

### 任务

新增任务类型：`metric_refresh`。任务进度记录：选中数、源库命中数、更新数、未命中数、批次数、耗时、各年龄层数量。

所有 `incremental`、`manual_refresh`、`history_backfill`、`metric_refresh` 任务共用全局执行锁，任一任务执行时，其他任务保持 `pending` 并等待前一任务完成后再领取。看板锁继续保留，作为跨进程/异常场景的二次保护。

这保证采集和指标回刷错峰执行，不会同时访问源库；任务处理器必须 `await` 当前任务结束后才领取下一个任务。

## Nacos 配置

配置归属：`echohunt_social_listening_config`。

```json
{
  "metricRefresh": {
    "mode": "enabled",
    "tickIntervalMinutes": 20,
    "batchSize": 1000,
    "maxBatchesPerTick": 1,
    "recentHours": 12,
    "recentIntervalMinutes": 20,
    "dayIntervalMinutes": 60,
    "weekIntervalMinutes": 300,
    "monthIntervalMinutes": 1080
  }
}
```

`mode=disabled` 时不入队；参数需在 admin 配置页展示并校验范围。首次上线允许任务逐轮补齐，无需一次性回刷全部历史。

## 聚合与可观测性

- 每个看板完成一轮指标更新后，异步刷新对应快照；不要为每个批次重复全量聚合。
- 日志和任务详情必须包含 `boardId`、帖子数、命中/更新/未命中、年龄层、批次数与耗时。
- 监控项：源库查询耗时、更新耗时、积压到期数、锁冲突数、失败率。
- 失败不影响现有帖子数据；下轮按 `metricsRefreshedAt` 自动重试。

## 验收标准

1. 仅 `monitoring` 看板的最近 30 天帖子参与回刷。
2. 新帖在 20 分钟优先级内刷新；旧帖按分层间隔最终得到刷新。
3. 指标刷新不产生 AI 调用、不改变帖子正文、标签、摘要或态度结果。
4. 所有采集与指标回刷任务全局串行执行；源库异常时不影响后续增量采集。
5. 管理后台可查看任务进度、最后刷新时间、更新数和失败原因。
