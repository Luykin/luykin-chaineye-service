-- 修复 gotrue 迁移问题：创建缺失的 factor_type 类型
-- 这个类型应该在更早的迁移中创建，但如果缺失会导致后续迁移失败

-- 创建 factor_type 枚举类型（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'factor_type' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth')) THEN
        CREATE TYPE auth.factor_type AS ENUM ('totp', 'phone');
    END IF;
END
$$;

