
-- ============================================================
-- Stage 1: Foundation tables, helpers, and storage RLS.
-- All new functions: REVOKE FROM PUBLIC first, then targeted GRANT.
-- ============================================================

-- ---- app_config: server-only key/value ---------------------
CREATE TABLE public.app_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.app_config TO service_role;
-- no grants to anon / authenticated: reachable only via named helpers below.
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
-- deny-all by default; service_role bypasses RLS.

-- Seed authoritative consent version + payments flag.
INSERT INTO public.app_config (key, value) VALUES
  ('beta_consent_version', to_jsonb('beta-v1'::text)),
  ('payments_enabled',      to_jsonb(true)),
  ('anon_cleanup_dry_run',  to_jsonb(false));

-- current_consent_version(): safe read for the app.
CREATE OR REPLACE FUNCTION public.current_consent_version()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (value #>> '{}')::text FROM public.app_config WHERE key = 'beta_consent_version'
$$;
REVOKE ALL ON FUNCTION public.current_consent_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_consent_version() TO anon, authenticated;

-- payments_enabled(): safe read for the app.
CREATE OR REPLACE FUNCTION public.payments_enabled()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((value)::boolean, false) FROM public.app_config WHERE key = 'payments_enabled'
$$;
REVOKE ALL ON FUNCTION public.payments_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payments_enabled() TO anon, authenticated;

-- updated_at trigger for app_config.
CREATE OR REPLACE FUNCTION public._app_config_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public._app_config_touch() FROM PUBLIC;
CREATE TRIGGER app_config_touch BEFORE UPDATE ON public.app_config
FOR EACH ROW EXECUTE FUNCTION public._app_config_touch();

-- ---- storage_object_trip: maps storage path -> destination ----
CREATE TABLE public.storage_object_trip (
  bucket_id      text NOT NULL,
  object_path    text NOT NULL,
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  uploaded_by    uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_id, object_path)
);
CREATE INDEX storage_object_trip_dest_idx ON public.storage_object_trip(destination_id);
GRANT ALL ON public.storage_object_trip TO service_role;
-- No grants to anon/authenticated: only reachable through server functions.
ALTER TABLE public.storage_object_trip ENABLE ROW LEVEL SECURITY;

-- ---- pending_intents: resumable intents across email confirm ----
CREATE TABLE public.pending_intents (
  id          text PRIMARY KEY,           -- 128-bit opaque, generated server-side
  session_id  text NOT NULL,              -- browser session claim to bind on resume
  kind        text NOT NULL,              -- e.g. 'pitch_trip', 'accept_invite'
  payload     jsonb NOT NULL,
  claimed_by  uuid,                       -- set when a signed-in user resumes it
  claimed_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX pending_intents_expires_idx ON public.pending_intents(expires_at);
GRANT ALL ON public.pending_intents TO service_role;
ALTER TABLE public.pending_intents ENABLE ROW LEVEL SECURITY;

-- ---- pending_invite_access: anon read-only invite peek ----
CREATE TABLE public.pending_invite_access (
  id             text PRIMARY KEY,        -- 128-bit opaque, distinct from invite token
  session_id     text NOT NULL,
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  invite_id      uuid NOT NULL REFERENCES public.trip_invites(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX pending_invite_access_expires_idx ON public.pending_invite_access(expires_at);
CREATE INDEX pending_invite_access_dest_idx    ON public.pending_invite_access(destination_id);
GRANT ALL ON public.pending_invite_access TO service_role;
ALTER TABLE public.pending_invite_access ENABLE ROW LEVEL SECURITY;

-- ---- destinations: add cover_object_path (additive, nullable) ----
ALTER TABLE public.destinations
  ADD COLUMN cover_object_path text;

-- ---- Storage RLS: destination-cover-drafts bucket -----------
-- Signed-in users can only touch drafts/<their uid>/... in the drafts bucket.
CREATE POLICY "drafts owner select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'destination-cover-drafts'
  AND (storage.foldername(name))[1] = 'drafts'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "drafts owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'destination-cover-drafts'
  AND (storage.foldername(name))[1] = 'drafts'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "drafts owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'destination-cover-drafts'
  AND (storage.foldername(name))[1] = 'drafts'
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'destination-cover-drafts'
  AND (storage.foldername(name))[1] = 'drafts'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "drafts owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'destination-cover-drafts'
  AND (storage.foldername(name))[1] = 'drafts'
  AND (storage.foldername(name))[2] = auth.uid()::text
);
