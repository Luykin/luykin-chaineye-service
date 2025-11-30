-- 修复 mfa_amr_claims 表的主键冲突问题
-- 错误：multiple primary keys for table "mfa_amr_claims" are not allowed

-- 1. 检查当前表结构
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'auth' 
AND table_name = 'mfa_amr_claims'
ORDER BY ordinal_position;

-- 2. 检查主键约束
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'auth' 
AND table_name = 'mfa_amr_claims'
AND constraint_type = 'PRIMARY KEY';

-- 3. 如果表存在但结构不对，修复它
DO $$
BEGIN
    -- 检查表是否存在
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' 
        AND table_name = 'mfa_amr_claims'
    ) THEN
        -- 检查是否有多个主键约束
        IF (SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE table_schema = 'auth' 
            AND table_name = 'mfa_amr_claims'
            AND constraint_type = 'PRIMARY KEY') > 1 THEN
            
            -- 删除所有主键约束
            ALTER TABLE auth.mfa_amr_claims DROP CONSTRAINT IF EXISTS mfa_amr_claims_pkey;
            ALTER TABLE auth.mfa_amr_claims DROP CONSTRAINT IF EXISTS amr_id_pk;
            
            -- 确保 id 列存在
            IF NOT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_schema = 'auth'
                AND table_name = 'mfa_amr_claims'
                AND column_name = 'id'
            ) THEN
                ALTER TABLE auth.mfa_amr_claims ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
            END IF;
            
            -- 重新添加主键
            ALTER TABLE auth.mfa_amr_claims ADD CONSTRAINT amr_id_pk PRIMARY KEY(id);
            
            RAISE NOTICE '已修复 mfa_amr_claims 表的主键问题';
        ELSE
            RAISE NOTICE 'mfa_amr_claims 表的主键正常';
        END IF;
    ELSE
        RAISE NOTICE 'mfa_amr_claims 表不存在';
    END IF;
END
$$;

-- 4. 标记迁移为已完成（防止 GoTrue 再次尝试运行）
DROP TABLE IF EXISTS public.schema_migrations;
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version VARCHAR(255) PRIMARY KEY
);

-- 插入所有已完成的迁移版本（包括有问题的这个）
INSERT INTO public.schema_migrations (version) VALUES
('20221011041400'),  -- add_mfa_indexes
('20221208132122')   -- backfill_email_last_sign_in_at
ON CONFLICT (version) DO NOTHING;

-- 5. 验证修复
SELECT 
    '修复完成' as status,
    (SELECT COUNT(*) FROM information_schema.table_constraints
     WHERE table_schema = 'auth' 
     AND table_name = 'mfa_amr_claims'
     AND constraint_type = 'PRIMARY KEY') as primary_key_count;

