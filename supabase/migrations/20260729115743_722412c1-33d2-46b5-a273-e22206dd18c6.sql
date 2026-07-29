DO $$
DECLARE
  r RECORD;
  moved INT := 0;
  is_legacy BOOLEAN;
  html_val TEXT;
  text_val TEXT;
  strategy TEXT;
BEGIN
  FOR r IN SELECT msg_id, message FROM pgmq.q_auth_emails LOOP
    html_val := COALESCE(r.message->>'html', '');
    text_val := COALESCE(r.message->>'text', '');
    strategy := r.message->>'link_strategy';
    is_legacy := (
      strategy IS DISTINCT FROM 'tribe_token_hash_interstitial'
      AND (r.message->>'label') <> 'reauthentication'
    )
    OR html_val ~* '/auth/v1/verify'
    OR text_val ~* '/auth/v1/verify'
    OR html_val ~* 'supabase\.co/auth/v1/'
    OR text_val ~* 'supabase\.co/auth/v1/';

    IF is_legacy THEN
      BEGIN
        PERFORM public.move_to_dlq('auth_emails', 'auth_emails_dlq', r.msg_id, r.message);
        INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, error_message, metadata)
        VALUES (
          r.message->>'message_id',
          COALESCE(r.message->>'label', 'auth_emails'),
          r.message->>'to',
          'dlq',
          'legacy_pipeline_purged',
          jsonb_build_object(
            'link_strategy', strategy,
            'purged_at', now()
          )
        );
        moved := moved + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'purge auth_emails msg_id=% failed: %', r.msg_id, SQLERRM;
      END;
    END IF;
  END LOOP;
  RAISE NOTICE 'legacy auth email purge complete: % messages moved to DLQ', moved;
END $$;