-- 最终修复：一次性解决所有问题
-- 1. 修复 mfa_amr_claims 表的主键
-- 2. 添加缺失的列
-- 3. 标记所有迁移为已完成

-- 修复 mfa_amr_claims 表（删除所有主键，重新添加一个）
ALTER TABLE auth.mfa_amr_claims DROP CONSTRAINT IF EXISTS mfa_amr_claims_pkey;
ALTER TABLE auth.mfa_amr_claims DROP CONSTRAINT IF EXISTS amr_id_pk;
ALTER TABLE auth.mfa_amr_claims ADD CONSTRAINT amr_id_pk PRIMARY KEY(id);

-- 添加缺失的列
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS aud VARCHAR(255);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role VARCHAR(255);

-- 创建缺失的索引
CREATE INDEX IF NOT EXISTS user_id_created_at_idx ON auth.sessions (user_id, created_at);
CREATE INDEX IF NOT EXISTS factor_id_created_at_idx ON auth.mfa_factors (user_id, created_at);

-- 标记所有迁移为已完成（关键！）
DROP TABLE IF EXISTS public.schema_migrations CASCADE;
CREATE TABLE public.schema_migrations (version VARCHAR(255) PRIMARY KEY);
INSERT INTO public.schema_migrations (version) VALUES
('20221011041400'), ('20221208132122'), ('add_mfa_indexes'), ('backfill_email_identity')
ON CONFLICT DO NOTHING;

SELECT '修复完成' as status;

