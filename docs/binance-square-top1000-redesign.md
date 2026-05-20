# Binance Square Top1000 目标用户与热帖评分改造梳理

> 日期：2026-05-20  
> 范围：`src/binance-square/` 现有爬虫逻辑、目标用户发现逻辑、帖子存储与评分逻辑改造思路。  
> 参考：`/Users/luykin/Documents/mac-work-new/cryptohunt-backend-v2/server/src/bin/twitter_task_hot_tweets.rs`

## 1. 结论概览

当前币安广场模块的核心逻辑是：

1. 人工维护一批 Seed 用户；
2. 同步 Seed 用户的关注列表；
3. 从这些关注关系中按“被 Seed 关注次数”聚合出 Top50；
4. 只抓取 `isTargetUser = true` 的 Top50 用户帖子；
5. 每次帖子抓取都会 upsert 最新帖子，同时写入一份帖子镜像 `BinanceSquarePostSnapshots`，用于后续对比。

坤哥希望的新逻辑是：

1. 不再把 Top50 当作最终爬取目标；
2. Top50、Top100、Top300、Top1000 是分阶段人工触发的扩展结果；
3. 操作上需要后台手动一步一步点击：先算/更新 Top50，再基于 Top50 算/更新 Top100，再基于 Top100 算/更新 Top300，再基于 Top300 算/更新 Top1000；
4. 每一层都要分别存储，后续可以单独重新同步关注列表、单独重新计算排名；
5. Top1000 才是最终帖子爬取目标；
6. 每小时抓取这 Top1000 用户近 7 天内容；
7. 不再保留帖子镜像；每次抓取直接更新帖子主表；
8. 写入/更新帖子时计算热度得分，接口默认按得分排序；
9. 修改记录可以后置，可选做“轻量指标变化日志”，不建议继续沿用完整镜像。

核心差异：当前是“Top50 + 镜像留存 + 发布时间排序”，新方案应改成“人工分阶段扩展到 Top1000 + 各层独立存储可更新 + 最新状态存储 + 得分排序”。

## 0. 坤哥已确认的产品决策

| 问题 | 结论 |
|------|------|
| 扩展链路 | 确认为 `Top50 → Top100 → Top300 → Top1000` |
| Top1000 是否包含中间层 | 是，最终目标用户必须包含 Top50、Top100、Top300 里的用户 |
| 每层更新方式 | 方案 A：点击更新某层时，自动同步上一层来源用户的关注列表，再计算目标层 |
| 是否允许跳步 | 不允许。必须先有有效上一层，才能更新下一层 |
| 帖子抓取类型 | `ALL + REPLY` 都抓 |
| 抓取频率/冷却 | 先保守降低频率；如果上一轮还在跑则跳过；如果上一轮完成未满 30 分钟也跳过 |
| 任务耗时超过 1 小时 | 可以接受，不强制中断；下一次调度发现仍在运行就跳过 |
| 修改记录 | 不做完整修改记录；指标历史不是本版本重点，可以后置且允许不连续 |


---

## 2. 当前实现梳理

### 2.1 当前主要文件

| 文件 | 当前职责 |
|------|----------|
| `src/binance-square/api/binance-square.js` | Seed 管理、关注同步、Top50 计算、帖子抓取接口、帖子查询接口、调度器控制 |
| `src/binance-square/scraper/api-client.js` | 调币安广场关注列表和帖子列表 API |
| `src/binance-square/scraper/taskManager.js` | 执行帖子抓取、写帖子表、写镜像表、进度 Redis、清理旧镜像 |
| `src/binance-square/services/scheduler.js` | 定时调度：增量抓取、全量抓取、镜像清理 |
| `src/binance-square/models/*` | Sequelize 模型定义 |
| `migrations-pg/20260507000000-create-binance-square-tables.js` | 当前 Binance Square 表结构初始化迁移 |

### 2.2 当前目标用户发现逻辑

当前流程：

```text
SeedConfig 活跃用户
    ↓ /following/sync
BinanceSquareFollowings 记录 Seed -> following
    ↓ /target/calculate
按 followingUsername group by count(*) desc limit 50
    ↓
BinanceSquareTargetRanks 写 Top50
BinanceSquareUsers.isTargetUser = true
```

关键代码在 `src/binance-square/api/binance-square.js` 的 `/target/calculate`：

- 读取 `BinanceSquareSeedConfig` 中 `isActive = true` 的用户；
- 聚合 `BinanceSquareFollowing`：
  - `where followerUsername in seedUsernames`
  - `group by followingUsername`
  - `order by count desc`
  - `limit 50`
- 清空旧 `BinanceSquareTargetRanks`；
- 重置所有 `isTargetUser`；
- 将 Top50 写入 `BinanceSquareTargetRanks`；
- 标记 Top50 用户 `isTargetUser = true`。

当前排名字段语义：

| 字段 | 当前语义 |
|------|----------|
| `BinanceSquareTargetRank.rank` | 1-50 |
| `followerCount` | 被多少个 Seed 用户关注 |
| `seedFollowers` | 关注该候选人的 Seed 用户列表 |
| `BinanceSquareUser.isTargetUser` | 是否 Top50 |
| `BinanceSquareUser.followScore` | 定义了字段，但当前 Top50 计算逻辑没有系统性维护 |

### 2.3 当前关注关系存储问题

`BinanceSquareFollowing` 当前结构：

```text
followerUsername
followingUsername
followingSquareUid
createdAt / updatedAt
```

目前 `syncSingleUserFollowing()` 写入关系时使用 `ignoreDuplicates: true`，也就是：

- 新关注关系会新增；
- 已存在关系不会更新太多状态；
- 如果用户取消关注，旧关系不会被删除/失效；
- 关系表注释里还写着“关注者用户名（种子用户）”，但新需求下 follower 不再只是 Seed，也会是 Top50、Top100、Top300 中的用户。

对 Top1000 扩展来说，这个点必须改。否则历史关注关系会持续污染排名。

### 2.4 当前帖子抓取逻辑

当前 `taskManager.runPostCrawl()`：

1. 从 `BinanceSquareUser` 查询 `isTargetUser = true` 的用户；
2. 对每个目标用户并行请求：
   - `fetchUserPosts(squareUid, "ALL", 7, onlyFirstPage)`
   - `fetchUserPosts(squareUid, "REPLY", 7, onlyFirstPage)`
3. 解析帖子；
4. 按 `postId` 去重；
5. upsert 到 `BinanceSquarePosts`；
6. 查询上一份快照；
7. 写入 `BinanceSquarePostSnapshots`；
8. 记录 `diffFromPrev`；
9. 更新用户 `lastCrawledAt`。

当前定时策略：

| 任务 | 当前频率 | 当前行为 |
|------|----------|----------|
| 增量抓取 | 默认每 2 小时 | 只查第一页，`onlyFirstPage = true` |
| 全量抓取 | 每天凌晨 3 点 | 翻页查近 7 天，`onlyFirstPage = false` |
| 镜像清理 | 每天凌晨 4 点 | 清理 N 天前的 `BinanceSquarePostSnapshots` 和日志 |

### 2.5 当前接口排序

`GET /posts` 和 `GET /posts/user/:username` 当前默认：

```js
order: [["publishedAt", "DESC"]]
```

当前没有热度得分字段，也没有按得分排序的接口逻辑。

---

## 3. 新需求目标拆解

### 3.1 目标用户发现新链路

坤哥确认后，目标用户发现不做一次性全自动链路，而是做成后台手动分阶段任务。每一层都有独立存储和独立更新能力。

建议定义为四层：

```text
Layer 0: Seed 用户（人工配置）
    ↓ 手动点击：同步 Seed 关注列表，计算/更新 Top50
Layer 1: Top50
    ↓ 手动点击：同步 Top50 关注列表，计算/更新 Top100
Layer 2: Top100
    ↓ 手动点击：同步 Top100 关注列表，计算/更新 Top300
Layer 3: Top300
    ↓ 手动点击：同步 Top300 关注列表，计算/更新 Top1000
Layer 4: Top1000 = 最终帖子抓取目标
```

最终 Top1000 的组成建议：

```text
FinalTop1000 = union(Top50, Top100, Top300, Top1000Candidates) 去重后截断到 1000
```

其中 `Top1000Candidates` 是基于 Top300 关注列表算出来的候选榜。排序上建议：

1. 先按候选自身在对应 rankSet 中的 rank/followerCount 排；
2. 如果同一个用户存在于多个层级，保留其最高层级命中信息和所有来源层信息；
3. 最终写入 `rankSet=top1000` 时，将 union 后的 1000 人重新编号为 1-1000；
4. `BinanceSquareUsers.isTargetUser = true` 只对应这个最终 union 后的 Top1000。

> 默认假设：最终 `isTargetUser = true` 只标记 Top1000。Top50/Top100/Top300 是发现过程中的中间层，也可以额外保留 rank stage 供管理后台展示。

### 3.2 每小时帖子抓取新链路

```text
Top1000 target users
    ↓ 每小时
抓取近 7 天帖子
    ↓
upsert BinanceSquarePosts 最新状态
    ↓
批量计算 / 重算得分
    ↓
接口按 score 排名返回
```

变化点：

- 不再创建 `BinanceSquarePostSnapshots`；
- 不再区分“增量第一页”和“每日全量镜像”；
- 每小时都以近 7 天为窗口抓取；
- `BinanceSquarePosts` 变成“帖子当前最新状态表”；
- 得分在抓取写入后更新，推荐 run-level 批量重算，而不是单条 upsert 时立即确定最终全局排名。

### 3.3 为什么推荐“批量重算得分”

参考 Rust 热推逻辑，得分不是单条帖子独立计算，而是依赖当前候选集合里的最大值做归一化：

- `max_kol_engage_count`
- `max_retweet_quote_count`
- `max_view_count`
- 或归一化后的最大值

如果边写入边算，前面写入的帖子不知道后面会不会出现更高的 view/share/comment，因此分数可能不稳定。更稳的方式：

1. 本轮抓取先 upsert 所有帖子；
2. 查询近 7 天候选帖子；
3. 按候选集合计算各维度 max；
4. 批量更新每条帖子得分字段；
5. 接口直接 order by `score DESC`。

---

## 4. 参考 Rust 评分逻辑提炼

参考文件：`twitter_task_hot_tweets.rs`。

### 4.1 Hot Tweets 逻辑

Rust 中热推逻辑的关键维度：

| 维度 | 来源 | 权重 |
|------|------|------|
| `kol_engage_score` | KOL 对某条推文的互动贡献，quote=4，retweet=3，reply=1 | 0.4 |
| `retweet_quote_score` | 推文本身 quote + retweet 数 | 0.3 |
| `view_score` | 推文 views | 0.3 |

归一化方式：

```text
kol_engage_score = ln(1 + value) / ln(1 + max_value)
retweet_quote_score = ln(1 + value) / ln(1 + max_value)
view_score = value^0.7 / max_value^0.7
final_score = round(0.4 * kol_engage + 0.3 * retweet_quote + 0.3 * view, 2)
```

### 4.2 Top Influencer 逻辑

Top Influencer 不是按单条推文，而是按作者聚合：

- 一个作者多条推文的 KOL 互动贡献累加；
- quote/retweet/reply 分别按 4/3/1 加权；
- view 和 retweet_quote 按作者聚合；
- 使用 `tweet_count.sqrt()` 降低发帖数量优势；
- 再做归一化和排序。

这给 Binance Square 的启发：

1. 帖子榜：可以按单条帖子算 `postScore`；
2. 作者榜：可以按作者近 7 天所有帖子聚合算 `authorHotScore`；
3. 如果后续币安广场能拿到“哪些 Top 用户互动过这条帖子”，可以补上类似 `kolEngageScore` 的网络传播维度。

### 4.3 Binance Square 当前可用字段与差异

当前 `BinanceSquarePost` 能拿到：

| 字段 | 可用于评分 |
|------|------------|
| `viewCount` | 浏览热度 |
| `shareCount` | 转发/分享热度，接近 Twitter 的 retweet/quote 传播维度 |
| `commentCount` | 讨论热度 |
| `likeCount` | 轻互动热度 |
| `publishedAt` | 新鲜度 / 时间衰减 |
| `postType` | 可对 reply / quote / article 做过滤或权重调整 |

当前拿不到或未存储：

| Rust 维度 | Binance Square 当前情况 |
|----------|--------------------------|
| `kol_engage_count` | 当前没有“哪些目标用户引用/转发/回复了该帖子”的稳定结构化聚合 |
| `retweet_count + quote_count` | 可用 `shareCount` 近似替代 |
| `views` | 可用 `viewCount` |
| sensitive / AI 过滤 | 当前没有 AI 过滤链路 |

---

## 5. Binance Square 推荐评分设计

### 5.1 帖子级评分字段

建议在 `BinanceSquarePosts` 新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `score` | FLOAT/DECIMAL | 最终综合得分，接口默认排序字段 |
| `viewScore` | FLOAT/DECIMAL | 浏览归一化分 |
| `shareScore` | FLOAT/DECIMAL | 分享归一化分 |
| `commentScore` | FLOAT/DECIMAL | 评论归一化分 |
| `likeScore` | FLOAT/DECIMAL | 点赞归一化分 |
| `freshnessScore` | FLOAT/DECIMAL | 新鲜度分，越新越高 |
| `velocityScore` | FLOAT/DECIMAL，可选 | 增长速度分，需要变化记录或上一轮指标 |
| `scoreDetails` | JSONB | 本次计算的原始分量、max 值、权重、计算版本 |
| `scoreVersion` | STRING | 评分公式版本，例如 `bs_post_v1` |
| `lastScoredAt` | DATE | 最后算分时间 |

### 5.2 第一版推荐公式

因为 Binance Square 暂时没有 Twitter 里的 `kol_engage_count`，第一版建议以帖子自身公开指标为主：

```text
viewScore    = pow(viewCount, 0.7) / pow(maxViewCount, 0.7)
shareScore   = ln(1 + shareCount) / ln(1 + maxShareCount)
commentScore = ln(1 + commentCount) / ln(1 + maxCommentCount)
likeScore    = ln(1 + likeCount) / ln(1 + maxLikeCount)
freshnessScore = exp(-ageHours / 72)   // 72小时半衰近似，可配置

score = round(
  0.35 * viewScore
+ 0.25 * shareScore
+ 0.20 * commentScore
+ 0.10 * likeScore
+ 0.10 * freshnessScore,
  4
)
```

权重解释：

- `viewCount`：币安广场最直接的曝光指标，权重最高；
- `shareCount`：接近 Twitter 传播维度，权重第二；
- `commentCount`：代表讨论价值；
- `likeCount`：容易水，权重较低；
- `freshnessScore`：避免 7 天窗口里老帖长期霸榜。

### 5.3 如果要更贴近 Rust 的三维结构

也可以把 Binance 字段映射成：

```text
spreadScore = ln(1 + shareCount) / ln(1 + maxShareCount)
engageScore = ln(1 + (3 * commentCount + likeCount)) / ln(1 + maxEngage)
viewScore   = pow(viewCount, 0.7) / pow(maxViewCount, 0.7)

score = round(0.4 * engageScore + 0.3 * spreadScore + 0.3 * viewScore, 4)
```

这个结构更像 Rust：

| Rust | Binance 替代 |
|------|--------------|
| `kol_engage_score` | `engageScore = comment/like 加权` |
| `retweet_quote_score` | `spreadScore = shareCount` |
| `view_score` | `viewScore = viewCount` |

### 5.4 作者级评分，可选

如果接口将来需要“Top 作者”而不只是“Top 帖子”，建议新增作者级聚合：

```text
authorScore = 按作者近 7 天帖子聚合：
  sum(share/comment/like/view) / sqrt(postCount)
```

`sqrt(postCount)` 是参考 Rust 逻辑，用来降低“高频发帖账号”的天然优势。

可以存到：

- `BinanceSquareUsers.hotScore7d`
- `BinanceSquareUsers.hotRank7d`
- 或单独 `BinanceSquareAuthorRanks`

第一阶段可以先不做作者榜，只做帖子榜。

---

## 6. 数据结构改造建议

### 6.1 `BinanceSquareFollowings` 改造

当前关系表不区分当前有效关系和历史关系，建议增加：

| 字段 | 类型 | 说明 |
|------|------|------|
| `followerSquareUid` | STRING，可选 | 关注者 uid，后续调试更稳 |
| `isActive` | BOOLEAN | 当前这条关注关系是否仍然有效 |
| `firstSeenAt` | DATE | 首次发现时间 |
| `lastSeenAt` | DATE | 最近一次同步仍看到该关系的时间 |
| `lastSyncRunId` | STRING | 本次关注同步批次 |

同步策略改为：

1. 本次抓到的关系：upsert，`isActive = true`，更新 `lastSeenAt`；
2. 对同一个 `followerUsername`，本次没出现但历史存在的关系：标记 `isActive = false`；
3. 计算 TopN 时只使用 `isActive = true`。

### 6.2 `BinanceSquareTargetRanks` 改造

当前只能表达 Top50。建议支持多层排名：

| 字段 | 类型 | 说明 |
|------|------|------|
| `rankSet` | STRING | 例如 `top50` / `top100` / `top300` / `top1000` |
| `rank` | INTEGER | 对应集合内排名 |
| `username` | STRING | 候选用户 |
| `followerCount` | INTEGER | 被上一层源用户关注次数 |
| `sourceUserCount` | INTEGER | 上一层源用户数量，例如 50/100/300 |
| `sourceFollowers` | JSONB | 关注该候选人的上一层用户列表 |
| `calculationRunId` | STRING | 一轮扩展计算批次 ID |
| `lastCalculatedAt` | DATE | 计算时间 |

索引建议：

```text
(rankSet, rank)
(calculationRunId)
(username)
```

最终：

- `rankSet = top1000` 的用户标记为 `BinanceSquareUsers.isTargetUser = true`；
- `rankSet = top50/top100/top300` 只作为扩展层和展示层。

后台操作上建议拆成以下按钮/接口，而不是一个按钮跑完全部：

| 操作 | 输入来源 | 输出存储 | 说明 |
|------|----------|----------|------|
| 更新 Top50 | Seed 用户 | `rankSet=top50` | 同步 Seed 关注列表后，按被 Seed 关注次数排名 |
| 更新 Top100 | Top50 | `rankSet=top100` | 同步 Top50 用户关注列表后，按被 Top50 关注次数排名 |
| 更新 Top300 | Top100 | `rankSet=top300` | 同步 Top100 用户关注列表后，按被 Top100 关注次数排名 |
| 更新 Top1000 | Top300 | `rankSet=top1000` | 同步 Top300 用户关注列表后，按被 Top300 关注次数排名，并更新最终目标用户标记 |

每个 rankSet 都应支持单独刷新，不要求必须每次从 Seed 到 Top1000 全量跑一遍。

### 6.3 `BinanceSquareUsers` 改造

建议至少调整：

| 字段 | 说明 |
|------|------|
| `isTargetUser` 注释从 Top50 改为 Top1000 |
| `targetRank` | 当前 Top1000 排名，方便查询 |
| `targetRankSet` | 一般为 `top1000`，也可表示进入过哪层 |
| `followScore` | 继续保留，但明确为“当前 rankSet 的 followerCount”或废弃不用 |
| `lastFollowingSyncedAt` | 关注列表最后同步时间，和帖子 `lastCrawledAt` 分开 |

### 6.4 `BinanceSquarePosts` 改造

建议移除对镜像的依赖，新增评分字段：

| 字段 | 说明 |
|------|------|
| `score` | 综合热度分 |
| `viewScore` | 浏览分 |
| `shareScore` | 分享分 |
| `commentScore` | 评论分 |
| `likeScore` | 点赞分 |
| `freshnessScore` | 新鲜度分 |
| `velocityScore` | 增速分，可后置 |
| `scoreDetails` | JSONB，保存 max、权重、原始值 |
| `scoreVersion` | 评分公式版本 |
| `lastScoredAt` | 最后计算时间 |
| `lastMetricChangedAt` | 指标变化时间，可选 |

建议新增索引：

```text
(score DESC)
(publishedAt DESC)
(username, publishedAt DESC)
(score DESC, publishedAt DESC)
```

### 6.5 修改记录 / 指标历史建议

不建议继续使用完整 `BinanceSquarePostSnapshots` 做每小时全量镜像。可选新增轻量表：`BinanceSquarePostMetricHistories`。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `postId` | STRING | 帖子 ID |
| `crawlRunId` | STRING | 抓取批次 |
| `capturedAt` | DATE | 采集时间 |
| `likeCount` | INTEGER | 当前点赞 |
| `shareCount` | INTEGER | 当前分享 |
| `commentCount` | INTEGER | 当前评论 |
| `viewCount` | INTEGER | 当前浏览 |
| `deltaLike` | INTEGER | 较上次变化 |
| `deltaShare` | INTEGER | 较上次变化 |
| `deltaComment` | INTEGER | 较上次变化 |
| `deltaView` | INTEGER | 较上次变化 |
| `score` | FLOAT | 当时分数，可选 |

写入策略推荐二选一：

| 策略 | 存储量 | 说明 |
|------|--------|------|
| 只在指标变化时写 | 低 | 推荐。大部分帖子小时级可能无变化 |
| 每次抓到都写 | 高 | 可做完整趋势，但数据膨胀快 |

---

## 7. 存储量级粗估

### 7.1 不再写完整镜像后的主表量级

假设：

- Top1000 用户；
- 每个用户近 7 天平均 10-50 条帖子；
- 帖子主表保留近 7-30 天；
- 每条帖子含 `rawData` 平均 2KB-10KB。

则近 7 天帖子主表大概：

```text
10,000 - 50,000 rows
约 20MB - 500MB 级别，加索引后可能翻倍
```

这个量级可控。

### 7.2 如果继续完整镜像

如果每小时对近 7 天帖子都写完整镜像：

```text
50,000 posts * 24 crawls/day * 7 days = 8,400,000 snapshot rows/week
```

如果每条镜像带内容和 raw JSON，可能很容易到：

```text
数 GB - 数十 GB / 周
```

所以不建议继续使用完整 `PostSnapshots`。

### 7.3 轻量指标历史

如果每小时只写 metric 数字，不写正文/rawData：

```text
50,000 posts * 24 * 7 = 8,400,000 metric rows/week
```

每行只含几个 integer + timestamp + index，可能仍然有 GB 级别索引压力。推荐：

1. 只在指标变化时写；
2. 只保留 7 天或 14 天；
3. 或只对 TopN 高分帖子写历史。

---

## 8. 任务调度改造建议

### 8.1 目标扩展任务

目标扩展比帖子抓取重很多，而且坤哥确认每层都需要人工点击推进，因此第一版不做自动全链路定时扩展。

推荐策略：

| 任务 | 推荐方式 |
|------|----------|
| 更新 Top50 | 后台手动点击；自动同步 Seed 关注列表后计算 |
| 更新 Top100 | 后台手动点击；自动同步当前 Top50 关注列表后计算 |
| 更新 Top300 | 后台手动点击；自动同步当前 Top100 关注列表后计算 |
| 更新 Top1000 | 后台手动点击；自动同步当前 Top300 关注列表后计算，并 union Top50/100/300 生成最终目标 |
| 单个用户关注列表重试 | 失败重试队列，后台慢慢补 |
| Top1000 帖子抓取 | 定时抓，但先保守降低频率，并加运行锁与冷却 |

目标扩展任务需要支持断点和进度，因为一次完整扩展要同步：

```text
Top50 + Top100 + Top300 = 450 个用户的关注列表
```

如果每个用户关注 500 人，币安 API pageSize=20，则请求数约：

```text
450 * 500 / 20 = 11,250 请求
```

如果平均关注 1000 人，则约 22,500 请求。必须考虑限流、失败重试、断点恢复。

### 8.2 帖子抓取任务

当前串行抓 Top50 还能接受；Top1000 抓 `ALL + REPLY` 且回溯近 7 天，请求量会明显变大。坤哥确认可以慢慢抓，任务超过 1 小时也没关系，但需要避免高频触发导致封控。

建议：

1. 抓取类型固定为 `ALL + REPLY`；
2. 先保守降低频率，例如初始配置 `post_crawl_interval_hours = 2` 或更高，观察封控情况后再调；
3. 加任务运行锁：如果调度时间到了但上一轮仍在运行，直接跳过本次；
4. 加完成后冷却：如果上一轮完成距当前不足 30 分钟，直接跳过本次；
5. 任务耗时超过 1 小时不强制中断，只依赖下一轮调度跳过；
6. 支持有限并发，但第一版建议从小并发开始，例如 2-3 个用户并发，后续根据限流情况调整；
7. 每个用户抓 7 天时最多翻 N 页，避免异常账号拖垮任务；
8. 对失败用户记录重试，不阻塞整轮；
9. 任务启动前同时检查 Redis 分布式锁和最近完成时间。

推荐调度判断伪代码：

```text
if crawl_lock exists:
  skip("上一轮仍在运行")

lastCompletedAt = latest successful/partial post crawl completedAt
if now - lastCompletedAt < 30 minutes:
  skip("冷却中")

start crawl Top1000 ALL + REPLY daysBack=7
```

### 8.3 新配置项建议

新增配置：

| configKey | 默认值 | 说明 |
|-----------|--------|------|
| `target_expand_interval_hours` | `24` | Top1000 发现任务间隔 |
| `post_crawl_interval_hours` | `2` | 帖子抓取间隔，先保守，后续观察封控后再调 |
| `post_crawl_min_cooldown_minutes` | `30` | 上一轮完成后的最小冷却时间 |
| `post_crawl_days_back` | `7` | 帖子窗口 |
| `post_crawl_concurrency` | `2` 或 `3` | 初始小并发，避免封控 |
| `post_crawl_filter_types` | `ALL,REPLY` | 坤哥确认固定抓 ALL + REPLY |
| `post_score_version` | `bs_post_v1` | 当前评分版本 |
| `metric_history_retention_days` | `7` | 指标历史保留天数，如启用 |

---

## 9. API 改造建议

### 9.1 目标用户相关

新增或改造：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/target/calculate/top50` | 手动更新 Top50 |
| POST | `/target/calculate/top100` | 手动基于当前 Top50 更新 Top100 |
| POST | `/target/calculate/top300` | 手动基于当前 Top100 更新 Top300 |
| POST | `/target/calculate/top1000` | 手动基于当前 Top300 更新 Top1000，并标记最终目标用户 |
| POST | `/target/expand/run` | 可选：一键全链路，第一版不作为主流程 |
| GET | `/target/list?rankSet=top1000` | 查看某个 rankSet 的列表 |
| GET | `/target/progress` | 查看目标扩展任务进度 |
| POST | `/following/sync/:username` | 保留，但语义从“种子用户”改为“任意用户” |

当前 `/target/calculate` 可以兼容保留，但建议改为：

- `rankSet=top50` 的计算；
- 或内部被 `/target/expand/run` 调用。

### 9.2 帖子相关

改造：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/crawl/posts` | 手动触发 Top1000 近 7 天抓取与重算分 |
| GET | `/posts` | 默认 `orderBy=score`，支持 `orderBy=publishedAt` |
| GET | `/posts/hot` | 可新增热帖接口，默认近 7 天，按 score 排序 |
| GET | `/posts/user/:username` | 用户页仍按时间倒序，也可支持 score 排序 |

`GET /posts` 建议支持参数：

```text
page, pageSize
username
postType
startDate, endDate
orderBy=score|publishedAt|viewCount|shareCount
minScore
```

---

## 10. 和当前实现的关键差异清单

| 维度 | 当前 | 新方案 |
|------|------|--------|
| 最终目标用户 | Top50 | Top1000 |
| 目标发现 | Seed 关注列表一次聚合 | 手动分阶段，上一层自动同步关注后计算下一层，禁止跳步 |
| 关注关系 | 只新增，不处理取消关注 | 需要 `isActive/lastSeenAt`，只用当前有效关系排名 |
| 帖子抓取频率 | 增量 2h + 全量每天 | 先保守定时；运行中跳过；完成后 30 分钟冷却 |
| 帖子抓取对象 | `isTargetUser = Top50` | `isTargetUser = finalTop1000`，且包含 Top50/100/300 |
| 帖子存储 | 主表 + 每轮快照 | 只维护主表最新状态 |
| 修改记录 | 完整镜像 diff | 后置：轻量指标变化记录 |
| 排序 | 发布时间倒序 | score 倒序 |
| 评分 | 无 | upsert 后批量重算多维 score |
| 清理 | 清理镜像 | 清理过期帖子/日志/可选指标历史 |

---

## 11. 实施顺序建议

### Phase 1：数据库与模型扩展

1. 新增迁移：
   - 改造 `BinanceSquareFollowings`；
   - 改造 `BinanceSquareTargetRanks`；
   - 改造 `BinanceSquareUsers`；
   - 改造 `BinanceSquarePosts` 评分字段；
   - 可选新增 `BinanceSquarePostMetricHistories`。
2. 更新 Sequelize models。
3. `CrawlLog.taskType` 当前是 ENUM，需要新增任务类型：
   - `target_expand`
   - `score_recalculate`
   - 或改成 STRING，避免后续每次新增任务都要改 enum。

### Phase 2：关注同步改造

1. `syncSingleUserFollowing()` 改为任意用户可用；
2. 同步时维护 `isActive/lastSeenAt`；
3. 计算排名时只使用有效关系；
4. 记录每个用户的 `lastFollowingSyncedAt`。

### Phase 3：Top1000 扩展任务

实现服务：`targetExpansionService` 或放入 taskManager。第一版按手动分阶段设计：

```text
calculateTopN(sourceUsernames, rankSet, limit)
syncFollowingsForRankSet(rankSet)
runRankStage({ sourceRankSet, targetRankSet, limit })
```

后台按钮对应流程：

```text
按钮1：更新 Top50
  source = active Seed users
  sync source followings
  calculate rankSet=top50 limit=50

按钮2：更新 Top100
  guard: current top50 exists and enough fresh
  source = current rankSet=top50
  sync source followings
  calculate rankSet=top100 limit=100

按钮3：更新 Top300
  guard: current top100 exists and enough fresh
  source = current rankSet=top100
  sync source followings
  calculate rankSet=top300 limit=300

按钮4：更新 Top1000
  guard: current top300 exists and enough fresh
  source = current rankSet=top300
  sync source followings
  calculate top1000 candidates
  finalTop1000 = union(top50, top100, top300, top1000 candidates) dedupe then trim to 1000
  write rankSet=top1000
  reset isTargetUser
  mark finalTop1000 as isTargetUser=true
```

跳步规则：不允许跳步。如果上一层 rankSet 不存在、数量不足或处于更新中，下一层按钮直接返回错误提示。

### Phase 4：帖子抓取去镜像化

1. `runPostCrawl()` 改为读取 Top1000；
2. 每小时抓近 7 天，不再写 `BinanceSquarePostSnapshot`；
3. upsert 前读取旧 metrics，用于可选 delta；
4. upsert 后执行 `recalculatePostScores(daysBack=7)`；
5. 更新 `GET /posts` 默认排序。

### Phase 5：可选指标历史

如果需要“修改记录”：

1. 新增 metric history 表；
2. 只在指标变化时写；
3. retention 默认 7 天；
4. 支持单帖趋势接口。

---

## 12. 已确认决策与仍可后置的问题

### 12.1 已确认

1. 扩展链路是 `Top50 → Top100 → Top300 → Top1000`。
2. Top1000 最终目标池必须包含 Top50、Top100、Top300 里的用户。
3. 每层更新采用方案 A：点击更新时，自动同步上一层来源用户关注列表，再计算目标层。
4. 不允许跳步，必须基于有效上一层结果更新下一层。
5. 帖子抓取固定抓 `ALL + REPLY`。
6. 抓取可以慢，超过 1 小时没关系；调度需要运行中跳过和完成后至少 30 分钟冷却。
7. 不做完整修改记录；指标历史不是当前版本重点，后续可以做轻量、不连续的记录。

### 12.2 可后置的问题

1. 指标历史是否要记录、记录哪些字段、保留多久。
2. 抓取并发和频率上线后的具体调参。
3. 是否需要作者级热度榜。
4. 是否后续补 AI 摘要/敏感过滤/标签能力。


## 13. 推荐第一版落地范围

为了最小改动且尽快上线，第一版建议只做：

1. 手动分阶段扩展链路：Top50、Top100、Top300、Top1000；
2. 每层独立存储，且更新下一层时自动同步上一层关注列表；
3. 禁止跳步；
4. 最终 Top1000 union 包含 Top50/100/300，并将 `isTargetUser` 从 Top50 改为 finalTop1000；
5. 帖子抓取去掉 `PostSnapshot` 写入；
6. 定时抓 Top1000 近 7 天 `ALL + REPLY`，初始低频、小并发；
7. 增加运行中跳过和完成后 30 分钟冷却；
8. `BinanceSquarePosts` 新增 score 字段；
9. 抓取后批量重算帖子分；
10. `/posts` 默认按 score 排序；
11. 轻量指标历史先不做，保留接口和 schema 设计空间。

