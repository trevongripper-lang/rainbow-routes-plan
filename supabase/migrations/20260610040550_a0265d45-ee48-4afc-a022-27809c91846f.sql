
-- Polls
CREATE TABLE public.trip_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 280),
  kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general','stay','ticket','activity','date')),
  allow_multi boolean NOT NULL DEFAULT false,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_polls TO authenticated;
GRANT ALL ON public.trip_polls TO service_role;
ALTER TABLE public.trip_polls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read polls" ON public.trip_polls FOR SELECT TO authenticated
USING (public.is_trip_member(destination_id, auth.uid()));
CREATE POLICY "Members create polls" ON public.trip_polls FOR INSERT TO authenticated
WITH CHECK (public.is_trip_member(destination_id, auth.uid()) AND user_id = auth.uid());
CREATE POLICY "Creator or owner updates poll" ON public.trip_polls FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.is_trip_owner(destination_id, auth.uid()))
WITH CHECK (user_id = auth.uid() OR public.is_trip_owner(destination_id, auth.uid()));
CREATE POLICY "Creator or owner deletes poll" ON public.trip_polls FOR DELETE TO authenticated
USING (user_id = auth.uid() OR public.is_trip_owner(destination_id, auth.uid()));

CREATE INDEX trip_polls_destination_id_idx ON public.trip_polls(destination_id, created_at DESC);

-- Options
CREATE TABLE public.trip_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.trip_polls(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  image_url text,
  ref_table text CHECK (ref_table IN ('trip_stays','trip_tickets')),
  ref_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_poll_options TO authenticated;
GRANT ALL ON public.trip_poll_options TO service_role;
ALTER TABLE public.trip_poll_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read options" ON public.trip_poll_options FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.trip_polls p WHERE p.id = poll_id AND public.is_trip_member(p.destination_id, auth.uid())));
CREATE POLICY "Members add options" ON public.trip_poll_options FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.trip_polls p WHERE p.id = poll_id AND public.is_trip_member(p.destination_id, auth.uid())));
CREATE POLICY "Creator/owner edits options" ON public.trip_poll_options FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.trip_polls p WHERE p.id = poll_id AND (p.user_id = auth.uid() OR public.is_trip_owner(p.destination_id, auth.uid()))))
WITH CHECK (EXISTS (SELECT 1 FROM public.trip_polls p WHERE p.id = poll_id AND (p.user_id = auth.uid() OR public.is_trip_owner(p.destination_id, auth.uid()))));
CREATE POLICY "Creator/owner deletes options" ON public.trip_poll_options FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.trip_polls p WHERE p.id = poll_id AND (p.user_id = auth.uid() OR public.is_trip_owner(p.destination_id, auth.uid()))));

CREATE INDEX trip_poll_options_poll_id_idx ON public.trip_poll_options(poll_id, sort_order);

-- Votes
CREATE TABLE public.trip_poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.trip_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.trip_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id, option_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_poll_votes TO authenticated;
GRANT ALL ON public.trip_poll_votes TO service_role;
ALTER TABLE public.trip_poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read votes" ON public.trip_poll_votes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.trip_polls p WHERE p.id = poll_id AND public.is_trip_member(p.destination_id, auth.uid())));
CREATE POLICY "Own vote insert" ON public.trip_poll_votes FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.trip_polls p WHERE p.id = poll_id AND public.is_trip_member(p.destination_id, auth.uid()) AND p.closed_at IS NULL));
CREATE POLICY "Own vote delete" ON public.trip_poll_votes FOR DELETE TO authenticated
USING (user_id = auth.uid());

CREATE INDEX trip_poll_votes_poll_id_idx ON public.trip_poll_votes(poll_id);
CREATE INDEX trip_poll_votes_option_id_idx ON public.trip_poll_votes(option_id);
