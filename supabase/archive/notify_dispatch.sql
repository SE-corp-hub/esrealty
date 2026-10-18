-- Email/SMS dispatch support: dispatch-tracking columns on notifications.
-- Run AFTER notifications.sql. Idempotent.

begin;

alter table public.notifications
  add column if not exists emailed_at timestamptz,
  add column if not exists sms_sent_at  timestamptz;

-- Optional: automatic dispatch every 5 minutes via pg_cron + pg_net.
-- 1) Enable extensions (Dashboard > Database > Extensions, or run):
--    create extension if not exists pg_cron;
--    create extension if not exists pg_net;
-- 2) Set a shared secret used by both sides:
--    supabase secrets set NOTIFY_DISPATCH_SECRET=<random-string>
-- 3) Uncomment and fill in your project ref + the SAME secret, then run:
--
-- select cron.schedule(
--   'notify-dispatch',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT-REF>.supabase.co/functions/v1/notify-dispatch',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-dispatch-secret', '<SAME-NOTIFY-DISPATCH-SECRET>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );

commit;
