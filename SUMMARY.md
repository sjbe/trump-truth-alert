# Trump Truth Alert — Project Summary

## What it does
A Chrome extension that polls Trump's Truth Social account and sends browser notifications when he posts.

## How it works
- Uses Truth Social's public Mastodon API: `https://truthsocial.com/api/v1/accounts/107780257626128497/statuses`
- An offscreen document runs `setInterval` every 60 seconds (bypasses Chrome's 30-second alarm minimum) and sends ticks to the background service worker via a port connection
- Background script checks for new posts, compares against `lastSeenId` in storage, and fires a Chrome notification for anything new
- Clicking the notification opens the post on Truth Social

## Recent fixes
- **Rate limiting (429):** stores a `rateLimitedUntil` timestamp in storage and skips checks during the 5-minute cooldown
- **Retruth parsing:** extracts the RT URL from raw HTML `href`, filters out the "RT:" marker and URL lines, leaving only Trump's comment — displayed first, with the RT URL shown at the bottom
- **Media attachments:** saves `media_attachments` and renders thumbnail previews in the popup (with ▶ overlay for video)
- **Load more button:** fetches older posts using `max_id` pagination

## Popup features
- Toggle notifications on/off
- Configurable polling interval (1 min, 2 min, 5 min)
- Recent posts with timestamps, retruth/media display, engagement counts
- Load more button

## Files
- `manifest.json` — version 1.2.2
- `background.js` — all core logic (API polling, notifications, storage)
- `offscreen.html` / `offscreen.js` — keepalive timer
- `popup.html` / `popup.js` — UI
- `icons/` — icon16, icon48, icon128

## Chrome Web Store
- Published at version 1.2.1
- Latest changes (retruth fix, load more, media) are at 1.2.2
- Upload `trump-truth-alert-store.zip` as an update in the developer console
