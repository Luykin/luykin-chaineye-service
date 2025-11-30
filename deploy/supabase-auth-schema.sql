-- 创建 auth schema（GoTrue 需要）
CREATE SCHEMA IF NOT EXISTS auth;

-- 授予 auth schema 权限
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA auth TO postgres, anon, authenticated, service_role;

-- 授予 auth schema 的默认权限
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;

