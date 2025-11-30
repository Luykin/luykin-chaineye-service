-- 一行命令标记所有迁移为已完成（最简单）
CREATE TABLE IF NOT EXISTS public.schema_migrations (version VARCHAR(255) PRIMARY KEY);
INSERT INTO public.schema_migrations (version) SELECT '20221011041400' WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '20221011041400');
INSERT INTO public.schema_migrations (version) SELECT '20221208132122' WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '20221208132122');

