# Trump Truth Alerts — Project Notes

> Last updated 2026-08-25. The deepest/authoritative references are
> `trump-truth-server/CLAUDE.md` and the auto-memory files. Keep this file in
> sync when the architecture changes — it drifted badly once (it described the
> original Railway/ScraperAPI design long after polling moved to the Pi).

## What This Is
A Chrome extension + email service that alerts people within ~1 minute whenever
Donald Trump posts on Truth Social. Built by sbecket. Website: trumptruthalerts.com.

---

## Architecture Overview

```
Truth Social API
      ↑ polled every 60s by a Raspberry Pi (Puppeteer + stealth, bypasses Cloudflare;
      |   falls back to ScraperAPI only if Puppeteer fails)
Raspberry Pi 4  (hostname: trumppi, runs src/poller.js via pm2 process "trump-poller")
      ↓ inserts new posts, generates AI subject lines, sends emails
Supabase (PostgreSQL)  ←→  Resend (transactional email to active subscribers)
      ↑
Railway server (src/index.js)  — READ-ONLY API + static website. Does NOT poll.
      ↑ GET /posts (cached 60s, requires X-TTA-Client header)
Chrome extension  — polls Railway /posts every 30s, shows badge + desktop notification
```

Key point that the old notes got wrong: **polling and emailing run on the Pi, not
on Railway.** Railway is a read-only API in front of Supabase plus the marketing
site. `poller.js` is imported on Railway only so the admin `POST /poll` route can
trigger a one-off poll; the scheduled loop runs on the Pi (`require.main === module`).

---

## Two Separate Repos

| Repo | Location | Deployed |
|------|----------|---------|
| Chrome Extension | `~/Desktop/Trump Truth Project/trump-truth-alert` | Chrome Web Store (v1.4.6; a v1.4.7 zip was built Aug 5 but its changes are uncommitted) |
| Server | `~/Desktop/Trump Truth Project/trump-truth-server` | Railway (auto-deploys from `main`); poller also runs on the Pi |

---

## Chrome Extension (`trump-truth-alert`)

### Key Files
- **`background.js`** — service worker. All logic lives here. Polls Railway `/posts`
  every 30s, diffs against `lastSeenId`, fires desktop notifications + badge.
- **`offscreen.html` / `offscreen.js`** — keepalive timer (MV3 workaround) that
  pings the service worker every 30s so it doesn't sleep.
- **`popup.html` / `popup.js`** — popup feed UI with post-type filter bar.
- **`manifest.json`** — MV3 manifest. **`icons/`** — icon16/48/128.

### Important Behavior
- Polls **Railway only** — there is no longer a direct Truth-Social fallback in the
  extension (`background.js` only fetches `RAILWAY_URL`).
- Every request sends the `X-TTA-Client` header; `/posts` returns 403 without it.
- On install/update it force-resets `intervalSec` to 30 (older versions allowed
  sub-second values that caused runaway polling — see runaway-polling memory).
- Reloading in `chrome://extensions` after a `background.js` change is enough.

---

## Server (`trump-truth-server`)

### Key Files
- **`src/poller.js`** — the Pi-side poller. Fetches Trump's statuses via Puppeteer
  (ScraperAPI fallback), `parsePost()` normalizes them, inserts new posts into
  Supabase, resolves async cards/video thumbnails, detects deletions, and calls the
  emailer. Runs standalone on the Pi every 60s.
- **`src/emailer.js`** — Resend sending with `sendWithRetry()` (250ms inter-send
  delay + 429 backoff). HMAC tokens for unsubscribe / confirm / preferences. Claude
  vision generates subject lines for image-only posts; Gemini summarizes video-only
  posts. Filters per-subscriber `post_types`. Welcome / deletion / announcement /
  admin emails.
- **`src/scorer.js`** — newsworthiness scorer (added Aug 25 2026). Claude Haiku
  scores every new post 1 (filler) / 2 (notable) / 3 (major) against a fixed
  rubric; called from `sendEmailsForPost()` after subject generation; score saved
  to `posts.importance`. **Shadow mode:** scores never affect who gets emailed.
  NULL importance = unscored (API failure or media with no description) and must
  always be treated as "send to everyone" if filtering is ever applied. Scoring
  failures email an admin alert (throttled hourly, own throttle var).
- **`grade-posts.js`** (repo root) — local blind-grading tool for the shadow
  evaluation: `node grade-posts.js` → http://localhost:4545, press 1/2/3.
  Labels go to local `eval-labels.json` (gitignored); the page never reveals the
  model's score. Read-only against Supabase.
- **`src/index.js`** — Express app: read-only API + serves `public/` (static site,
  `extensions:["html"]`). Security headers, IP blocklist (`BLOCKED_IPS`), per-route
  rate limits keyed on the real client IP (`getClientIp` + `trust proxy`).
- **`public/`** — landing page, preferences, unsubscribe, confirmed, thank-you,
  404, etc. Everything here is publicly reachable and crawlable, so nothing
  internal belongs in it.
- **`design/`** — internal mockups / promo tiles / screenshot mockups used to make
  Chrome Web Store and og-image assets. Lived in `public/` until Aug 25 2026,
  which made them live pages (`/mockup-a`, `/promo-tile`, …). Not served.

### API Routes (current)
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/posts` | Recent posts for the extension. Cached 60s; requires `X-TTA-Client`; rate-limited 60/min/IP |
| GET | `/health` | Health check |
| POST | `/subscribe` | Add subscriber (sends welcome email; see opt-in note) |
| GET | `/confirm` | Email-confirm route — **currently unused** (see opt-in note) |
| POST | `/install` | Extension-install ping (throttled admin email) |
| GET/POST | `/unsubscribe` | Unsubscribe (soft delete: `active=false`) |
| GET | `/preferences-data` / POST `/preferences` | Read/save per-subscriber `post_types` |
| GET | `/image-proxy` | Legacy image proxy — **unused by current clients** (lockdown candidate) |
| POST | `/poll` · `/test-email` · `/test-deletion-email` · `/test-welcome-email` · `/send-prefs-announcement` · GET `/admin/prefs-url` | Admin-only (Bearer `ADMIN_SECRET`) |
| — | *(catch-all)* | 404 handler, must stay last in `index.js`. Serves `public/404.html` to browsers, `{"error":"Not found"}` to API clients |

### Website Privacy Note (Aug 25 2026)
The landing page used to redirect signups to `/thank-you?prefs=<url with email +
token>`, and `/thank-you` loads Google Analytics — which reports the full URL as
`page_location`. That sent subscriber email addresses and their **non-expiring**
prefs token to Google. The prefs URL now travels in `sessionStorage` instead, and
`thank-you.html` scrubs any legacy `?prefs=` with `history.replaceState()` in a
script that must stay **above** the gtag snippet. Don't reintroduce query-string
params carrying email or tokens on any page that loads Analytics.

### Fetching Truth Social
- Truth Social sits behind Cloudflare and 403s plain datacenter IPs. The Pi uses
  Puppeteer + stealth to pass Cloudflare, then calls the API with a Bearer
  `TRUTH_SOCIAL_TOKEN`.
- **ScraperAPI is fallback-only** now (residential IPs, billed per successful
  request). In practice ScraperAPI usage is ~zero most days because Puppeteer is
  reliable. ⚠️ Open item: Aug 5 2026 Pi logs show `ScraperAPI returned 403` on
  video-refresh calls — the key is likely expired or out of credits, which would
  mean the emergency fallback is silently broken. Check the ScraperAPI dashboard.

---

## Supabase

### Tables
- **`posts`** — `truth_id` (unique), `text`, `content_html`, `created_at`, `url`,
  `media` (jsonb), `is_retruth`, `rt_url`, `reblog_preview`, `card`, `reblogs_count`,
  `favourites_count`, `deleted_at`, `suspected_deleted_at`, `importance`
  (smallint, added Aug 25 2026: 1/2/3 newsworthiness score from Claude Haiku,
  NULL = unscored → treat as major/send-to-everyone).
- **`subscribers`** — `email` (unique), `active` (bool), `source`, `post_types` (text[]).
  - `post_types = NULL` → receives **all** post types (the default).
  - `post_types = []` (empty array) → receives **nothing** (a silent "mute all").
  - `active` defaults to **TRUE**, so signup is **single opt-in** in practice.

### Auth
- Server uses the **service key** (bypasses RLS). RLS on `subscribers` denies the
  anon key.

### ⚠️ Opt-in note
`/subscribe` sends the welcome email immediately and does not set `active` (which
defaults TRUE) — so it's single opt-in. The confirmation machinery
(`sendConfirmationEmail`, `generateConfirmToken`, `/confirm`) exists but is **not
wired in** — effectively dead code. Decide whether to wire it up or delete it.

### ⚠️ Change-detection safety (see CLAUDE.md)
Re-send detection compares **`content_html` only** — never derived fields like
`text` or `card`. Changing `parsePost()` parsing can otherwise re-email old posts
to everyone. Read CLAUDE.md before touching `parsePost()`.

---

## In progress: importance tiers & burst collapsing (private beta)

Goal: cut email overload (~26 emails/day avg, 114 max). Three phases; regular
subscribers see zero change until GA — new features are gated to subscribers
Stefan flags as beta testers.

1. **Shadow scoring — LIVE since Aug 25 2026.** Every post scored 1/2/3 (see
   `src/scorer.js` above). Being validated against Stefan's own blind labels
   from `grade-posts.js`. Pass bar: nothing he labels major (3) scored 1.
2. **Tier filtering, beta-only — not built.** `subscribers.beta` (bool) +
   `subscribers.importance_tier` (`all`/`notable`/`major`, NULL = all).
   Preferences page shows the tier picker only to beta subscribers; enforce the
   beta gate when saving. Tier and `post_types` filters intersect. Unscored
   (NULL) posts go to everyone — fail open.
3. **Burst collapsing, beta-only — not built.** First post of a burst and all
   score-3 posts send immediately; lower-scored posts within 5 min of a prior
   send are held and bundled into one email. FIXED window (closes 5 min after
   the first held post — a sliding window never closes during long bursts).
   In-memory queue must flush on shutdown (every deploy restarts pm2), and
   `check-posts.sh` must learn about bundles or it will false-alarm.

---

## Services & Environment Variables
- **Railway** (server): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`,
  `UNSUBSCRIBE_SECRET`, `ADMIN_SECRET`, `BASE_URL`, `BLOCKED_IPS`,
  `TRUTH_SOCIAL_TOKEN`, `PORT`. Startup fails fast if `UNSUBSCRIBE_SECRET` /
  `ADMIN_SECRET` are missing/weak.
- **Pi** (poller `.env`): the Supabase + Resend keys above plus `USE_PUPPETEER`,
  `SCRAPER_API_KEY`, `TRUTH_SOCIAL_TOKEN`, `ANTHROPIC_API_KEY` (image subjects),
  `GEMINI_API_KEY` (video subjects).

---

## Deployment
- **Server:** push to `main` → Railway auto-deploys.
- **Pi:** `ssh sbecket@trumppi`, then `git pull` + `pm2 restart trump-poller`
  (the `update` alias does this). **Always update the Pi after pushing changes
  that affect `poller.js` / `emailer.js`** — Railway and the Pi run the same repo
  but the Pi is what actually polls and emails.

---

## Useful commands
- `pil` (Mac) — tail Pi logs over SSH.
- `ssh sbecket@trumppi` — SSH into the Pi (via Tailscale).
- `check` (Pi) — runs `check-posts.sh` to verify recent posts were emailed.
- `update` (Pi) — `git pull` + `pm2 restart trump-poller` + logs.
