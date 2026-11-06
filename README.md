# Figment XR Backend

A real backend for Figment XR — replaces the Claude Artifacts `window.storage`
layer (which only works inside Claude's chat environment) with an actual
API and persistent Postgres database, and adds the server-side pieces that
Apple and Google's in-app purchase systems require.

## What's actually working here

- Real password hashing (bcrypt) and JWT sessions — not the toy hash the
  artifact used.
- Resident signup/login. Visitors still don't need an account, same as
  the app already does.
- Sculptures: public read, Resident-only create (enforces the same 3-per-beta
  quota), owner-only delete.
- AR File Library: gated by `isPro` on the user record — but that flag can
  now *only* be set by a verified purchase (see below), not a client-side
  toggle.
- Data persists to a real Postgres database via `src/lib/db.js`. Every route
  only ever calls the functions that file exports (getAll/getOne/insert/
  update/remove) — if you ever want to move off Postgres, that's the only
  file that needs to change.

### Why Postgres, and not just files on disk

An earlier version of this stored data in plain JSON files. That works fine
locally, but it's a dead end on most free hosting: platforms like Render's
free tier wipe local disk on every restart, redeploy, or sleep cycle, so
anything written to files there doesn't survive. A real external database
is the fix. Two providers with a genuinely-free, doesn't-expire tier for a
project this size:

- **Neon** (neon.tech) — serverless Postgres, generous permanent free tier.
- **Supabase** (supabase.com) — also Postgres, also a solid free tier.

Either one: create a project, copy the connection string it gives you, and
put it in `.env` as `DATABASE_URL`. The app creates its own tables
automatically on first run — no manual schema setup needed.

(Render's *own* free Postgres is not a good fit here — it expires 30 days
after creation.)

## What's intentionally NOT working yet: billing

`src/routes/billing.js` has the right endpoints, auth, and shapes, but the
actual Apple/Google receipt verification is a stub that returns `501 Not
Implemented`. I did that on purpose rather than fake it — verifying a
StoreKit transaction or a Play purchase token correctly requires real
cryptographic signature checks against Apple's/Google's keys. Getting that
subtly wrong is a security hole (it'd let anyone unlock Pro for free), and
it can't be tested without your real developer credentials. The file has
detailed comments on exactly what to plug in and which official libraries
to use (`@apple/app-store-server-library`, `googleapis`).

In the meantime, `POST /api/me/simulate-pro` and `POST /api/billing/dev/set-pro`
are dev-only routes (automatically disabled if `NODE_ENV=production`) that
let you flip `isPro` directly for testing the File Library feature end to
end. **Delete both before shipping to real users** — each is a deliberate,
temporary hole that lets anyone with a login grant themselves Pro for free.

## Running it

```
npm install
cp .env.example .env
# edit .env:
#   JWT_SECRET     — generate with: openssl rand -base64 48
#   DATABASE_URL   — from Neon or Supabase, see above
npm start
```

**Important — I could not run `npm install` or a live test of this server
myself.** This sandbox has no network access, so I couldn't fetch the
dependencies or connect to a real Postgres instance. Every file passed
`node --check` (syntax validation) and I traced through the logic by hand,
but you should run and exercise this for real — including the database
connection — before trusting it with real users.

Quick smoke test once it's running:

```
curl -X POST http://localhost:4000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}'

curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}'
```

If the signup call works and returns a token, the database connection and
table creation both worked.

## Deploying it somewhere real

This needs a host that runs a persistent Node process. Two things ruled
out along the way, worth knowing about if you're choosing between hosts:

- **Netlify** only serves static files — no persistent Node process at all.
- **Shared cPanel hosting** (e.g. HostMetro) — only works if your specific
  plan includes cPanel's "Setup Node.js App" / Node.js Selector tool.
  Check under cPanel's Software section; if it's not there, your plan
  doesn't support it.

**Render** is a solid free option: no credit card required, straightforward
deploy from a Git repo. The trade-off is its free web services "spin down"
after 15 minutes of inactivity, causing a 30–60 second delay on the next
request — fine for a personal project or beta, not ideal once you have
real, latency-sensitive traffic. Because the database now lives on Neon/
Supabase rather than Render's own disk, that spin-down/wake cycle no longer
risks losing any data — only adds a delay to the first request after idle.

## What's still ahead (can't be done in this chat)

1. **A native or hybrid app.** Apple and Google both require a real app
   binary, not just a website, to use their in-app purchase systems — and
   StoreKit/Play Billing are native APIs a plain website can't call. That
   means wrapping the existing HTML/JS in something like Capacitor, or
   rebuilding key screens natively, with a JS bridge for the purchase flow.
2. **Real Apple/Google developer accounts** ($99/yr Apple, $25 one-time
   Google) — only you can create these.
3. **Finishing `billing.js`** with the official verification libraries once
   you have those credentials.
4. **Xcode and Android Studio** — needed to build, sign, and submit both
   apps. I don't have access to either in this environment.

**Claude Code** (running locally on your machine, where you'll have Xcode/
Android Studio and your real credentials) is the right tool for that next
phase — it can iterate on the native wrapper and the billing integration
with you step by step, the same way we've been iterating on this backend.

## Location features (added Nov 2026)

Sculptures already store a `lat` and `lon`, and any number of sculptures can share the same area.

- `GET /api/sculptures/nearby?lat=..&lon=..&radius=300` — public. The sculptures within `radius` metres
  (default 300, max 5000), closest first, each with `distanceM`. Light records: no geometry or photo.
  Uses an index on latitude/longitude, created automatically when the server starts.
- `GET /api/sculptures/:id` — public. One sculpture's full record.
- `POST /api/sculptures/upload-url` — Residents only. Returns `{ uploadUrl, publicUrl }` for one `.glb` upload to
  Cloudflare R2. The app PUTs the file to `uploadUrl`, then saves `publicUrl` as the sculpture's `glbUrl`.
  Needs the `R2_*` values in `.env` (see `.env.example`); until then it answers 501.
- `POST` / `PATCH /api/sculptures` now also accept `glbUrl` (https only), `rotationDeg` (turned from true north)
  and `heightOffset` (metres) — the placement an artist saves on site.

After pulling these changes run `npm install` (two new packages for file storage).
