// Trump Truth Social Alert - Popup Script

const enableToggle = document.getElementById("enableToggle");
const statusBadge = document.getElementById("statusBadge");
const postsList = document.getElementById("postsList");

let allPosts = [];   // all posts loaded so far
let loadingMore = false;

// ── Load saved state ────────────────────────────────────────────────────────

async function init() {
  const data = await chrome.storage.local.get(["enabled", "intervalSec", "recentPosts"]);

  // Toggle
  const isEnabled = data.enabled !== false;
  enableToggle.checked = isEnabled;
  updateStatusBadge(isEnabled);

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

// ── Render recent posts ─────────────────────────────────────────────────────

function renderPosts(posts) {
  if (!posts.length) {
    postsList.innerHTML = `<div class="empty">No posts loaded yet.<br>They'll appear after the first check.</div>`;
    return;
  }

  postsList.innerHTML = posts
    .map((p) => {
      const timeAgo = getTimeAgo(new Date(p.created_at));
      const displayText = (() => {
        if (!p.card) return p.text;
        const text = p.text || "";
        const idx = text.lastIndexOf("https://");
        if (idx === -1) return text;
        return text.substring(0, idx).replace(/[\s:]+$/, "").trim();
      })();
      const isLong = displayText && displayText.length > 300;
      const preview = isLong ? displayText.substring(0, 300) + "…" : displayText;

      // Media grid helper
      function mediaGrid(mediaArr) {
        if (!mediaArr || !mediaArr.length) return "";
        const thumbs = mediaArr.map((m) => {
          const isVideo = m.type === "video" || m.type === "gifv";
          const fullUrl = m.url || m.preview_url;
          if (isVideo && !m.preview_url) {
            return `<div class="media-thumb media-thumb--no-preview" data-fullurl="${escapeAttr(fullUrl)}">
              <div class="media-play-placeholder">▶</div>
            </div>`;
          }
          return `<div class="media-thumb" data-fullurl="${escapeAttr(fullUrl)}">
            <img src="${escapeAttr(m.preview_url)}" loading="lazy" alt="">
            ${isVideo ? `<div class="media-play">▶</div>` : `<div class="media-expand">⤢</div>`}
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
          ${isLong ? `<div class="full-text" style="display:none">${escapeHtml(displayText)}</div>
          <div class="expand-btn">See full post ▾</div>` : ""}
          ${mediaGrid(p.media)}
          ${linkCard}
          ${reblogCard}
          ${rtFooter}
          <div class="post-meta">
            ${p.deleted ? `<span class="deleted-badge">DELETED</span>` : ""}
            <span>⏰ ${timeAgo}</span>
            <span>🔁 ${formatNum(p.reblogs_count)}</span>
            <span>❤️ ${formatNum(p.favourites_count)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  // Media thumbnails — open full image in new tab
  postsList.querySelectorAll(".media-thumb").forEach((thumb) => {
    thumb.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = thumb.dataset.fullurl;
      if (isSafeUrl(url)) chrome.tabs.create({ url });
    });
  });

  // Expand button
  postsList.querySelectorAll(".expand-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const post = btn.closest(".post");
      const preview = post.querySelector(".post-text");
      const full = post.querySelector(".full-text");
      const expanded = full.style.display !== "none";
      preview.style.display = expanded ? "" : "none";
      full.style.display = expanded ? "none" : "";
      btn.textContent = expanded ? "See full post ▾" : "Show less ▴";
    });
  });

  // Click to open
  postsList.querySelectorAll(".post").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".expand-btn")) return;
      const card = e.target.closest(".link-card");
      const url = card ? card.dataset.cardurl : el.dataset.url;
      if (isSafeUrl(url)) chrome.tabs.create({ url });
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

const TRUMP_ACCOUNT_ID = "107780257626128497";

async function loadMore(maxId) {
  if (loadingMore || !maxId) return;
  loadingMore = true;

  const btn = document.getElementById("loadMoreBtn");
  if (btn) btn.textContent = "Loading…";

  try {
    let newPosts = null;

    // Try server first
    try {
      const res = await fetch(`https://trump-truth-server-production.up.railway.app/posts?limit=10&before=${maxId}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) newPosts = data;
      }
    } catch (e) { /* fall through */ }

    // Fall back to Truth Social
    if (!newPosts) {
      const res = await fetch(`https://truthsocial.com/api/v1/accounts/${TRUMP_ACCOUNT_ID}/statuses?exclude_replies=true&limit=10&max_id=${maxId}`, { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const raw = await res.json();
      newPosts = raw.map(p => {
        const rawCard = p.card || null;
        const card = rawCard && rawCard.title ? {
          url: rawCard.url,
          title: rawCard.title,
          description: rawCard.description,
          image: rawCard.image,
          provider: rawCard.provider_name || (() => { try { return new URL(rawCard.url).hostname; } catch { return ""; } })()
        } : null;
        return {
          id: p.id,
          text: stripHtmlPopup(p.content || ""),
          created_at: p.created_at,
          url: p.url || `https://truthsocial.com/@realDonaldTrump/${p.id}`,
          reblogs_count: p.reblogs_count || 0,
          favourites_count: p.favourites_count || 0,
          media: (p.media_attachments || []).map(m => ({ type: m.type, preview_url: m.preview_url, url: m.url })),
          card
        };
      });
    }

    if (!newPosts?.length) {
      if (btn) { btn.textContent = "No more posts"; btn.style.opacity = "0.4"; btn.style.pointerEvents = "none"; }
      return;
    }

    allPosts = [...allPosts, ...newPosts];
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
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

// ── Email signup ─────────────────────────────────────────────────────────────

const SERVER = "https://trump-truth-server-production.up.railway.app";

async function initEmailSignup() {
  const { emailSubscribed, emailDismissed } = await chrome.storage.local.get(["emailSubscribed", "emailDismissed"]);
  if (emailSubscribed || emailDismissed) {
    document.getElementById("emailSignup").style.display = "none";
    return;
  }

  const input = document.getElementById("emailInput");
  const btn = document.getElementById("emailSubmit");
  const msg = document.getElementById("emailMsg");

  document.getElementById("emailDismiss").addEventListener("click", async () => {
    await chrome.storage.local.set({ emailDismissed: true });
    document.getElementById("emailSignup").style.display = "none";
  });

  btn.addEventListener("click", async () => {
    const email = input.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = "Please enter a valid email address.";
      msg.className = "email-msg error";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Subscribing…";
    msg.className = "email-msg";

    try {
      const res = await fetch(`${SERVER}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "extension" }),
      });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        await chrome.storage.local.set({ emailSubscribed: true });
        msg.textContent = "You're subscribed! Check your inbox for a welcome email.";
        msg.className = "email-msg success";
        input.style.display = "none";
        btn.style.display = "none";
      } else {
        throw new Error(data.error || `Server error ${res.status}`);
      }
    } catch (err) {
      msg.textContent = "Signup failed — please try again.";
      msg.className = "email-msg error";
      btn.disabled = false;
      btn.textContent = "Subscribe";
      console.error("[TruthAlert] subscribe error:", err);
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btn.click();
  });
}

// ── Go ──────────────────────────────────────────────────────────────────────
init();
initEmailSignup();
