# EchoHunt Social Listening 可视化时序图

打开 `index.html` 查看全部图。页面顶部包含表与存储位置说明；每张图下面都带有“流程说明”，用于快速解释这条链路做了什么、读写哪些核心数据。

单张图：

1. `01-admin-create-monitored-account.svg`：运营新增被监控账号。
2. `02-backend-job-computation.svg`：后台任务调度总览。
3. `02a-post-recall-and-upsert.svg`：推文召回、作者快照、去重落表。
4. `02b-ai-analysis-storage.svg`：复用旧 AI 能力与项目态度落表。
5. `02c-aggregate-to-frontend.svg`：聚合结果与前端模块映射。
6. `03-admin-assign-access.svg`：运营分配 EchoHunt 查看权限。
7. `04-echohunt-entry-guard.svg`：前台入口显示与直接访问门禁。
8. `05-echohunt-view-board.svg`：前台查看看板数据。
9. `06-manual-refresh.svg`：手动刷新限流与任务触发。
10. `07-export.svg`：帖子导出限制与审计。

这些 SVG 是纯静态图片，可以直接放进技术文档、PRD、飞书或语雀。后续要调整文案或样式，修改 `generate-diagrams.js` 后重新执行：

```bash
node docs/social-listening-sequence-diagrams/generate-diagrams.js
```
