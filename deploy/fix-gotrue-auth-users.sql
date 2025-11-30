-- 修复 GoTrue 无法访问 auth.users 表的问题
-- 解决 "Database error checking email" 错误

-- 1. 确保 auth schema 存在
CREATE SCHEMA IF NOT EXISTS auth;

-- 2. 为数据库用户授予 auth schema 的所有权限（GoTrue 需要创建表）
-- 注意：请将 'luykin' 替换为您的实际数据库用户名
GRANT ALL ON SCHEMA auth TO luykin;
GRANT USAGE ON SCHEMA auth TO luykin;

-- 3. 为所有角色授予 auth schema 权限
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, postgres, supabase_admin;
GRANT ALL ON SCHEMA auth TO anon, authenticated, service_role, postgres, supabase_admin;

-- 4. 检查 auth.users 表是否存在
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' 
        AND table_name = 'users'
    ) THEN
        RAISE NOTICE 'auth.users 表不存在，GoTrue 将在首次启动时自动创建';
    ELSE
        RAISE NOTICE 'auth.users 表已存在';
    END IF;
END
$$;

-- 5. 如果 auth.users 表已存在，授予权限
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' 
        AND table_name = 'users'
    ) THEN
        -- 授予表权限
        GRANT ALL PRIVILEGES ON TABLE auth.users TO anon, authenticated, service_role, postgres, supabase_admin;
        
        -- 授予序列权限（如果有）
        GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO anon, authenticated, service_role, postgres, supabase_admin;
        
        RAISE NOTICE '已为 auth.users 表授予权限';
    END IF;
END
$$;

-- 6. 为 auth schema 中的所有现有表授予权限
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'auth'
    LOOP
        EXECUTE format('GRANT ALL PRIVILEGES ON TABLE auth.%I TO anon, authenticated, service_role, postgres, supabase_admin', r.tablename);
        RAISE NOTICE '已处理 auth schema 表: %', r.tablename;
    END LOOP;
END
$$;

-- 7. 设置 auth schema 的默认权限
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO anon, authenticated, service_role, postgres, supabase_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, postgres, supabase_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role, postgres, supabase_admin;

-- 8. 显示 auth schema 中的表（用于验证）
SELECT 
    schemaname,
    tablename
FROM pg_tables 
WHERE schemaname = 'auth'
ORDER BY tablename;

-- 9. 验证权限
SELECT 
    nspname as schema_name,
    nspacl as permissions
FROM pg_namespace
WHERE nspname = 'auth';

