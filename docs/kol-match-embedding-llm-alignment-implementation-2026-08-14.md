# EchoHunt KOL Match Embedding + 二次深评对齐实施文档

> 日期：2026-08-14  
> 后端项目：`/Users/luykin/Documents/mac-work/luykin-chaineye-service`  
> 前端项目：`/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt`  
> 产品原型：`/Users/luykin/Documents/mac-work-new/echohuntdemo/kol-match-p0`  
> 参考提交：旧版 `0d0685d`，新版 `b4b806a`

## 1. 背景与目标

产品原型将 AI 精准匹配从旧版：

```text
数据库硬筛 → 按影响力取前 500 → 规则/关键词召回 40 → 二次模型深评 → 综合排序
```

调整为新版：

```text
第一次模型理解需求 → 数据库完整硬筛 → Embedding 语义召回 Top K → 第二次模型深评 → 程序综合排序 → 返回结果
```

目标是避免高影响力但语义不相关的 KOL 过早占据候选池，同时让长尾但高度相关的 KOL 有机会进入深评。

## 2. 当前生产后端现状判断

当前后端 `src/xhunt/api/echohunt-kol-match.js` 已经不再使用旧原型中的“影响力 Top 500 预截断”逻辑。AI 主链路调用 `src/xhunt/api/kol-marketing/search-service.js`，在存在硬筛条件时会先 materialize 完整过滤集合，再按 pgvector 距离排序。

当前链路：

```text
/strategy 第一次 LLM 生成 strategy.semanticQuery
→ /ai-search/stream
→ normalizeProductHardFilters
→ getAiSearchSqlFilters
→ searchKolMarketingProfiles(skipAutoFilterExtraction=true)
→ pgvector Top N
→ scoreKol 程序排序
→ 返回 20
```

已经满足：

- 硬筛先于语义召回。
- 不按影响力预截断。
- 底层不再从 composite query 二次推断接单意愿硬筛。
- SSE 取消后在关键阶段不扣 AI quota。

尚未满足产品新版原型：

- 没有单独的 Embedding Top K 召回参数，当前直接取最终 `limit`。
- 没有第二次 LLM 对 Top K 候选深评。
- 最终推荐分仍混入 followers / willingness。
- 第一次模型 Schema 与产品原型仍存在字段差异，如 `matchingQuery`、证据引用、假设与冲突；Prompt 规则已做低风险对齐，保留当前兼容 Schema。

## 3. 本次实施范围

### 3.1 后端

1. AI 搜索召回数量改为 `ECHOHUNT_KOL_MATCH_RECALL_TOP_K`，默认 40，最大不超过底层 `MAX_LIMIT`。
2. 新增第二次候选深评 Prompt / Schema：
   - 输入：项目上下文、hardFilters、候选语义证据。
   - 不传入粉丝、流量、影响力、Soul、接单意愿。
   - 输出：`semanticScore`、四个维度、推荐理由、证据、命中概念。
3. 新增深评开关：`ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_ENABLED`，默认开启；如遇成本、延迟或稳定性问题可显式设为 `false` 降级。
4. LLM 深评失败时默认降级为 embedding similarity proxy，不影响主流程可用性。
5. 新综合排序：
   - LLM 开启且成功：AI 语义匹配 70% + 真实流量 15% + 影响力 10% + Soul 5%。
   - LLM 未开启/失败：用 embedding similarity 作为语义 proxy，仍使用同一权重结构。
6. 返回结构兼容前端，并新增 `aiMatchScore`、`dimensions`、`matchedTerms`、`evaluationEvidence`、`recommendationScoreBreakdown`、`evaluationEngine`。
7. Prompt 对齐产品原型：第一次模型接入 `xProfile` evidence，补充事实边界、brief / X 画像 / hardFilters 优先级、hardFilters 冲突处理、`semanticQuery` 等价 `matchingQuery`；第二次模型补充禁止外部知识/工具调用和 `semanticScore` 非影响力分。

### 3.2 前端

1. 类型与映射兼容后端新增字段。
2. AI 结果表将“推荐分”文案调整为“综合推荐分”。
3. 补充 AI 匹配度展示，避免把推荐分误解为纯语义分。
4. 进度文案从“直接生成推荐名单”调整为“召回候选 → 深评 → 排序”。
5. 结果页读取 `meta.evaluation` 展示深度评测状态：成功显示“已完成”，降级显示“基础匹配模式”。
6. 确认策略页新增项目 X 画像理解卡片：展示后端 `profileContext`（Bio / 近期内容 / 粉丝 / 认证等已取得信号），后端旧版本未返回时用前端账号 lookup 结果轻量兜底，明确第一步策略已感知项目画像。

## 4. 风险与边界

- 已接入项目 X 画像证据：前端把账号 lookup 结果作为 `xProfile` 传给 `/strategy`，后端整理 `x:identity`、`x:bio`、`x:post:*`（内部 X lookup 上游有返回时）给第一次 LLM，并返回 `profileContext` 供确认策略页展示；内部 X lookup 异常只 retry 1 次，不再 PG fallback；若缺少 Bio/近期内容，则仍以 brief 和硬筛为准。
- 第二次 LLM 默认开启；如上线后成本、延迟或稳定性不可控，可通过环境变量关闭。
- `ECHOHUNT_KOL_MATCH_RECALL_TOP_K` 受底层 `MAX_LIMIT=50` 限制。
- 深评失败时会在 meta 中标记 `evaluationFallback=true`，并继续返回结果，不扣费策略仍沿用“成功有结果才扣”。

## 5. 环境变量

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `ECHOHUNT_KOL_MATCH_RECALL_TOP_K` | `40` | AI 精准匹配进入排序/深评的 Embedding 召回数 |
| `ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_ENABLED` | `true` | 是否启用第二次 LLM 候选深评；设为 `false` 时使用 Embedding similarity proxy |
| `ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_MODEL` | `LLM_MODEL` | 候选深评模型 |
| `ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_TIMEOUT_MS` | `20000` | 候选深评超时 |

## 6. 实施进度

| 步骤 | 状态 | 说明 |
|---|---|---|
| 技术方案文档 | 已完成 | 已记录旧逻辑判断、目标链路、环境变量和验收建议 |
| 后端召回 TopK 与二次深评 | 已完成 | `echohunt-kol-match.js` 已新增 `ECHOHUNT_KOL_MATCH_RECALL_TOP_K`、候选深评 Prompt/Schema、LLM 灰度开关、proxy 降级，并完成 Prompt 低风险对齐；已移除深评 schema 顶层 `assessments.maxItems/minItems` 以兼容 Gemini/Vertex 结构化输出 |
| 前端字段与文案对齐 | 已完成 | `types.ts` / `api.ts` / `ResultTable.tsx` / `KolDetailDrawer.tsx` / `KolMatchPage.tsx` / `globals.css` 已兼容 AI 匹配度、综合推荐分、候选深评进度和结果页深评状态 |
| 静态检查 | 已完成 | 已执行 `node -c src/xhunt/api/echohunt-kol-match.js` 和 `npx tsc --noEmit --project apps/echohunt/tsconfig.json`；未启动 dev/build |

## 6.1 本次已落地的链路

```text
第一次模型生成 strategy.semanticQuery
→ pgvector 在完整硬筛集合中召回 TopK，默认 40
→ candidate_evaluation 阶段对召回候选做二次语义深评
   ├─ 默认开启 ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_ENABLED：调用 LLM 深评
   └─ 显式关闭或失败：使用 Embedding similarity proxy 降级
→ 程序按 AI/语义匹配度、真实流量、影响力、Soul 综合排序
→ 返回最终 limit，默认 20
```

## 6.2 与产品原型仍需确认的边界

- 第二次 LLM 当前默认开启；需要重点观察成本、延迟、超时和模型稳定性，必要时可用 `ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_ENABLED=false` 降级。
- 当前真实流量归一化基于本次 Embedding 召回池；如果严格要求“完整硬筛池归一化”，需要额外 SQL 聚合或持久化分位指标。
- 第一次模型已接入项目 X 画像证据通道；实际可用的 Bio / 近期内容取决于内部 X lookup 接口返回字段，缺失时不得由模型虚构。
- `matchingQuery` 在产品原型中命名为 matchingQuery，当前生产兼容链路仍使用 `semanticQuery` 作为接口字段；Prompt 已明确 `semanticQuery` 等价产品文档中的 `matchingQuery`。

## 7. 验收建议

1. 显式设置 `ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_ENABLED=false`：验证结果仍可返回，meta 中 evaluation engine 为 embedding proxy，结果页显示“深度评测：基础匹配模式”。
2. 默认配置或显式设置 `ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_ENABLED=true`：验证 SSE 出现候选深评阶段，结果含 AI 匹配度和证据，结果页显示“深度评测：已完成”。
3. 检查推荐分：粉丝数和接单意愿只展示，不参与新推荐分。
4. 宽硬筛场景验证 `candidateTotal >= recalledCount`，且不出现影响力 Top 500 预截断。
5. 模型失败/超时场景：应降级返回，不暴露内部错误，不提前扣 quota。


### 7.1 线上降级排查记录

2026-08-15 线上出现结果页显示“深度评测：基础匹配模式”。SSH 排查 PM2 日志发现第二次 LLM 失败：

```text
400 litellm.BadRequestError: Vertex_aiException BadRequestError - Request contains an invalid argument.
Received Model Group=gemini-3.1-flash-lite-preview
```

最小化验证结果：LLM API Key 和基础 JSON Schema 可用，但候选深评复杂 schema 在顶层 `assessments` 数组同时带 `maxItems: 50` / `minItems: 1` 时会被 Gemini/Vertex 拒绝。移除顶层数组数量约束后，同模型同服务可正常返回结构化结果。运行时仍通过 `normalized.length !== rows.length` 校验必须返回每个候选，因此不会放宽业务约束。
