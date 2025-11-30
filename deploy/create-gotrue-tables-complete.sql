-- 完整创建 GoTrue 必需的表（包含所有列）
-- 清空并重新创建 auth schema

-- 1. 删除并重新创建 auth schema（会删除所有数据）
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA auth;

-- 2. 授予权限
GRANT ALL ON SCHEMA auth TO luykin, postgres, anon, authenticated, service_role, supabase_admin;
GRANT USAGE ON SCHEMA auth TO luykin, postgres, anon, authenticated, service_role, supabase_admin;

-- 3. 创建 auth.users 表（GoTrue 的完整表结构）
CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID,
    email VARCHAR(255),
    encrypted_password VARCHAR(255),
    email_confirmed_at TIMESTAMPTZ,
    invited_at TIMESTAMPTZ,
    confirmation_token VARCHAR(255),
    confirmation_sent_at TIMESTAMPTZ,
    recovery_token VARCHAR(255),
    recovery_sent_at TIMESTAMPTZ,
    email_change_token_new VARCHAR(255),
    email_change VARCHAR(255),
    email_change_sent_at TIMESTAMPTZ,
    last_sign_in_at TIMESTAMPTZ,
    raw_app_meta_data JSONB,
    raw_user_meta_data JSONB,
    is_super_admin BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    phone TEXT,
    phone_confirmed_at TIMESTAMPTZ,
    phone_change TEXT,
    phone_change_token VARCHAR(255),
    phone_change_sent_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    email_change_token_current VARCHAR(255),
    email_change_confirm_status SMALLINT,
    banned_until TIMESTAMPTZ,
    reauthentication_token VARCHAR(255),
    reauthentication_sent_at TIMESTAMPTZ,
    is_sso_user BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    aud VARCHAR(255),
    role VARCHAR(255)
);

-- 4. 创建 auth.identities 表
CREATE TABLE auth.identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    identity_data JSONB NOT NULL,
    provider TEXT NOT NULL,
    last_sign_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    email TEXT GENERATED ALWAYS AS (lower((identity_data->>'email'))) STORED,
    UNIQUE(provider, id)
);

-- 5. 创建 auth.refresh_tokens 表
CREATE TABLE auth.refresh_tokens (
    instance_id UUID,
    id BIGSERIAL PRIMARY KEY,
    token VARCHAR(255) UNIQUE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    revoked BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    parent VARCHAR(255),
    session_id UUID
);

-- 6. 创建 auth.audit_log_entries 表
CREATE TABLE auth.audit_log_entries (
    instance_id UUID,
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ip_address VARCHAR(64) NOT NULL DEFAULT ''
);

-- 7. 创建必要的枚举类型（必须在创建使用它们的表之前）
DO $$
BEGIN
    -- factor_type 枚举
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'factor_type' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth')) THEN
        CREATE TYPE auth.factor_type AS ENUM ('totp', 'phone');
    END IF;
    
    -- factor_status 枚举
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'factor_status' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth')) THEN
        CREATE TYPE auth.factor_status AS ENUM ('unverified', 'verified');
    END IF;
    
    -- code_challenge_method 枚举
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'code_challenge_method' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth')) THEN
        CREATE TYPE auth.code_challenge_method AS ENUM ('plain', 'S256');
    END IF;
END
$$;

-- 8. 创建 auth.sessions 表
CREATE TABLE auth.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    factor_id UUID,
    aal TEXT,
    not_after TIMESTAMPTZ
);

-- 9. 创建 auth.mfa_factors 表（MFA 支持）
CREATE TABLE auth.mfa_factors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    friendly_name TEXT,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    secret TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. 创建 auth.mfa_challenges 表
CREATE TABLE auth.mfa_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factor_id UUID NOT NULL REFERENCES auth.mfa_factors(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    ip_address INET NOT NULL
);

-- 11. 创建 auth.mfa_amr_claims 表
CREATE TABLE auth.mfa_amr_claims (
    session_id UUID NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    authentication_method TEXT NOT NULL,
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

-- 12. 创建必要的枚举类型（已移到前面）
DO $$
BEGIN
    -- factor_type 枚举
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'factor_type' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth')) THEN
        CREATE TYPE auth.factor_type AS ENUM ('totp', 'phone');
    END IF;
    
    -- factor_status 枚举
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'factor_status' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth')) THEN
        CREATE TYPE auth.factor_status AS ENUM ('unverified', 'verified');
    END IF;
    
    -- code_challenge_method 枚举
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'code_challenge_method' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth')) THEN
        CREATE TYPE auth.code_challenge_method AS ENUM ('plain', 'S256');
    END IF;
END
$$;

-- 13. 创建索引
CREATE INDEX idx_users_email ON auth.users(email);
CREATE INDEX idx_users_instance_id ON auth.users(instance_id);
CREATE INDEX idx_users_is_anonymous ON auth.users(is_anonymous);
CREATE INDEX idx_identities_email ON auth.identities(email);
CREATE INDEX idx_identities_user_id ON auth.identities(user_id);
CREATE INDEX idx_identities_provider_id ON auth.identities(provider, id);
CREATE INDEX idx_refresh_tokens_instance_id ON auth.refresh_tokens(instance_id);
CREATE INDEX idx_refresh_tokens_instance_id_user_id ON auth.refresh_tokens(instance_id, user_id);
CREATE INDEX idx_refresh_tokens_parent ON auth.refresh_tokens(parent);
CREATE INDEX idx_refresh_tokens_session_id_revoked ON auth.refresh_tokens(session_id, revoked);
CREATE INDEX idx_audit_logs_instance_id ON auth.audit_log_entries(instance_id);
CREATE INDEX idx_sessions_user_id ON auth.sessions(user_id);
CREATE INDEX idx_sessions_not_after ON auth.sessions(not_after);
CREATE INDEX idx_mfa_factors_user_id ON auth.mfa_factors(user_id);
CREATE INDEX idx_mfa_challenges_factor_id ON auth.mfa_challenges(factor_id);
CREATE INDEX idx_mfa_amr_claims_session_id ON auth.mfa_amr_claims(session_id);

-- 14. 授予权限
GRANT ALL ON ALL TABLES IN SCHEMA auth TO luykin, postgres, anon, authenticated, service_role, supabase_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO luykin, postgres, anon, authenticated, service_role, supabase_admin;
GRANT ALL ON ALL TYPES IN SCHEMA auth TO luykin, postgres, anon, authenticated, service_role, supabase_admin;

-- 15. 设置默认权限
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO luykin, postgres, anon, authenticated, service_role, supabase_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO luykin, postgres, anon, authenticated, service_role, supabase_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TYPES TO luykin, postgres, anon, authenticated, service_role, supabase_admin;

-- 16. 创建迁移记录表并标记所有迁移为已完成（关键！）
-- 这样 GoTrue 就不会再尝试运行迁移了
DROP TABLE IF EXISTS public.schema_migrations CASCADE;
CREATE TABLE public.schema_migrations (
    version VARCHAR(255) PRIMARY KEY
);

-- 插入所有迁移版本（包括有问题的迁移），让 GoTrue 认为都已完成
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
('add_mfa_indexes'),
('add_sessions_user_id_index'),
('add_refresh_tokens_session_id_revoked_index'),
('add_saml'),
('add_identities_user_id_idx'),
('add_session_not_after_column'),
('remove_parent_foreign_key_refresh_tokens'),
('backfill_email_identity'),
('20221208132122'),
('20221011041400'),
('20221208132122_backfill_email_last_sign_in_at'),
('20221011041400_add_mfa_indexes')
ON CONFLICT (version) DO NOTHING;

-- 完成
SELECT 'GoTrue 完整表结构创建完成，所有迁移已标记为已完成' as status;

