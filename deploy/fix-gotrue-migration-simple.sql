-- 简单修复 GoTrue 迁移错误
-- 直接修复迁移脚本中的 SQL 问题并标记迁移为完成

-- 1. 修复迁移脚本中的 SQL 问题
-- 原错误：id = user_id::text (uuid = text 类型不匹配)
-- 修复：id::text = user_id::text

DO $$
DECLARE
    updated_count integer;
BEGIN
    -- 执行修复后的迁移逻辑
    UPDATE auth.identities
    SET last_sign_in_at = '2022-11-25'::timestamp
    WHERE
        last_sign_in_at IS NULL AND
        created_at = '2022-11-25'::timestamp AND
        updated_at = '2022-11-25'::timestamp AND
        provider = 'email' AND
        id::text = user_id::text;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE '已更新 % 条记录', updated_count;
END
$$;

-- 2. 标记迁移为已完成（GoTrue 使用 pop 迁移系统）
-- 检查并创建 schema_migrations 表（如果不存在）
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version VARCHAR(255) PRIMARY KEY
);

-- 插入迁移记录（如果不存在）
INSERT INTO public.schema_migrations (version)
VALUES ('20221208132122')
ON CONFLICT (version) DO NOTHING;

-- 3. 验证
SELECT 
    '迁移修复完成' as status,
    version as completed_migration
FROM public.schema_migrations
WHERE version = '20221208132122';

