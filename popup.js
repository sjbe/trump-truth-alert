// Trump Truth Social Alert - Popup Script

const enableToggle = document.getElementById("enableToggle");
const statusBadge = document.getElementById("statusBadge");
const postsList = document.getElementById("postsList");

let allPosts = [];   // all posts loaded so far
let loadingMore = false;

const ALL_TYPES = ["text", "link", "image", "video", "retruth"];
let activeFilters = new Set(ALL_TYPES);

function getDisplayText(p) {
  if (!p.card) return p.text;
  const text = p.text || "";
  const idx = text.lastIndexOf("https://");
  if (idx === -1) return text;
  return text.substring(0, idx).replace(/[\s:]+$/, "").trim();
}

function getPostType(p) {
  const displayText = getDisplayText(p);
  const hasVideo = p.media?.some(m => m.type === "video" || m.type === "gifv");
  const hasMedia = !!p.media?.length;
  if ((p.isRetruth || p.reblogPreview) && !displayText && hasMedia) return hasVideo ? "video" : "image";
  if (p.isRetruth || p.reblogPreview) return "retruth";
  if (!displayText && hasVideo) return "video";
  if (!displayText && hasMedia) return "image";
  if (p.card?.title) return "link";
  return "text";
}

function getTypeBadgeHtml(type, p) {
  const description = p.media?.find(m => m.description)?.description;
  const desc = description ? ` — ${escapeHtml(description)}` : "";
  switch (type) {
    case "link":    return `<span class="media-badge badge--link">🔗 LINK</span>`;
    case "image":   return `<span class="media-badge badge--image">📷 IMAGE${desc}</span>`;
    case "video":   return `<span class="media-badge badge--video">🎬 VIDEO${desc}</span>`;
    case "retruth": return `<span class="media-badge badge--retruth">🔁 RETRUTH</span>`;
    default:        return `<span class="media-badge">📝 TEXT</span>`;
  }
}

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
  const filtered = posts.filter(p => activeFilters.has(getPostType(p)));

  if (!posts.length) {
    postsList.innerHTML = `<div class="empty">No posts loaded yet.<br>They'll appear after the first check.</div>`;
    return;
  }
  if (!filtered.length) {
    postsList.innerHTML = `<div class="empty">No posts match the selected filters.</div>`;
    return;
  }

  postsList.innerHTML = filtered
    .map((p) => {
      const timeAgo = getTimeAgo(new Date(p.created_at));
      const displayText = getDisplayText(p);
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

      const postTypeBadge = getTypeBadgeHtml(getPostType(p), p);

      return `
        <div class="post" data-url="${escapeAttr(p.url)}">
          ${postTypeBadge}
          ${preview ? `<div class="post-text">${linkify(escapeHtml(preview))}</div>` : ""}
          ${isLong ? `<div class="full-text" style="display:none">${linkify(escapeHtml(displayText))}</div>
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

  // Media thumbnails — open the post on Truth Social (or the asset directly if deleted)
  postsList.querySelectorAll(".media-thumb").forEach((thumb) => {
    thumb.addEventListener("click", (e) => {
      e.stopPropagation();
      const post = thumb.closest(".post");
      const isDeleted = !!post?.querySelector(".deleted-badge");
      const url = isDeleted ? thumb.dataset.fullurl : post?.dataset.url;
      if (url && isSafeUrl(url)) chrome.tabs.create({ url });
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
      const inlineLink = e.target.closest("a[href]");
      const card = e.target.closest(".link-card");
      const url = inlineLink ? inlineLink.href : card ? card.dataset.cardurl : el.dataset.url;
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

async function loadMore(maxId, autoFetchCount = 0, filteredSoFar = 0) {
  const MAX_AUTO_FETCH = 10;
  if (loadingMore || !maxId) return;
  loadingMore = true;

  const btn = document.getElementById("loadMoreBtn");
  if (btn) btn.textContent = "Loading…";

  try {
    let newPosts = null;

    const res = await fetch(`https://trump-truth-server-production.up.railway.app/posts?limit=10&before=${maxId}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) newPosts = data;
    }

    if (!newPosts?.length) {
      if (btn) { btn.textContent = "No more posts"; btn.style.opacity = "0.4"; btn.style.pointerEvents = "none"; }
      return;
    }

    allPosts = [...allPosts, ...newPosts];

    const newFiltered = newPosts.filter(p => activeFilters.has(getPostType(p)));
    const totalFiltered = filteredSoFar + newFiltered.length;
    if (totalFiltered < 10 && newPosts.length === 10 && autoFetchCount < MAX_AUTO_FETCH) {
      const nextId = allPosts[allPosts.length - 1]?.id;
      loadingMore = false;
      if (nextId) { await loadMore(nextId, autoFetchCount + 1, totalFiltered); return; }
    }

    if (btn) btn.remove();
    renderPosts(allPosts);
  } catch (err) {
    if (btn) { btn.textContent = "Error — try again"; btn.style.color = "#ef9a9a"; }
    console.error("[TruthAlert popup] loadMore error:", err);
  } finally {
    loadingMore = false;
  }
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

function linkify(escapedHtml) {
  return escapedHtml.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
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

// ── Filter pills ─────────────────────────────────────────────────────────────

document.getElementById("filterBar").addEventListener("click", (e) => {
  const pill = e.target.closest(".filter-pill");
  if (!pill) return;
  const type = pill.dataset.type;
  const pills = document.querySelectorAll(".filter-pill");

  if (activeFilters.size === ALL_TYPES.length) {
    // All active — isolate to just this type
    activeFilters = new Set([type]);
    pills.forEach(p => p.classList.toggle("inactive", p.dataset.type !== type));
  } else if (activeFilters.has(type)) {
    activeFilters.delete(type);
    if (activeFilters.size === 0) {
      // Last one turned off — snap back to all
      activeFilters = new Set(ALL_TYPES);
      pills.forEach(p => p.classList.remove("inactive"));
    } else {
      pill.classList.add("inactive");
    }
  } else {
    activeFilters.add(type);
    pill.classList.remove("inactive");
  }
  renderPosts(allPosts);

  const currentFiltered = allPosts.filter(p => activeFilters.has(getPostType(p)));
  if (currentFiltered.length < 10 && allPosts.length >= 10) {
    const oldestId = allPosts[allPosts.length - 1]?.id;
    if (oldestId) loadMore(oldestId, 0, currentFiltered.length);
  }
});

// ── Go ──────────────────────────────────────────────────────────────────────
init();
initEmailSignup();
