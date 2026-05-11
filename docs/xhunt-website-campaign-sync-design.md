# XHunt 网站活动配置与同步方案

## 1. 背景

当前 XHunt Earn 活动配置主要维护在 Nacos 中，插件侧直接消费 Nacos 配置。

现阶段网站侧也需要活动列表页与详情页，但网站展示诉求和插件诉求并不完全一致，主要体现在：

1. 网站需要独立的数据接口，不能继续依赖前端写死数据。
2. 网站有专属展示字段，这些字段不适合全部放进 Nacos。
3. 网站展示状态需要与 Nacos 活动时间解耦。
   - 例如：Nacos 侧活动报名已结束；
   - 网站侧仍可能展示“立即领取”。
4. 网站详情页虽然保留单独 route，但底层应尽量复用统一模板与统一数据结构。

因此，需要在现有业务数据库中增加一张网站活动表，形成：

- **Nacos**：插件配置源、运营主编辑入口
- **数据库表**：网站配置源、网站接口读取源
- **同步动作**：将 Nacos 中的共享字段同步到数据库，同时保留网站专属字段

> 本方案阶段目标：先出设计文档，不改代码。

---

## 2. 方案结论

结合当前需求，采用以下方案：

1. **不新建数据库**，直接使用现有业务 PostgreSQL 数据库。
2. **新增一张网站活动表**，用于存储网站活动数据。
3. **同步主键使用 Nacos 的 `id` 字段**。
4. **同步日志不单独建表**，复用现有后端操作日志机制记录。
5. **网站专属字段尽量少设计**，能从 Nacos 默认推导的，尽量不重复存储。
6. **网站支持草稿状态**，允许先同步、后补网站展示配置、再发布。
7. **网站列表展示、按钮文案、卡片样式统一由 `webStatus` 推导**，不额外引入分区/按钮类型/按钮跳转/卡片样式字段。
8. **详情页继续保留单独 route**，但 route 底层可以统一走模板渲染与同一套数据结构。
9. **网站专属字段的维护入口与 Nacos 配置页面分区展示**，由运营人工补充。

---

## 3. 总体架构

### 3.1 数据职责划分

#### Nacos 负责
- 插件使用的活动配置
- 活动基础信息
- 报名时间、奖励基础数据、基础文案
- 运营主编辑入口

#### 数据库表负责
- 网站列表展示数据
- 网站详情页展示数据
- 网站专属状态
- 网站草稿内容
- 网站模板配置

### 3.2 同步流程

运营流程建议：

1. 运营先在 `src/xhunt/views/partials/nacos-campaigns.ejs` 中维护活动基础配置。
2. 发布到 Nacos。
3. 点击“同步到网站”按钮。
4. 后端读取最新 Nacos 配置，与数据库表进行比对。
5. 按同步规则写入数据库。
6. 运营再在“网站专属字段区域”补充网站配置。
7. 网站前端通过 API 读取数据库数据。

---

## 4. 同步规则

同步对象为 Nacos 配置中的 `campaigns[]`。

### 4.1 主键规则

- 同步唯一键：`id`
- `campaignKey` 作为业务标识使用
- `slug` 作为网站详情页展示标识使用

说明：

- `id` 已确认作为同步主键，最稳定。
- `campaignKey` 更适合作为活动业务名称。
- `slug` 用于网站路由展示，可默认从 `campaignKey` 派生，也允许后续单独维护。

### 4.2 新增

当 Nacos 中存在、数据库中不存在：

- 插入新记录
- 写入共享字段
- 网站专属字段使用默认值
- 初始状态建议为 `draft`

### 4.3 修改

当 Nacos 中存在、数据库中也存在：

- 根据 `id` 更新共享字段
- 不覆盖网站专属字段
- 更新同步时间
- 如原记录为软删除状态，则恢复

### 4.4 删除

当数据库中存在、Nacos 中不存在：

- 不物理删除
- 标记 `isDeleted = true`
- 记录删除时间

### 4.5 恢复

当记录曾被软删除，后续再次出现在 Nacos 中：

- `isDeleted = false`
- `deletedAt = null`
- 重新同步共享字段

---

## 5. 字段设计原则

这次不建议一开始就设计过多网站专属字段，而是采用：

- **共享字段优先复用 Nacos**
- **网站字段只补“无法从 Nacos 得到”的部分**
- **很多网站展示字段优先做“数据库可覆盖，否则走 Nacos 默认值”**

这样可以降低维护成本，也避免数据重复。

---

## 6. 数据表设计建议

建议新增表名：`XHuntWebsiteCampaigns`

> 命名可根据项目现有 Sequelize 命名习惯再微调。

### 6.1 核心字段

#### 标识与同步字段
- `id`：数据库主键
- `nacosCampaignId`：Nacos 活动 `id`，唯一索引
- `campaignKey`：活动业务 key
- `slug`：网站访问标识
- `isDeleted`：软删除标记
- `deletedAt`：软删除时间
- `lastSyncedAt`：最后同步时间

#### 从 Nacos 同步的共享字段
这些字段建议落库，供网站接口直接使用：

- `enabled`
- `testingPhase`
- `sortWeight`
- `displayNameZh`
- `displayNameEn`
- `projectIntroductionZh`
- `projectIntroductionEn`
- `startAt`
- `endAt`
- `rewardAmount`
- `rewardParticipantCount`
- `rewardUnit`
- `guideUrl`
- `activeUrl`
- `logos`（JSON）
- `tags`（JSON）
- `writingThemes`（JSON）
- `nacosPayload`（JSON，可保留完整快照，便于模板和兜底使用）

#### 网站专属字段
网站专属字段控制在必要范围内：

- `webStatus`
- `webAnnouncementZh`
- `webAnnouncementEn`
- `webRewardTextZh`
- `webRewardTextEn`
- `webNoteZh`
- `webNoteEn`
- `claimPoiContractAddress`
- `claimPowContractAddress`
- `claimEssayContractAddress`
- `pageTemplate`
- `templateConfig`（JSON）
- `websiteExtra`（JSON，可留少量扩展）

### 6.2 为什么网站字段要精简

原因如下：

1. 当前网站很多展示内容可以直接从 Nacos 推导。
2. 列表展示顺序、按钮文案、卡片样式统一由 `webStatus` 决定，不再单独配置。
3. 运营流程是“先配 Nacos，再补网站”，网站字段太多会增加维护负担。
4. 第一版重点是先把网站从死数据切到接口，不宜把后台配置做得过重。

---

## 7. 默认值与回退策略

这是本方案的重点：

**数据库字段优先，Nacos 字段兜底。**

即网站接口组装返回时遵循：

1. 如果数据库专属字段存在，使用数据库值。
2. 如果数据库专属字段为空，则从 Nacos 同步字段中推导默认值。
3. 列表展示顺序、按钮文案、卡片样式由 `webStatus` 和时间规则统一推导。
4. 如果 Nacos 也没有，再使用系统默认值。

### 7.1 列表页字段默认策略

#### 标题
优先级：
1. 网站专属标题（如后续扩展）
2. `displayNameZh/En`
3. `campaignKey`

#### Announcement
优先级：
1. `webAnnouncementZh/En`
2. Nacos 中现有 copy / introduction 相关字段组合
3. 空字符串

#### Reward Text
优先级：
1. `webRewardTextZh/En`
2. 由 `rewardAmount + rewardUnit` 自动拼装
3. 如果有 essay/pow，再从 `nacosPayload` 进一步拼装

#### CTA 与点击行为
优先级：
1. 按钮文案由 `webStatus` 决定
2. 按钮点击统一进入活动详情页

#### 卡片样式
优先级：
1. 由 `webStatus` 映射固定样式
2. 如后续有强需求，再补独立样式字段

### 7.2 详情页字段默认策略

#### 模板
优先级：
1. `pageTemplate`
2. 默认模板 `standard`

#### 模板配置
优先级：
1. `templateConfig`
2. 从 `nacosPayload` 提取可用字段
3. 系统模板默认值

### 7.3 claim 状态附加字段与校验

当活动处于 `claim` 状态时，需要额外维护领奖相关字段：

- `claimPoiContractAddress`：**必填**
- `claimPowContractAddress`：当 Nacos 配置 `enablePowLeaderboard = true` 时必填
- `claimEssayContractAddress`：当 Nacos 配置 `enableEssayContest = true` 时必填

这些字段属于明确业务字段，不建议仅放入 `templateConfig` 中。

原因：

1. 语义明确，适合独立配置与独立校验
2. 后台界面可以根据 Nacos 开关做动态显隐
3. 接口返回结构更清晰，前端实现更稳定

---

## 8. 网站状态设计

网站状态必须独立于 Nacos 时间控制。

建议 `webStatus` 支持以下枚举：

- `draft`：草稿，不对外展示
- `coming_soon`：即将上线，可展示不可参与
- `live`：正常展示，可查看榜单/活动页
- `claim`：领取阶段，按钮显示“立即领取”
- `ended`：活动结束
- `archived`：历史归档

### 8.1 设计原因

这样可以兼容以下场景：

1. Nacos 报名结束，但网站还要展示领取入口。
2. 网站活动页先配置好，但暂时不对外开放。
3. 历史活动需要保留，但展示在往期列表。

### 8.2 列表与按钮规则

网站列表分组、按钮文案、卡片样式均不单独存字段，而是统一由 `webStatus` 和时间规则推导：

- `draft`：默认不返回
- `archived`：默认不返回
- `coming_soon`：展示在前面
- `live`：正常展示
- `claim`：正常展示，按钮文案显示“立即领取”
- `ended`：展示在最后，进入收起的往期活动

按钮点击行为统一进入活动详情页。

---

## 9. 列表页接口建议

建议新增网站活动列表接口，例如：

`GET /api/xhunt/website/campaigns`

### 9.1 默认过滤规则

默认仅返回：

- `isDeleted = false`
- `webStatus != draft`
- `webStatus != archived`

### 9.2 可选查询参数

- `section=active|claim|past|all`（接口内部可按 `webStatus` 推导）
- `lang=zh-CN|en`
- `includeTesting=true|false`
- `includeDraft=true|false`（后台管理场景可用）

### 9.3 返回字段建议

每个活动建议返回：

- `id`
- `nacosCampaignId`
- `campaignKey`
- `slug`
- `title`
- `announcement`
- `rewardText`
- `leftLogo`
- `rightLogo`
- `note`
- `status`
- `sortOrder`
- `startAt`
- `endAt`

其中大部分是接口层计算结果，并不要求全部原样存表。按钮文案、卡片样式、列表归类均由 `webStatus` 推导。

---

## 10. 详情页接口建议

建议新增详情接口，例如：

`GET /api/xhunt/website/campaigns/:slug`

### 10.1 返回内容结构建议

#### 基础区
- `id`
- `campaignKey`
- `slug`
- `title`
- `summary`
- `description`
- `logos`
- `startAt`
- `endAt`
- `reward`
- `guideUrl`
- `activeUrl`
- `webStatus`

#### 模板区
- `pageTemplate`
- `templateConfig`

#### 原始回退区（可选）
- `nacosPayload`

这样单独 route 在拿到数据后，也可以统一走模板渲染。

---

## 11. 详情页 route 方案

当前结论：

- **网站详情路由继续保留单独 route**
- **但 route 底层尽量统一使用同一套模板与数据结构**

### 11.1 推荐做法

例如仍保留：

- `/mantle3`
- `/realgo`
- `/bybit2`

但每个 route 实际只做很薄的一层：

1. 根据 route 对应的 `slug` / `campaignKey` 查询数据库接口
2. 取到活动详情数据
3. 调用统一模板渲染函数
4. 输出 HTML

### 11.2 好处

1. 不影响现有 URL 结构
2. 兼容既有部署方式
3. 避免继续为每个活动手写大量独立 HTML
4. 后续 route 文件可以很薄，维护成本低

---

## 12. 后台配置页面建议

运营确认是人工维护网站专属字段，因此建议在现有活动配置页面内分区处理。

### 12.1 页面结构建议

在 `nacos-campaigns.ejs` 内保留两块区域：

#### A. Nacos 基础配置区
- 继续作为插件活动配置主编辑区
- 保存/发布到 Nacos

#### B. 网站专属配置区
- 单独展示网站状态、网站文案覆盖、claim 领奖字段、模板等字段
- 保存到数据库
- 不回写 Nacos

### 12.2 按钮建议

建议页面增加三个明确动作：

1. `发布到 Nacos`
2. `同步到网站`
3. `保存网站配置`

这样职责清晰：

- Nacos 数据更新是一步
- 网站同步是一步
- 网站专属字段维护是一步

---

## 13. 后端日志建议

本方案不单独建设同步日志表。

建议在现有后端操作日志中记录以下内容：

- 操作人
- 操作时间
- 同步动作类型
- 同步结果摘要
- 新增数量
- 更新数量
- 删除数量
- 异常信息（如有）

这样足够满足第一阶段追踪诉求。

---

## 14. 第一阶段实施范围建议

第一阶段建议只做最小闭环：

1. 新增网站活动表
2. 实现 Nacos -> 数据库 的同步逻辑
3. 实现网站列表接口
4. 实现网站详情接口
5. 在后台增加网站专属字段分区
6. 在后台增加“同步到网站”按钮

### 暂不做

1. 不单独建同步日志表
2. 不过度拆分多张网站子表
3. 不一次性抽象所有详情页模板类型
4. 不一开始就给网站专属字段加太多复杂配置

---

## 15. 当前已确认的关键决策

### 已确认

1. **数据库使用现有业务数据库**，不新建独立 database。
2. **同步主键使用 Nacos 的 `id`**。
3. **同步日志不单独建表**。
4. **网站支持草稿状态**。
5. **网站详情继续保留单独 route**。
6. **网站专属字段由运营人工维护**。
7. **网站字段在页面里分区编辑**。
8. **网站列表展示、按钮文案、卡片样式统一由 `webStatus` 推导**。
9. **claim 状态下需要额外维护领奖合约地址字段，并做必填校验**。

### 当前推荐但仍可微调

1. 网站表命名
2. `webStatus` 的具体枚举值
3. claim 领奖字段的最终命名
4. 接口返回字段的最终命名
5. 后台 UI 具体摆放方式

---

## 16. 下一步建议

在本设计确认后，下一步建议按以下顺序推进：

1. 补充数据库表字段清单
2. 确定 Sequelize Model 结构
3. 确定后台页面的分区交互方式
4. 确定同步接口入参与返回格式
5. 再开始代码实现

---

## 17. 附：推荐的精简网站字段清单

为了方便后续实现，第一版网站专属字段建议优先只做以下这些：

- `slug`
- `webStatus`
- `webAnnouncementZh`
- `webAnnouncementEn`
- `webRewardTextZh`
- `webRewardTextEn`
- `webNoteZh`
- `webNoteEn`
- `claimPoiContractAddress`
- `claimPowContractAddress`
- `claimEssayContractAddress`
- `pageTemplate`
- `templateConfig`

其余展示内容，优先从 Nacos 同步字段或 `nacosPayload` 里兜底推导。

列表展示、按钮文案、卡片样式统一由 `webStatus` 推导，不额外存储单独字段。

这样既能满足网站差异化展示，又能避免后台配置过重。

## 18. 数据表字段明细（建议版）

下面给出一版更细的字段清单，便于后续落 Sequelize Model 和 migration。

### 18.1 表：`XHuntWebsiteCampaigns`

| 字段名 | 类型建议 | 必填 | 默认值 | 说明 |
|---|---|---:|---|---|
| `id` | BIGSERIAL / INTEGER | 是 | 自增 | 数据库主键 |
| `nacosCampaignId` | STRING | 是 | - | 对应 Nacos `campaign.id`，唯一索引 |
| `campaignKey` | STRING | 是 | - | 活动业务 key |
| `slug` | STRING | 是 | 从 `campaignKey` 派生 | 网站详情页标识 |
| `isDeleted` | BOOLEAN | 是 | `false` | 软删除标记 |
| `deletedAt` | DATE | 否 | `null` | 软删除时间 |
| `lastSyncedAt` | DATE | 否 | `null` | 最后一次从 Nacos 同步的时间 |
| `enabled` | BOOLEAN | 否 | `false` | Nacos 同步字段 |
| `testingPhase` | BOOLEAN | 否 | `false` | Nacos 同步字段 |
| `sortWeight` | INTEGER | 否 | `0` | Nacos 同步字段 |
| `displayNameZh` | STRING / TEXT | 否 | `null` | Nacos 同步字段 |
| `displayNameEn` | STRING / TEXT | 否 | `null` | Nacos 同步字段 |
| `projectIntroductionZh` | TEXT | 否 | `null` | Nacos 同步字段 |
| `projectIntroductionEn` | TEXT | 否 | `null` | Nacos 同步字段 |
| `startAt` | DATE | 否 | `null` | Nacos 同步字段 |
| `endAt` | DATE | 否 | `null` | Nacos 同步字段 |
| `rewardAmount` | DECIMAL / BIGINT | 否 | `null` | Nacos 同步字段 |
| `rewardParticipantCount` | INTEGER | 否 | `null` | Nacos 同步字段 |
| `rewardUnit` | STRING | 否 | `null` | Nacos 同步字段 |
| `guideUrl` | TEXT | 否 | `null` | Nacos 同步字段 |
| `activeUrl` | TEXT | 否 | `null` | Nacos 同步字段 |
| `logos` | JSONB | 否 | `[]` | Nacos 同步字段 |
| `tags` | JSONB | 否 | `[]` | Nacos 同步字段 |
| `writingThemes` | JSONB | 否 | `[]` | Nacos 同步字段 |
| `nacosPayload` | JSONB | 否 | `{}` | Nacos 原始快照 |
| `webStatus` | STRING | 是 | `draft` | 网站展示状态 |
| `webAnnouncementZh` | TEXT | 否 | `null` | 网站中文公告覆盖 |
| `webAnnouncementEn` | TEXT | 否 | `null` | 网站英文公告覆盖 |
| `webRewardTextZh` | TEXT | 否 | `null` | 网站中文奖励文案覆盖 |
| `webRewardTextEn` | TEXT | 否 | `null` | 网站英文奖励文案覆盖 |
| `webNoteZh` | TEXT | 否 | `null` | 网站中文备注覆盖 |
| `webNoteEn` | TEXT | 否 | `null` | 网站英文备注覆盖 |
| `claimPoiContractAddress` | STRING | 否 | `null` | claim 阶段 POI 合约地址 |
| `claimPowContractAddress` | STRING | 否 | `null` | claim 阶段 POW 合约地址 |
| `claimEssayContractAddress` | STRING | 否 | `null` | claim 阶段征文合约地址 |
| `pageTemplate` | STRING | 是 | `standard` | 详情页模板类型 |
| `templateConfig` | JSONB | 否 | `{}` | 模板细节配置 |
| `websiteExtra` | JSONB | 否 | `{}` | 预留扩展字段 |
| `createdAt` | DATE | 是 | now | Sequelize 标准字段 |
| `updatedAt` | DATE | 是 | now | Sequelize 标准字段 |

### 18.2 索引建议

建议至少建立以下索引：

1. 唯一索引：`nacosCampaignId`
2. 普通索引：`campaignKey`
3. 普通索引：`slug`
4. 普通索引：`webStatus`
5. 联合索引：`isDeleted + webStatus`

### 18.3 字段命名补充建议

#### 关于 `slug`
建议规则：

1. 默认取 `campaignKey`
2. 若未来网站 route 需要特殊命名，可允许单独修改
3. 一旦上线后，尽量不要频繁修改 `slug`

#### 关于 `nacosPayload`
该字段主要用于：

1. 保留同步来源快照，便于排查问题
2. 某些前端展示字段临时兜底
3. 模板渲染时读取少量未拆分字段

但不建议长期把正式字段都只放在 `nacosPayload` 里消费。

---

## 19. 同步接口设计（建议版）

本节先定义内部管理接口，不涉及外部公开调用。

### 19.1 同步接口

建议接口：

`POST /api/xhunt/website/campaigns/sync-from-nacos`

### 19.2 请求参数

第一版建议可以不接复杂参数，只保留简单控制项：

```json
{
  "dataId": "xhunt_campaigns",
  "group": "DEFAULT_GROUP",
  "dryRun": false
}
```

### 19.3 参数说明

| 字段 | 必填 | 说明 |
|---|---:|---|
| `dataId` | 否 | 默认 `xhunt_campaigns` |
| `group` | 否 | 默认 `DEFAULT_GROUP` |
| `dryRun` | 否 | 若为 `true`，只返回 diff 结果，不实际写库 |

### 19.4 同步处理步骤

后端建议按以下顺序执行：

1. 从 Nacos 拉取 `xhunt_campaigns`
2. 校验返回结构是否包含 `campaigns[]`
3. 读取数据库中所有未物理删除的网站活动记录
4. 以 `campaign.id` 为键构建映射
5. 逐条比对并分类为：
   - 新增
   - 更新
   - 恢复
   - 软删除
   - 跳过
6. 若 `dryRun=false`，执行数据库写入
7. 写入后端操作日志
8. 返回同步摘要

### 19.5 返回结构建议

```json
{
  "success": true,
  "summary": {
    "totalInNacos": 8,
    "created": 1,
    "updated": 3,
    "restored": 0,
    "softDeleted": 1,
    "unchanged": 3
  },
  "items": {
    "created": ["mantle4"],
    "updated": ["realgo", "bybit2", "mantle3"],
    "softDeleted": ["old-campaign"]
  }
}
```

### 19.6 dry run 场景

建议支持 `dryRun=true`，主要用于：

1. 后台“同步到网站”前先预览变更
2. 便于运营确认是新增、修改还是删除
3. 降低误同步风险

---

## 20. 网站配置保存接口（建议版）

### 20.1 保存网站专属字段接口

建议接口：

`PUT /api/xhunt/website/campaigns/:nacosCampaignId/web-config`

说明：
- 这里用 `:nacosCampaignId` 更符合后台同步主键体系
- 如果后续更习惯用数据库主键，也可以改为 `:id`

### 20.2 请求体建议

```json
{
  "slug": "mantle3",
  "webStatus": "claim",
  "webAnnouncementZh": "Mantle 第三季奖励领取已开启",
  "webAnnouncementEn": "Mantle Season 3 reward claim is now live",
  "webRewardTextZh": "奖池：10,000 USDC",
  "webRewardTextEn": "Reward: 10,000 USDC",
  "webNoteZh": "请在截止时间前完成领取",
  "webNoteEn": "Please claim before the deadline",
  "claimPoiContractAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "claimPowContractAddress": null,
  "claimEssayContractAddress": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  "pageTemplate": "standard",
  "templateConfig": {
    "claimStatusBadge": "Claim is live",
    "secondaryTabTitle": "Content Contest"
  }
}
```

### 20.3 后端校验规则建议

#### 基础校验

1. `slug` 非空
2. `webStatus` 必须在允许枚举内
3. `pageTemplate` 非空
4. 合约地址如有填写，应满足 EVM 地址格式

#### claim 状态校验

当 `webStatus = claim`：

1. `claimPoiContractAddress` 必填
2. 如果 `enablePowLeaderboard = true`，则 `claimPowContractAddress` 必填
3. 如果 `enableEssayContest = true`，则 `claimEssayContractAddress` 必填

#### 非 claim 状态

当 `webStatus != claim`：

- 三个 claim 合约地址允许为空
- 是否保留历史值可按后端策略处理，建议默认保留，不自动清空

### 20.4 返回结构建议

```json
{
  "success": true,
  "data": {
    "nacosCampaignId": "mantle3",
    "webStatus": "claim",
    "updatedAt": "2026-05-11T12:00:00.000Z"
  }
}
```

---

## 21. 网站列表接口返回示例

建议接口：

`GET /api/xhunt/website/campaigns?lang=zh-CN`

### 21.1 返回示例

```json
{
  "success": true,
  "data": [
    {
      "nacosCampaignId": "mantle3",
      "campaignKey": "mantle3",
      "slug": "mantle3",
      "title": "Mantle Season 3",
      "announcement": "Mantle 第三季奖励领取已开启",
      "rewardText": "奖池：10,000 USDC",
      "note": "请在截止时间前完成领取",
      "status": "claim",
      "buttonText": "立即领取",
      "cardStyle": "claim",
      "leftLogo": "/whitexhunt.png",
      "rightLogo": "/MANTLE.png",
      "sortOrder": 1000,
      "startAt": "2026-03-02T00:00:00.000Z",
      "endAt": "2026-03-24T23:59:59.000Z"
    },
    {
      "nacosCampaignId": "realgo",
      "campaignKey": "realgo",
      "slug": "realgo",
      "title": "RealGo",
      "announcement": "排行榜活动火热进行中",
      "rewardText": "奖池：10,000 USDT + 70,000 RT",
      "note": null,
      "status": "live",
      "buttonText": "查看详情",
      "cardStyle": "live",
      "leftLogo": "/whitexhunt.png",
      "rightLogo": "/realgo-logo.png",
      "sortOrder": 900,
      "startAt": "2026-03-18T00:00:00.000Z",
      "endAt": "2026-04-16T23:59:59.000Z"
    }
  ]
}
```

### 21.2 字段来源说明

| 返回字段 | 来源 |
|---|---|
| `title` | 优先网站覆盖，否则 `displayNameZh/En` |
| `announcement` | 优先 `webAnnouncementZh/En`，否则 Nacos 兜底 |
| `rewardText` | 优先 `webRewardTextZh/En`，否则自动拼装 |
| `note` | 优先 `webNoteZh/En` |
| `buttonText` | 由 `webStatus` 推导 |
| `cardStyle` | 由 `webStatus` 推导 |
| `leftLogo/rightLogo` | 从 `logos` 中按约定位置提取 |
| `sortOrder` | 由 `webStatus + sortWeight + 时间规则` 计算 |

---

## 22. 网站详情接口返回示例

建议接口：

`GET /api/xhunt/website/campaigns/:slug?lang=zh-CN`

### 22.1 返回示例

```json
{
  "success": true,
  "data": {
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
        "image": "/whitexhunt.png",
        "url": "https://xhunt.ai/"
      },
      {
        "image": "/MANTLE.png",
        "url": "https://x.com/0xMantleCN"
      }
    ],
    "reward": {
      "text": "奖池：10,000 USDC",
      "amount": 10000,
      "unit": "USDC"
    },
    "claim": {
      "poiContractAddress": "0x1234567890abcdef1234567890abcdef12345678",
      "powContractAddress": null,
      "essayContractAddress": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    },
    "pageTemplate": "standard",
    "templateConfig": {
      "claimStatusBadge": "Claim is live",
      "secondaryTabTitle": "Content Contest"
    },
    "nacosPayload": {}
  }
}
```

### 22.2 详情页 route 侧推荐用法

单独 route 建议只做以下逻辑：

1. 根据当前 route 找到固定 `slug`
2. 调用详情接口取数据
3. 根据 `pageTemplate` 选择模板
4. 把 `templateConfig` 和 claim 字段注入模板
5. 输出 HTML

---

## 23. 后台页面字段分区草案

为了减少运营理解成本，建议后台编辑区分为四块。

### 23.1 第一块：Nacos 基础配置区

已有内容继续保留，主要是：

- 活动基础信息
- 活动时间
- 奖励信息
- Essay / POW 开关
- 链接与文案

这部分继续发布到 Nacos。

### 23.2 第二块：网站同步信息区

建议只展示只读信息：

- Nacos 活动 ID
- campaignKey
- slug
- 最后同步时间
- 是否已软删除

### 23.3 第三块：网站展示配置区

建议编辑字段：

- `webStatus`
- `webAnnouncementZh`
- `webAnnouncementEn`
- `webRewardTextZh`
- `webRewardTextEn`
- `webNoteZh`
- `webNoteEn`
- `pageTemplate`

### 23.4 第四块：claim 领奖配置区

仅当：
- `webStatus = claim`
时展开或高亮。

建议字段：

- `claimPoiContractAddress`
- `claimPowContractAddress`
- `claimEssayContractAddress`

并根据 Nacos 开关联动：

- 若 `enablePowLeaderboard != true`，则 POW 合约地址输入框可隐藏或标记为非必填
- 若 `enableEssayContest != true`，则征文合约地址输入框可隐藏或标记为非必填

### 23.5 第五块：模板配置区

建议编辑字段：

- `templateConfig`（JSON 编辑器或结构化表单）

第一版为了快，可以先保留 JSON 编辑；
后续若模板字段稳定，再拆成结构化表单。

---

## 24. 排序与列表归类规则建议

虽然不再单独存 `webListSection`，但仍建议把归类逻辑写死在后端，避免前端各写各的。

### 24.1 一级归类

后端可先按 `webStatus` 归类：

1. `coming_soon`
2. `live`
3. `claim`
4. `ended`

其中：
- `draft`、`archived` 默认不进入公开列表

### 24.2 二级排序

同一状态内建议使用以下规则：

1. `sortWeight` 倒序
2. `startAt` 倒序
3. `updatedAt` 倒序

### 24.3 前端展示建议

- `coming_soon`：展示在最前
- `live` 和 `claim`：展示在主列表中
- `ended`：放在最下方的“往期活动”收起区

这样能保证网站和后台对“展示顺序”理解一致。

---

## 25. 风险点与注意事项

### 25.1 `slug` 修改风险

如果某活动已经对外发布并被搜索引擎收录，再修改 `slug` 可能导致：

1. 旧链接失效
2. route 配置失配
3. 外部分享链接失效

因此建议：
- 活动公开后尽量不再修改 `slug`
- 若确需修改，后续应考虑补 redirect 方案

### 25.2 claim 合约地址填错风险

claim 阶段字段属于高风险配置，尤其是 POI 合约地址。

建议后续实现时至少具备：

1. 地址格式校验
2. 保存前二次确认
3. 操作日志记录修改前后值

### 25.3 模板配置 JSON 出错风险

`templateConfig` 若采用 JSON 手工编辑，存在：

1. JSON 格式错误
2. 字段名拼错
3. 值类型不正确

建议：
- 第一版保存前做 JSON 校验
- 后续稳定后，把高频字段从 JSON 中拆出来

### 25.4 Nacos 与数据库数据短暂不一致

由于采用“先发布 Nacos、再同步数据库”的流程，短时间内一定会存在：

- 插件看到的是新配置
- 网站看到的是旧配置

这属于正常现象。

建议在后台交互上明确提示：

- 发布 Nacos 后，如需更新网站，请继续点击“同步到网站”

---

## 26. 推荐的实施顺序（文档版）

建议后续落地时按下面顺序推进：

### 第一步：数据结构落地

1. 确定表名
2. 确定字段名
3. 确定 migration
4. 确定 Sequelize Model

### 第二步：同步链路落地

1. 后端增加同步接口
2. 实现 dry run
3. 接入操作日志
4. 后台增加“同步到网站”按钮

### 第三步：网站配置落地

1. 后端增加网站配置保存接口
2. 后台增加网站专属字段编辑区
3. 做 claim 状态下的联动校验

### 第四步：网站消费落地

1. 网站列表页改为请求活动列表接口
2. 网站详情页改为请求详情接口
3. 单独 route 改为统一模板渲染

这样推进，风险最小，也最容易分阶段验收。
