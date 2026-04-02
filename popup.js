// Trump Truth Social Alert - Popup Script

const enableToggle = document.getElementById("enableToggle");
const statusBadge = document.getElementById("statusBadge");
const intervalSelect = document.getElementById("intervalSelect");
const postsList = document.getElementById("postsList");

// ── Load saved state ────────────────────────────────────────────────────────

async function init() {
  const data = await chrome.storage.local.get(["enabled", "intervalSec", "recentPosts"]);

  // Toggle
  const isEnabled = data.enabled !== false;
  enableToggle.checked = isEnabled;
  updateStatusBadge(isEnabled);

  // Interval
  intervalSelect.value = String(data.intervalSec || 10);

  // Posts
  renderPosts(data.recentPosts || []);
}

// ── Toggle notifications on/off ─────────────────────────────────────────────

enableToggle.addEventListener("change", async () => {
  const enabled = enableToggle.checked;
  await chrome.storage.local.set({ enabled });
  updateStatusBadge(enabled);
});

function updateStatusBadge(on) {
  statusBadge.textContent = on ? "ACTIVE" : "PAUSED";
  statusBadge.className = on ? "status on" : "status off";
}

// ── Interval selector ───────────────────────────────────────────────────────

intervalSelect.addEventListener("change", async () => {
  const sec = parseInt(intervalSelect.value, 10);
  await chrome.storage.local.set({ intervalSec: sec });
});

// ── Render recent posts ─────────────────────────────────────────────────────

function renderPosts(posts) {
  if (!posts.length) {
    postsList.innerHTML = `<div class="empty">No posts loaded yet.<br>They'll appear after the first check.</div>`;
    return;
  }

  postsList.innerHTML = posts
    .map((p) => {
      const timeAgo = getTimeAgo(new Date(p.created_at));
      const preview = p.text.length > 180 ? p.text.substring(0, 180) + "…" : p.text;
      return `
        <div class="post" data-url="${escapeAttr(p.url)}">
          <div class="post-text">${escapeHtml(preview)}</div>
          <div class="post-meta">
            <span>⏰ ${timeAgo}</span>
            <span>🔁 ${formatNum(p.reblogs_count)}</span>
            <span>❤️ ${formatNum(p.favourites_count)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  // Click to open
  postsList.querySelectorAll(".post").forEach((el) => {
    el.addEventListener("click", () => {
      chrome.tabs.create({ url: el.dataset.url });
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);

  // Show "just now" for < 1 min
  if (diffMins < 1) return "just now";

  // Today: show time like "2:45 PM"
  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (date.toDateString() === now.toDateString()) {
    return timeStr;
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `yesterday at ${timeStr}`;
  }

  // Older: show "Mar 31 at 2:45 PM"
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dateStr} at ${timeStr}`;
}

function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Go ──────────────────────────────────────────────────────────────────────
init();
