# 数据爬虫系统

## 功能特点

- 🚀 自动化数据爬取
  - 支持全量数据爬取
  - 每日定时更新最新数据
  - 断点续传功能
  - 自动错误重试

- 💾 数据管理
  - SQLite 数据存储
  - 自动数据去重
  - 数据版本追踪

- 🛡️ 安全特性
  - API 速率限制
  - CORS 保护
  - 安全响应头
  - 数据压缩

- 📊 可视化管理
  - 实时爬虫状态监控
  - 数据预览
  - 手动触发控制

## 技术栈

- 后端：Node.js + Express
- 数据库：SQLite + Sequelize
- 爬虫：Puppeteer
- 前端：HTML + Tailwind CSS

## 快速开始

1. 安装依赖：
```bash
npm install
```

2. 启动服务：
```bash
npm run dev
```

3. 访问管理界面：
```
http://localhost:3000
```

## 系统架构

```
├── public/                 # 静态文件
│   └── index.html         # 管理界面
├── src/
│   ├── models/            # 数据模型
│   │   ├── index.js      # 数据库配置
│   │   ├── fundraising.js # 募资数据模型
│   │   └── crawl-state.js # 爬虫状态模型
│   ├── services/          # 业务逻辑
│   │   ├── crawler.js     # 爬虫服务
│   │   └── scheduler.js   # 调度服务
│   ├── routes/            # API 路由
│   │   └── fundraising.js # 募资相关接口
│   └── index.js           # 应用入口
├── .env                   # 环境配置
└── package.json           # 项目配置
```

## API 接口

### 数据查询
- `GET /api/fundraising`
  - 参数：
    - page: 页码（默认：1）
    - limit: 每页数量（默认：10）
  - 返回：分页后的募资数据

### 爬虫控制
- `POST /api/fundraising/crawl/full`
  - 启动全量数据爬取
- `POST /api/fundraising/crawl/quick`
  - 启动快速更新（仅前3页）
- `GET /api/fundraising/status`
  - 获取爬虫运行状态

## 自动化任务

- 每日凌晨 5 点自动更新最新数据
- 服务启动时自动恢复未完成的全量爬取
- 定期清理过期的错误日志

## 注意事项

1. 请合理设置爬取频率，避免对目标站点造成压力
2. 建议定期备份 SQLite 数据库文件
3. 在生产环境部署时，请修改 `.env` 配置文件
4. 确保服务器有足够的磁盘空间存储数据

## 格式化
- Shift + Option + F

## 许可证

MIT License
