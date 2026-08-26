-- EchoHunt KOL 商务合作信息同步字段
-- 目标表：dev.kol_marketing_profile
-- 原则：只新增 collaboration_* 字段，不修改任何原有画像字段 / AI 意愿字段 / updated_at。

ALTER TABLE dev.kol_marketing_profile
  ADD COLUMN IF NOT EXISTS collaboration_accepting_new_invitations boolean,
  ADD COLUMN IF NOT EXISTS collaboration_telegram text,
  ADD COLUMN IF NOT EXISTS collaboration_email text,
  ADD COLUMN IF NOT EXISTS collaboration_short_post_price numeric(18, 2),
  ADD COLUMN IF NOT EXISTS collaboration_short_post_currency text,
  ADD COLUMN IF NOT EXISTS collaboration_thread_price numeric(18, 2),
  ADD COLUMN IF NOT EXISTS collaboration_thread_currency text,
  ADD COLUMN IF NOT EXISTS collaboration_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS collaboration_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS collaboration_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kol_marketing_profile_collab_short_currency_check'
  ) THEN
    ALTER TABLE dev.kol_marketing_profile
      ADD CONSTRAINT kol_marketing_profile_collab_short_currency_check
      CHECK (
        collaboration_short_post_currency IS NULL
        OR collaboration_short_post_currency = ANY (ARRAY['USDT'::text, 'USD'::text])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kol_marketing_profile_collab_thread_currency_check'
  ) THEN
    ALTER TABLE dev.kol_marketing_profile
      ADD CONSTRAINT kol_marketing_profile_collab_thread_currency_check
      CHECK (
        collaboration_thread_currency IS NULL
        OR collaboration_thread_currency = ANY (ARRAY['USDT'::text, 'USD'::text])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kol_marketing_profile_collab_price_check'
  ) THEN
    ALTER TABLE dev.kol_marketing_profile
      ADD CONSTRAINT kol_marketing_profile_collab_price_check
      CHECK (
        (collaboration_short_post_price IS NULL OR collaboration_short_post_price > 0)
        AND (collaboration_thread_price IS NULL OR collaboration_thread_price > 0)
      );
  END IF;
END $$;
