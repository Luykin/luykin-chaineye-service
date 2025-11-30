-- 修复 auth schema 的权限问题
-- 解决 "permission denied for schema auth" 错误

-- 1. 确保 auth schema 存在
CREATE SCHEMA IF NOT EXISTS auth;

-- 2. 为 supabase_admin 授予 auth schema 的所有权限
GRANT ALL ON SCHEMA auth TO supabase_admin;
GRANT USAGE ON SCHEMA auth TO supabase_admin;

-- 3. 为所有角色授予 auth schema 的权限
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, postgres;
GRANT ALL ON SCHEMA auth TO anon, authenticated, service_role, postgres, supabase_admin;

-- 4. 为 auth schema 中的所有现有表授予权限
DO $$
DECLARE
    r RECORD;
BEGIN
    -- 遍历 auth schema 中的所有表
    FOR r IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'auth'
    LOOP
        -- 授予表权限
        EXECUTE format('GRANT ALL PRIVILEGES ON TABLE auth.%I TO anon, authenticated, service_role, postgres, supabase_admin', r.tablename);
        
        RAISE NOTICE '已处理 auth schema 表: %', r.tablename;
    END LOOP;
END
$$;

-- 5. 为 auth schema 中的所有现有序列授予权限
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO anon, authenticated, service_role, postgres, supabase_admin;

-- 6. 为 auth schema 中的所有现有函数授予权限
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role, postgres, supabase_admin;

-- 7. 设置 auth schema 的默认权限（影响新创建的对象）
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO anon, authenticated, service_role, postgres, supabase_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, postgres, supabase_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role, postgres, supabase_admin;

-- 8. 显示 auth schema 中的表（用于验证）
SELECT 
    schemaname,
    tablename,
    CASE 
        WHEN rowsecurity THEN 'RLS 已启用'
        ELSE 'RLS 已禁用'
    END as rls_status
FROM pg_tables t
LEFT JOIN pg_class c ON c.relname = t.tablename
LEFT JOIN pg_namespace n ON n.nspname = t.schemaname AND c.relnamespace = n.oid
WHERE schemaname = 'auth'
ORDER BY tablename;

-- 9. 验证权限（显示当前用户对 auth schema 的权限）
SELECT 
    nspname as schema_name,
    nspacl as permissions
FROM pg_namespace
WHERE nspname = 'auth';

