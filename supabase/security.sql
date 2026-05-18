-- À exécuter dans Supabase : SQL Editor
-- Sécurise app_state (lecture publique, écriture admin uniquement)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admin_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash text NOT NULL
);

ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;

-- Hash SHA-256 du mot de passe initial (change-le ensuite via update_admin_password)
INSERT INTO admin_config (id, password_hash)
VALUES (1, encode(digest('triade70', 'sha256'), 'hex'))
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION verify_admin(p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored text;
BEGIN
  SELECT password_hash INTO stored FROM admin_config WHERE id = 1;
  IF stored IS NULL THEN RETURN false; END IF;
  RETURN stored = encode(digest(p_password, 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION save_app_state(p_state jsonb, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_admin(p_password) THEN
    RAISE EXCEPTION 'invalid_admin_password' USING ERRCODE = '42501';
  END IF;

  INSERT INTO app_state (id, state, updated_at)
  VALUES ('global', p_state, now())
  ON CONFLICT (id) DO UPDATE
  SET state = EXCLUDED.state,
      updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION update_admin_password(p_current text, p_new text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_admin(p_current) THEN
    RAISE EXCEPTION 'invalid_admin_password' USING ERRCODE = '42501';
  END IF;

  UPDATE admin_config
  SET password_hash = encode(digest(p_new, 'sha256'), 'hex')
  WHERE id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_admin(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_app_state(jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_admin_password(text, text) TO anon, authenticated;

ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_state' AND policyname = 'Public read app_state'
  ) THEN
    CREATE POLICY "Public read app_state"
      ON app_state FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_state' AND policyname = 'Block anon insert app_state'
  ) THEN
    CREATE POLICY "Block anon insert app_state"
      ON app_state FOR INSERT
      TO anon
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_state' AND policyname = 'Block anon update app_state'
  ) THEN
    CREATE POLICY "Block anon update app_state"
      ON app_state FOR UPDATE
      TO anon
      USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_state' AND policyname = 'Block anon delete app_state'
  ) THEN
    CREATE POLICY "Block anon delete app_state"
      ON app_state FOR DELETE
      TO anon
      USING (false);
  END IF;
END $$;
