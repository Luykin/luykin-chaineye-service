-- 修复现有表的权限，使其可以在 Supabase Studio Table Editor 中编辑
-- 此脚本会为所有现有表授予必要的权限

-- 1. 为所有现有表授予权限给 anon, authenticated, service_role
DO $$
DECLARE
    r RECORD;
BEGIN
    -- 遍历 public schema 中的所有表
    FOR r IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    LOOP
        -- 授予表权限
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO anon, authenticated, service_role', r.tablename);
        
        -- 授予序列权限（如果有）
        EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role');
        
        -- 禁用 RLS（Row Level Security），如果启用了的话
        -- 注意：如果表需要 RLS，请注释掉下面这行，并手动配置 RLS 策略
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
        
        RAISE NOTICE '已处理表: %', r.tablename;
    END LOOP;
END
$$;

-- 2. 为 supabase_admin 用户授予所有表的权限
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO supabase_admin', r.tablename);
    END LOOP;
END
$$;

-- 3. 授予所有序列的权限
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, supabase_admin;

-- 4. 授予所有函数的权限
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role, supabase_admin;

-- 5. 确保 supabase_admin 有 schema 权限
GRANT ALL ON SCHEMA public TO supabase_admin;

-- 显示处理结果
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
WHERE schemaname = 'public'
ORDER BY tablename;

