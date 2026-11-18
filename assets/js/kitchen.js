/**
 * kitchen.js — Kitchen Display System (KDS) Logic
 * Mosaic Engine HMS
 */

// ─── State ──────────────────────────────────────────────────────────────────
let kdsOrders       = [];      // All flattened order rounds
let kdsFilter       = "All";
let kdsCountdown    = 5;
let kdsTimerHandle  = null;
let kdsCountHandle  = null;
let kdsElapsedHandles = {};    // { orderId: intervalHandle }
let kdsStation      = (function () { try { return localStorage.getItem("kds_station") || "All"; } catch (e) { return "All"; } })();
let kdsRules        = { stations: [], warn_pct: 70, stale_min: 30, block_bill: true };
let kdsAlerted      = {};

function kdsEscape(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function kdsClearLocalLogin() {
  sessionStorage.removeItem("luka_logged_in");
  sessionStorage.removeItem("luka_logged_user");
  sessionStorage.removeItem("luka_logged_role");
}

// If the server says the login has expired (401), return to the login gate
(function installSessionGuard() {
  const originalFetch = window.fetch.bind(window);
  let redirecting = false;
  window.fetch = function(url, opts) {
    return originalFetch(url, Object.assign({ credentials: "same-origin" }, opts)).then(res => {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (res.status === 401 && u.indexOf("/api/login") === -1 && !redirecting &&
          sessionStorage.getItem("luka_logged_in") === "true") {
        redirecting = true;
        kdsClearLocalLogin();
        alert("Your session has expired. Please log in again.");
        location.reload();
      }
      return res;
    });
  };
})();

function kdsShowApp(user) {
  // Kitchen staff don't get a link back to the admin panel
  const role = sessionStorage.getItem("luka_logged_role");
  const adminLink = document.getElementById("kds-admin-link");
  if (adminLink) adminLink.style.display = role === "Kitchen" ? "none" : "";
  document.getElementById("kds-login").style.display  = "none";
  document.getElementById("kds-app").style.display    = "flex";
  document.getElementById("kds-staff-name").textContent = user;
  kdsStartRefreshLoop();
  kdsLoadOrders();
}

// ─── Init ────────────────────────────────────────────────────────────────────
(function init() {
  const stored = sessionStorage.getItem("luka_logged_in");
  const role   = sessionStorage.getItem("luka_logged_role") || "";
  const user   = sessionStorage.getItem("luka_logged_user") || "";

  const allowedRoles = ["Admin", "Owner", "Kitchen"];

  if (stored === "true" && allowedRoles.includes(role)) {
    // Confirm the login with the server before showing orders
    fetch("/api/session")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.authenticated === false) { kdsClearLocalLogin(); return; }
        if (data && data.authenticated && !allowedRoles.includes(data.role)) { kdsClearLocalLogin(); return; }
        kdsShowApp(data && data.username ? data.username : user);
      })
      .catch(() => kdsClearLocalLogin());
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
    if (data.status === "ok" || data.status === "success") {
      const allowedRoles = ["Admin", "Owner", "Kitchen"];
      if (!allowedRoles.includes(data.role)) {
        errEl.textContent = "Access denied: Kitchen role required.";
        return;
      }
      sessionStorage.setItem("luka_logged_in",   "true");
      sessionStorage.setItem("luka_logged_user",  data.username || username);
      sessionStorage.setItem("luka_logged_role",  data.role);
      kdsShowApp(data.username || username);
    } else {
      errEl.textContent = data.message || "Invalid credentials.";
    }
  })
  .catch(() => { errEl.textContent = "Server connection failed."; });
}

function kdsLogout() {
  kdsClearLocalLogin();
  fetch("/api/logout", { method: "POST" })
    .catch(() => {})
    .finally(() => location.reload());
}

// ─── DATA LOADING ────────────────────────────────────────────────────────────
function kdsLoadOrders() {
  const staff = sessionStorage.getItem("luka_logged_user") || "Kitchen";
  fetch("/api/kitchen/orders", {
    headers: { "X-Staff-User": encodeURIComponent(staff) }
  })
  .then(r => r.json())
  .then(data => {
    const list = Array.isArray(data) ? data : (data && data.tickets);
    if (!Array.isArray(list)) return;
    if (!Array.isArray(data)) {
      kdsRules = { stations: data.stations || [], warn_pct: data.warn_pct || 70, stale_min: data.stale_min || 30, block_bill: !!data.block_bill };
      kdsRenderStations();
    }
    kdsOrders = list;
    kdsRender();
    kdsUpdateMetrics();
    kdsAlerts();
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
    const matchStation = kdsStation === "All" || (o.stations || []).includes(kdsStation);
    if (!matchStation) return false;
    const matchSearch = !search ||
      String(o.table_no).includes(search) ||
      (o.order_id || "").toLowerCase().includes(search) ||
      (o.label || "").toLowerCase().includes(search);
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

// Time state vs the ticket's own target: ok → warn (at warn_pct of target) → late
function kdsTimeState(o, ms) {
  if (o.status === "Served" || o.status === "Ready") return "";
  const target = (o.target_min || 15) * 60000;
  if (ms >= target) return "late";
  if (ms >= target * (kdsRules.warn_pct / 100)) return "warn";
  return "";
}

function kdsCardHTML(o) {
  const elapsedMs = Date.now() - new Date(o.timestamp).getTime();
  const state    = kdsTimeState(o, elapsedMs);
  const timerStr = formatElapsed(elapsedMs);
  const items = (o.items || []).filter(it => kdsStation === "All" || it.station === kdsStation);
  const hidden = (o.items || []).length - items.length;

  const itemsHTML = items.map(it => `
    <div class="kds-item">
      <div class="kds-qty">${it.quantity}</div>
      <div>
        <div class="kds-iname">${kdsEscape(it.name)}</div>
        <div class="kds-ivar">${it.variant ? kdsEscape(it.variant) + " · " : ""}<span class="kds-stn">${kdsEscape(it.station || "")}</span></div>
      </div>
    </div>
  `).join("") + (hidden ? `<div class="kds-ivar" style="padding:4px 0 0 2px;">+ ${hidden} item(s) at other stations</div>` : "");

  let warnBar = "";
  if (o.escalated && o.status !== "Served") warnBar = `<div class="kds-warn-bar late"><i class="fas fa-bell"></i> Stale — over ${kdsRules.stale_min} min, manager alerted</div>`;
  else if (state === "late") warnBar = `<div class="kds-warn-bar late"><i class="fas fa-exclamation-triangle"></i> Late — target ${o.target_min} min</div>`;
  else if (state === "warn") warnBar = `<div class="kds-warn-bar"><i class="fas fa-hourglass-half"></i> ${kdsRules.warn_pct}% of the ${o.target_min}-min target used</div>`;
  const billBar = o.bill_asked && o.status !== "Served" ? `<div class="kds-warn-bar bill"><i class="fas fa-receipt"></i> Guest asked for the bill — serve now${kdsRules.block_bill ? " (bill is waiting)" : ""}</div>` : "";
  const title = o.label || `Table ${o.table_no}`;
  const chan = o.channel && o.channel !== "Dine-in" ? `<span class="kds-chan">${kdsEscape(o.channel)}</span>` : "";

  return `<div class="kds-card ${state}" data-status="${o.status}" data-id="${kdsEscape(o.order_id)}">
    <div class="kds-card-head">
      <div class="kds-card-head-left">
        <div class="kds-table-no">${kdsEscape(title)} ${chan}</div>
        <div class="kds-card-meta">${o.channel && o.channel !== "Dine-in" ? "" : `Round ${o.round || 1} &nbsp;·&nbsp; `}${formatTime(o.timestamp)} &nbsp;·&nbsp; target ${o.target_min || 15} min</div>
      </div>
      <div class="kds-card-head-right">
        <span class="kds-chip chip-${o.status}">${statusIcon(o.status)} ${o.status}</span>
        <span class="kds-timer ${state}" id="timer-${kdsEscape(o.order_id)}">${timerStr}</span>
      </div>
    </div>
    <div class="kds-card-body">
      <div class="kds-guest">
        <i class="fas fa-user"></i>
        ${kdsEscape(o.customer_name || "Guest")} &nbsp;·&nbsp;
        <i class="fas fa-hashtag" style="font-size:10px"></i>${kdsEscape(o.order_id)}
      </div>
      <div class="kds-items">${itemsHTML}</div>
      ${billBar}${warnBar}
    </div>
    <div class="kds-card-foot">${kdsFooterBtns(o)}<button class="kds-abtn kds-abtn-print" title="Print ticket" aria-label="Print ticket" onclick="kdsPrint('${kdsEscape(o.order_id)}')"><i class="fas fa-print"></i></button></div>
  </div>`;
}

// Station chips (All + each station from Settings)
function kdsRenderStations() {
  const bar = document.getElementById("kds-stations");
  if (!bar) return;
  const list = ["All"].concat(kdsRules.stations);
  if (!list.includes(kdsStation)) kdsStation = "All";
  const html = list.map(s => `<button class="kds-fbtn kds-sbtn ${s === kdsStation ? "active" : ""}" onclick="kdsSetStation('${kdsEscape(s)}')">${s === "All" ? '<i class="fas fa-layer-group"></i> All stations' : kdsEscape(s)}</button>`).join("");
  if (bar.dataset.html !== html) { bar.innerHTML = html; bar.dataset.html = html; }
}
function kdsSetStation(s) {
  kdsStation = s;
  try { localStorage.setItem("kds_station", s); } catch (e) {}
  kdsRenderStations();
  kdsRender();
}

// Beep + toast once for each new bill request / stale ticket
function kdsAlerts() {
  kdsOrders.forEach(o => {
    if (o.status === "Served") return;
    if (o.bill_asked && !kdsAlerted["b" + o.order_id]) { kdsAlerted["b" + o.order_id] = 1; kdsToast(`${o.label || "Table " + o.table_no}: guest asked for the bill`, "warning"); kdsBeep(); }
    if (o.escalated && !kdsAlerted["s" + o.order_id]) { kdsAlerted["s" + o.order_id] = 1; kdsToast(`${o.label || "Table " + o.table_no}: ticket is stale`, "error"); kdsBeep(); }
  });
}
function kdsBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); osc.frequency.value = 880; osc.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.25);
  } catch (e) {}
}

// Print a ticket for the selected station on the printer attached to this screen
function kdsPrint(id) {
  const o = kdsOrders.find(x => String(x.order_id) === String(id));
  if (!o) return;
  const items = (o.items || []).filter(it => kdsStation === "All" || it.station === kdsStation);
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) { kdsToast("Allow pop-ups to print tickets", "warning"); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>KOT ${kdsEscape(o.order_id)}</title><style>
    body{font-family:monospace;width:72mm;margin:0;padding:6px;font-size:13px} h1{font-size:18px;margin:0} .r{display:flex;gap:8px;margin:4px 0} .q{font-weight:bold;min-width:26px}
    hr{border:0;border-top:1px dashed #000} small{color:#333}</style></head><body>
    <h1>${kdsEscape(o.label || "Table " + o.table_no)}</h1><small>KOT ${kdsEscape(o.order_id)} · ${formatTime(o.timestamp)}${kdsStation !== "All" ? " · " + kdsEscape(kdsStation) : ""}</small><hr>
    ${items.map(it => `<div class="r"><span class="q">${it.quantity}×</span><span>${kdsEscape(it.name)}${it.variant ? " (" + kdsEscape(it.variant) + ")" : ""}<br><small>${kdsEscape(it.station || "")}</small></span></div>`).join("")}
    <hr><small>${kdsEscape(o.customer_name || "")}</small><script>window.onload=function(){window.print();setTimeout(function(){window.close()},300);}<\/script></body></html>`);
  w.document.close();
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
    const st = kdsTimeState(o, ms);
    el.textContent = formatElapsed(ms);
    el.classList.toggle("warn", st === "warn");
    el.classList.toggle("late", st === "late");
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
