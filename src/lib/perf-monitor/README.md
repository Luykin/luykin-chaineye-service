# perf-monitor 模块说明

> 高性能、低侵入的 Node.js (Express) 请求性能监控解决方案。

---

## 一、模块定位

1. **请求全量采集**
   - 每一个 HTTP 请求都会被采集基本指标（耗时、状态码、方法、Path 等）。
   - 采集代码位于 `middleware.js`，使用 `res.on('finish')`，对业务零侵入。
2. **详细追踪采样**
   - 可配置是否全量记录或按规则采样（慢请求、错误请求、随机采样）。
   - 详细字段由 `collectDetailedInfo` 动态定义，可自由扩展。
3. **异步批量处理**
   - 中间件只将事件放入内存缓冲并批量 `LPUSH` 至 Redis List (`perf:events:queue`)。
   - 后台进程 (`processor.js` via `singletonJobsServer.js`) 每 2 秒消费，批量写入结构化 Key：
     - 聚合指标：`perf:metrics:<时间戳>` (Hash)
     - 散点索引：`perf:trace:index:<YYYYMMDDHH>` (ZSET)
     - 详细 Trace：`perf:trace:detail:<requestId>` (Hash)
4. **48h 数据保留**
   - 所有 Key 设置 TTL=48h，自动过期，无须人工清理。
5. **可视化 Dashboard**
   - 管理后台 `stats.ejs` 新增 Tab「⚡️ 性能监控」。
   - 散点图 + AvgDuration/RPS 折线图，支持 1/2/4/8/24/48 小时。

---

## 二、目录结构

```
src/lib/perf-monitor/
├── api.js              # 查询 API (metrics / traces / trace)
├── index.js            # initPerfMonitor 入口 & 默认配置
├── middleware.js       # 数据采集 (在 apiServer 中 use)
├── processor.js        # 数据消费/聚合 (在 singletonJobsServer 中定时 run)
└── README.md           # 当前文档
```

---

## 三、初始化示例 (`apiServer.js`)

```js
const { middleware: perfMiddleware, apiRouter: perfApiRouter } =
  initPerfMonitor({
    redisClient,
    // 数据提取配置
    requestIdFrom: ["headers", "x-request-id"],
    collectDetailedInfo: {
      userId: ["headers", "x-user-id"],
      fingerprint: ["headers", "x-device-fingerprint"],
      version: ["headers", "x-extension-version"],
      location: ["headers", "x-window-location-href"],
      ua: ["get", "user-agent"],
    },
    // 运行参数
    flushThreshold: 100,
    flushIntervalMs: 5000,
    trace: {
      sampleRate: 0.05, // 5% 快速成功请求采样
      slowThresholdMs: 500, // >500ms 自动详细追踪
      retentionHours: 48,
    },
    metrics: {
      timeWindowSecs: 60, // 聚合窗口 60s
      retentionHours: 48,
    },
  });
app.use(perfMiddleware);
app.use("/api/stats/perf", perfApiRouter);
```

### singletonJobsServer 集成

```js
const { processor: perfProcessor } = initPerfMonitor({ redisClient });
setInterval(() => perfProcessor.run().catch(console.error), 2000);
```

---

## 四、运行时数据结构

| Key 类型 | Key 模式                        | 说明                                                                |
| -------- | ------------------------------- | ------------------------------------------------------------------- |
| List     | `perf:events:queue`             | 原始事件队列 (LPUSH by middleware)                                  |
| Hash     | `perf:metrics:<ts>`             | 按分钟聚合统计 (`request_count`, `total_duration`, `status_2xx`...) |
| ZSET     | `perf:trace:index:<YYYYMMDDHH>` | 散点图索引，member 为点数据 JSON，score 为时间戳                    |
| Hash     | `perf:trace:detail:<requestId>` | 详细 Trace（仅对 hasDetail=true 记录）                              |

---

## 五、权限控制

- Tab 按钮 & Pane 始终渲染，由前端 `public/static/js/stats.js` 统一判断 `window.adminPermissions`：
  - `perf-monitor` 权限未授予 => 按钮 `opacity:0.6` 且点击后显示“权限不足”Pane。
- `admin-users.ejs` 的 `PERM_META` 已新增：
  ```js
  "perf-monitor": { type:"Tab", label:"性能监控" }
  ```

---

## 六、前端交互

- **散点图 (ECharts)** 颜色规则：
  - `status >= 400` → 深红
  - `durationMs > 5000` → 浅红
  - `durationMs > 500` → 橙色
  - 其他 → 绿色
- 点击点：若 `hasDetail=true` 调 `/api/stats/perf/trace/:id` 弹出 JSON 详情。
- 点数量限制：后端 `/traces` 接口统一 `limit=2000`，保证 48h 范围也不爆前端。

---

## 七、配置项说明 (`initPerfMonitor`)

| 字段                     | 类型           | 默认值                       | 说明                              |
| ------------------------ | -------------- | ---------------------------- | --------------------------------- |
| `redisClient`            | `ioredis` 实例 | **必填**                     | 已连接的 Redis 客户端             |
| `requestIdFrom`          | `Array`        | `['headers','x-request-id']` | 抽取 RequestId 的路径             |
| `collectDetailedInfo`    | `Object`       | 详见示例                     | 需要采集的字段及其路径            |
| `flushThreshold`         | `Number`       | 100                          | Buffer 达到多少条立即 flush       |
| `flushIntervalMs`        | `Number`       | 5000                         | 最长等待多少 ms flush             |
| `trace.sampleRate`       | `Number`       | 0.01                         | 成功快速请求采样率                |
| `trace.slowThresholdMs`  | `Number`       | 500                          | 超过此耗时 + 错误请求强制保存详情 |
| `trace.retentionHours`   | `Number`       | 48                           | 详细 Trace 保留时长               |
| `metrics.timeWindowSecs` | `Number`       | 60                           | 聚合指标时间窗口                  |
| `metrics.retentionHours` | `Number`       | 48                           | 聚合数据保留时长                  |

---

## 八、常见问题 FAQ

**1. Redis 宕机或网络抖动怎么办？**

> middleware 内有硬性 `MAX_BUFFER_SIZE`=10000；若 Redis 挂，最多积压 1 万条后开始丢弃新数据，并打印告警。

**2. 单例处理器来不及消费怎么办？**

> `processor.run()` 默认 200 条/2 秒；队列积压超过 10k 会在日志中高亮告警，可通过增大 `BATCH_SIZE` 或缩短定时器间隔优化。

**3. 如何切换到“全量 Trace”模式？**

> 把 `trace.sampleRate` 设 1 或直接修改 middleware 采样逻辑。注意监控 Redis/TCP 压力。

**4. 为什么 `apiServer` 和 `singletonJobsServer` 都要 `initPerfMonitor`？**

> 这是“生产者-消费者”模式的体现：
>
> - **`apiServer` (多实例/生产者)**: 每个实例都需要自己的 `middleware` 来采集各自处理的请求，并将数据推入**同一个** Redis 队列。
> - **`singletonJobsServer` (单实例/消费者)**: 只需要一个 `processor` 实例，从共享的 Redis 队列中安全地消费数据，避免了并发处理的风险。

---

## 九、上线前检查清单

- [x] API 与 Jobs 进程均已 `initPerfMonitor` 并使用同一 Redis。
- [x] Redis `maxmemory` 配置 ≥ 2GB (当前 ~1.5GB 峰值足够)。
- [x] 前端 `stats.ejs` 按钮已加、`tabPermMap` 已更新。
- [x] `stats.js` limit=2000，48h 范围测试无性能问题。
- [x] 已在 staging 环境试跑 24h，无内存泄漏/队列积压。

---

## 十、资源与性能考量

**1. 48 小时数据对 Redis 的压力有多大？**

根据 `~43 RPS` 的流量模型估算，本模块在 48 小时滚动窗口内的峰值内存占用预估为 **1.5 GB ~ 2.2 GB**。其中大部分（约 1.2 ~ 1.8 GB）来自于为全量请求建立的散点图索引 (ZSET)。

CPU 与命令压力由于采用了批量处理，负载很低，可以忽略不计。

**建议**：

- 为 Redis 实例设置明确的 `maxmemory` 上限（如 `8gb`）和淘汰策略（如 `allkeys-lru`），作为安全保障。
- 上线后监控 Redis 内存使用情况。如果压力过大，首选的优化方式是将配置中的 `trace.retentionHours` 和 `metrics.retentionHours` 从 `48` 调整为 `24`。
