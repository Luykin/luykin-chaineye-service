# Directus Docker 部署指南

本文档说明如何使用 `deploy/docker-compose.directus.yml` 在本地或服务器上快速拉起 Directus，并整理常见问题。

## 环境准备
- **Docker / Docker Compose**：推荐 Docker Engine ≥ 24、Compose V2。
- **配置文件**：建议在仓库根目录创建 `.env-directus`（或直接写入系统环境变量）。
- **开放端口**：默认映射 `8055`，如需对公网服务请在防火墙及安全组中放行。

## 快速开始
1. 复制示例环境变量（可按需调整值）：
   ```bash
   cd /Users/luykin/Documents/mac-work/luykin-chaineye-service
   cat > .env-directus <<'EOF'
   DIRECTUS_KEY=changeme-key
   DIRECTUS_SECRET=changeme-secret
   DIRECTUS_ADMIN_EMAIL=admin@example.com
   DIRECTUS_ADMIN_PASSWORD=ChangeMe123!
   DIRECTUS_PUBLIC_URL=https://directus.example.com
   DIRECTUS_DB_NAME=directus
   DIRECTUS_DB_USER=directus
   DIRECTUS_DB_PASSWORD=SuperSecretPwd
   DIRECTUS_PORT=8055
   EOF
   ```
2. 载入环境变量并启动：
   ```bash
   cd /Users/luykin/Documents/mac-work/luykin-chaineye-service
   env $(cat .env-directus | xargs) docker compose -f deploy/docker-compose.directus.yml up -d
   ```
3. 浏览器访问 `http://<服务器IP>:8055`（或 `DIRECTUS_PUBLIC_URL` 对应地址），使用前一步设置的管理员账号登陆。

## 目录与数据持久化
- `directus-db-data`：Postgres 数据
- `directus-uploads`：上传的文件
- `directus-extensions`：自定义扩展
- `directus-redis-data`：Redis 数据（当前配置只在容器运行时使用，可按需启用持久化）

迁移服务器时只需备份这些 Docker 卷即可恢复。

## 常见操作
- **查看日志**：`docker compose -f deploy/docker-compose.directus.yml logs -f directus`
- **更新 Directus**：修改 compose 文件中的镜像版本，执行 `docker compose pull && docker compose up -d`
- **导出数据库**：`docker exec -t $(docker ps -qf name=directus-db) pg_dump -U $DIRECTUS_DB_USER $DIRECTUS_DB_NAME > backup.sql`
- **进入 Directus 容器**：`docker exec -it $(docker ps -qf name=directus) sh`

## 常见问题
| 问题 | 解决方案 |
| --- | --- |
| 无法访问 8055 端口 | 检查服务器安全组/防火墙、Nginx 反向代理配置，以及 `DIRECTUS_PORT` 是否被正确映射 |
| 管理员账号未创建 | 确认首次启动前 `DIRECTUS_ADMIN_EMAIL/PASSWORD` 已设置，并删除 `directus-db-data` 卷后重新启动 |
| Redis 连接失败 | 确认 `directus-redis` 服务正常运行，或修改 `REDIS` 环境变量指向外部 Redis |
| 上传文件 404 | 确认 `directus-uploads` 卷存在并且挂载权限正确，且 Nginx 代理时是否转发 `Content-Length`、`Content-Type` 等头 |

## 与现有 Nginx 的集成
可以在 `nginx/kb.cryptohunt.ai.conf`（或其他站点配置）中新增 `location`，通过域名访问 Directus。例如：
```
location /directus/ {
    proxy_pass http://127.0.0.1:8055/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
如需独立域名，可在 `server {}` 块中新增 `server_name directus.example.com;` 并将 `location /` 代理到 `http://127.0.0.1:8055`。

