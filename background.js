// Trump Truth Social Alert - Background Service Worker
// ALL logic runs here. The offscreen doc is just a keepalive timer.

const SERVER_URL = "https://trump-truth-server-production.up.railway.app/posts?limit=10";
const TRUMP_ACCOUNT_ID = "107780257626128497";
const TRUTH_SOCIAL_URL = `https://truthsocial.com/api/v1/accounts/${TRUMP_ACCOUNT_ID}/statuses?exclude_replies=true&limit=10`;

// ── Initialization ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[TruthAlert] Installed/updated");
  const data = await chrome.storage.local.get(["enabled", "intervalSec"]);
  if (data.enabled === undefined) await chrome.storage.local.set({ enabled: true });
  if (data.intervalSec === undefined) await chrome.storage.local.set({ intervalSec: 60 });
  await ensureOffscreen();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("[TruthAlert] Chrome started");
  await ensureOffscreen();
});

// Fallback alarm to re-create offscreen if it dies
chrome.alarms.create("ensureAlive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "ensureAlive") {
    await ensureOffscreen();
  }
});

// ── Offscreen document management ───────────────────────────────────────────

async function ensureOffscreen() {
  try {
    const exists = await chrome.offscreen.hasDocument();
    if (!exists) {
      console.log("[TruthAlert] Creating offscreen document");
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "Keepalive timer for fast polling"
      });
    }
  } catch (e) {
    console.warn("[TruthAlert] Offscreen error:", e.message);
  }
}

// ── Port-based keepalive from offscreen doc ─────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keepalive") {
    console.log("[TruthAlert] Offscreen connected");

    // Tell it to start ticking
    chrome.storage.local.get("intervalSec").then(({ intervalSec }) => {
      port.postMessage({ type: "startTimer", seconds: intervalSec || 10 });
    });

    // Each tick = time to check for new posts
    port.onMessage.addListener((msg) => {
      if (msg.type === "tick") {
        checkForNewPosts();
      }
    });
  }
});

// Forward setting changes to offscreen
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // We can't easily message the offscreen doc directly in this architecture,
  // so if interval changes, just recreate the offscreen doc
  if (changes.intervalSec || changes.enabled) {
    chrome.offscreen.hasDocument().then((exists) => {
      if (exists) {
        chrome.offscreen.closeDocument().then(() => ensureOffscreen());
      }
    }).catch(() => {});
  }
});

// ── Core: check for new posts ───────────────────────────────────────────────

async function fetchPosts() {
  // Try our server first (no rate limiting), fall back to Truth Social
  try {
    const res = await fetch(SERVER_URL);
    if (res.ok) {
      const posts = await res.json();
      if (Array.isArray(posts) && posts.length) return { posts, source: "server" };
    }
  } catch (e) {
    console.warn("[TruthAlert] Server unreachable, falling back to Truth Social");
  }

  // Fallback: Truth Social directly
  const res = await fetch(TRUTH_SOCIAL_URL, {
    headers: { "Accept": "application/json" }
  });
  if (!res.ok) throw new Error(`Truth Social API ${res.status}`);
  return { posts: await res.json(), source: "truthsocial" };
}

async function checkForNewPosts() {
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled === false) return;

  try {
    const { posts, source } = await fetchPosts();
    console.log(`[TruthAlert] Fetched from ${source}`);

    chrome.action.setBadgeText({ text: "" });

    // Normalize Truth Social posts to server format if needed
    const normalized = source === "server" ? posts : posts.map(p => ({
      id: p.id,
      text: stripHtml((p.content || "").replace(/<\/p>/gi, "\n").replace(/<p[^>]*>/gi, "")).trim(),
      created_at: p.created_at,
      url: p.url || `https://truthsocial.com/@realDonaldTrump/${p.id}`,
      reblogs_count: p.reblogs_count || 0,
      favourites_count: p.favourites_count || 0,
      media: (p.media_attachments || []).map(m => ({ type: m.type, preview_url: m.preview_url, url: m.url })),
      isRetruth: !!p.reblog,
      rtUrl: p.reblog?.url || null,
      reblogPreview: p.reblog ? {
        account: p.reblog.account?.display_name || "",
        text: stripHtml(p.reblog.content || "").substring(0, 140),
        media: (p.reblog.media_attachments || []).map(m => ({ type: m.type, preview_url: m.preview_url, url: m.url }))
      } : null,
      card: p.card ? { url: p.card.url, title: p.card.title, description: p.card.description, image: p.card.image, provider: p.card.provider_name || "" } : null
    }));

    if (!normalized.length) return;

    const { lastSeenId } = await chrome.storage.local.get("lastSeenId");

    // First run — save baseline, no notification
    if (!lastSeenId) {
      console.log("[TruthAlert] Baseline set:", normalized[0].id);
      await chrome.storage.local.set({ lastSeenId: normalized[0].id });
      await saveRecentPosts(normalized);
      return;
    }

    const newPosts = normalized.filter((p) => {
      try { return BigInt(p.id) > BigInt(lastSeenId); }
      catch { return p.id > lastSeenId; }
    });

    if (newPosts.length > 0) {
      console.log(`[TruthAlert] ${newPosts.length} NEW post(s)!`);
      await chrome.storage.local.set({ lastSeenId: newPosts[0].id });

      for (const post of newPosts.slice().reverse()) {
        await sendNotification(post);
      }

      chrome.action.setBadgeText({ text: "NEW" });
      chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000);
    }

    await saveRecentPosts(normalized);
  } catch (err) {
    console.warn("[TruthAlert] Check failed:", err.message);
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#b71c1c" });
  }
}

// ── Notifications ───────────────────────────────────────────────────────────

async function sendNotification(post) {
  const text = post.text || "";
  const preview = text.length > 200 ? text.substring(0, 200) + "…" : text;
  const notifId = `truth-${post.id}`;
  const postUrl = post.url || `https://truthsocial.com/@realDonaldTrump/${post.id}`;

  await chrome.storage.local.set({ [`notif_${notifId}`]: postUrl });

  try {
    const createdId = await chrome.notifications.create(notifId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "New Truth from President Trump",
      message: preview || "(media post)",
      priority: 2,
      requireInteraction: true
    });
    console.log("[TruthAlert] Notified:", createdId);
  } catch (e) {
    console.error("[TruthAlert] Notif error:", e.message);
  }
}

chrome.notifications.onClicked.addListener(async (notifId) => {
  const key = `notif_${notifId}`;
  const data = await chrome.storage.local.get(key);
  const url = data[key] || "https://truthsocial.com/@realDonaldTrump";
  chrome.tabs.create({ url });
  chrome.notifications.clear(notifId);
  await chrome.storage.local.remove(key);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
}

async function saveRecentPosts(posts) {
  await chrome.storage.local.set({ recentPosts: posts.slice(0, 10) });
}
