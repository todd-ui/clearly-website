-- Schedule weekly analytics report every Monday at 8am ET (12:00 UTC)
select cron.schedule(
  'weekly-analytics-report',
  '0 12 * * 1',
  $$
  select net.http_post(
    url := 'https://dwncravjhkbclbuzijra.supabase.co/functions/v1/weekly-analytics-report',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
