
ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS vibes text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS special_note text,
  ADD COLUMN IF NOT EXISTS trip_length text,
  ADD COLUMN IF NOT EXISTS budget text,
  ADD COLUMN IF NOT EXISTS reasons text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS audience text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS downsides text,
  ADD COLUMN IF NOT EXISTS best_time text;
