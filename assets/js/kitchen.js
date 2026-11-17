/**
 * kitchen.js — Kitchen Display System (KDS) Logic
 * Downtown Luka v1.1
 */

// ─── State ──────────────────────────────────────────────────────────────────
let kdsOrders       = [];      // All flattened order rounds
let kdsFilter       = "All";
let kdsCountdown    = 5;
let kdsTimerHandle  = null;
let kdsCountHandle  = null;
let kdsElapsedHandles = {};    // { orderId: intervalHandle }

// ─── Init ────────────────────────────────────────────────────────────────────
(function init() {
  const stored = sessionStorage.getItem("luka_logged_in");
  const role   = sessionStorage.getItem("luka_logged_role") || "";
  const user   = sessionStorage.getItem("luka_logged_user") || "";

  const allowedRoles = ["Admin", "Owner", "Kitchen"];

  if (stored === "true" && allowedRoles.includes(role)) {
    document.getElementById("kds-login").style.display  = "none";
    document.getElementById("kds-app").style.display    = "flex";
    document.getElementById("kds-staff-name").textContent = user;
    kdsStartRefreshLoop();
    kdsLoadOrders();
  }
  // else: show login gate (default)
})();

// ─── LOGIN ───────────────────────────────────────────────────────────────────
function kdsLogin() {
  const username = document.getElementById("kds-username").value.trim();
  const password = document.getElementById("kds-password").value;
  const errEl    = document.getElementById("kds-login-error");

  errEl.textContent = "";
  if (!username || !password) {
    errEl.textContent = "Please enter username and password.";
    return;
  }

  fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  })
  .then(r => r.json())
  .then(data => {
    if (data.status === "ok") {
      const allowedRoles = ["Admin", "Owner", "Kitchen"];
      if (!allowedRoles.includes(data.role)) {
        errEl.textContent = "Access denied: Kitchen role required.";
        return;
      }
      sessionStorage.setItem("luka_logged_in",   "true");
      sessionStorage.setItem("luka_logged_user",  data.username || username);
      sessionStorage.setItem("luka_logged_role",  data.role);
      document.getElementById("kds-login").style.display = "none";
      document.getElementById("kds-app").style.display   = "flex";
      document.getElementById("kds-staff-name").textContent = data.username || username;
      kdsStartRefreshLoop();
      kdsLoadOrders();
    } else {
      errEl.textContent = data.message || "Invalid credentials.";
    }
  })
  .catch(() => { errEl.textContent = "Server connection failed."; });
}

function kdsLogout() {
  sessionStorage.removeItem("luka_logged_in");
  sessionStorage.removeItem("luka_logged_user");
  sessionStorage.removeItem("luka_logged_role");
  location.reload();
}

// ─── DATA LOADING ────────────────────────────────────────────────────────────
function kdsLoadOrders() {
  const staff = sessionStorage.getItem("luka_logged_user") || "Kitchen";
  fetch("/api/kitchen/orders", {
    headers: { "X-Staff-User": encodeURIComponent(staff) }
  })
  .then(r => r.json())
  .then(data => {
    if (Array.isArray(data)) {
      kdsOrders = data;
      kdsRender();
      kdsUpdateMetrics();
    }
  })
  .catch(err => console.error("KDS fetch error:", err));
}

// ─── RENDER ──────────────────────────────────────────────────────────────────
function kdsRender() {
  const grid    = document.getElementById("kds-grid");
  const search  = (document.getElementById("kds-search").value || "").toLowerCase();

  // Clear existing elapsed timers
  Object.values(kdsElapsedHandles).forEach(h => clearInterval(h));
  kdsElapsedHandles = {};

  let visible = kdsOrders.filter(o => {
    const matchFilter = kdsFilter === "All" || o.status === kdsFilter;
    const matchSearch = !search ||
      String(o.table_no).includes(search) ||
      (o.order_id || "").toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });

  // Sort: Received first, then Preparing, Ready, Served — within each by timestamp asc
  const statusOrder = { Received: 0, Preparing: 1, Ready: 2, Served: 3 };
  visible.sort((a, b) => {
    const sd = statusOrder[a.status] - statusOrder[b.status];
    if (sd !== 0) return sd;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  if (visible.length === 0) {
    const msg = kdsFilter !== "All"
      ? `No <strong>${kdsFilter}</strong> orders right now.`
      : "No active orders yet.";
    grid.innerHTML = `<div class="kds-empty">
      <i class="fas fa-utensils"></i>
      <h3>${kdsFilter !== "All" ? "No orders here" : "All Quiet in the Kitchen"}</h3>
      <p>${msg}</p>
    </div>`;
    return;
  }

  grid.innerHTML = visible.map(o => kdsCardHTML(o)).join("");

  // Start elapsed timers for unserved orders
  visible.forEach(o => {
    if (o.status !== "Served") kdsStartElapsed(o);
  });
}

function kdsCardHTML(o) {
  const now      = Date.now();
  const created  = new Date(o.timestamp).getTime();
  const elapsedMs = now - created;
  const warn     = elapsedMs > 15 * 60 * 1000 && o.status !== "Served";
  const timerStr = formatElapsed(elapsedMs);

  const itemsHTML = (o.items || []).map(it => `
    <div class="kds-item">
      <div class="kds-qty">${it.quantity}</div>
      <div>
        <div class="kds-iname">${it.name}</div>
        ${it.variant ? `<div class="kds-ivar">${it.variant}</div>` : ""}
      </div>
    </div>
  `).join("");

  const warnBar = warn ? `<div class="kds-warn-bar">
    <i class="fas fa-exclamation-triangle"></i> Waiting over 15 minutes!
  </div>` : "";

  const footerBtns = kdsFooterBtns(o);

  return `<div class="kds-card" data-status="${o.status}" data-id="${o.order_id}">
    <div class="kds-card-head">
      <div class="kds-card-head-left">
        <div class="kds-table-no">Table ${o.table_no}</div>
        <div class="kds-card-meta">Round ${o.round || 1} &nbsp;·&nbsp; ${formatTime(o.timestamp)}</div>
      </div>
      <div class="kds-card-head-right">
        <span class="kds-chip chip-${o.status}">${statusIcon(o.status)} ${o.status}</span>
        <span class="kds-timer ${warn ? "warn" : ""}" id="timer-${o.order_id}">${timerStr}</span>
      </div>
    </div>
    <div class="kds-card-body">
      <div class="kds-guest">
        <i class="fas fa-user"></i>
        ${o.customer_name || "Guest"} &nbsp;·&nbsp;
        <i class="fas fa-hashtag" style="font-size:10px"></i>${o.order_id}
      </div>
      <div class="kds-items">${itemsHTML}</div>
      ${warnBar}
    </div>
    <div class="kds-card-foot">${footerBtns}</div>
  </div>`;
}

function kdsFooterBtns(o) {
  const s = o.status;
  if (s === "Received") return `
    <button class="kds-abtn kds-abtn-start" onclick="kdsUpdateStatus('${o.order_id}', '${o.table_no}', 'Preparing')">
      <i class="fas fa-fire-flame-curved"></i> Start Preparing
    </button>`;
  if (s === "Preparing") return `
    <button class="kds-abtn kds-abtn-start" onclick="kdsUpdateStatus('${o.order_id}', '${o.table_no}', 'Preparing')" disabled style="opacity:0.4;cursor:default">Preparing...</button>
    <button class="kds-abtn kds-abtn-ready" onclick="kdsUpdateStatus('${o.order_id}', '${o.table_no}', 'Ready')">
      <i class="fas fa-check"></i> Mark Ready
    </button>`;
  if (s === "Ready") return `
    <button class="kds-abtn kds-abtn-done" disabled>Awaiting Pickup…</button>
    <button class="kds-abtn kds-abtn-served" onclick="kdsUpdateStatus('${o.order_id}', '${o.table_no}', 'Served')">
      <i class="fas fa-check-double"></i> Served
    </button>`;
  if (s === "Served") return `
    <button class="kds-abtn kds-abtn-done" disabled><i class="fas fa-check-double"></i> Completed</button>`;
  return "";
}

// ─── STATUS UPDATE ───────────────────────────────────────────────────────────
function kdsUpdateStatus(orderId, tableNo, newStatus) {
  const staff = sessionStorage.getItem("luka_logged_user") || "Kitchen";
  fetch("/api/kitchen/update-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Staff-User": encodeURIComponent(staff)
    },
    body: JSON.stringify({ order_id: orderId, table_no: tableNo, status: newStatus })
  })
  .then(r => r.json())
  .then(data => {
    if (data.status === "ok") {
      kdsToast(`Order ${orderId} → ${newStatus}`, "success");
      kdsLoadOrders();
    } else {
      kdsToast(data.message || "Update failed", "error");
    }
  })
  .catch(() => kdsToast("Connection error", "error"));
}

// ─── METRICS ─────────────────────────────────────────────────────────────────
function kdsUpdateMetrics() {
  const recv    = kdsOrders.filter(o => o.status === "Received").length;
  const prep    = kdsOrders.filter(o => o.status === "Preparing").length;
  const ready   = kdsOrders.filter(o => o.status === "Ready").length;
  const served  = kdsOrders.filter(o => o.status === "Served").length;

  document.getElementById("m-recv").textContent  = recv;
  document.getElementById("m-prep").textContent  = prep;
  document.getElementById("m-ready").textContent = ready;
  document.getElementById("m-serv").textContent  = served;

  // Avg prep time: orders that went from Received → Ready (approx: use time since created for Served)
  const servedOrders = kdsOrders.filter(o => o.status === "Served" && o.completed_at && o.timestamp);
  if (servedOrders.length > 0) {
    const totalMs = servedOrders.reduce((acc, o) => {
      return acc + (new Date(o.completed_at) - new Date(o.timestamp));
    }, 0);
    const avgMs = totalMs / servedOrders.length;
    document.getElementById("m-avg").textContent = formatElapsed(avgMs);
  } else {
    document.getElementById("m-avg").textContent = "—";
  }

  // Longest pending
  const pending = kdsOrders.filter(o => o.status !== "Served");
  if (pending.length > 0) {
    const oldest = pending.reduce((a, b) =>
      new Date(a.timestamp) < new Date(b.timestamp) ? a : b);
    const ms = Date.now() - new Date(oldest.timestamp).getTime();
    document.getElementById("m-long").textContent = formatElapsed(ms);
  } else {
    document.getElementById("m-long").textContent = "—";
  }
}

// ─── ELAPSED TIMERS ──────────────────────────────────────────────────────────
function kdsStartElapsed(o) {
  const el = document.getElementById(`timer-${o.order_id}`);
  if (!el) return;
  const created = new Date(o.timestamp).getTime();
  kdsElapsedHandles[o.order_id] = setInterval(() => {
    const ms  = Date.now() - created;
    const warn = ms > 15 * 60 * 1000;
    el.textContent = formatElapsed(ms);
    el.classList.toggle("warn", warn);
  }, 1000);
}

// ─── AUTO REFRESH LOOP ───────────────────────────────────────────────────────
function kdsStartRefreshLoop() {
  kdsCountdown = 5;
  if (kdsCountHandle) clearInterval(kdsCountHandle);
  kdsCountHandle = setInterval(() => {
    kdsCountdown--;
    const el = document.getElementById("kds-cd");
    if (el) el.textContent = `Refresh in ${kdsCountdown}s`;
    if (kdsCountdown <= 0) {
      kdsCountdown = 5;
      kdsLoadOrders();
    }
  }, 1000);
}

function kdsRefreshNow() {
  kdsCountdown = 5;
  kdsLoadOrders();
}

// ─── FILTER ──────────────────────────────────────────────────────────────────
function kdsSetFilter(btn) {
  document.querySelectorAll(".kds-fbtn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  kdsFilter = btn.dataset.filter;
  kdsRender();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function formatElapsed(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

function statusIcon(status) {
  return { Received: "🔴", Preparing: "🟡", Ready: "🟢", Served: "⬜" }[status] || "";
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
function kdsToast(msg, type = "success") {
  const container = document.getElementById("kds-toast-c");
  const el = document.createElement("div");
  const bg = type === "error" ? "#ef4444" : type === "warning" ? "#f59e0b" : "#10b981";
  el.style.cssText = `padding:10px 18px; border-radius:8px; background:${bg}; color:#fff; font-size:13px;
    font-weight:600; box-shadow:0 4px 12px rgba(0,0,0,0.3); opacity:0; transform:translateY(10px);
    transition:all 0.3s; font-family:'Outfit',sans-serif;`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; }, 10);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3000);
}
