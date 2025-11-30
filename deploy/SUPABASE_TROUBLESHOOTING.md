# Supabase Studio "Failed to load schemas" 故障排查指南

## 错误信息
```
Failed to load schemas

Error: [ { "expected": "string", "code": "invalid_type", "path": [ "formattedError" ], "message": "Invalid input: expected string, received undefined" } ]
```

## 可能的原因

### 1. Meta 服务无法连接到数据库

**检查步骤：**

```bash
# 1. 检查 meta 服务是否运行
cd deploy
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro ps meta

# 2. 查看 meta 服务日志
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro logs meta --tail 50

# 3. 测试 meta 服务健康状态
curl http://localhost:18080/health

# 4. 测试 meta 服务是否能访问数据库
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro exec meta wget -qO- http://localhost:8080/health
```

**如果 meta 服务无法连接数据库，检查：**
- 数据库是否可以从容器网络访问（`150.5.158.179:5432`）
- 数据库用户权限是否正确
- 防火墙是否允许连接

### 2. Studio 无法连接到 Meta 服务

**检查步骤：**

```bash
# 1. 检查 Studio 日志
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro logs studio --tail 50

# 2. 从 Studio 容器内测试 Meta 服务连接
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro exec studio wget -qO- http://meta:8080/health

# 3. 检查网络连接
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro exec studio ping -c 3 meta
```

### 3. 数据库权限问题

**检查步骤：**

```bash
# 连接到数据库检查权限
psql -h 150.5.158.179 -U luykin -d luykindatabase

# 在 psql 中执行：
\du  # 查看所有用户和角色
\dn  # 查看所有 schema
SELECT schema_name FROM information_schema.schemata;  # 列出所有 schema
```

**确保以下角色存在：**
- `anon`
- `authenticated`
- `service_role`
- `postgres`

**确保以下 schema 存在：**
- `public`
- `auth`
- `storage`
- `realtime`
- `graphql_public`

### 4. 环境变量配置问题

**检查 `.env-pro` 文件中的配置：**

```bash
# 确保这些变量都正确设置
cat .env-pro | grep -E "(PG_HOST|PG_PORT|PG_DATABASE|PG_USERNAME|PG_PASSWORD)"
```

## 修复步骤

### 步骤 1: 重启服务（应用新配置）

```bash
cd deploy

# 停止所有服务
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro down

# 重新启动服务
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro up -d

# 等待服务启动（特别是 meta 服务）
sleep 10

# 检查服务状态
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro ps
```

### 步骤 2: 验证 Meta 服务

```bash
# 检查 meta 服务健康状态
curl http://localhost:18080/health

# 应该返回类似：{"status":"ok"} 或 {"healthy":true}
```

### 步骤 3: 验证数据库连接

```bash
# 从 meta 容器内测试数据库连接
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro exec meta \
  sh -c 'PGPASSWORD=$PG_META_DB_PASSWORD psql -h $PG_META_DB_HOST -p $PG_META_DB_PORT -U $PG_META_DB_USER -d $PG_META_DB_NAME -c "SELECT version();"'
```

### 步骤 4: 检查 Studio 连接

```bash
# 查看 Studio 日志，查找错误信息
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro logs studio --tail 100 | grep -i error

# 测试 Studio 到 Meta 的连接
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro exec studio \
  wget -qO- http://meta:8080/health
```

### 步骤 5: 如果问题仍然存在

**手动测试 Meta API：**

```bash
# 获取数据库 schema 列表
curl http://localhost:18080/schemas

# 获取表列表
curl http://localhost:18080/tables

# 如果这些命令失败，说明 meta 服务本身有问题
```

## 常见解决方案

### 方案 1: 确保数据库可访问

如果数据库在外部服务器上，确保：
1. 数据库允许从 Docker 容器网络访问
2. 防火墙规则允许连接
3. PostgreSQL 的 `pg_hba.conf` 配置正确

### 方案 2: 检查数据库用户权限

```sql
-- 连接到数据库
psql -h 150.5.158.179 -U luykin -d luykindatabase

-- 确保用户有足够权限
GRANT ALL PRIVILEGES ON DATABASE luykindatabase TO luykin;
GRANT ALL ON SCHEMA public TO luykin;
GRANT ALL ON SCHEMA auth TO luykin;
GRANT ALL ON SCHEMA storage TO luykin;
GRANT ALL ON SCHEMA realtime TO luykin;
```

### 方案 3: 重新初始化数据库 Schema

如果 schema 不完整，重新运行初始化脚本：

```bash
# 在服务器上执行
psql -h 150.5.158.179 -U luykin -d luykindatabase -f deploy/supabase-init.sql
psql -h 150.5.158.179 -U luykin -d luykindatabase -f deploy/supabase-auth-schema.sql
psql -h 150.5.158.179 -U luykin -d luykindatabase -f deploy/supabase-gotrue-fix.sql
```

### 方案 4: 检查网络连接

```bash
# 从容器内测试数据库连接
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro exec meta \
  sh -c 'nc -zv $PG_META_DB_HOST $PG_META_DB_PORT'
```

## 验证修复

修复后，访问 Studio：
1. 打开浏览器：`http://150.5.158.179:8388`
2. 登录后，应该能看到数据库 schema 列表
3. 尝试查看表数据，应该不再报错

## 如果仍然无法解决

1. **收集日志：**
   ```bash
   docker compose -f docker-compose.supabase.yml --env-file ../.env-pro logs > supabase-logs.txt
   ```

2. **检查所有服务状态：**
   ```bash
   docker compose -f docker-compose.supabase.yml --env-file ../.env-pro ps
   ```

3. **验证环境变量：**
   ```bash
   docker compose -f docker-compose.supabase.yml --env-file ../.env-pro config
   ```

