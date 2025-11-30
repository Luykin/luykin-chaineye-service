-- 添加缺失的 aud 列到 auth.users 表
-- 错误：column users.aud does not exist

ALTER TABLE auth.users 
ADD COLUMN IF NOT EXISTS aud VARCHAR(255);

-- 验证
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'auth' 
AND table_name = 'users'
AND column_name = 'aud';

