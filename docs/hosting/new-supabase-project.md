# Moving to a new free Supabase project

Written 25 Oct 2026, after the old project (`mrngaqtbaseewzcsogqi`) was restricted for
`exceed_cached_egress_quota`. The free plan includes 5 GB of cached egress a month, which is
mostly public listing photos sent through Supabase's CDN. The restriction lifts at the start of
the next billing cycle, or on an upgrade.

Supabase applies quotas and restrictions to the whole **organization**, so a new project in the
same organization stays restricted. Create it in a new free organization.

The database, rules, functions and storage buckets all come from this repository, so the new
project starts empty but complete. Listings, accounts and photos from the old project do not
come along.

## 1. Owner: create the project

1. supabase.com > your avatar > **New organization**, on the Free plan.
2. In it, **New project**. Pick the region **Southeast Asia (Singapore)** and save the database password.
3. Copy two values:
   - the **project ref**, from Project Settings > General (20 letters and digits);
   - the **publishable key**, from Project Settings > API Keys (starts with `sb_publishable_`).
4. GitHub > Settings > Secrets > Actions: `SUPABASE_ACCESS_TOKEN` has to be a token from an account
   that is a member of the new organization. If it is your own account, the current token works.

## 2. Claude: point the repository at it

```
node tools/switch_supabase_project.js <project ref> <publishable key> [new site URL, if the Cloudflare account changed]
```

This rewrites every place that names the project (site config, Worker, workflows, backend check,
seo function, robots.txt, market-scan API). Then open a PR and merge it.

## 3. Claude: build the database and deploy the functions

1. Actions > **Apply database migration**: run every file in `supabase/migrations/` in order,
   from `0000_baseline.sql` to the last one, each first in test mode and then in apply mode.
2. Actions > **Deploy edge functions** with
   `listing-api location-report seo fb-leads agent-dispatch admin-create-account notify-dispatch nearby-scan`.

## 4. Owner: settings in the new project

- **Authentication > URL Configuration**: set the Site URL to `https://esrealty.extraricestore.workers.dev`
  and add it to Redirect URLs. Copy any custom email templates or SMTP settings from the old project.
- **Edge Functions > Secrets**: add the ones you use. Supabase does not show the old values, so
  take them from where you keep them, or make new ones:
  `RESEND_API_KEY`, `MAIL_FROM`, `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER`, `META_APP_SECRET`,
  `META_PAGE_TOKEN`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION`, `FB_LEADS_DEFAULT_BROKER_EMAIL`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SITE_URL`. For `AGENT_DISPATCH_SECRET`,
  `NOTIFY_DISPATCH_SECRET` and `INQUIRY_RATE_LIMIT_SALT`, any new long random value works.
- Vercel (market-scan): if `SUPABASE_URL` or `SUPABASE_ANON_KEY` are set there, update them.

## 5. Owner: the first Super Admin

Sign up on the site with your email, then run this once in the new project's SQL editor:

```sql
update public.profiles set role = 'super-admin', registration_status = 'approved'
 where id = (select id from auth.users where email = 'YOUR EMAIL');
```

Everyone else signs up and is approved from Users & Access as before.

## 6. Photos off Supabase (so this does not happen again)

1. Cloudflare dashboard > **R2** > enable it, then **Create bucket** `esrealty-photos`. The free
   tier has 10 GB of storage and no charge for bandwidth. Cloudflare may ask for a payment
   method before turning R2 on.
2. Merge the Worker PR. Workers Builds must deploy with `npx wrangler deploy` (see `wrangler.jsonc`).
3. Check that `https://esrealty.extraricestore.workers.dev/photos/<a photo path>` shows the photo.
4. Edge Functions > Secrets: set `PHOTO_BASE` to `https://esrealty.extraricestore.workers.dev/photos/`.

From then on the site loads each photo from Cloudflare, and Supabase sends it once.
