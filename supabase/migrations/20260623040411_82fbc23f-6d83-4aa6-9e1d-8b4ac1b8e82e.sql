
ALTER TABLE public.notifications ALTER COLUMN destination_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  INSERT INTO public.notifications (user_id, destination_id, kind, actor_id, payload)
  VALUES (
    NEW.id,
    NULL,
    'welcome',
    NULL,
    jsonb_build_object(
      'title', 'Welcome to Tribe Trips 👋',
      'body', 'Create your first trip or join one with an invite link to start planning with your crew.'
    )
  );

  RETURN NEW;
END;
$function$;
