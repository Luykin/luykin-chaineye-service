# XHunt 时区处理指南

## 概述

XHunt 系统采用统一的时区处理策略：

- **数据库存储**: UTC+0 时间
- **前端显示**: 中国时区 (UTC+8)
- **统计计算**: 基于中国时区进行

## 时区处理原则

### 1. 数据库层面

- 所有时间字段在数据库中存储为 UTC+0 时间
- Sequelize 配置：`timezone: "+00:00"`
- 确保数据的一致性和准确性

### 2. 后端处理

- 统计查询时，将中国时区的时间范围转换为 UTC 时间进行数据库查询
- 使用统一的时区转换函数

### 3. 前端显示

- 所有时间显示都使用中国时区 (UTC+8)
- 用户界面明确标注时区信息

## 核心工具函数

### `src/xhunt/utils/date.js`

```javascript
// 获取中国时区的今日开始时间（UTC）
getTodayStartChina();

// 获取中国时区的今日结束时间（UTC）
getTodayEndChina();

// 格式化日期时间（中国时区）
formatDateTimeChina(date);

// 获取中国时区的当前日期字符串（YYYY-MM-DD）
getChinaDateString(date);

// 将UTC时间转换为中国时区时间
utcToChinaTime(utcDate);
```

### `src/xhunt/utils/htmlHelpers.js`

```javascript
// 格式化日期时间（中国时区）
formatDateTime(date);

// 格式化中国时间（仅用于显示）
formatChinaTime(date);
```

## 使用示例

### 1. 统计查询

```javascript
const { getTodayStartChina, getTodayEndChina } = require("../utils/date");

// 获取今日统计（中国时区）
const todayStart = getTodayStartChina();
const todayEnd = getTodayEndChina();

const result = await Model.count({
  where: {
    createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd },
  },
});
```

### 2. 前端显示

```javascript
// 在 EJS 模板中
<p>最后更新: <%= formatDateTime() %></p>

// 在 JavaScript 中
const chinaTime = date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
```

### 3. 日期选择器

```javascript
// 设置默认日期为今天（中国时区）
const today = new Date();
const chinaToday = new Date(
  today.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
);
const todayStr = chinaToday.toISOString().split("T")[0];
dateSelector.value = todayStr;
```

## 页面标注

所有统计页面都包含明确的时区说明：

```html
<p style="margin-top: 8px; font-size: 14px;">
  🕐 所有统计数据均按中国时区（UTC+8）计算
</p>
```

## 注意事项

1. **夏令时**: 中国不使用夏令时，所以时区处理相对简单
2. **数据库查询**: 始终使用 UTC 时间进行数据库查询
3. **前端显示**: 始终使用中国时区进行显示
4. **时间计算**: 相对时间计算（如"几分钟前"）需要考虑时区转换

## 测试验证

可以通过以下方式验证时区处理是否正确：

1. 检查数据库中的时间是否为 UTC
2. 检查前端显示的时间是否为北京时间
3. 验证统计数据的日期范围是否正确
4. 确认跨日期边界的统计是否准确

## 常见问题

### Q: 为什么数据库存储 UTC 时间？

A: 确保数据的一致性和可移植性，避免时区转换错误。

### Q: 如何处理用户在不同时区的情况？

A: 目前系统主要面向中国大陆用户，统一使用中国时区。如需支持多时区，需要额外的用户时区设置功能。

### Q: 夏令时如何处理？

A: 中国不使用夏令时，所以不需要特殊处理。
