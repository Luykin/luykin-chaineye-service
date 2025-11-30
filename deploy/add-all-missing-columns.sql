-- 一次性添加所有 GoTrue 可能需要的缺失列
-- 基于错误日志添加：aud, role 等

-- 添加 aud 列
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS aud VARCHAR(255);

-- 添加 role 列
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role VARCHAR(255);

-- 验证
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'auth' 
AND table_name = 'users'
AND column_name IN ('aud', 'role')
ORDER BY column_name;

