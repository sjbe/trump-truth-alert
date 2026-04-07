// Trump Truth Social Alert - Background Service Worker
// ALL logic runs here. The offscreen doc is just a keepalive timer.

const API_URL = "https://trump-truth-server-production.up.railway.app/posts?limit=10";

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

async function checkForNewPosts() {
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled === false) return;

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      console.warn(`[TruthAlert] API ${response.status}`);
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#b71c1c" });
      return;
    }

    chrome.action.setBadgeText({ text: "" });

    const posts = await response.json();
    if (!Array.isArray(posts) || posts.length === 0) return;

    const { lastSeenId } = await chrome.storage.local.get("lastSeenId");

    // First run — save baseline, no notification
    if (!lastSeenId) {
      console.log("[TruthAlert] Baseline set:", posts[0].id);
      await chrome.storage.local.set({ lastSeenId: posts[0].id });
      await saveRecentPosts(posts);
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

    await saveRecentPosts(posts);
  } catch (err) {
    console.error("[TruthAlert] Error:", err.message);
  }
}

// ── Notifications ───────────────────────────────────────────────────────────

async function sendNotification(post) {
  const text = post.text || "";
  const preview = text.length > 200 ? text.substring(0, 200) + "…" : text;
  const notifId = `truth-${post.id}`;
  const postUrl = post.url || `https://truthsocial.com/@realDonaldTrump/${post.id}`;

  await chrome.storage.local.set({ [`notif_${notifId}`]: postUrl });

  chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "New Truth from President Trump",
    message: preview || "(media post)",
    priority: 2,
    requireInteraction: true
  }, (createdId) => {
    if (chrome.runtime.lastError) {
      console.error("[TruthAlert] Notif error:", chrome.runtime.lastError.message);
    } else {
      console.log("[TruthAlert] Notified:", createdId);
    }
  });
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


async function saveRecentPosts(posts) {
  // Posts from the server are already parsed — save directly
  await chrome.storage.local.set({ recentPosts: posts.slice(0, 10) });
}
