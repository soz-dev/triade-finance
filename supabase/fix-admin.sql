-- Correctif : colle ce script dans Supabase SQL Editor puis Run
-- Ne supprime aucune donnée, corrige uniquement la vérification du mot de passe

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO admin_config (id, password_hash)
VALUES (1, encode(digest('triade70'::text, 'sha256'::text), 'hex'))
ON CONFLICT (id) DO UPDATE
SET password_hash = EXCLUDED.password_hash;

CREATE OR REPLACE FUNCTION verify_admin(p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  stored text;
BEGIN
  SELECT password_hash INTO stored FROM admin_config WHERE id = 1;
  IF stored IS NULL THEN RETURN false; END IF;
  RETURN stored = encode(digest(p_password::text, 'sha256'::text), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION save_app_state(p_state jsonb, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT verify_admin(p_current) THEN
    RAISE EXCEPTION 'invalid_admin_password' USING ERRCODE = '42501';
  END IF;

  UPDATE admin_config
  SET password_hash = encode(digest(p_new::text, 'sha256'::text), 'hex')
  WHERE id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_admin(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_app_state(jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_admin_password(text, text) TO anon, authenticated;
