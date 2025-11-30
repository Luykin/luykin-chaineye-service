-- 简单创建 GoTrue 必需的表（跳过有问题的迁移）
-- 清空并重新创建 auth schema

-- 1. 删除并重新创建 auth schema（会删除所有数据）
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA auth;

-- 2. 授予权限
GRANT ALL ON SCHEMA auth TO luykin, postgres, anon, authenticated, service_role, supabase_admin;
GRANT USAGE ON SCHEMA auth TO luykin, postgres, anon, authenticated, service_role, supabase_admin;

-- 3. 创建 auth.users 表（GoTrue 的核心表）
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
    deleted_at TIMESTAMPTZ
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
    email TEXT GENERATED ALWAYS AS (lower((identity_data->>'email'))) STORED
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

-- 7. 创建 auth.sessions 表
CREATE TABLE auth.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    factor_id UUID,
    aal TEXT,
    not_after TIMESTAMPTZ
);

-- 8. 创建索引
CREATE INDEX idx_users_email ON auth.users(email);
CREATE INDEX idx_users_instance_id ON auth.users(instance_id);
CREATE INDEX idx_identities_email ON auth.identities(email);
CREATE INDEX idx_identities_user_id ON auth.identities(user_id);
CREATE INDEX idx_refresh_tokens_instance_id ON auth.refresh_tokens(instance_id);
CREATE INDEX idx_refresh_tokens_instance_id_user_id ON auth.refresh_tokens(instance_id, user_id);
CREATE INDEX idx_refresh_tokens_parent ON auth.refresh_tokens(parent);
CREATE INDEX idx_refresh_tokens_session_id_revoked ON auth.refresh_tokens(session_id, revoked);
CREATE INDEX idx_audit_logs_instance_id ON auth.audit_log_entries(instance_id);
CREATE INDEX idx_sessions_user_id ON auth.sessions(user_id);
CREATE INDEX idx_sessions_not_after ON auth.sessions(not_after);

-- 9. 授予权限
GRANT ALL ON ALL TABLES IN SCHEMA auth TO luykin, postgres, anon, authenticated, service_role, supabase_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO luykin, postgres, anon, authenticated, service_role, supabase_admin;

-- 10. 设置默认权限
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO luykin, postgres, anon, authenticated, service_role, supabase_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO luykin, postgres, anon, authenticated, service_role, supabase_admin;

-- 11. 清空迁移记录（让 GoTrue 认为没有迁移需要运行）
DROP TABLE IF EXISTS public.schema_migrations;
CREATE TABLE public.schema_migrations (
    version VARCHAR(255) PRIMARY KEY
);

-- 完成
SELECT 'GoTrue 表创建完成' as status;

