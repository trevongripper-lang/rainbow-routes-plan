CREATE TABLE public.beta_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  UNIQUE (user_id, version)
);
GRANT SELECT, INSERT ON public.beta_consents TO authenticated;
GRANT ALL ON public.beta_consents TO service_role;
ALTER TABLE public.beta_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own beta consents" ON public.beta_consents FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own beta consents" ON public.beta_consents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);