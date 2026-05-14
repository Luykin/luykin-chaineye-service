# XHunt Admin React

## 启动方式

在项目根目录执行：

```bash
yarn admin-web:dev
```

默认会通过 Vite 代理请求到：

```bash
http://localhost:8090
```

如需修改后端代理地址，可设置环境变量：

```bash
VITE_API_TARGET=http://localhost:8090
```

## 当前阶段

当前已完成：

- React + Vite + TypeScript + Ant Design 基础壳子
- 管理员会话接入（`/admin/session`）
- 基础后台 Layout
- 404 页面
- 无权限页面
- `日活详情` 与 `在线用户` 页面接入
- 其余首批页面路由骨架

尚未完成：

- `generic-stats` 真实数据接入
- `admin-audit-logs` 真实数据接入
- `url-stats` / `version-stats` 真实数据接入
- 后续按原后台顺序继续迁移剩余页面
