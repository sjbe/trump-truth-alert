// Trump Truth Social Alert - Popup Script

const enableToggle = document.getElementById("enableToggle");
const statusBadge = document.getElementById("statusBadge");
const intervalSelect = document.getElementById("intervalSelect");
const postsList = document.getElementById("postsList");

const TRUMP_ACCOUNT_ID = "107780257626128497";
let allPosts = [];   // all posts loaded so far
let loadingMore = false;

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
  allPosts = data.recentPosts || [];
  renderPosts(allPosts);
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

      // Media grid helper
      function mediaGrid(mediaArr) {
        if (!mediaArr || !mediaArr.length) return "";
        const thumbs = mediaArr.map((m) => {
          const isVideo = m.type === "video" || m.type === "gifv";
          return `<div class="media-thumb">
            <img src="${escapeAttr(m.preview_url)}" loading="lazy" alt="">
            ${isVideo ? `<div class="media-play">▶</div>` : ""}
          </div>`;
        }).join("");
        return `<div class="media-grid">${thumbs}</div>`;
      }

      // Retruth footer
      let rtFooter = "";
      if (p.isRetruth && p.rtUrl) {
        rtFooter = `<div class="rt-label">RT: <span class="rt-url">${escapeHtml(p.rtUrl)}</span></div>`;
      }

      // Link preview card
      let linkCard = "";
      if (p.card && p.card.title) {
        linkCard = `<div class="link-card" data-cardurl="${escapeAttr(p.card.url)}">
          ${p.card.image ? `<img src="${escapeAttr(p.card.image)}" class="link-card-img" loading="lazy" alt="">` : ""}
          <div class="link-card-body">
            ${p.card.provider ? `<div class="link-card-provider">${escapeHtml(p.card.provider)}</div>` : ""}
            <div class="link-card-title">${escapeHtml(p.card.title)}</div>
            ${p.card.description ? `<div class="link-card-desc">${escapeHtml(p.card.description)}</div>` : ""}
          </div>
        </div>`;
      }

      // Reblog card (pure retruth with no comment)
      let reblogCard = "";
      if (p.reblogPreview) {
        const rb = p.reblogPreview;
        reblogCard = `<div class="reblog-card">
          <div class="reblog-label">🔁 Retruth</div>
          ${rb.account ? `<div class="reblog-account">${escapeHtml(rb.account)}</div>` : ""}
          ${rb.text ? `<div class="reblog-text">${escapeHtml(rb.text)}</div>` : ""}
          ${mediaGrid(rb.media)}
        </div>`;
      }

      return `
        <div class="post" data-url="${escapeAttr(p.url)}">
          ${preview ? `<div class="post-text">${escapeHtml(preview)}</div>` : ""}
          ${mediaGrid(p.media)}
          ${linkCard}
          ${reblogCard}
          ${rtFooter}
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
    el.addEventListener("click", (e) => {
      const card = e.target.closest(".link-card");
      if (card) {
        chrome.tabs.create({ url: card.dataset.cardurl });
      } else {
        chrome.tabs.create({ url: el.dataset.url });
      }
    });
  });

  // Load more button
  const oldestId = posts[posts.length - 1]?.id;
  const btn = document.createElement("div");
  btn.id = "loadMoreBtn";
  btn.className = "load-more";
  btn.textContent = "Load more";
  btn.addEventListener("click", () => loadMore(oldestId));
  postsList.appendChild(btn);
}

async function loadMore(maxId) {
  if (loadingMore || !maxId) return;
  loadingMore = true;

  const btn = document.getElementById("loadMoreBtn");
  if (btn) btn.textContent = "Loading…";

  try {
    const url = `https://truthsocial.com/api/v1/accounts/${TRUMP_ACCOUNT_ID}/statuses?exclude_replies=true&limit=10&max_id=${maxId}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) {
      if (btn) { btn.textContent = "No more posts"; btn.style.opacity = "0.4"; btn.style.pointerEvents = "none"; }
      return;
    }

    // Parse into same shape as saved posts
    const newPosts = raw.map((p) => ({
      id: p.id,
      text: stripHtmlPopup(p.content || ""),
      created_at: p.created_at,
      url: p.url || `https://truthsocial.com/@realDonaldTrump/${p.id}`,
      reblogs_count: p.reblogs_count || 0,
      favourites_count: p.favourites_count || 0,
      media: (p.media_attachments || []).map((m) => ({
        type: m.type, preview_url: m.preview_url, url: m.url
      }))
    }));

    allPosts = [...allPosts, ...newPosts];

    // Remove old load-more button, re-render all
    if (btn) btn.remove();
    renderPosts(allPosts);
  } catch (err) {
    if (btn) { btn.textContent = "Error — try again"; btn.style.color = "#ef9a9a"; }
    console.error("[TruthAlert popup] loadMore error:", err);
  } finally {
    loadingMore = false;
  }
}

function stripHtmlPopup(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ").trim();
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
