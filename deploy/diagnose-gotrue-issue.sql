-- 诊断 GoTrue 问题的脚本
-- 检查数据库连接、权限和表结构

-- 1. 检查 auth schema 是否存在
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') 
        THEN '✓ auth schema 存在'
        ELSE '✗ auth schema 不存在'
    END as auth_schema_status;

-- 2. 检查 auth.users 表是否存在
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'auth' 
            AND table_name = 'users'
        )
        THEN '✓ auth.users 表存在'
        ELSE '✗ auth.users 表不存在（GoTrue 需要运行迁移）'
    END as users_table_status;

-- 3. 检查数据库用户的权限
SELECT 
    r.rolname as role_name,
    CASE 
        WHEN has_schema_privilege(r.rolname, 'auth', 'USAGE') THEN '✓'
        ELSE '✗'
    END as has_usage,
    CASE 
        WHEN has_schema_privilege(r.rolname, 'auth', 'CREATE') THEN '✓'
        ELSE '✗'
    END as has_create,
    CASE 
        WHEN has_schema_privilege(r.rolname, 'auth', 'ALL') THEN '✓'
        ELSE '✗'
    END as has_all
FROM pg_roles r
WHERE r.rolname IN ('luykin', 'postgres', 'supabase_admin', 'anon', 'authenticated', 'service_role')
ORDER BY r.rolname;

-- 4. 如果 auth.users 表存在，显示表结构
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' 
        AND table_name = 'users'
    ) THEN
        RAISE NOTICE 'auth.users 表结构:';
    ELSE
        RAISE NOTICE 'auth.users 表不存在';
    END IF;
END
$$;

-- 5. 显示 auth schema 中的所有表
SELECT 
    schemaname,
    tablename,
    CASE 
        WHEN rowsecurity THEN 'RLS 启用'
        ELSE 'RLS 禁用'
    END as rls_status
FROM pg_tables 
WHERE schemaname = 'auth'
ORDER BY tablename;

-- 6. 检查是否有必要的扩展
SELECT 
    extname as extension_name,
    CASE 
        WHEN extname IN ('uuid-ossp', 'pgcrypto') THEN '✓ 必需'
        ELSE '可选'
    END as status
FROM pg_extension
WHERE extname IN ('uuid-ossp', 'pgcrypto', 'pg_trgm', 'btree_gin', 'btree_gist')
ORDER BY extname;

