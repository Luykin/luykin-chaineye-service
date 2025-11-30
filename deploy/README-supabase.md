# Supabase Docker Compose 部署说明

## 概述

这个 docker-compose 文件配置了完整的 Supabase 本地开发环境，连接到您的外部 PostgreSQL 数据库。

## 前置要求

1. Docker 和 Docker Compose 已安装
2. 外部 PostgreSQL 数据库可访问
3. 数据库需要创建 Supabase 所需的 schema 和角色

## 快速开始

### 1. 在 .env-pro 文件中添加以下环境变量

```bash
# Supabase 配置
SUPABASE_JWT_SECRET=your-super-secret-jwt-token-with-at-least-32-characters-long-change-this
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU

# Supabase 服务端口配置
SUPABASE_KONG_PORT=8062  # 外网访问端口（API Gateway）
SUPABASE_KONG_HTTPS_PORT=8443
SUPABASE_STUDIO_PORT=3000
SUPABASE_GOTRUE_PORT=9999
SUPABASE_REALTIME_PORT=4000
SUPABASE_STORAGE_PORT=5000
SUPABASE_META_PORT=8080
SUPABASE_FUNCTIONS_PORT=9000

# Supabase 应用配置
SUPABASE_SITE_URL=http://localhost:8062
SUPABASE_PUBLIC_URL=http://localhost:8062
SUPABASE_URI_ALLOW_LIST=http://localhost:3000,http://localhost:8080
SUPABASE_DISABLE_SIGNUP=false
SUPABASE_JWT_EXP=3600

# Supabase 邮件配置（可选）
SUPABASE_EXTERNAL_EMAIL_ENABLED=true
SUPABASE_MAILER_AUTOCONFIRM=false
SUPABASE_SMTP_ADMIN_EMAIL=admin@example.com
SUPABASE_SMTP_HOST=smtp.gmail.com
SUPABASE_SMTP_PORT=587
SUPABASE_SMTP_USER=
SUPABASE_SMTP_PASS=
SUPABASE_SMTP_SENDER_NAME=Supabase
SUPABASE_MAILER_URLPATH=/auth/v1/verify

# Supabase 存储配置
SUPABASE_STORAGE_FILE_SIZE_LIMIT=52428800
SUPABASE_STORAGE_REGION=stub
SUPABASE_IMGPROXY_ENABLE_WEBP_DETECTION=true

# Supabase 组织配置
SUPABASE_DEFAULT_ORG_NAME=Default Organization
SUPABASE_DEFAULT_PROJECT_NAME=Default Project

# Supabase Studio 中文语言配置
SUPABASE_STUDIO_DEFAULT_LOCALE=zh-CN
SUPABASE_BROWSER_LOCALE=zh-CN
SUPABASE_DEFAULT_LOCALE=zh-CN
```

### 2. 初始化数据库 Schema

在连接到外部数据库之前，需要运行 Supabase 的数据库迁移脚本。您可以使用 Supabase CLI 或手动执行 SQL 脚本。

**重要**: 需要创建以下角色和 schema：
- `anon` 角色（匿名用户）
- `authenticated` 角色（认证用户）
- `service_role` 角色（服务角色）
- `realtime` schema
- `storage` schema
- `graphql_public` schema

### 3. 启动服务

```bash
cd deploy
docker-compose -f docker-compose.supabase.yml --env-file ../.env-pro up -d
```

### 4. 访问服务

- **Supabase Studio (管理界面，中文)**: http://localhost:3000
- **Kong API Gateway (外网访问入口)**: http://localhost:8062
- **PostgREST API**: http://localhost:8062/rest/v1
- **GoTrue Auth**: http://localhost:8062/auth/v1
- **Realtime**: ws://localhost:4000
- **Storage**: http://localhost:8062/storage/v1

## 服务说明

### Kong (API Gateway)
- 端口: 8062 (HTTP，外网访问), 8443 (HTTPS)
- 作用: 统一入口，路由所有 API 请求

### PostgREST
- 端口: 3000 (内部)
- 作用: 自动为 PostgreSQL 数据库生成 REST API

### GoTrue
- 端口: 9999
- 作用: 用户认证和授权服务

### Realtime
- 端口: 4000
- 作用: WebSocket 实时数据同步

### Storage
- 端口: 5000
- 作用: 文件存储服务

### Studio
- 端口: 3000
- 作用: Supabase 管理界面

### Meta
- 端口: 8080
- 作用: 数据库元数据管理

### Functions
- 端口: 9000
- 作用: Edge Functions 运行时

## 必须修改的配置项

### 1. SUPABASE_JWT_SECRET ⚠️ **最重要**
```bash
SUPABASE_JWT_SECRET=your-super-secret-jwt-token-with-at-least-32-characters-long-change-this
```
**必须修改**: 这是 JWT 签名密钥，用于生成和验证访问令牌。请使用一个至少 32 个字符的强随机字符串。

### 2. SUPABASE_ANON_KEY 和 SUPABASE_SERVICE_KEY
这些密钥需要与 `SUPABASE_JWT_SECRET` 匹配。您可以使用 Supabase CLI 生成：
```bash
npx supabase gen keys
```

### 3. 数据库连接配置
确保 `.env-pro` 中的数据库配置正确：
- `PG_HOST`
- `PG_PORT`
- `PG_DATABASE`
- `PG_USERNAME`
- `PG_PASSWORD`

### 4. SUPABASE_SITE_URL 和 SUPABASE_PUBLIC_URL
根据您的实际部署环境修改（默认已设置为 8062 端口）：
```bash
SUPABASE_SITE_URL=http://localhost:8062  # 或您的实际域名
SUPABASE_PUBLIC_URL=http://localhost:8062
```

### 5. 中文语言配置（已默认设置）
Studio 界面已默认设置为中文，如需修改：
```bash
SUPABASE_STUDIO_DEFAULT_LOCALE=zh-CN
SUPABASE_BROWSER_LOCALE=zh-CN
SUPABASE_DEFAULT_LOCALE=zh-CN
```

### 6. SUPABASE_URI_ALLOW_LIST
添加您的前端应用 URL：
```bash
SUPABASE_URI_ALLOW_LIST=http://localhost:3000,https://your-frontend.com
```

### 7. 邮件配置（如果使用邮件功能）
```bash
SUPABASE_SMTP_HOST=smtp.gmail.com
SUPABASE_SMTP_PORT=587
SUPABASE_SMTP_USER=your-email@gmail.com
SUPABASE_SMTP_PASS=your-app-password
```

## 数据库初始化

在使用 Supabase 之前，需要初始化数据库。推荐使用 Supabase CLI：

```bash
# 安装 Supabase CLI
npm install -g supabase

# 初始化项目
supabase init

# 链接到您的数据库
supabase db remote set postgres://luykin:wtf.0813@150.5.158.179:5432/luykindatabase

# 应用迁移
supabase db remote commit
```

或者，您可以手动执行 SQL 脚本来创建必要的 schema 和角色。

## 故障排查

### 1. 数据库连接失败
- 检查数据库是否可访问
- 验证防火墙设置
- 确认数据库用户权限

### 2. 服务无法启动
- 检查端口是否被占用
- 查看日志: `docker-compose -f docker-compose.supabase.yml logs [service-name]`

### 3. JWT 验证失败
- 确保 `SUPABASE_JWT_SECRET` 在所有服务中一致
- 重新生成 `ANON_KEY` 和 `SERVICE_KEY`

## 停止服务

```bash
docker-compose -f docker-compose.supabase.yml down
```

## 清理数据

```bash
docker-compose -f docker-compose.supabase.yml down -v
```

