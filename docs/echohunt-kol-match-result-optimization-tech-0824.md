# EchoHunt KOL Match 结果页优化技术方案（0824）

## 1. 背景

产品 PRD：`/Users/luykin/Downloads/echohunt-kol-match-result-optimization-prd-0824.md`

本次需求目标是在不改变现有 AI 匹配主流程、推荐算法、推荐分计算和次数消耗规则的前提下，优化 EchoHunt KOL Match 的结果页体验，包括：

1. AI 精准匹配结果页增加二次筛选。
2. 接单意愿展示与筛选优先级接入 KOL 本人邀约状态。
3. “条件筛选”Tab 更名为“全量匹配”。
4. KOL 名单展示专业能力分数。
5. 展示 XHUNT 使用标识。

结合当前代码现状，本技术方案先实现无阻塞部分：

- 4.1 AI 精准匹配结果页二次筛选
- 4.3 “条件筛选”更名为“全量匹配”
- 4.4 KOL 名单增加专业能力分数

暂不实现：

- 4.2 接单意愿展示与筛选优先级：等待另一个“商务合作 / 本人邀约状态”需求完成并确认数据源后再做。
- 4.5 展示 XHUNT 使用标识：后端查询接口已实现，但本轮暂不做前端展示。

---

## 2. 代码现状

### 2.1 后端相关路径

```text
src/xhunt/api/echohunt-kol-match.js
src/xhunt/api/echohunt-kol-match/
src/xhunt/api/kol-marketing/search-service.js
```

### 2.2 前端相关路径

```text
/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt/components/kol-match/KolMatchPage.tsx
/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt/components/kol-match/ResultTable.tsx
/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt/components/kol-match/KolDetailDrawer.tsx
/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt/components/kol-match/types.ts
/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt/components/kol-match/api.ts
/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt/components/kol-match/utils.tsx
/Users/luykin/Documents/mac-work-new/XHunt.website/apps/echohunt/app/globals.css
```

### 2.3 当前后端 KOL 数据组装

KOL Match 当前统一通过 `mapKolProfile(row, context)` 输出前端所需 KOL 数据。

当前已返回字段包括：

```js
willingnessLevel
willingnessScore
willingnessConfidence
willingnessReason
willingnessEvidence
capabilities
followers
soulScore
lastActiveAt
influenceRank
aiRankGlobal
aiRankCn
web3RankGlobal
web3RankCn
```

其中专业能力来源于：

```js
row.aiAbilities
row.web3Abilities
```

当前 `capabilityLabels()` 只返回能力名称，不返回分数：

```json
{
  "capabilities": ["DeFi", "Trading", "BNB Chain"]
}
```

但底层 `ai_abilities` / `web3_abilities` JSON 中已经有能力分数，例如：

```json
{
  "en": {
    "fields": [
      { "DeFi": 92 },
      { "Trading": 88 }
    ]
  }
}
```

所以 4.4 可以直接基于现有字段扩展返回。

### 2.4 当前前端 AI 结果展示

当前 AI 结果页逻辑为：

```tsx
const sortedAiRows = useMemo(
  () => sortRows(aiResults, aiSort, domain, market),
  [aiResults, aiSort, domain, market]
);

<ResultTable rows={sortedAiRows} />
```

当前 AI 结果页只有排序，没有二次筛选。

### 2.5 当前全量筛选页

当前 Tab 文案为：

```tsx
tr(language, '条件筛选', 'Filter by Conditions')
```

本次需要更名为：

```tsx
tr(language, '全量匹配', 'All KOLs')
```

---

## 3. 本轮实现范围

| PRD 项 | 是否本轮实现 | 说明 |
| --- | --- | --- |
| 4.1 AI 精准匹配结果页增加二次筛选 | 是 | 前端本地筛选，不请求后端，不消耗次数 |
| 4.2 接单意愿展示与筛选优先级 | 否 | 等另一个本人邀约状态需求完成后再做 |
| 4.3 “条件筛选”更名为“全量匹配” | 是 | 前端文案修改 |
| 4.4 KOL 名单增加专业能力分数 | 是 | 后端扩展返回，前端展示 |
| 4.5 展示 XHUNT 使用标识 | 否 | 后端接口已实现，本轮暂不做 |

---

## 4. 需求与现实差异

### 4.1 接单意愿本人邀约状态暂不具备接入条件

PRD 要求：

> KOL 本人设置的邀约状态优先；本人未设置时使用 AI 判断。

当前 KOL Match 相关代码只使用：

```sql
k.willingness_level
```

即 AI 接单意愿字段。

当前代码中尚未发现明确的本人邀约状态字段，例如：

- accepting
- paused
- invitation status
- KOL 本人邀约状态
- 接受邀约
- 暂停邀约

因此 4.2 本轮不做，需要等待另一个需求完成后，确认以下信息再接入：

1. 本人邀约状态存在哪张表。
2. 字段名和枚举值。
3. 是否在当前 KOL Match 只读库可查。
4. 如何与 `dev.kol_marketing_profile.twitter_user_id` 关联。
5. 需要作用于哪些接口：AI 精准匹配、全量匹配、KOL 详情。

### 4.2 二次筛选项与现有全量匹配筛选项不同

PRD 的 AI 结果页二次筛选中，粉丝量是区间：

```text
1 万以下
1 万至 5 万
5 万至 10 万
10 万至 50 万
50 万以上
```

当前全量匹配的粉丝量是下限筛选：

```text
10K+
50K+
100K+
500K+
```

本次只对 AI 结果页二次筛选实现 PRD 区间逻辑，不修改全量匹配原有后端筛选规则。

### 4.3 灵魂指数阈值不一致

PRD 要求 AI 结果页二次筛选：

```text
80+
90+
95+
```

当前全量匹配为：

```text
85+
90+
95+
```

本次 AI 结果页二次筛选按 PRD 使用 `80 / 90 / 95`，不改全量匹配。

---

## 5. 后端技术方案：专业能力分数

### 5.1 修改文件

```text
src/xhunt/api/echohunt-kol-match.js
```

### 5.2 返回结构

保持旧字段不变：

```json
{
  "capabilities": ["DeFi", "Trading", "BNB Chain"]
}
```

新增字段：

```json
{
  "capabilityScores": [
    { "label": "DeFi", "score": 92 },
    { "label": "Trading", "score": 88 },
    { "label": "BNB Chain", "score": 85 }
  ]
}
```

### 5.3 实现逻辑

新增 helper：

```js
function capabilityScoreItems(abilities, market, lang = "zh", maxItems = 20) {
  if (!abilities || typeof abilities !== "object") return [];

  const bucket = abilities[lang === "en" ? "en" : market === "CN" ? "cn" : "en"]
    || abilities.en
    || abilities.cn;

  const fields = Array.isArray(bucket?.fields) ? bucket.fields : [];

  return fields
    .flatMap((field) => Object.entries(field || {}).map(([label, value]) => ({
      label,
      score: numeric(value),
    })))
    .filter((item) => item.label)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, maxItems);
}
```

调整原 `capabilityLabels()`：

```js
function capabilityLabels(abilities, market, lang = "zh") {
  return capabilityScoreItems(abilities, market, lang, 6).map((item) => item.label);
}
```

调整 `mapKolProfile()`：

```js
const abilities = domain === "AI" ? row.aiAbilities : row.web3Abilities;
const capabilityScores = capabilityScoreItems(abilities, market, lang);

return {
  // ...existing fields
  capabilities: capabilityScores.slice(0, 6).map((item) => item.label),
  capabilityScores,
};
```

### 5.4 兼容性

- 不删除 `capabilities`。
- 不改变原有排序和推荐分。
- 没有分数时 `score` 为 `null`，前端只展示能力名。

---

## 6. 前端技术方案

## 6.1 类型扩展

### 修改文件

```text
components/kol-match/types.ts
```

新增类型：

```ts
export type KolCapabilityScore = {
  label: string;
  score?: number | null;
};
```

扩展 `KolProfile`：

```ts
capabilityScores?: KolCapabilityScore[];
```

---

## 6.2 API 映射能力分数

### 修改文件

```text
components/kol-match/api.ts
```

新增解析函数：

```ts
function asCapabilityScores(value: unknown): KolCapabilityScore[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const label = asString(row.label).trim();
      if (!label) return null;
      return {
        label,
        score: asNullableNumber(row.score),
      };
    })
    .filter((item): item is KolCapabilityScore => Boolean(item));
}
```

在 `mapKolProfile()` 中新增：

```ts
capabilityScores: asCapabilityScores(row.capabilityScores),
```

---

## 6.3 AI 结果页二次筛选

### 修改文件

```text
components/kol-match/KolMatchPage.tsx
```

### 新增状态

```ts
type AiResultFilterState = {
  rankRange:
    | 'any'
    | 'top_1k'
    | '1001_5k'
    | '5001_10k'
    | '10001_50k'
    | 'after_50k';
  followersRange:
    | 'any'
    | 'lt_10k'
    | '10k_50k'
    | '50k_100k'
    | '100k_500k'
    | 'gte_500k';
  capabilities: string[];
  activity: 'any' | '7d' | '14d' | '30d';
  soul: 'any' | '80' | '90' | '95';
  moreOpen: boolean;
};
```

默认值：

```ts
const DEFAULT_AI_RESULT_FILTERS: AiResultFilterState = {
  rankRange: 'any',
  followersRange: 'any',
  capabilities: [],
  activity: 'any',
  soul: 'any',
  moreOpen: false,
};
```

### 新增本地筛选结果

```ts
const filteredAiRows = useMemo(() => {
  return sortedAiRows.filter((kol) => {
    return (
      matchAiRank(kol, aiResultFilters.rankRange, domain, market) &&
      matchAiFollowers(kol, aiResultFilters.followersRange) &&
      matchAiCapabilities(kol, aiResultFilters.capabilities) &&
      matchAiActivity(kol, aiResultFilters.activity) &&
      matchAiSoul(kol, aiResultFilters.soul)
    );
  });
}, [sortedAiRows, aiResultFilters, domain, market]);
```

渲染结果时改为：

```tsx
<ResultTable rows={filteredAiRows} />
```

### 规则要求

- 只筛选当前 `aiResults`。
- 不请求 `/ai-search`。
- 不请求 `/filter-search`。
- 不消耗 quota。
- 不重新计算推荐分。
- 保持当前排序方式。
- 切换排序后，二次筛选条件保留。
- 重新生成名单后，清空二次筛选条件。

### 重新生成名单时清空筛选

在 AI 匹配成功写入新结果的位置执行：

```ts
setAiResultFilters(DEFAULT_AI_RESULT_FILTERS);
```

---

## 6.4 二次筛选组件

建议新增组件：

```text
components/kol-match/AiResultFilterBar.tsx
```

组件 props：

```ts
type AiResultFilterBarProps = {
  language: EchohuntLanguage;
  value: AiResultFilterState;
  total: number;
  visible: number;
  capabilityOptions: string[];
  onChange: (next: AiResultFilterState) => void;
  onReset: () => void;
};
```

展示内容：

1. 标题：
   - 中文：筛选推荐结果
   - 英文：Filter recommended results
2. 说明文案：
   - 中文：只筛选当前名单，不会重新匹配或消耗次数。
   - 英文：Only filters the current shortlist. It will not rerun matching or use quota.
3. 当前人数：
   - 中文：显示 `12 / 20` 人
   - 英文：Showing `12 / 20`
4. 首层筛选：
   - X 影响力排名
   - 专业能力，多选
   - 粉丝量
   - 更多筛选
   - 重置
5. 更多筛选：
   - 近期活跃度
   - 灵魂指数
6. 已应用标签：
   - 支持单独移除
   - 支持清除全部

### 专业能力选项来源

从当前 AI 结果动态生成：

```ts
const aiCapabilityOptions = useMemo(() => {
  const set = new Set<string>();

  aiResults.forEach((kol) => {
    const items = kol.capabilityScores?.length
      ? kol.capabilityScores.map((item) => item.label)
      : kol.capabilities;

    items.forEach((item) => {
      if (item) set.add(item);
    });
  });

  return Array.from(set).sort();
}, [aiResults]);
```

---

## 6.5 AI 二次筛选条件判断

### 影响力排名

```ts
function matchAiRank(kol: KolProfile, range: AiResultFilterState['rankRange'], domain: KolDomain, market: KolMarket) {
  if (range === 'any') return true;

  const rank = getRank(kol, domain, market);
  if (!Number.isFinite(Number(rank))) return false;

  const value = Number(rank);

  if (range === 'top_1k') return value <= 1000;
  if (range === '1001_5k') return value >= 1001 && value <= 5000;
  if (range === '5001_10k') return value >= 5001 && value <= 10000;
  if (range === '10001_50k') return value >= 10001 && value <= 50000;
  if (range === 'after_50k') return value >= 50001;

  return true;
}
```

### 粉丝量

```ts
function matchAiFollowers(kol: KolProfile, range: AiResultFilterState['followersRange']) {
  if (range === 'any') return true;

  const followers = Number(kol.followers || 0);

  if (range === 'lt_10k') return followers < 10000;
  if (range === '10k_50k') return followers >= 10000 && followers < 50000;
  if (range === '50k_100k') return followers >= 50000 && followers < 100000;
  if (range === '100k_500k') return followers >= 100000 && followers < 500000;
  if (range === 'gte_500k') return followers >= 500000;

  return true;
}
```

### 专业能力

```ts
function matchAiCapabilities(kol: KolProfile, selected: string[]) {
  if (!selected.length) return true;

  const labels = new Set(
    (kol.capabilityScores?.length
      ? kol.capabilityScores.map((item) => item.label)
      : kol.capabilities
    ).map((item) => item.toLowerCase())
  );

  return selected.some((item) => labels.has(item.toLowerCase()));
}
```

### 活跃度

```ts
function matchAiActivity(kol: KolProfile, activity: AiResultFilterState['activity']) {
  if (activity === 'any') return true;
  if (!kol.lastActiveAt) return false;

  const date = new Date(kol.lastActiveAt);
  if (Number.isNaN(date.getTime())) return false;

  const days = activity === '7d' ? 7 : activity === '14d' ? 14 : 30;
  return date.getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
}
```

### 灵魂指数

```ts
function matchAiSoul(kol: KolProfile, soul: AiResultFilterState['soul']) {
  if (soul === 'any') return true;

  const score = Number(kol.soulScore);
  if (!Number.isFinite(score)) return false;

  return score >= Number(soul);
}
```

---

## 6.6 空状态

### 修改文件

```text
components/kol-match/ResultTable.tsx
```

建议扩展 props：

```ts
emptyDescription?: string;
emptyAction?: ReactNode;
```

AI 二次筛选为空时传入：

```tsx
<ResultTable
  rows={filteredAiRows}
  mode="ai"
  domain={domain}
  market={market}
  language={language}
  onOpen={openDrawer}
  emptyDescription={tr(
    language,
    '当前推荐名单中没有符合这些条件的 KOL，可以清除筛选或放宽条件。',
    'No KOLs in this shortlist match these filters. Clear or loosen the filters.'
  )}
  emptyAction={
    <Button onClick={resetAiResultFilters}>
      {tr(language, '清除全部筛选', 'Clear all filters')}
    </Button>
  }
/>
```

---

## 6.7 专业能力分数展示

### 修改文件

```text
components/kol-match/ResultTable.tsx
components/kol-match/KolDetailDrawer.tsx
```

### 列表展示

列表最多展示 Top 3：

```tsx
const capabilityItems = kol.capabilityScores?.length
  ? kol.capabilityScores.slice(0, 3)
  : kol.capabilities.slice(0, 3).map((label) => ({ label, score: null }));
```

渲染：

```tsx
{capabilityItems.map((item) => (
  <em key={item.label}>
    <span>{item.label}</span>
    {Number.isFinite(Number(item.score)) ? <b>{Math.round(Number(item.score))}</b> : null}
  </em>
))}
```

### 详情展示

详情展示更完整能力列表：

```tsx
const detailCapabilityItems = kol.capabilityScores?.length
  ? kol.capabilityScores
  : kol.capabilities.map((label) => ({ label, score: null }));
```

无分数时只展示能力名称，不展示 `0`、`—` 或空分数。

---

## 6.8 “条件筛选”更名为“全量匹配”

### 修改文件

```text
components/kol-match/KolMatchPage.tsx
```

替换：

```tsx
tr(language, '条件筛选', 'Filter by Conditions')
```

为：

```tsx
tr(language, '全量匹配', 'All KOLs')
```

相关页面文案建议同步：

```text
今日条件筛选次数已用完
```

改为：

```text
今日全量匹配次数已用完
```

英文：

```text
Today's All KOLs quota is used up
```

注意：本次只改名称，不改原有全量匹配筛选逻辑、次数限制和结果展示规则。

---

## 7. 4.2 后续接入预留方案

4.2 本轮不做，等另一个本人邀约状态需求完成后再接。

后续建议后端扩展字段：

```json
{
  "aiWillingnessLevel": "low",
  "kolInvitationStatus": "accepting",
  "displayWillingnessLevel": "accepting",
  "displayWillingnessSource": "kol_self",
  "displayWillingnessLabel": {
    "zh": "接受邀约",
    "en": "Accepting invitations"
  }
}
```

建议枚举：

```ts
type AiWillingnessLevel = 'high' | 'medium' | 'low' | 'unknown';
type KolInvitationStatus = 'accepting' | 'paused' | 'unset';
type DisplayWillingnessLevel = 'accepting' | 'paused' | 'high' | 'medium' | 'low' | 'unknown';
type DisplayWillingnessSource = 'kol_self' | 'ai';
```

优先级：

1. 本人设置 `accepting`：展示接受邀约。
2. 本人设置 `paused`：展示暂停邀约。
3. 本人未设置：展示 AI `high / medium / low / unknown`。

排除 low 逻辑后续应调整为：

1. 本人暂停邀约：排除。
2. 本人接受邀约：保留，即使 AI 为 low。
3. 本人未设置：AI 为 low 时排除。

---

## 8. 建议开发顺序

### 第一阶段：本轮可直接开发

1. 后端 `echohunt-kol-match.js` 增加 `capabilityScores`。
2. 前端 `types.ts` 增加 `KolCapabilityScore`。
3. 前端 `api.ts` 映射 `capabilityScores`。
4. 前端结果列表和详情页展示专业能力分数。
5. 前端新增 AI 结果页二次筛选状态与过滤函数。
6. 前端新增或内联 `AiResultFilterBar`。
7. 前端空状态增加“清除全部筛选”。
8. 前端 Tab 和相关文案改成“全量匹配 / All KOLs”。

### 第二阶段：另一个需求完成后

1. 确认 KOL 本人邀约状态表和字段。
2. 后端 KOL Match 查询 join 本人邀约状态。
3. 后端返回 display willingness 字段。
4. 后端修正 exclude-low SQL 逻辑。
5. 前端展示本人设置 / AI 判断来源。

---

## 9. 测试建议

### 9.1 后端

不启动服务，仅做语法检查：

```bash
node -c src/xhunt/api/echohunt-kol-match.js
```

建议接口验证：

- `/api/xhunt/echohunt/kol-match/ai-search`
- `/api/xhunt/echohunt/kol-match/ai-search/stream`
- `/api/xhunt/echohunt/kol-match/filter-search`
- `/api/xhunt/echohunt/kol-match/kols/:twitterUserId`

重点确认：

- `capabilities` 仍然存在且为字符串数组。
- `capabilityScores` 新增且按分数倒序。
- 无分数时不返回错误。
- 原推荐分、排序、quota 不受影响。

### 9.2 前端

不自动启动 dev server，不自动 build。

建议坤哥本地启动后手动验证：

1. AI 匹配生成结果后，二次筛选不发起后端请求。
2. 二次筛选不消耗 AI 次数。
3. 显示 `可见人数 / 总人数` 正确。
4. 专业能力多选为 OR 逻辑。
5. 重置和单项移除条件可用。
6. 空状态可一键清除全部筛选。
7. 切换排序后筛选条件保留。
8. 重新生成名单后筛选条件清空。
9. 移动端不出现横向滚动。
10. 中英文切换后筛选状态保留，文案正确。

---

## 10. 验收标准

### 10.1 AI 结果二次筛选

- 用户可以在当前推荐名单中继续筛选。
- 筛选不重新发起 AI 匹配。
- 筛选不消耗 AI 精准匹配次数。
- 筛选不改变推荐分。
- 筛选后保持当前排序方式。
- 已应用条件支持标签展示和单独移除。
- 无结果时展示空状态和清除全部筛选操作。

### 10.2 全量匹配改名

- 顶部 Tab 显示：中文“全量匹配”，英文“All KOLs”。
- 页面内相关引用同步。
- 原有全量匹配功能逻辑不变。

### 10.3 专业能力分数

- AI 结果列表展示主要专业能力和分数。
- KOL 详情页展示更完整专业能力和分数。
- 能力按分数从高到低排列。
- 没有分数时只展示能力名。
- 不影响推荐分、排序、筛选次数。

### 10.4 暂不验收项

- 4.2 接单意愿本人状态优先级：等待另一个需求完成后再验收。
- 4.5 XHUNT 使用标识：本轮暂不验收。
