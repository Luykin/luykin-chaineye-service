-- 修复 GoTrue 迁移错误
-- 错误：operator does not exist: uuid = text
-- 迁移文件：20221208132122_backfill_email_last_sign_in_at.up.sql

-- 1. 检查 auth.identities 表是否存在
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' 
        AND table_name = 'identities'
    ) THEN
        RAISE EXCEPTION 'auth.identities 表不存在，请先运行其他迁移';
    END IF;
END
$$;

-- 2. 检查表结构
DO $$
DECLARE
    id_type text;
    user_id_type text;
BEGIN
    SELECT data_type INTO id_type
    FROM information_schema.columns
    WHERE table_schema = 'auth' 
    AND table_name = 'identities' 
    AND column_name = 'id';
    
    SELECT data_type INTO user_id_type
    FROM information_schema.columns
    WHERE table_schema = 'auth' 
    AND table_name = 'identities' 
    AND column_name = 'user_id';
    
    RAISE NOTICE 'id 列类型: %, user_id 列类型: %', id_type, user_id_type;
END
$$;

-- 3. 修复迁移脚本（修复类型转换问题）
-- 原脚本有错误：id = user_id::text
-- 应该改为：id::text = user_id::text 或者 id = user_id（如果类型相同）

DO $$
BEGIN
    -- 检查是否有需要更新的记录
    IF EXISTS (
        SELECT 1 FROM auth.identities
        WHERE last_sign_in_at IS NULL 
        AND created_at = '2022-11-25'::timestamp
        AND updated_at = '2022-11-25'::timestamp
        AND provider = 'email'
    ) THEN
        -- 修复后的 SQL：正确处理 UUID 和文本类型的比较
        UPDATE auth.identities
        SET last_sign_in_at = '2022-11-25'::timestamp
        WHERE
            last_sign_in_at IS NULL AND
            created_at = '2022-11-25'::timestamp AND
            updated_at = '2022-11-25'::timestamp AND
            provider = 'email' AND
            id::text = user_id::text;
        
        RAISE NOTICE '已更新 % 条记录', SQL%ROWCOUNT;
    ELSE
        RAISE NOTICE '没有需要更新的记录';
    END IF;
END
$$;

-- 4. 手动标记迁移为已完成（如果使用 schema_migrations 表）
-- 注意：GoTrue 使用 pop 迁移系统，可能需要不同的方法
-- 这里我们尝试在 schema_migrations 表中插入记录

DO $$
BEGIN
    -- 检查 schema_migrations 表是否存在
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'schema_migrations' 
        AND table_name = 'schema_migrations'
    ) THEN
        -- 如果表存在，标记迁移为已完成
        INSERT INTO schema_migrations.schema_migrations (version)
        VALUES ('20221208132122')
        ON CONFLICT (version) DO NOTHING;
        
        RAISE NOTICE '已标记迁移为已完成';
    ELSE
        RAISE NOTICE 'schema_migrations 表不存在，GoTrue 可能使用不同的迁移系统';
    END IF;
END
$$;

-- 5. 检查并标记 GoTrue 的迁移（pop 迁移系统）
-- GoTrue 使用 pop 迁移，迁移记录可能在 schema_migrations 表中
DO $$
BEGIN
    -- 检查 public schema 中的 schema_migrations 表
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'schema_migrations'
    ) THEN
        -- 插入迁移记录（如果不存在）
        INSERT INTO public.schema_migrations (version)
        VALUES ('20221208132122')
        ON CONFLICT DO NOTHING;
        
        RAISE NOTICE '已在 public.schema_migrations 中标记迁移';
    END IF;
    
    -- 检查是否有其他迁移表
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name LIKE '%migration%'
    ) THEN
        RAISE NOTICE '发现其他迁移表，请手动检查';
    END IF;
END
$$;

-- 6. 显示当前迁移状态
SELECT 
    '迁移修复完成' as status,
    (SELECT COUNT(*) FROM auth.identities WHERE last_sign_in_at IS NOT NULL) as identities_with_last_sign_in,
    (SELECT COUNT(*) FROM auth.identities) as total_identities;

