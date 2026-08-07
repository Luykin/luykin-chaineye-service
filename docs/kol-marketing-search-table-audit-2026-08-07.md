# KOL Marketing 搜索表现状与搜索方案适配性报告

> 核查日期：2026-08-07  
> 核查方式：登录 K8s 只读查看；仅执行 `kubectl get/logs`、读取只读 PG 连接配置、PG `SELECT / EXPLAIN` 查询。  
> 核查原则：未修改服务器文件、未修改数据库、未重启服务、未执行 DDL/DML。

---

## 1. 核查对象

- K8s 入口：`150.5.161.65`
- 数据库：PG 只读从库
- 实际连接：
  - database：`meta`
  - server：`172.31.0.11:5432`
  - `pg_is_in_recovery = true`
  - `transaction_read_only = on`
- 表：`dev.kol_marketing_profile`

---

## 2. 表数据现状

### 2.1 行数与向量覆盖

```text
总行数: 3634
active 行数: 3633
active 且有 embedding: 191
active 但缺 embedding: 3442
active 且 needs_embedding_refresh: 3442
active 且 needs_ai_refresh: 3552
```

结论：

> 当前真正能参与向量搜索的只有 **191 条**，约占 active 数据的 **5.26%**。

这是当前搜索效果最大的限制：即使搜索逻辑正确，也只能在 191 个 KOL 画像里找结果。

---

## 3. 画像字段分布

### 3.1 语言分布

active 全量：

```text
GLOBAL: 1836
CN:     1797
```

active + embedding：

```text
CN:     100
GLOBAL: 91
```

语言分布比较均衡。

---

### 3.2 domains 分布

active + embedding：

```text
Web3: 150
AI:   125
```

domain 组合：

```text
AI,Web3: 84
Web3:    66
AI:      41
```

结论：

> `domains` 字段比较适合做硬过滤，因为值较稳定，目前主要就是 `AI / Web3`。

---

### 3.3 willingness_level 分布

active + embedding：

```text
low:     111
medium:  57
high:    21
unknown: 2
```

结论：

> 如果默认只查 `medium/high`，会直接排除 111 条 low 数据。  
> 对“愿意合作”这类 query，用 `medium/high` 是合理的；但如果用户没有明确合作意愿，不建议默认加这个过滤。

---

### 3.4 followers 分布

active + embedding：

```text
min: 2534
P25: 20492
P50: 58588
P75: 172414
P90: 676127
max: 35615043
```

结论：

> `followers` 适合做硬过滤，比如 `5 万以上`。  
> 但当前有 embedding 的样本只有 191 条，粉丝过滤叠加后候选会明显减少。

---

## 4. 标签字段现状

### 4.1 keywords 示例

top keywords：

```text
AI智能体: 46
宏观经济: 32
AI商业化: 27
AI编程: 24
RWA: 23
基础模型: 19
AI Agent: 17
DeFi: 8
NFT: 8
```

### 4.2 cooperation_types 示例

```text
research_tutorial: 133
product_education_review: 120
ama_event: 53
brand_content: 35
advisory_retainer: 34
```

### 4.3 marketing_goals 示例

```text
开发者社区渗透: 11
建立技术权威背书: 11
开发者生态建设: 9
行业影响力提升: 6
```

### 4.4 project_stages 示例

```text
产品研发阶段: 31
技术研发阶段: 23
产品验证阶段: 22
市场扩张期: 15
品牌建设期: 14
```

结论：

> `keywords / marketing_goals / project_stages` 这些字段不是标准枚举，很多是中文长标签。  
> LLM 如果推断出 `AI / growth / early` 这类通用词，直接进 SQL 会很容易 0 结果。

只读验证：

```text
CN + AI + medium/high: 43 条

再加 keywords = ['AI']: 0 条
再加 marketing_goals = ['growth']: 0 条
再加 project_stages = ['early']: 0 条
```

因此当前代码策略应该保持：

> LLM 推断的这些标签字段不能自动作为 SQL 硬过滤，只适合作为语义 query 的一部分。

---

## 5. 索引现状

已有索引：

```text
PRIMARY KEY twitter_user_id
btree(active, language)
GIN(domains)
GIN(keywords)
GIN(cooperation_types)
HNSW(marketing_profile_embedding vector_cosine_ops)
btree(lower(handle))
```

缺失但未来可能有用的索引：

```text
willingness_level
followers
identity_tier
marketing_goals GIN
project_stages GIN
```

不过以当前 191 条向量数据规模看，暂时不是瓶颈。

---

## 6. 当前搜索方式是否适合这张表

### 6.1 之前的问题

原方式：

```sql
WHERE language = ...
  AND domains && ...
  AND willingness_level = ...
ORDER BY marketing_profile_embedding <=> query_embedding
LIMIT 20
```

PostgreSQL 可能走 HNSW 近似索引。

问题是：

> HNSW 是近似召回，可能先找一批向量近邻，再套 WHERE 过滤。  
> 如果近邻候选里没有满足硬过滤的数据，就会返回 0。  
> 但表里实际有匹配数据。

只读复现：

```text
query: 找英文区适合 DeFi 项目、互动质量高的营销账号

GLOBAL + Web3 + medium/high 实际匹配: 8 条
HNSW 查询返回: 0 条
精确过滤后排序返回: 8 条
```

---

### 6.2 修改后的方式

有硬过滤时：

```sql
WITH filtered_profiles AS MATERIALIZED (...)
SELECT ...
FROM filtered_profiles
ORDER BY embedding <=> query_embedding
LIMIT 20
```

效果：

```text
先过滤候选
再对候选做精确向量排序
```

这更适合当前表。

原因：

1. 当前向量数据只有 191 条，精确排序成本很低。
2. 硬过滤后的候选更少，例如：
   ```text
   CN + AI + medium/high: 43 条
   CN + Web3 + 5万粉以上 + medium/high: 29 条
   GLOBAL + Web3 + medium/high: 8 条
   ```
3. 可以避免 HNSW 近似索引漏召回。

结论：

> 对当前表规模和需求，**有 filters 时 exact filtered rerank 比 HNSW 更合适**。  
> 无 filters 时继续用 HNSW 是合理的。

---

## 7. 当前需求匹配度

### 7.1 适合的需求

当前表比较适合：

```text
找中文/英文区 KOL
找 AI/Web3 KOL
找粉丝数满足条件的 KOL
找中高合作意愿 KOL
按自然语言语义找相似画像
```

### 7.2 不太适合的需求

当前不太适合：

```text
非常依赖 keywords 精确标签的搜索
非常依赖 marketing_goals / project_stages 精确标签的搜索
需要覆盖 3000+ KOL 的完整搜索
需要复杂多条件组合且保证大量召回
```

核心原因：

1. embedding 覆盖只有 191 条。
2. 部分标签不是标准枚举。
3. `willingness_level` 中 `low` 占比很高，默认过滤 `medium/high` 会显著缩小候选。
4. HNSW 不适合和小候选硬过滤直接组合。

---

## 8. 优化建议

### P0：继续完成 embedding / AI 画像生成

当前最大问题不是 SQL，而是数据覆盖：

```text
active: 3633
active + embedding: 191
缺 embedding: 3442
```

建议优先把 active KOL 的 embedding 补齐，否则搜索池太小。

---

### P1：保持当前 exact filtered rerank 方案

当前改法适合这张表：

```text
无硬过滤：HNSW
有硬过滤：先过滤，再精确向量排序
```

这能解决 0 召回问题。

---

### P1：LLM 不自动硬过滤非标准标签

保持当前策略：

```text
LLM 可推断 keywords / goals / stages 用于展示
但不自动进入 SQL
```

只有用户显式选择 filters 时才进入 SQL。

---

### P2：如果后续数据量变大，再补索引

当 embedding 覆盖到几万/几十万时，可以考虑：

```sql
-- 仅建议，当前未执行
CREATE INDEX ... ON dev.kol_marketing_profile USING gin (marketing_goals);
CREATE INDEX ... ON dev.kol_marketing_profile USING gin (project_stages);
CREATE INDEX ... ON dev.kol_marketing_profile (active, language, willingness_level);
CREATE INDEX ... ON dev.kol_marketing_profile (active, followers);
CREATE INDEX ... ON dev.kol_marketing_profile (active, identity_tier);
```

目前 191 条向量数据不急。

---

### P2：建立标准枚举 / 映射表

如果未来要让 LLM 自动推断这些字段：

```text
keywords
marketing_goals
project_stages
cooperation_types
```

建议先做标准 taxonomy，例如：

```text
early -> 产品冷启动 / 种子轮 / 产品验证阶段
growth -> 市场扩张期 / 增长期 / 产品增长期
AI -> AI智能体 / AI商业化 / AI编程 / 基础模型
```

否则 LLM 直接输出自然语言标签，很容易和表内标签对不上。

---

## 9. 总结

当前表适合做 KOL Marketing 语义搜索，但还处于早期数据覆盖阶段。

最关键结论：

1. **搜索返回 0 不是因为没数据，而是 HNSW + 硬过滤会漏召回。**
2. **当前改成有过滤时 exact rerank 是正确方向。**
3. **LLM 推断的非标准标签不能直接进 SQL。**
4. **最大瓶颈是 embedding 只有 191 条，覆盖率约 5.26%。**
5. **短期不用急着加索引，先补 embedding 覆盖；中长期再标准化标签和补过滤索引。**
