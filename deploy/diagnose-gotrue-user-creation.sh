#!/bin/bash
# 诊断 GoTrue 创建用户问题

echo "=== 检查 GoTrue 服务状态 ==="
cd deploy
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro ps gotrue

echo ""
echo "=== 查看 GoTrue 最近日志 ==="
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro logs gotrue --tail 50

echo ""
echo "=== 检查 auth.users 表是否存在 ==="
echo "执行: SELECT COUNT(*) FROM auth.users;"
echo "请在数据库中执行上述 SQL 查询"

echo ""
echo "=== 检查 auth.identities 表是否存在 ==="
echo "执行: SELECT COUNT(*) FROM auth.identities;"
echo "请在数据库中执行上述 SQL 查询"

echo ""
echo "=== 测试 GoTrue API 健康检查 ==="
echo "执行: curl http://localhost:9999/health"
echo "或者: curl http://150.5.158.179:9999/health"

echo ""
echo "=== 检查 GoTrue 配置 ==="
echo "查看环境变量配置..."
docker compose -f docker-compose.supabase.yml --env-file ../.env-pro config | grep -A 20 "gotrue:"

