-- 检查 GoTrue 表结构和数据

-- 1. 检查 auth.users 表是否存在
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'auth' 
            AND table_name = 'users'
        )
        THEN '✓ auth.users 表存在'
        ELSE '✗ auth.users 表不存在'
    END as users_table_status;

-- 2. 检查 auth.identities 表是否存在
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'auth' 
            AND table_name = 'identities'
        )
        THEN '✓ auth.identities 表存在'
        ELSE '✗ auth.identities 表不存在'
    END as identities_table_status;

-- 3. 显示 auth.users 表的所有列
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'auth' 
AND table_name = 'users'
ORDER BY ordinal_position;

-- 4. 显示 auth.identities 表的所有列
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'auth' 
AND table_name = 'identities'
ORDER BY ordinal_position;

-- 5. 检查表中的数据
SELECT COUNT(*) as users_count FROM auth.users;
SELECT COUNT(*) as identities_count FROM auth.identities;

-- 6. 检查权限
SELECT 
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'auth' 
AND table_name = 'users'
ORDER BY grantee, privilege_type;

