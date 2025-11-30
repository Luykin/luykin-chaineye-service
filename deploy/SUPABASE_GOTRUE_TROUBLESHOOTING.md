# GoTrue 创建用户失败故障排查

## 错误信息
```
Failed to create user: API error happened while trying to communicate with the server
{"error":{"message":"{}"}}
```

## 可能的原因

1. **auth.users 表不存在** - GoTrue 需要运行数据库迁移来创建表
2. **数据库权限不足** - 数据库用户没有创建表的权限
3. **GoTrue 服务未正确启动** - 检查服务日志
4. **数据库连接问题** - GoTrue 无法连接到数据库

## 排查步骤

### 步骤 1: 检查 GoTrue 服务日志

```bash
cd deploy
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro logs gotrue --tail 100
```

查看是否有错误信息，特别是：
- 数据库连接错误
- 迁移错误
- 权限错误

### 步骤 2: 检查数据库状态

执行诊断脚本：

```bash
psql -h 150.5.158.179 -U luykin -d luykindatabase -f diagnose-gotrue-issue.sql
```

### 步骤 3: 确保权限正确

执行权限修复脚本：

```bash
psql -h 150.5.158.179 -U luykin -d luykindatabase -f fix-gotrue-auth-users.sql
```

### 步骤 4: 重启 GoTrue 服务

```bash
cd deploy
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro restart gotrue
```

等待几秒钟，然后检查日志：

```bash
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro logs gotrue --tail 50
```

### 步骤 5: 验证 auth.users 表

```bash
psql -h 150.5.158.179 -U luykin -d luykindatabase -c "SELECT COUNT(*) FROM auth.users;"
```

如果表不存在，GoTrue 应该会自动创建（如果 `GOTRUE_DB_AUTOMIGRATE=true`）。

## 手动创建 auth.users 表（如果自动迁移失败）

如果 GoTrue 无法自动创建表，可以手动运行 GoTrue 的迁移。但最简单的方法是确保：

1. 数据库用户有 `auth` schema 的创建权限
2. GoTrue 配置了 `GOTRUE_DB_AUTOMIGRATE=true`
3. 重启 GoTrue 服务

## 常见问题

### 问题 1: "permission denied for schema auth"

**解决方案**: 执行 `fix-gotrue-auth-users.sql` 脚本

### 问题 2: "relation auth.users does not exist"

**解决方案**: 
- 确保 `GOTRUE_DB_AUTOMIGRATE=true` 已设置
- 重启 GoTrue 服务
- 检查 GoTrue 日志确认迁移是否成功

### 问题 3: GoTrue 日志显示连接错误

**解决方案**:
- 检查数据库连接字符串是否正确
- 确认数据库可以从容器网络访问
- 检查防火墙设置

## 验证修复

修复后，尝试在 Studio 中创建用户。如果仍然失败：

1. 查看 GoTrue 日志获取详细错误
2. 检查数据库中的 `auth.users` 表是否存在
3. 验证数据库用户权限

