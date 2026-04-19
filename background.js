// Trump Truth Social Alert - Background Service Worker
// ALL logic runs here. The offscreen doc is just a keepalive timer.

const RAILWAY_URL = "https://trump-truth-server-production.up.railway.app/posts?limit=10";

// ── Initialization ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
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
    await cleanupStaleNotifKeys();
  }
});

async function cleanupStaleNotifKeys() {
  const all = await chrome.storage.local.get(null);
  const staleKeys = Object.keys(all).filter((k) => k.startsWith("notif_truth-"));
  if (staleKeys.length > 50) {
    const sorted = staleKeys.sort((a, b) => {
      const idA = a.replace("notif_truth-", "");
      const idB = b.replace("notif_truth-", "");
      try { return Number(BigInt(idB) - BigInt(idA)); } catch { return idB.localeCompare(idA); }
    });
    const toRemove = sorted.slice(10);
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
  }
}

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

    chrome.storage.local.get("intervalSec").then(({ intervalSec }) => {
      port.postMessage({ type: "startTimer", seconds: intervalSec || 10 });
    });

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
  if (changes.intervalSec || changes.enabled) {
    chrome.offscreen.hasDocument().then((exists) => {
      if (exists) {
        chrome.offscreen.closeDocument().then(() => ensureOffscreen());
      }
    }).catch(() => {});
  }
});

// ── Core: check for new posts ───────────────────────────────────────────────

async function checkForNewPosts() {
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled === false) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let response;
    try {
      response = await fetch(RAILWAY_URL, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.warn(`[TruthAlert] Railway ${response.status} — skipping tick`);
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.warn(`[TruthAlert] Railway returned non-JSON (${contentType}) — skipping tick`);
      return;
    }

    const posts = await response.json();
    if (!Array.isArray(posts) || posts.length === 0) return;

    const latestTime = posts[0]?.created_at ? new Date(posts[0].created_at).toLocaleTimeString() : "unknown";
    console.log(`[TruthAlert] Checked ${new Date().toLocaleTimeString()} — latest post: ${latestTime}`);
    chrome.action.setBadgeText({ text: "" });

    const { lastSeenId } = await chrome.storage.local.get("lastSeenId");

    if (!lastSeenId) {
      console.log("[TruthAlert] Baseline set:", posts[0].id);
      await chrome.storage.local.set({ lastSeenId: posts[0].id, recentPosts: posts.slice(0, 10) });
      return;
    }

    const newPosts = posts.filter((p) => {
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

    await chrome.storage.local.set({ recentPosts: posts.slice(0, 10) });
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("[TruthAlert] Railway fetch timed out — skipping tick");
    } else {
      console.warn("[TruthAlert] Error:", err.message);
    }
  }
}

// ── Notifications ───────────────────────────────────────────────────────────

async function sendNotification(post) {
  const text = post.text || "";
  const mediaWithDesc = !text && post.media?.find(m => m.description);
  const mediaDescription = mediaWithDesc?.description;
  const hasVideo = !text && post.media?.some(m => m.type === "video");
  const mediaEmoji = mediaWithDesc?.type === "video" ? "🎬" : "📷";
  const preview = text.length > 200 ? text.substring(0, 200) + "…" : text || (mediaDescription ? `${mediaEmoji} ${mediaDescription}` : hasVideo ? "🎬 New video post" : "(media post)");
  const notifId = `truth-${post.id}`;
  const postUrl = post.url || `https://truthsocial.com/@realDonaldTrump/${post.id}`;

  await chrome.storage.local.set({ [`notif_${notifId}`]: postUrl });

  try {
    const createdId = await chrome.notifications.create(notifId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "New Truth from President Trump",
      message: preview,
      priority: 2,
      requireInteraction: true
    });
    console.log("[TruthAlert] Notified:", createdId);
  } catch (e) {
    console.warn("[TruthAlert] Notif error:", e.message);
  }
}

chrome.notifications.onClicked.addListener(async (notifId) => {
  const key = `notif_${notifId}`;
  const data = await chrome.storage.local.get(key);
  const url = data[key] || "https://truthsocial.com/@realDonaldTrump";
  if (isSafeUrl(url)) {
    chrome.tabs.create({ url });
  }
  chrome.notifications.clear(notifId);
  await chrome.storage.local.remove(key);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
