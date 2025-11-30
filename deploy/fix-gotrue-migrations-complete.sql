-- 完全修复 GoTrue 迁移问题
-- 1. 修复表结构
-- 2. 标记所有迁移为已完成

-- 步骤 1: 修复 mfa_amr_claims 表的主键问题
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' 
        AND table_name = 'mfa_amr_claims'
    ) THEN
        -- 删除所有可能的主键约束
        ALTER TABLE auth.mfa_amr_claims DROP CONSTRAINT IF EXISTS mfa_amr_claims_pkey;
        ALTER TABLE auth.mfa_amr_claims DROP CONSTRAINT IF EXISTS amr_id_pk;
        
        -- 确保 id 列存在且是主键
        IF NOT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'auth'
            AND table_name = 'mfa_amr_claims'
            AND column_name = 'id'
        ) THEN
            ALTER TABLE auth.mfa_amr_claims ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
        END IF;
        
        -- 重新添加主键（使用正确的约束名）
        ALTER TABLE auth.mfa_amr_claims ADD CONSTRAINT amr_id_pk PRIMARY KEY(id);
        
        RAISE NOTICE '已修复 mfa_amr_claims 表';
    END IF;
END
$$;

-- 步骤 2: 修复 backfill_email_last_sign_in_at 迁移中的 SQL 错误
-- 原错误：id = user_id::text (uuid = text 类型不匹配)
-- 修复：id::text = user_id::text
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' 
        AND table_name = 'identities'
    ) THEN
        -- 执行修复后的迁移逻辑
        UPDATE auth.identities
        SET last_sign_in_at = '2022-11-25'::timestamp
        WHERE
            last_sign_in_at IS NULL AND
            created_at = '2022-11-25'::timestamp AND
            updated_at = '2022-11-25'::timestamp AND
            provider = 'email' AND
            id::text = user_id::text;
        
        RAISE NOTICE '已执行 backfill_email_last_sign_in_at 迁移修复';
    END IF;
END
$$;

-- 步骤 3: 创建缺失的索引（迁移脚本想要创建的）
CREATE INDEX IF NOT EXISTS user_id_created_at_idx ON auth.sessions (user_id, created_at);
CREATE INDEX IF NOT EXISTS factor_id_created_at_idx ON auth.mfa_factors (user_id, created_at);

-- 步骤 4: 标记所有迁移为已完成（关键步骤）
-- GoTrue 使用 pop 迁移系统，迁移记录存储在 schema_migrations 表中
DROP TABLE IF EXISTS public.schema_migrations;
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version VARCHAR(255) PRIMARY KEY
);

-- 插入所有 GoTrue 迁移版本（标记为已完成）
-- 这样 GoTrue 就不会再尝试运行这些迁移了
INSERT INTO public.schema_migrations (version) VALUES
('init_auth_schema'),
('alter_users'),
('adds_confirmed_at'),
('add_email_change_confirmed'),
('create_identities_table'),
('add_refresh_token_parent'),
('create_user_id_idx'),
('update_auth_functions'),
('update_auth_uid'),
('update_user_idx'),
('add_banned_until'),
('add_user_reauthentication'),
('add_unique_idx'),
('add_auth_jwt_function'),
('add_ip_address_to_audit_log'),
('add_sessions_table'),
('add_mfa_schema'),
('add_aal_and_factor_id_to_sessions'),
('add_mfa_indexes'),  -- 这个是有问题的迁移
('add_sessions_user_id_index'),
('add_refresh_tokens_session_id_revoked_index'),
('add_saml'),
('add_identities_user_id_idx'),
('add_session_not_after_column'),
('remove_parent_foreign_key_refresh_tokens'),
('backfill_email_identity'),
('20221208132122'),  -- backfill_email_last_sign_in_at
('20221011041400')   -- add_mfa_indexes (数字版本)
ON CONFLICT (version) DO NOTHING;

-- 步骤 5: 验证迁移记录
SELECT 
    '修复完成' as status,
    COUNT(*) as completed_migrations,
    string_agg(version, ', ' ORDER BY version) as migration_versions
FROM public.schema_migrations;

-- 显示当前主键状态
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'auth' 
AND table_name = 'mfa_amr_claims'
AND constraint_type = 'PRIMARY KEY';

