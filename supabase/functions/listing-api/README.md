# Listings API

REST API for public listing discovery, authenticated listing management,
favorites, and rate-limited listing inquiries. It reuses Supabase Auth and the
existing `profiles` roles; it does not create another authentication system.

## Install

Run these files in the Supabase SQL Editor in order:

1. `supabase/archive/listing_platform_schema.sql`
2. `supabase/archive/listing_api.sql`

Set a private rate-limit salt, then deploy from the project root:

```powershell
supabase secrets set INQUIRY_RATE_LIMIT_SALT="GENERATE-A-LONG-RANDOM-VALUE" --project-ref YOUR_PROJECT_REF
supabase functions deploy listing-api --no-verify-jwt --project-ref YOUR_PROJECT_REF
```

The function is three files, deployed together: `index.ts` (listings, favourites,
inquiries, the contact form, site settings and the router), `agents.ts` (agent
pages, the agent directory, check-an-agent and client reviews) and `limits.ts`
(the rate limits every form shares).

`--no-verify-jwt` is required because browsing and inquiries are public. The
function validates bearer tokens itself on every protected route. Supabase
provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically; never put
the service-role key in browser code.

## Routes

The deployed base URL is:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/listing-api/api
```

- `GET /listings`
- `GET /listings/:id`
- `POST /listings`
- `PUT /listings/:id`
- `DELETE /listings/:id`
- `GET /users/me/listings`
- `POST /listings/:id/favorite`
- `GET /users/me/favorites`
- `POST /listings/:id/inquiries`

The browser wrapper is `js/listings-api.js`. A hosting proxy can map `/api/*`
to this function later without changing the frontend wrapper's method contract.

## Photos through the site's Worker (PHOTO_BASE)

The Supabase free plan has a monthly cached-egress quota, and public listing photos use most of it.
Once the site's Worker is live with its R2 bucket (`esrealty-photos`, see `wrangler.jsonc`), set the
function secret `PHOTO_BASE` to `https://<site address>/photos/`. Every photo link this function
answers then points at the Worker, which fetches each photo from Storage once and keeps a copy in R2.
Stored links are not changed, and unsetting the secret switches back. When the site moves to the
brand domain, update `PHOTO_BASE` to match, because the site's CSP only allows its own images.
