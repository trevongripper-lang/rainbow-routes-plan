#!/usr/bin/env bash
# Stage 3 cross-session concurrency check.
# Fires N parallel process_paddle_unlock_event calls for the SAME event_id
# against DEV_SUPABASE_DB_URL and asserts exactly ONE unlock effect and ONE
# loyalty increment.
#
# Requires: DEV_SUPABASE_DB_URL, psql on PATH.
set -euo pipefail

: "${DEV_SUPABASE_DB_URL:?DEV_SUPABASE_DB_URL required}"

DEST="00000000-0000-0000-0000-0000000060aa"
OWNER="00000000-0000-0000-0000-0000000050aa"
EVENT="evt_stage3_parallel_$$"

cleanup() {
  psql "$DEV_SUPABASE_DB_URL" -v ON_ERROR_STOP=0 <<SQL >/dev/null 2>&1
DELETE FROM public.paddle_events WHERE event_id='$EVENT';
DELETE FROM public.destinations WHERE id='$DEST';
DELETE FROM auth.users WHERE id='$OWNER';
SQL
}
trap cleanup EXIT

psql "$DEV_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
                        aud, role, created_at, updated_at, raw_app_meta_data,
                        raw_user_meta_data, is_anonymous)
VALUES ('$OWNER', '00000000-0000-0000-0000-000000000000',
        'stage3-parallel@example.test', crypt('x', gen_salt('bf')), now(),
        'authenticated','authenticated', now(), now(),'{}'::jsonb,'{}'::jsonb, false)
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET is_pro=true, paid_trip_count=0 WHERE id='$OWNER';
INSERT INTO public.destinations (id, user_id, title, region, country, headcount, unlock_status)
VALUES ('$DEST', '$OWNER', 'Stage3 Parallel', 'Aegean','GR', 8, 'free');
SQL

# Fire N parallel calls to the same event_id.
N=6
outputs=()
pids=()
for i in $(seq 1 $N); do
  (
    psql "$DEV_SUPABASE_DB_URL" -v ON_ERROR_STOP=0 -tAc \
      "SET ROLE service_role;
       SELECT public.process_paddle_unlock_event(
         '$EVENT','transaction.completed','{}'::jsonb,
         '$DEST'::uuid, 499);" 2>&1
  ) > "/tmp/stage3-parallel-$i.out" &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || true; done

echo "── Per-call outputs ──"
for i in $(seq 1 $N); do
  printf "call %d: %s\n" "$i" "$(cat /tmp/stage3-parallel-$i.out | tr '\n' ' ')"
done

processed=0
duplicate=0
concurrent=0
other=0
for i in $(seq 1 $N); do
  out=$(cat "/tmp/stage3-parallel-$i.out")
  if [[ "$out" == *'"outcome": "processed"'* || "$out" == *'"outcome":"processed"'* ]]; then
    processed=$((processed+1))
  elif [[ "$out" == *'"outcome": "duplicate"'* || "$out" == *'"outcome":"duplicate"'* ]]; then
    duplicate=$((duplicate+1))
  elif [[ "$out" == *concurrent_processing* || "$out" == *55P03* ]]; then
    concurrent=$((concurrent+1))
  else
    other=$((other+1))
  fi
  rm -f "/tmp/stage3-parallel-$i.out"
done

# Verify DB state.
row_status=$(psql "$DEV_SUPABASE_DB_URL" -tAc \
  "SELECT status FROM public.paddle_events WHERE event_id='$EVENT';")
dest_status=$(psql "$DEV_SUPABASE_DB_URL" -tAc \
  "SELECT unlock_status FROM public.destinations WHERE id='$DEST';")
paid_count=$(psql "$DEV_SUPABASE_DB_URL" -tAc \
  "SELECT paid_trip_count FROM public.profiles WHERE id='$OWNER';")

echo "── Aggregates ──"
echo "processed=$processed duplicate=$duplicate concurrent=$concurrent other=$other"
echo "paddle_events.status=$row_status dest.unlock_status=$dest_status profiles.paid_trip_count=$paid_count"

fail=0
[[ "$processed" == "1" ]] || { echo "FAIL: expected exactly 1 processed, got $processed"; fail=1; }
[[ "$other"     == "0" ]] || { echo "FAIL: unexpected other outcomes $other"; fail=1; }
[[ "$row_status"   == "success" ]] || { echo "FAIL: event status $row_status != success"; fail=1; }
[[ "$dest_status"  == "paid"    ]] || { echo "FAIL: dest $dest_status != paid"; fail=1; }
[[ "$paid_count"   == "1"       ]] || { echo "FAIL: paid_trip_count $paid_count != 1"; fail=1; }
[[ $((duplicate + concurrent)) -ge $((N - 1)) ]] || {
  echo "FAIL: expected the other $((N-1)) calls to be duplicate or concurrent"; fail=1; }

if [[ $fail == 0 ]]; then
  echo "PASS: exactly one unlock + one loyalty increment across $N parallel deliveries"
  exit 0
fi
exit 1
