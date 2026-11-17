/**
 * admin.js — Mosaic Engine HMS (Admin / ERP panel)
 *
 * Sections: Dashboard · Table Orders (billing, payment entry, split bill) ·
 * Sales Invoices · Menu Items · Categories · BOM & Inventory · Users ·
 * Audit Log · Settings (Admin only)
 */

/* ════════════════════════════════════════════════════════════════════════
   Utilities
   ════════════════════════════════════════════════════════════════════════ */

window.showToast = function(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  const icons = { success: "fa-circle-check", error: "fa-circle-exclamation", warning: "fa-triangle-exclamation", info: "fa-circle-info" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span></span>`;
  toast.querySelector("span").textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, type === "error" ? 5000 : 3200);
};

function escapeHTML(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Safe for use inside onclick="fn('…')" attributes
function jsArg(str) {
  return escapeHTML(String(str == null ? "" : str).replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function inr(n) {
  const v = round2(n);
  const hasPaise = Math.abs(v % 1) > 0.001;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 });
}

function formatDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d)) return escapeHTML(ts);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTime(ts) {
  const d = new Date(ts);
  return isNaN(d) ? "" : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function emptyRow(colspan, html) {
  return `<tr><td colspan="${colspan}" class="empty-cell">${html}</td></tr>`;
}

// JSON fetch helper: throws an Error with the server's message on failure
async function api(path, options = {}) {
  const opts = Object.assign({ credentials: "same-origin" }, options);
  if (opts.body && typeof opts.body !== "string" && !(opts.body instanceof FormData)) {
    opts.body = JSON.stringify(opts.body);
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) {
    throw new Error((data && data.message) || `Request failed (${res.status})`);
  }
  return data;
}

/* ════════════════════════════════════════════════════════════════════════
   Session & authentication
   ════════════════════════════════════════════════════════════════════════ */

// If the server says the login has expired (401), go back to the login screen.
(function installSessionGuard() {
  const originalFetch = window.fetch.bind(window);
  let redirecting = false;
  window.fetch = function(url, opts) {
    return originalFetch(url, Object.assign({ credentials: "same-origin" }, opts)).then(res => {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (res.status === 401 && u.indexOf("/api/login") === -1 && !redirecting &&
          sessionStorage.getItem("luka_logged_in") === "true") {
        redirecting = true;
        clearLocalLogin();
        alert("Your session has expired. Please sign in again.");
        window.location.reload();
      }
      return res;
    });
  };
})();

let currentUser = { username: "", role: "" };
let publicSettings = { business_name: "", business_address: "", tables_count: 15, payment_methods: ["UPI", "Cash", "Card"], bom_enabled: false };

function clearLocalLogin() {
  sessionStorage.removeItem("luka_logged_in");
  sessionStorage.removeItem("luka_logged_user");
  sessionStorage.removeItem("luka_logged_role");
}

function currentRole() {
  return currentUser.role || sessionStorage.getItem("luka_logged_role") || "";
}

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupMediaUploader();
  setupAdjustTypeToggle();
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      const open = [...document.querySelectorAll(".modal-backdrop.open")].pop();
      if (open) {
        if (open.id === "bill-modal") closeBillModal();
        else closeModal(open.id);
      } else if (document.body.classList.contains("nav-open")) {
        toggleNav(false);
      }
    }
  });

  // Confirm the login with the server; the browser's copy alone is not trusted
  if (sessionStorage.getItem("luka_logged_in") === "true") {
    fetch("/api/session")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.authenticated) {
          startApp(data.username, data.role);
        } else {
          clearLocalLogin();
        }
      })
      .catch(() => clearLocalLogin());
  }
});

function verifyLogin(e) {
  if (e) e.preventDefault();
  const username = document.getElementById("username-input").value.trim();
  const password = document.getElementById("passcode-input").value;
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("btn-login");
  errEl.textContent = "";
  if (!username || !password) {
    errEl.textContent = "Enter your username and password.";
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in…';

  api("/api/login", { method: "POST", body: { username, password } })
    .then(data => {
      if (data.status !== "success") throw new Error(data.message || "Login failed");
      if (data.role === "Kitchen") {
        sessionStorage.setItem("luka_logged_in", "true");
        sessionStorage.setItem("luka_logged_user", data.username);
        sessionStorage.setItem("luka_logged_role", data.role);
        window.location.href = "kitchen.html";
        return;
      }
      startApp(data.username, data.role);
      window.showToast(`Welcome back, ${data.username}!`, "success");
    })
    .catch(err => {
      errEl.textContent = err.message === "Invalid username or passcode." ? "Wrong username or password." : err.message;
    })
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Sign in';
    });
}

function logoutAdmin() {
  clearLocalLogin();
  fetch("/api/logout", { method: "POST" })
    .catch(() => {})
    .finally(() => window.location.reload());
}

async function startApp(username, role) {
  if (role === "Kitchen") {
    window.location.href = "kitchen.html";
    return;
  }
  currentUser = { username, role };
  sessionStorage.setItem("luka_logged_in", "true");
  sessionStorage.setItem("luka_logged_user", username);
  sessionStorage.setItem("luka_logged_role", role);

  document.getElementById("login-panel").style.display = "none";
  document.getElementById("admin-dashboard").style.display = "block";
  document.getElementById("user-name").textContent = username;
  document.getElementById("user-role").textContent = role;
  document.getElementById("user-avatar").textContent = (username || "?").charAt(0);

  await loadPublicSettings();
  applyRolePermissions();
  await loadData();

  const fromHash = (location.hash || "").replace("#", "");
  switchAdminTab(allowedTabs().includes(fromHash) ? fromHash : allowedTabs()[0]);
  startOrdersPolling();
}

async function loadPublicSettings() {
  try {
    publicSettings = Object.assign(publicSettings, await api("/api/settings/public"));
  } catch (e) {
    console.warn("Settings unavailable, using defaults", e);
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Navigation, roles and tabs
   ════════════════════════════════════════════════════════════════════════ */

const TABS = {
  dashboard:  { section: "sec-dashboard",     title: "Dashboard",        roles: ["Admin", "Owner"],                                 onOpen: () => window.loadDashboard && loadDashboard() },
  orders:     { section: "sec-table-orders",  title: "Table Orders",     roles: ["Admin", "Owner", "Receptionist", "Waiter"],       onOpen: () => { renderTablesGrid(); loadAdminTableOrders(); } },
  invoices:   { section: "sec-invoices",      title: "Sales Invoices",   roles: ["Admin", "Owner", "Receptionist"],                 onOpen: () => loadHistoricalInvoices() },
  items:      { section: "sec-items",         title: "Menu Items",       roles: ["Admin", "Owner", "Receptionist", "Waiter"],       onOpen: () => renderAdminItems() },
  categories: { section: "sec-categories",    title: "Categories",       roles: ["Admin", "Owner"],                                 onOpen: () => renderAdminCategories() },
  inventory:  { section: "sec-inventory",     title: "BOM & Inventory",  roles: ["Admin", "Owner", "Receptionist"], needsBom: true, onOpen: () => loadInventory() },
  users:      { section: "sec-users",         title: "Users",            roles: ["Admin"],                                          onOpen: () => loadUsers() },
  logs:       { section: "sec-logs",          title: "Audit Log",        roles: ["Admin", "Owner"],                                 onOpen: () => loadAuditLogs() },
  settings:   { section: "sec-settings",      title: "Settings",         roles: ["Admin"],                                          onOpen: () => loadSettings() },
};
let activeTab = null;

function allowedTabs() {
  const role = currentRole();
  return Object.keys(TABS).filter(t => TABS[t].roles.includes(role) && (!TABS[t].needsBom || publicSettings.bom_enabled));
}

function setupNav() {
  document.querySelectorAll(".nav-link[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      switchAdminTab(btn.dataset.tab);
      toggleNav(false);
    });
  });
}

function toggleNav(open) {
  document.body.classList.toggle("nav-open", !!open);
}

function applyRolePermissions() {
  const allowed = allowedTabs();
  const role = currentRole();
  document.querySelectorAll(".nav-link[data-tab]").forEach(btn => {
    btn.classList.toggle("hidden", !allowed.includes(btn.dataset.tab));
  });
  const kitchenLink = document.querySelector('.nav-link[data-link="kitchen"]');
  if (kitchenLink) kitchenLink.classList.toggle("hidden", !["Admin", "Owner"].includes(role));
  // Hide empty groups
  document.querySelectorAll(".nav-group").forEach(g => {
    const visible = [...g.querySelectorAll(".nav-link")].some(l => !l.classList.contains("hidden"));
    g.classList.toggle("hidden", !visible);
  });
  const addItemBtn = document.getElementById("btn-add-item-toggle");
  if (addItemBtn) addItemBtn.classList.toggle("hidden", !["Admin", "Owner"].includes(role));
  const addMatBtn = document.getElementById("btn-add-material");
  if (addMatBtn) addMatBtn.classList.toggle("hidden", !["Admin", "Owner"].includes(role));
  if (activeTab && !allowed.includes(activeTab)) switchAdminTab(allowed[0]);
}

function switchAdminTab(tab) {
  if (!allowedTabs().includes(tab)) tab = allowedTabs()[0];
  if (!tab) return;
  activeTab = tab;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(TABS[tab].section).classList.add("active");
  document.querySelectorAll(".nav-link[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("topbar-title").textContent = TABS[tab].title;
  document.title = `${TABS[tab].title} · Mosaic Engine HMS`;
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  window.scrollTo(0, 0);
  TABS[tab].onOpen();
}

/* ════════════════════════════════════════════════════════════════════════
   Modals
   ════════════════════════════════════════════════════════════════════════ */

function openModal(id) {
  const el = document.getElementById(id);
  // Each newly opened modal sits above the ones already open (e.g. Split over Bill)
  el.style.zIndex = 1500 + document.querySelectorAll(".modal-backdrop.open").length * 10;
  el.classList.add("open");
  document.body.style.overflow = "hidden";
  const first = document.querySelector(`#${id} .modal-body input:not([type=hidden]):not(:disabled):not([readonly]), #${id} .modal-body select:not(:disabled)`);
  if (first && window.matchMedia("(min-width: 641px)").matches) setTimeout(() => first.focus(), 50);
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  if (!document.querySelector(".modal-backdrop.open")) document.body.style.overflow = "";
}

/* ════════════════════════════════════════════════════════════════════════
   Menu data (items & categories)
   ════════════════════════════════════════════════════════════════════════ */

let categories = [];
let items = [];
let currentUploadedMedia = [];

function loadData() {
  return api("/api/menu")
    .then(data => {
      categories = data.categories || [];
      items = data.items || [];
    })
    .catch(err => {
      console.warn("Menu load failed, using local seed data:", err);
      if (window.LukaSeedData) {
        categories = window.LukaSeedData.initialCategories || [];
        items = window.LukaSeedData.initialItems || [];
      }
    })
    .finally(() => {
      populateCategorySelects();
      renderAdminItems();
      renderAdminCategories();
    });
}

function saveMenuData(actionDescription = "Modified Menu Catalog") {
  return fetch("/api/menu", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Audit-Action": encodeURIComponent(actionDescription)
    },
    body: JSON.stringify({ categories, items })
  })
  .then(async res => {
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.message || "Save failed");
    }
    window.showToast("Saved — changes are live on the menu.", "success");
  })
  .catch(err => {
    window.showToast(`Could not save: ${err.message}`, "error");
    loadData(); // reload the server copy so the screen matches reality
  });
}

function populateCategorySelects() {
  const formSelect = document.getElementById("item-category-select");
  const filterSelect = document.getElementById("table-filter-cat");
  const prevFilter = filterSelect.value;
  formSelect.innerHTML = "";
  filterSelect.innerHTML = '<option value="all">All categories</option>';
  [...categories].sort((a, b) => (a.section > b.section ? 1 : a.section < b.section ? -1 : a.display_order - b.display_order)).forEach(cat => {
    formSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHTML(cat.id)}">${cat.section === "food" ? "Food" : "Drinks"} — ${escapeHTML(cat.name)}</option>`);
    filterSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHTML(cat.id)}">${escapeHTML(cat.name)}</option>`);
  });
  if ([...filterSelect.options].some(o => o.value === prevFilter)) filterSelect.value = prevFilter;
}

function availabilityBadge(a) {
  if (a === "Available") return `<span class="badge badge-success"><i class="fas fa-circle" style="font-size:7px;"></i> Available</span>`;
  if (a === "Seasonal") return `<span class="badge badge-warning">Seasonal</span>`;
  return `<span class="badge badge-danger">Out of stock</span>`;
}

function renderAdminItems() {
  const tbody = document.getElementById("admin-items-tbody");
  const catFilter = document.getElementById("table-filter-cat").value;
  const q = (document.getElementById("item-search").value || "").trim().toLowerCase();
  const role = currentRole();

  let list = items.filter(item =>
    (catFilter === "all" || item.category_id === catFilter) &&
    (!q || item.name.toLowerCase().includes(q) || (item.description || "").toLowerCase().includes(q))
  );
  list.sort((a, b) => {
    const ca = categories.find(c => c.id === a.category_id), cb = categories.find(c => c.id === b.category_id);
    const d = ((ca && ca.display_order) || 0) - ((cb && cb.display_order) || 0);
    return d !== 0 ? d : (a.display_order || 0) - (b.display_order || 0);
  });

  if (list.length === 0) {
    tbody.innerHTML = emptyRow(6, q || catFilter !== "all" ? "No items match your search." : "No menu items yet.");
    return;
  }

  tbody.innerHTML = list.map(item => {
    const cat = categories.find(c => c.id === item.category_id);
    const prices = (item.price_variants || []).map(v => `${escapeHTML(v.label)} <b>${inr(v.price)}</b>`).join("<br>");
    let actions;
    if (role === "Waiter") {
      actions = `<button class="btn btn-ghost btn-sm" onclick="editItem('${jsArg(item.id)}')"><i class="fas fa-eye"></i> View</button>`;
    } else if (role === "Receptionist") {
      actions = `<button class="btn btn-secondary btn-sm" onclick="editItem('${jsArg(item.id)}')"><i class="fas fa-pen"></i> Edit</button>`;
    } else {
      actions = `<button class="btn btn-secondary btn-sm" onclick="editItem('${jsArg(item.id)}')"><i class="fas fa-pen"></i> Edit</button>
                 <button class="btn btn-danger-soft btn-sm" onclick="deleteItem('${jsArg(item.id)}')" aria-label="Delete"><i class="fas fa-trash"></i></button>`;
    }
    return `<tr>
      <td data-label="Item" class="strong">${escapeHTML(item.name)}</td>
      <td data-label="Category">${escapeHTML(cat ? cat.name : "Unassigned")}</td>
      <td data-label="Prices" style="font-size:13px;line-height:1.6;"><div>${prices || "—"}</div></td>
      <td data-label="Availability">${availabilityBadge(item.availability)}</td>
      <td data-label="Status">${item.status === "Published" ? '<span class="badge badge-primary">Published</span>' : '<span class="badge">Draft</span>'}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("");
}

function openItemForm() {
  resetItemForm();
  toggleFormFieldsForRole();
  openModal("item-modal");
}

function closeItemForm() {
  closeModal("item-modal");
}

function resetItemForm() {
  document.getElementById("item-crud-form").reset();
  document.getElementById("edit-item-id").value = "";
  document.getElementById("form-item-title").textContent = "Add menu item";
  currentUploadedMedia = [];
  renderMediaPreviews();
  document.getElementById("price-variants-container").innerHTML = "";
  addPriceVariantRow("Portion", "");
}

function editItem(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  resetItemForm();
  const viewOnly = currentRole() === "Waiter";
  document.getElementById("edit-item-id").value = item.id;
  document.getElementById("form-item-title").textContent = viewOnly ? item.name : `Edit: ${item.name}`;
  document.getElementById("item-name-input").value = item.name;
  document.getElementById("item-category-select").value = item.category_id;
  document.getElementById("item-desc-input").value = item.description || "";
  document.getElementById("item-avail-select").value = item.availability;
  document.getElementById("item-status-select").value = item.status;
  document.getElementById("item-order-input").value = item.display_order || 1;
  const tags = item.tags || [];
  document.getElementById("tag-veg-check").checked = tags.includes("Veg");
  document.getElementById("tag-nonveg-check").checked = tags.includes("Non-Veg");
  document.getElementById("tag-spicy-check").checked = tags.includes("Spicy");
  document.getElementById("tag-sig-check").checked = tags.includes("Signature");
  document.getElementById("tag-best-check").checked = tags.includes("Bestseller");
  currentUploadedMedia = [...(item.media || [])];
  renderMediaPreviews();
  const container = document.getElementById("price-variants-container");
  container.innerHTML = "";
  (item.price_variants && item.price_variants.length ? item.price_variants : [{ label: "Portion", price: "" }])
    .forEach(v => addPriceVariantRow(v.label, v.price));
  toggleFormFieldsForRole();
  openModal("item-modal");
}

function toggleFormFieldsForRole() {
  const viewOnly = currentRole() === "Waiter";
  document.querySelectorAll("#item-crud-form input, #item-crud-form select, #item-crud-form textarea").forEach(el => {
    if (el.type !== "hidden") el.disabled = viewOnly;
  });
  document.querySelectorAll("#item-crud-form button").forEach(b => {
    if (b.type === "submit" || b.closest("#price-variants-box") || b.closest(".media-thumb")) b.classList.toggle("hidden", viewOnly);
  });
  const zone = document.getElementById("media-drag-zone");
  zone.style.pointerEvents = viewOnly ? "none" : "";
  zone.style.opacity = viewOnly ? "0.5" : "";
}

function saveItem(e) {
  e.preventDefault();
  if (currentRole() === "Waiter") return;
  const idInput = document.getElementById("edit-item-id").value;
  const name = document.getElementById("item-name-input").value.trim();
  const categoryId = document.getElementById("item-category-select").value;
  const description = document.getElementById("item-desc-input").value.trim();
  const availability = document.getElementById("item-avail-select").value;
  const status = document.getElementById("item-status-select").value;
  const displayOrder = parseInt(document.getElementById("item-order-input").value, 10) || 1;

  const tags = [];
  if (document.getElementById("tag-veg-check").checked) tags.push("Veg");
  if (document.getElementById("tag-nonveg-check").checked) tags.push("Non-Veg");
  if (document.getElementById("tag-spicy-check").checked) tags.push("Spicy");
  if (document.getElementById("tag-sig-check").checked) tags.push("Signature");
  if (document.getElementById("tag-best-check").checked) tags.push("Bestseller");
  const catObj = categories.find(c => c.id === categoryId);
  if (catObj && catObj.section === "drinks") {
    tags.push(["cat-mocktails", "cat-beverages"].includes(categoryId) ? "Non-Alcoholic" : "Alcoholic");
  }

  const price_variants = [];
  const seen = new Set();
  document.querySelectorAll("#price-variants-container .variant-row").forEach(row => {
    const label = row.querySelector(".variant-label").value.trim();
    const price = parseFloat(row.querySelector(".variant-price").value);
    if (label && !seen.has(label.toLowerCase()) && price >= 0) {
      seen.add(label.toLowerCase());
      price_variants.push({ label, price });
    }
  });
  if (price_variants.length === 0) {
    window.showToast("Add at least one size with a price.", "error");
    return;
  }

  if (idInput) {
    const idx = items.findIndex(i => i.id === idInput);
    if (idx !== -1) {
      items[idx] = { ...items[idx], name, category_id: categoryId, description, tags, availability, status, display_order: displayOrder, media: currentUploadedMedia, price_variants };
    }
  } else {
    items.push({ id: `item-${Date.now()}`, category_id: categoryId, name, description, tags, availability, media: currentUploadedMedia, price_variants, display_order: displayOrder, status });
  }
  saveMenuData(idInput ? `Updated menu item: "${name}"` : `Added new menu item: "${name}"`);
  closeItemForm();
  renderAdminItems();
  renderAdminCategories();
}

function deleteItem(itemId) {
  const target = items.find(i => i.id === itemId);
  if (!target) return;
  if (!confirm(`Delete "${target.name}" from the menu?`)) return;
  items = items.filter(i => i.id !== itemId);
  saveMenuData(`Deleted menu item: "${target.name}"`);
  renderAdminItems();
  renderAdminCategories();
}

/* Media uploads */
function setupMediaUploader() {
  const zone = document.getElementById("media-drag-zone");
  const input = document.getElementById("media-file-input");
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", e => {
    e.preventDefault();
    zone.classList.remove("dragover");
    if (e.dataTransfer.files.length) uploadMediaFile(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => {
    if (input.files.length) uploadMediaFile(input.files[0]);
    input.value = "";
  });
}

function uploadMediaFile(file) {
  if (file.size > 20 * 1024 * 1024) {
    window.showToast("File is too large (max 20 MB).", "error");
    return;
  }
  window.showToast("Uploading…", "info");
  const formData = new FormData();
  formData.append("file", file);
  api("/api/upload", { method: "POST", body: formData })
    .then(data => {
      currentUploadedMedia.push(data.url);
      renderMediaPreviews();
      window.showToast("Uploaded.", "success");
    })
    .catch(err => window.showToast(`Upload failed: ${err.message}`, "error"));
}

function renderMediaPreviews() {
  const container = document.getElementById("media-previews");
  container.innerHTML = currentUploadedMedia.map((url, idx) => {
    const media = url.toLowerCase().endsWith(".mp4")
      ? `<video src="${escapeHTML(url)}" muted></video>`
      : `<img src="${escapeHTML(url)}" alt="">`;
    return `<div class="media-thumb">${media}<button type="button" onclick="removeMediaPreview(${idx})" aria-label="Remove"><i class="fas fa-xmark"></i></button></div>`;
  }).join("");
}

function removeMediaPreview(idx) {
  currentUploadedMedia.splice(idx, 1);
  renderMediaPreviews();
}

function addPriceVariantRow(label = "", price = "") {
  const div = document.createElement("div");
  div.className = "variant-row";
  div.innerHTML = `
    <input type="text" class="input variant-label" required placeholder="Size (e.g. Glass, 30 ml)" value="${escapeHTML(label)}" aria-label="Size">
    <input type="number" class="input variant-price" required placeholder="₹ Price" value="${escapeHTML(price)}" min="0" step="any" aria-label="Price">
    <button type="button" class="btn btn-icon btn-danger-soft" onclick="removePriceVariantRow(this)" aria-label="Remove size"><i class="fas fa-trash"></i></button>`;
  document.getElementById("price-variants-container").appendChild(div);
}

function removePriceVariantRow(btn) {
  const container = document.getElementById("price-variants-container");
  if (container.children.length <= 1) {
    window.showToast("An item needs at least one size.", "warning");
    return;
  }
  btn.closest(".variant-row").remove();
}

/* Categories */
function renderAdminCategories() {
  const tbody = document.getElementById("admin-categories-tbody");
  const list = [...categories].sort((a, b) => (a.section > b.section ? 1 : a.section < b.section ? -1 : a.display_order - b.display_order));
  if (!list.length) {
    tbody.innerHTML = emptyRow(6, "No categories yet.");
    return;
  }
  tbody.innerHTML = list.map(cat => {
    const count = items.filter(i => i.category_id === cat.id).length;
    return `<tr>
      <td data-label="Name" class="strong">${escapeHTML(cat.name)}</td>
      <td data-label="Section">${cat.section === "food" ? '<span class="badge badge-warning"><i class="fas fa-utensils"></i> Food</span>' : '<span class="badge badge-info"><i class="fas fa-martini-glass"></i> Drinks</span>'}</td>
      <td data-label="Order">${escapeHTML(cat.display_order)}</td>
      <td data-label="Items">${count}</td>
      <td data-label="Visible">${cat.visible ? '<span class="badge badge-success">Visible</span>' : '<span class="badge">Hidden</span>'}</td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="editCategory('${jsArg(cat.id)}')"><i class="fas fa-pen"></i> Edit</button>
        <button class="btn btn-danger-soft btn-sm" onclick="deleteCategory('${jsArg(cat.id)}')" aria-label="Delete"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join("");
}

function editCategory(catId) {
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;
  document.getElementById("edit-cat-id").value = cat.id;
  document.getElementById("form-category-title").innerHTML = `<i class="fas fa-pen"></i> Edit: ${escapeHTML(cat.name)}`;
  document.getElementById("cat-name-input").value = cat.name;
  document.getElementById("cat-section-select").value = cat.section;
  document.getElementById("cat-order-input").value = cat.display_order;
  document.getElementById("cat-visible-check").checked = !!cat.visible;
  document.getElementById("category-crud-form").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("cat-name-input").focus({ preventScroll: true });
}

function resetCategoryForm() {
  document.getElementById("category-crud-form").reset();
  document.getElementById("edit-cat-id").value = "";
  document.getElementById("form-category-title").innerHTML = '<i class="fas fa-pen"></i> Add category';
}

function saveCategory(e) {
  e.preventDefault();
  const idInput = document.getElementById("edit-cat-id").value;
  const name = document.getElementById("cat-name-input").value.trim();
  const section = document.getElementById("cat-section-select").value;
  const displayOrder = parseInt(document.getElementById("cat-order-input").value, 10) || 1;
  const visible = document.getElementById("cat-visible-check").checked;
  if (idInput) {
    const idx = categories.findIndex(c => c.id === idInput);
    if (idx !== -1) categories[idx] = { ...categories[idx], name, section, display_order: displayOrder, visible };
  } else {
    categories.push({ id: `cat-${Date.now()}`, name, section, display_order: displayOrder, visible });
  }
  saveMenuData(idInput ? `Updated category: "${name}"` : `Created category: "${name}"`);
  resetCategoryForm();
  populateCategorySelects();
  renderAdminCategories();
  renderAdminItems();
}

function deleteCategory(catId) {
  if (items.some(item => item.category_id === catId)) {
    alert("This category still has menu items. Move or delete those items first.");
    return;
  }
  const target = categories.find(c => c.id === catId);
  if (!target || !confirm(`Delete category "${target.name}"?`)) return;
  categories = categories.filter(c => c.id !== catId);
  saveMenuData(`Deleted category: "${target.name}"`);
  populateCategorySelects();
  renderAdminCategories();
}

/* ════════════════════════════════════════════════════════════════════════
   Users (Admin)
   ════════════════════════════════════════════════════════════════════════ */

let usersList = {};

function openUserForm() {
  document.getElementById("user-crud-form").reset();
  document.getElementById("edit-user-original-name").value = "";
  document.getElementById("form-user-title").textContent = "Add user";
  document.getElementById("btn-save-user").textContent = "Create user";
  document.getElementById("user-name-input").disabled = false;
  const pw = document.getElementById("user-password-input");
  pw.required = true;
  pw.placeholder = "Min. 6 characters";
  openModal("user-modal");
}

function closeUserForm() {
  closeModal("user-modal");
}

function loadUsers() {
  const tbody = document.getElementById("admin-users-tbody");
  tbody.innerHTML = emptyRow(4, '<i class="fas fa-spinner fa-spin"></i> Loading…');
  api("/api/users")
    .then(data => { usersList = data || {}; renderUsersTable(); })
    .catch(err => { tbody.innerHTML = emptyRow(4, escapeHTML(err.message)); });
}

const ROLE_BADGE = { Admin: "badge-danger", Owner: "badge-violet", Receptionist: "badge-info", Waiter: "badge-success", Kitchen: "badge-warning" };

function renderUsersTable() {
  const tbody = document.getElementById("admin-users-tbody");
  const names = Object.keys(usersList).sort();
  if (!names.length) {
    tbody.innerHTML = emptyRow(4, "No users.");
    return;
  }
  const me = currentUser.username.toLowerCase();
  tbody.innerHTML = names.map(name => {
    const role = usersList[name].role || "Waiter";
    const isMe = name.toLowerCase() === me;
    return `<tr>
      <td data-label="Username" class="strong"><span><i class="fas fa-circle-user" style="color:var(--faint);margin-right:6px;"></i>${escapeHTML(name)}${isMe ? ' <span class="badge">You</span>' : ""}</span></td>
      <td data-label="Role"><span class="badge ${ROLE_BADGE[role] || ""}">${escapeHTML(role)}</span></td>
      <td data-label="Password" class="muted"><i class="fas fa-lock" style="margin-right:4px;"></i>Encrypted</td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="editUserProfile('${jsArg(name)}')"><i class="fas fa-pen"></i> Edit</button>
        ${isMe ? "" : `<button class="btn btn-danger-soft btn-sm" onclick="deleteUserProfile('${jsArg(name)}')" aria-label="Delete"><i class="fas fa-trash"></i></button>`}
      </td>
    </tr>`;
  }).join("");
}

function editUserProfile(name) {
  const profile = usersList[name];
  if (!profile) return;
  document.getElementById("user-crud-form").reset();
  document.getElementById("edit-user-original-name").value = name;
  document.getElementById("form-user-title").textContent = `Edit user: ${name}`;
  document.getElementById("user-name-input").value = name;
  document.getElementById("user-name-input").disabled = true;
  const pw = document.getElementById("user-password-input");
  pw.value = "";
  pw.required = false;
  pw.placeholder = "Leave blank to keep current password";
  document.getElementById("user-role-select").value = profile.role || "Waiter";
  document.getElementById("btn-save-user").textContent = "Save changes";
  openModal("user-modal");
}

function persistUsers(payload, successMsg) {
  return api("/api/users", { method: "POST", body: payload })
    .then(() => { window.showToast(successMsg, "success"); closeUserForm(); loadUsers(); })
    .catch(err => { window.showToast(err.message, "error"); loadUsers(); });
}

function saveUserProfile(e) {
  e.preventDefault();
  const originalName = document.getElementById("edit-user-original-name").value.trim();
  const username = document.getElementById("user-name-input").value.trim().toLowerCase();
  const password = document.getElementById("user-password-input").value;
  const role = document.getElementById("user-role-select").value;
  if (!originalName && !password) {
    window.showToast("Enter a password for the new user.", "error");
    return;
  }
  if (password && password.length < 6) {
    window.showToast("Password must be at least 6 characters.", "error");
    return;
  }
  // Only send passwords that are being set or changed; the server keeps the rest
  const payload = {};
  Object.keys(usersList).forEach(n => { payload[n] = { role: usersList[n].role }; });
  if (originalName) {
    payload[originalName] = password ? { password, role } : { role };
  } else {
    if (payload[username]) {
      window.showToast("That username already exists.", "error");
      return;
    }
    payload[username] = { password, role };
  }
  persistUsers(payload, originalName ? "User updated." : "User created.");
}

function deleteUserProfile(name) {
  if (name.toLowerCase() === currentUser.username.toLowerCase()) {
    alert("You cannot delete your own account.");
    return;
  }
  if (!confirm(`Delete user "${name}"? They will be signed out immediately.`)) return;
  const payload = {};
  Object.keys(usersList).forEach(n => { if (n !== name) payload[n] = { role: usersList[n].role }; });
  persistUsers(payload, "User deleted.");
}

/* ════════════════════════════════════════════════════════════════════════
   Audit log
   ════════════════════════════════════════════════════════════════════════ */

let auditLogs = [];

function loadAuditLogs() {
  const tbody = document.getElementById("admin-logs-tbody");
  tbody.innerHTML = emptyRow(3, '<i class="fas fa-spinner fa-spin"></i> Loading…');
  api("/api/audit-log")
    .then(data => {
      auditLogs = Array.isArray(data) ? data : [];
      renderAuditLogs();
    })
    .catch(err => {
      auditLogs = [];
      tbody.innerHTML = emptyRow(3, `<i class="fas fa-triangle-exclamation" style="color:var(--danger)"></i> ${escapeHTML(err.message)}`);
    });
}

function auditIcon(action) {
  const a = action.toLowerCase();
  if (a.includes("logged in") || a.includes("logged out")) return "fa-right-to-bracket";
  if (a.includes("settled") || a.includes("invoice")) return "fa-receipt";
  if (a.includes("sms")) return "fa-comment-sms";
  if (a.includes("order")) return "fa-bell-concierge";
  if (a.includes("stock") || a.includes("material") || a.includes("recipe")) return "fa-boxes-stacked";
  if (a.includes("setting")) return "fa-gear";
  if (a.includes("user")) return "fa-users-gear";
  if (a.includes("menu") || a.includes("item") || a.includes("category")) return "fa-utensils";
  return "fa-circle-dot";
}

function renderAuditLogs() {
  const tbody = document.getElementById("admin-logs-tbody");
  const q = document.getElementById("log-search-box").value.trim().toLowerCase();
  const list = auditLogs.filter(l => !q || (l.user || "").toLowerCase().includes(q) || (l.action || "").toLowerCase().includes(q));
  if (!list.length) {
    tbody.innerHTML = emptyRow(3, auditLogs.length ? "No entries match your filter." : "No activity recorded yet. Sign-ins, menu edits and bills will appear here.");
    return;
  }
  tbody.innerHTML = list.slice(0, 500).map(l => `<tr>
      <td data-label="When" class="muted nowrap" style="font-size:13px;">${formatDateTime(l.timestamp)}</td>
      <td data-label="User" class="strong">${escapeHTML(l.user)}</td>
      <td data-label="Action" style="text-align:left;"><span><i class="fas ${auditIcon(l.action || "")}" style="color:var(--primary);margin-right:8px;width:14px;"></i>${escapeHTML(l.action)}</span></td>
    </tr>`).join("") + (list.length > 500 ? emptyRow(3, `Showing latest 500 of ${list.length}. Use the filter to narrow down.`) : "");
}

/* ════════════════════════════════════════════════════════════════════════
   Table orders
   ════════════════════════════════════════════════════════════════════════ */

let activeOrdersList = {};
let selectedAdminTableNo = null;
let ordersPollHandle = null;

function startOrdersPolling() {
  if (ordersPollHandle || !TABS.orders.roles.includes(currentRole())) return;
  loadAdminTableOrders(true);
  ordersPollHandle = setInterval(() => {
    if (!document.hidden) loadAdminTableOrders(true);
  }, 15000);
}

function loadAdminTableOrders(silent = false) {
  return api("/api/orders")
    .then(data => {
      activeOrdersList = data || {};
      updateBillBadge();
      if (activeTab === "orders") {
        renderTablesGrid();
        if (selectedAdminTableNo) showTableDetail(selectedAdminTableNo);
      }
    })
    .catch(err => { if (silent !== true) window.showToast(`Could not load orders: ${err.message}`, "error"); });
}

function updateBillBadge() {
  const n = Object.values(activeOrdersList).filter(s => s && s.status === "Checkout Requested").length;
  const badge = document.getElementById("nav-bill-badge");
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
}

function tableNumbers() {
  const count = Math.max(1, parseInt(publicSettings.tables_count, 10) || 15);
  const nums = Array.from({ length: count }, (_, i) => String(i + 1));
  // Include any active table outside the configured range (e.g. "Bar" or 21)
  Object.values(activeOrdersList).forEach(s => {
    if (s && s.table_no && !nums.includes(String(s.table_no))) nums.push(String(s.table_no));
  });
  return nums;
}

function renderTablesGrid() {
  const container = document.getElementById("admin-tables-grid");
  container.innerHTML = tableNumbers().map(no => {
    const s = activeOrdersList[`table_${no}`];
    const busy = s && s.orders && s.orders.length > 0;
    const bill = s && s.status === "Checkout Requested";
    const cls = bill ? "is-bill" : busy ? "is-active" : "";
    const label = bill ? "Bill" : busy ? "Dining" : "Free";
    return `<button type="button" class="table-tile ${cls} ${selectedAdminTableNo === no ? "is-selected" : ""}" onclick="selectTable('${jsArg(no)}')" aria-label="Table ${escapeHTML(no)}, ${label}">
      <div class="no">${escapeHTML(no)}</div><div class="st">${label}</div>
    </button>`;
  }).join("");
}

function selectTable(no) {
  selectedAdminTableNo = String(no);
  renderTablesGrid();
  showTableDetail(selectedAdminTableNo);
  if (window.matchMedia("(max-width: 860px)").matches) {
    document.getElementById("admin-table-detail-pane").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showTableDetail(tableNo) {
  const empty = document.getElementById("table-detail-empty-state");
  const content = document.getElementById("table-detail-content");
  const session = activeOrdersList[`table_${tableNo}`];

  if (!session || !session.orders || !session.orders.length) {
    content.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.innerHTML = `<i class="fas fa-chair"></i><h4>Table ${escapeHTML(tableNo)} is free</h4>
      <p>No one is ordering here right now. Orders placed from this table's QR code will show up automatically.</p>`;
    return;
  }

  empty.classList.add("hidden");
  content.classList.remove("hidden");
  document.getElementById("detail-table-title").innerHTML =
    `Table ${escapeHTML(tableNo)} ${session.status === "Checkout Requested" ? '<span class="badge badge-violet" style="margin-left:6px;"><i class="fas fa-bell"></i> Bill requested</span>' : ""}`;
  document.getElementById("detail-guest-line").innerHTML =
    `<span><i class="fas fa-user"></i>${escapeHTML(session.customer_name || "Guest")}</span>` +
    (session.customer_phone ? `<span><i class="fas fa-phone"></i>${escapeHTML(session.customer_phone)}</span>` : "") +
    `<span><i class="fas fa-layer-group"></i>${session.orders.length} round${session.orders.length > 1 ? "s" : ""}</span>`;
  document.getElementById("btn-generate-bill").classList.toggle("hidden", currentRole() === "Waiter");

  let running = 0;
  document.getElementById("detail-rounds-container").innerHTML = session.orders.map((round, idx) => {
    const lines = (round.items || []).map(i => {
      const line = (Number(i.price) || 0) * (Number(i.quantity) || 0);
      running += line;
      return `<div class="round-line"><span><span class="qty">${escapeHTML(i.quantity)}×</span>${escapeHTML(i.name)} <span class="var">· ${escapeHTML(i.variant)}</span></span><span class="nowrap">${inr(line)}</span></div>`;
    }).join("");
    const statuses = ["Received", "Preparing", "Ready", "Served"];
    return `<div class="round">
      <div class="round-head">
        <div class="round-title">Round ${idx + 1}<span class="time">${formatTime(round.timestamp)}</span></div>
        <select class="select status-select" aria-label="Kitchen status for round ${idx + 1}" onchange="updateAdminOrderStatus('${jsArg(tableNo)}', '${jsArg(round.order_id)}', this.value)">
          ${statuses.map(s => `<option value="${s}" ${round.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      ${lines}
    </div>`;
  }).join("");
  document.getElementById("detail-running-total").textContent = inr(running);
}

function updateAdminOrderStatus(tableNo, orderId, status) {
  api("/api/orders/update-status", { method: "POST", body: { table_no: tableNo, order_id: orderId, status } })
    .then(() => { window.showToast(`Round marked ${status}.`, "success"); loadAdminTableOrders(); })
    .catch(err => { window.showToast(err.message, "error"); loadAdminTableOrders(); });
}

/* ════════════════════════════════════════════════════════════════════════
   Billing, payment entry & split bill
   ════════════════════════════════════════════════════════════════════════ */

let currentCheckoutBill = null;   // live bill being settled
let activeReceiptObject = null;   // whatever the bill modal is showing (for PDF)
let payments = [];                // [{label, method, amount, reference}]

const METHOD_ICONS = { UPI: "fa-qrcode", Cash: "fa-money-bill-wave", Card: "fa-credit-card" };

function computeBill(session) {
  const map = new Map();
  let subtotal = 0;
  session.orders.forEach(round => (round.items || []).forEach(i => {
    const key = `${i.id || i.name}||${i.variant}`;
    subtotal += (Number(i.price) || 0) * (Number(i.quantity) || 0);
    if (map.has(key)) map.get(key).quantity += Number(i.quantity) || 0;
    else map.set(key, { ...i, quantity: Number(i.quantity) || 0 });
  }));
  subtotal = round2(subtotal);
  const service_charge = round2(subtotal * 0.10);
  const tax = round2(subtotal * 0.05);
  return { items: [...map.values()], subtotal, service_charge, tax, total: round2(subtotal + service_charge + tax) };
}

function fillReceipt(r, opts) {
  document.getElementById("bill-biz-name").textContent = publicSettings.business_name || "Receipt";
  document.getElementById("bill-biz-addr").textContent = [publicSettings.business_address, publicSettings.business_phone, publicSettings.gstin ? `GSTIN ${publicSettings.gstin}` : ""].filter(Boolean).join(" · ");
  const meta = [
    ["Invoice", opts.invoiceId || "Draft — not yet paid"],
    ["Table", r.table_no],
    ["Guest", r.customer_name || "Guest"],
    ["Phone", r.customer_phone || "—"],
    ["Date", opts.date],
  ];
  document.getElementById("bill-meta-info").innerHTML = meta.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHTML(v)}</dd>`).join("");
  document.getElementById("bill-items-list").innerHTML = (r.items || []).map(it => `
    <div class="receipt-line">
      <div class="n">${escapeHTML(it.name)} × ${escapeHTML(it.quantity)}<small>${escapeHTML(it.variant)} · ${inr(it.price)} each</small></div>
      <div class="nowrap">${inr(it.price * it.quantity)}</div>
    </div>`).join("");
  document.getElementById("bill-subtotal").textContent = inr(r.subtotal);
  document.getElementById("bill-service-charge").textContent = inr(r.service_charge);
  document.getElementById("bill-tax").textContent = inr(r.tax);
  document.getElementById("bill-grand-total").textContent = inr(r.total);

  const paid = document.getElementById("bill-paid-lines");
  if (opts.payments && opts.payments.length) {
    paid.innerHTML = `<div style="font-weight:700;margin-bottom:4px;">Paid</div>` + opts.payments.map(p =>
      `<div class="row"><span>${escapeHTML(p.label || "Payment")} · ${escapeHTML(p.method)}${p.reference ? ` <span class="muted">(${escapeHTML(p.reference)})</span>` : ""}</span><span>${inr(p.amount)}</span></div>`).join("");
    paid.classList.remove("hidden");
  } else {
    paid.classList.add("hidden");
  }
}

function checkoutTable() {
  const session = activeOrdersList[`table_${selectedAdminTableNo}`];
  if (!session) return;
  const bill = computeBill(session);
  currentCheckoutBill = { table_no: selectedAdminTableNo, ...bill };
  activeReceiptObject = {
    invoice_id: `BILL-T${selectedAdminTableNo}-${Date.now()}`,
    table_no: selectedAdminTableNo,
    customer_name: session.customer_name || "Guest",
    customer_phone: session.customer_phone || "",
    ...bill
  };
  fillReceipt(activeReceiptObject, { date: formatDateTime(new Date().toISOString()) });

  document.getElementById("bill-modal-title").textContent = `Table ${selectedAdminTableNo} · Bill & payment`;
  document.getElementById("bill-layout").classList.remove("view-only");
  document.getElementById("pay-panel").classList.remove("hidden");
  document.getElementById("btn-settle-action").classList.remove("hidden");
  resetPayments(1);
  openModal("bill-modal");
}

function closeBillModal() {
  closeModal("bill-modal");
  currentCheckoutBill = null;
}

function resetPayments(n) {
  if (!currentCheckoutBill) return;
  const total = currentCheckoutBill.total;
  n = Math.max(1, Math.min(50, parseInt(n, 10) || 1));
  const share = Math.floor((total * 100) / n) / 100;
  payments = [];
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? round2(total - share * (n - 1)) : share;
    payments.push({ label: n === 1 ? "Payment" : `Guest ${i + 1}`, method: null, amount, reference: "" });
  }
  document.getElementById("btn-unsplit").classList.toggle("hidden", n === 1);
  renderPaymentRows();
}

function renderPaymentRows() {
  const methods = publicSettings.payment_methods && publicSettings.payment_methods.length ? publicSettings.payment_methods : ["UPI", "Cash", "Card"];
  const multi = payments.length > 1;
  document.getElementById("payment-rows").innerHTML = payments.map((p, i) => `
    <div class="pay-row" data-idx="${i}">
      <div class="pay-row-top">
        <div class="who">${multi ? `<span class="num">${i + 1}</span>` : ""}${escapeHTML(p.label)}</div>
        <label class="pay-amount"><span>₹</span>
          <input type="number" class="input" min="0" step="0.01" inputmode="decimal" value="${p.amount}" aria-label="Amount for ${escapeHTML(p.label)}" oninput="onPaymentAmount(${i}, this.value)" ${multi ? "" : "readonly"}>
        </label>
      </div>
      <div class="seg" role="radiogroup" aria-label="Payment method for ${escapeHTML(p.label)}">
        ${methods.map(m => `<button type="button" role="radio" aria-checked="${p.method === m}" class="${p.method === m ? "active" : ""}" onclick="setPaymentMethod(${i}, '${jsArg(m)}')"><i class="fas ${METHOD_ICONS[m] || "fa-wallet"}"></i> ${escapeHTML(m)}</button>`).join("")}
      </div>
      ${p.method && p.method !== "Cash" ? `<div class="pay-ref"><input type="text" class="input" maxlength="40" placeholder="${p.method === "UPI" ? "UPI transaction ID (optional)" : "Card last 4 digits / approval code (optional)"}" value="${escapeHTML(p.reference)}" oninput="payments[${i}].reference=this.value"></div>` : ""}
    </div>`).join("");
  updatePaymentSummary();
}

function setPaymentMethod(i, method) {
  payments[i].method = method;
  if (method === "Cash") payments[i].reference = "";
  renderPaymentRows();
}

function onPaymentAmount(i, value) {
  payments[i].amount = round2(parseFloat(value) || 0);
  updatePaymentSummary();
}

function updatePaymentSummary() {
  const el = document.getElementById("pay-summary");
  const btn = document.getElementById("btn-settle-action");
  if (!currentCheckoutBill) return;
  const total = currentCheckoutBill.total;
  const paid = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const diff = round2(total - paid);
  const missingMethod = payments.findIndex(p => !p.method);
  const badAmount = payments.some(p => !(p.amount > 0));
  let ok = false, msg;
  if (Math.abs(diff) > 0.009) {
    msg = diff > 0
      ? `<span><i class="fas fa-circle-exclamation"></i> ${inr(diff)} still to collect</span><button type="button" class="btn btn-secondary btn-sm" onclick="fillBalance()">Add to last</button>`
      : `<span><i class="fas fa-circle-exclamation"></i> ${inr(-diff)} more than the bill</span><button type="button" class="btn btn-secondary btn-sm" onclick="fillBalance()">Fix last</button>`;
  } else if (badAmount) {
    msg = `<span><i class="fas fa-circle-exclamation"></i> Every payment must be more than ₹0</span>`;
  } else if (missingMethod !== -1) {
    msg = `<span><i class="fas fa-hand-pointer"></i> Choose ${escapeHTML((publicSettings.payment_methods || []).join(", "))} for ${escapeHTML(payments[missingMethod].label)}</span>`;
  } else {
    ok = true;
    msg = `<span><i class="fas fa-circle-check"></i> ${inr(paid)} collected — matches the bill</span>`;
  }
  el.className = `pay-summary ${ok ? "ok" : "bad"}`;
  el.innerHTML = msg;
  btn.disabled = !ok;
}

function fillBalance() {
  const total = currentCheckoutBill.total;
  const others = payments.slice(0, -1).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  payments[payments.length - 1].amount = round2(Math.max(0, total - others));
  renderPaymentRows();
}

function openSplitModal() {
  if (!currentCheckoutBill) return;
  const input = document.getElementById("split-count");
  input.value = Math.max(2, payments.length);
  const preview = () => {
    const n = Math.max(2, Math.min(50, parseInt(input.value, 10) || 2));
    document.getElementById("split-preview").textContent = `${inr(currentCheckoutBill.total)} ÷ ${n} ≈ ${inr(currentCheckoutBill.total / n)} each`;
  };
  input.oninput = preview;
  preview();
  openModal("split-modal");
  setTimeout(() => input.select(), 60);
}

function applySplit(e) {
  e.preventDefault();
  const n = parseInt(document.getElementById("split-count").value, 10);
  if (!(n >= 2 && n <= 50)) {
    window.showToast("Enter between 2 and 50 people.", "error");
    return;
  }
  closeModal("split-modal");
  resetPayments(n);
  window.showToast(`Bill split into ${n} payments.`, "info");
}

function confirmBillCheckout() {
  if (!currentCheckoutBill) return;
  const btn = document.getElementById("btn-settle-action");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  const body = {
    table_no: currentCheckoutBill.table_no,
    payments: payments.map(p => ({ label: p.label, method: p.method, amount: p.amount, reference: (p.reference || "").trim() }))
  };
  api("/api/orders/checkout", { method: "POST", body })
    .then(data => {
      const inv = data.invoice;
      window.showToast(`Table ${inv.table_no} settled · ${inr(inv.total)} via ${inv.payment_mode}`, "success");
      // Switch the modal to show the final, paid receipt
      currentCheckoutBill = null;
      activeReceiptObject = inv;
      fillReceipt(inv, { invoiceId: inv.invoice_id, date: formatDateTime(inv.timestamp), payments: inv.payments });
      document.getElementById("bill-layout").classList.add("view-only");
      document.getElementById("pay-panel").classList.add("hidden");
      document.getElementById("btn-settle-action").classList.add("hidden");
      document.getElementById("bill-modal-title").textContent = `Paid · ${inv.invoice_id}`;
      selectedAdminTableNo = null;
      document.getElementById("table-detail-content").classList.add("hidden");
      const empty = document.getElementById("table-detail-empty-state");
      empty.classList.remove("hidden");
      empty.innerHTML = '<i class="fas fa-circle-check" style="color:var(--success)"></i><h4>Bill settled</h4><p>The table is free again. Select another table to continue.</p>';
      loadAdminTableOrders();
    })
    .catch(err => window.showToast(err.message, "error"))
    .finally(() => {
      btn.innerHTML = '<i class="fas fa-check"></i> Record payment &amp; close table';
      if (currentCheckoutBill) updatePaymentSummary();
    });
}

/* ════════════════════════════════════════════════════════════════════════
   Sales invoices
   ════════════════════════════════════════════════════════════════════════ */

let historicalInvoices = [];

function loadHistoricalInvoices() {
  const tbody = document.getElementById("admin-invoices-tbody");
  tbody.innerHTML = emptyRow(9, '<i class="fas fa-spinner fa-spin"></i> Loading…');
  api("/api/invoices")
    .then(data => { historicalInvoices = Array.isArray(data) ? data : []; filterHistoricalInvoices(); })
    .catch(err => { tbody.innerHTML = emptyRow(9, escapeHTML(err.message)); });
}

function paymentBadges(inv) {
  if (!inv.payments || !inv.payments.length) return '<span class="badge">Not recorded</span>';
  const methods = [...new Set(inv.payments.map(p => p.method))];
  const split = inv.payments.length > 1 ? `<span class="badge badge-violet"><i class="fas fa-people-group"></i> ${inv.payments.length}</span> ` : "";
  return split + methods.map(m => `<span class="badge badge-primary"><i class="fas ${METHOD_ICONS[m] || "fa-wallet"}"></i> ${escapeHTML(m)}</span>`).join(" ");
}

function renderInvoicesTable(list) {
  const tbody = document.getElementById("admin-invoices-tbody");
  if (!list.length) {
    tbody.innerHTML = emptyRow(9, historicalInvoices.length ? "No invoices match your search." : "No invoices yet. Bills settled from Table Orders appear here.");
    return;
  }
  tbody.innerHTML = list.map(inv => `<tr>
      <td data-label="Invoice" class="mono" style="font-size:12px;color:var(--primary);font-weight:600;">${escapeHTML(inv.invoice_id)}</td>
      <td data-label="Date" class="muted nowrap" style="font-size:13px;">${formatDateTime(inv.timestamp)}</td>
      <td data-label="Table"><span class="badge">T-${escapeHTML(inv.table_no)}</span></td>
      <td data-label="Guest">${escapeHTML(inv.customer_name || "Guest")}</td>
      <td data-label="Subtotal" class="nowrap">${inr(inv.subtotal)}</td>
      <td data-label="Charges" class="nowrap muted">${inr((Number(inv.service_charge) || 0) + (Number(inv.tax) || 0))}</td>
      <td data-label="Total" class="amount">${inr(inv.total)}</td>
      <td data-label="Payment"><span>${paymentBadges(inv)}</span></td>
      <td class="actions"><button class="btn btn-secondary btn-sm" onclick="viewHistoricalInvoiceDetails('${jsArg(inv.invoice_id)}')"><i class="fas fa-eye"></i> View</button></td>
    </tr>`).join("");
}

function filterHistoricalInvoices() {
  const q = document.getElementById("invoice-search-input").value.trim().toLowerCase();
  if (!q) return renderInvoicesTable(historicalInvoices);
  renderInvoicesTable(historicalInvoices.filter(inv =>
    (inv.invoice_id || "").toLowerCase().includes(q) ||
    `table ${inv.table_no}`.includes(q) || String(inv.table_no) === q ||
    (inv.customer_name || "").toLowerCase().includes(q) ||
    (inv.payment_mode || "").toLowerCase().includes(q)
  ));
}

function viewHistoricalInvoiceDetails(invoiceId) {
  const inv = historicalInvoices.find(x => x.invoice_id === invoiceId);
  if (!inv) return;
  currentCheckoutBill = null;
  activeReceiptObject = inv;
  fillReceipt(inv, { invoiceId: inv.invoice_id, date: formatDateTime(inv.timestamp), payments: inv.payments });
  document.getElementById("bill-modal-title").textContent = `Invoice · ${inv.invoice_id}`;
  document.getElementById("bill-layout").classList.add("view-only");
  document.getElementById("pay-panel").classList.add("hidden");
  document.getElementById("btn-settle-action").classList.add("hidden");
  openModal("bill-modal");
}

function printInvoice() {
  window.print();
}

function downloadInvoicePDF() {
  if (!activeReceiptObject) return;
  if (!window.html2pdf) {
    window.showToast("PDF tool is still loading — try again in a moment.", "warning");
    return;
  }
  const el = document.getElementById("bill-receipt");
  html2pdf().set({
    margin: 0.3,
    filename: `${activeReceiptObject.invoice_id}.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, backgroundColor: "#ffffff", logging: false },
    jsPDF: { unit: "in", format: "a5", orientation: "portrait" }
  }).from(el).save()
    .then(() => window.showToast("PDF downloaded.", "success"))
    .catch(() => window.showToast("Could not create the PDF.", "error"));
}

/* ════════════════════════════════════════════════════════════════════════
   BOM & Inventory
   ════════════════════════════════════════════════════════════════════════ */

let inventory = { materials: [] };
let bomData = {};
let inventoryTab = "materials";

function loadInventory() {
  const canEdit = ["Admin", "Owner"].includes(currentRole());
  Promise.all([api("/api/inventory"), api("/api/bom")])
    .then(([inv, bom]) => {
      inventory = inv && Array.isArray(inv.materials) ? inv : { materials: [] };
      bomData = bom || {};
      const low = inventory.materials.filter(m => Number(m.stock) <= Number(m.reorder_level)).length;
      const notice = document.getElementById("bom-mode-notice");
      notice.className = `notice ${low ? "warn" : ""}`;
      notice.innerHTML = `<i class="fas ${low ? "fa-triangle-exclamation" : "fa-circle-info"}"></i><div>` +
        (low ? `<b>${low} material${low > 1 ? "s are" : " is"} at or below the reorder level.</b> ` : "") +
        `Stock is deducted automatically using each item's recipe.` +
        (canEdit ? "" : " You can record stock received; Admins and Owners manage materials and recipes.") + `</div>`;
      const recipesTab = document.querySelector('#sec-inventory .tab[data-subtab="recipes"]');
      recipesTab.classList.toggle("hidden", !canEdit);
      if (!canEdit && inventoryTab === "recipes") inventoryTab = "materials";
      switchInventoryTab(inventoryTab);
      renderMaterials();
      populateBomItemSelect();
      renderRecipesTable();
    })
    .catch(err => {
      document.getElementById("inv-materials-tbody").innerHTML = emptyRow(6, escapeHTML(err.message));
    });
}

function switchInventoryTab(tab) {
  inventoryTab = tab;
  document.querySelectorAll("#sec-inventory .tab").forEach(t => t.classList.toggle("active", t.dataset.subtab === tab));
  document.querySelectorAll("#sec-inventory .subpage").forEach(p => p.classList.toggle("active", p.id === `inv-${tab}`));
  if (tab === "ledger") loadLedger();
}

function materialById(id) {
  return inventory.materials.find(m => m.id === id);
}

function fmtQty(n) {
  return (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function renderMaterials() {
  const tbody = document.getElementById("inv-materials-tbody");
  const canEdit = ["Admin", "Owner"].includes(currentRole());
  const list = [...inventory.materials].sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) {
    tbody.innerHTML = emptyRow(6, canEdit ? 'No raw materials yet. Click <b>Add material</b> to start, e.g. "Paneer (kg)" or "Wheat beer (L)".' : "No raw materials yet.");
    return;
  }
  tbody.innerHTML = list.map(m => {
    const low = Number(m.stock) <= Number(m.reorder_level);
    return `<tr>
      <td data-label="Material" class="strong">${escapeHTML(m.name)}</td>
      <td data-label="In stock" class="${low ? "stock-low" : ""} nowrap"><span>${fmtQty(m.stock)} ${escapeHTML(m.unit)} ${low ? '<span class="badge badge-danger" style="margin-left:4px;">Low</span>' : ""}</span></td>
      <td data-label="Reorder at" class="muted nowrap">${fmtQty(m.reorder_level)} ${escapeHTML(m.unit)}</td>
      <td data-label="Cost / unit" class="nowrap">${inr(m.cost_per_unit)} / ${escapeHTML(m.unit)}</td>
      <td data-label="Stock value" class="nowrap">${inr(Math.max(0, m.stock) * m.cost_per_unit)}</td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" onclick="openAdjust('${jsArg(m.id)}')"><i class="fas fa-right-left"></i> Adjust</button>
        ${canEdit ? `<button class="btn btn-ghost btn-sm" onclick="openMaterialForm('${jsArg(m.id)}')" aria-label="Edit"><i class="fas fa-pen"></i></button>
        <button class="btn btn-danger-soft btn-sm" onclick="deleteMaterial('${jsArg(m.id)}')" aria-label="Delete"><i class="fas fa-trash"></i></button>` : ""}
      </td>
    </tr>`;
  }).join("");
}

function openMaterialForm(id) {
  const m = id ? materialById(id) : null;
  document.getElementById("material-modal-title").textContent = m ? `Edit: ${m.name}` : "Add raw material";
  document.getElementById("mat-id").value = m ? m.id : "";
  document.getElementById("mat-name").value = m ? m.name : "";
  document.getElementById("mat-unit").value = m ? m.unit : "kg";
  document.getElementById("mat-stock").value = m ? m.stock : 0;
  document.getElementById("mat-reorder").value = m ? m.reorder_level : 0;
  document.getElementById("mat-cost").value = m ? m.cost_per_unit : 0;
  // Stock of an existing material changes through "Adjust", so every change is in the ledger
  document.getElementById("mat-opening-field").classList.toggle("hidden", !!m);
  openModal("material-modal");
}

function saveMaterial(e) {
  e.preventDefault();
  const material = {
    id: document.getElementById("mat-id").value || undefined,
    name: document.getElementById("mat-name").value.trim(),
    unit: document.getElementById("mat-unit").value,
    stock: parseFloat(document.getElementById("mat-stock").value) || 0,
    reorder_level: parseFloat(document.getElementById("mat-reorder").value) || 0,
    cost_per_unit: parseFloat(document.getElementById("mat-cost").value) || 0,
  };
  api("/api/inventory", { method: "POST", body: { action: "save", material } })
    .then(() => { closeModal("material-modal"); window.showToast("Material saved.", "success"); loadInventory(); })
    .catch(err => window.showToast(err.message, "error"));
}

function deleteMaterial(id) {
  const m = materialById(id);
  if (!m || !confirm(`Delete "${m.name}"?`)) return;
  api("/api/inventory", { method: "POST", body: { action: "delete", id } })
    .then(() => { window.showToast("Material deleted.", "info"); loadInventory(); })
    .catch(err => window.showToast(err.message, "error"));
}

function setupAdjustTypeToggle() {
  document.querySelectorAll("#adj-type button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#adj-type button").forEach(x => x.classList.toggle("active", x === b));
  }));
}

function openAdjust(id) {
  const m = materialById(id);
  if (!m) return;
  document.getElementById("adj-id").value = id;
  document.getElementById("adjust-modal-title").textContent = `Adjust stock · ${m.name}`;
  document.getElementById("adj-current").innerHTML = `Current stock: <b>${fmtQty(m.stock)} ${escapeHTML(m.unit)}</b>`;
  document.getElementById("adj-qty").value = "";
  document.getElementById("adj-note").value = "";
  document.querySelectorAll("#adj-type button").forEach((x, i) => x.classList.toggle("active", i === 0));
  openModal("adjust-modal");
}

function saveAdjustment(e) {
  e.preventDefault();
  const qty = parseFloat(document.getElementById("adj-qty").value);
  if (!(qty > 0)) {
    window.showToast("Enter a quantity above 0.", "error");
    return;
  }
  const out = document.querySelector("#adj-type button.active").dataset.v === "out";
  api("/api/inventory", { method: "POST", body: {
    action: "adjust",
    id: document.getElementById("adj-id").value,
    delta: out ? -qty : qty,
    note: document.getElementById("adj-note").value.trim()
  } })
    .then(() => { closeModal("adjust-modal"); window.showToast("Stock updated.", "success"); loadInventory(); })
    .catch(err => window.showToast(err.message, "error"));
}

function loadLedger() {
  const tbody = document.getElementById("inv-ledger-tbody");
  tbody.innerHTML = emptyRow(6, '<i class="fas fa-spinner fa-spin"></i> Loading…');
  api("/api/inventory/ledger")
    .then(list => {
      if (!list.length) {
        tbody.innerHTML = emptyRow(6, "No stock movements yet.");
        return;
      }
      tbody.innerHTML = list.map(l => {
        const unit = (materialById(l.material_id) || {}).unit || "";
        const up = Number(l.delta) > 0;
        return `<tr>
          <td data-label="When" class="muted nowrap" style="font-size:13px;">${formatDateTime(l.timestamp)}</td>
          <td data-label="Material" class="strong">${escapeHTML(l.name)}</td>
          <td data-label="Change" class="nowrap" style="font-weight:700;color:${up ? "var(--success)" : "var(--danger)"}">${up ? "+" : ""}${fmtQty(l.delta)} ${escapeHTML(unit)}</td>
          <td data-label="Balance" class="nowrap">${fmtQty(l.balance)} ${escapeHTML(unit)}</td>
          <td data-label="Reason">${escapeHTML(l.reason)}</td>
          <td data-label="By">${escapeHTML(l.user)}</td>
        </tr>`;
      }).join("");
    })
    .catch(err => { tbody.innerHTML = emptyRow(6, escapeHTML(err.message)); });
}

/* Recipes (BOM) */
function populateBomItemSelect() {
  const sel = document.getElementById("bom-item-select");
  const prev = sel.value;
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = sorted.map(i => `<option value="${escapeHTML(i.id)}">${escapeHTML(i.name)}${bomData[i.id] ? " ✓" : ""}</option>`).join("");
  if (prev && sorted.some(i => i.id === prev)) sel.value = prev;
  onBomItemChange(true);
}

function onBomItemChange(keepVariant) {
  const item = items.find(i => i.id === document.getElementById("bom-item-select").value);
  const vs = document.getElementById("bom-variant-select");
  const prev = vs.value;
  vs.innerHTML = item ? (item.price_variants || []).map(v => `<option value="${escapeHTML(v.label)}">${escapeHTML(v.label)} — ${inr(v.price)}${bomData[item.id] && bomData[item.id][v.label] ? " ✓" : ""}</option>`).join("") : "";
  if (keepVariant === true && prev && [...vs.options].some(o => o.value === prev)) vs.value = prev;
  renderBomEditor();
}

function renderBomEditor() {
  const itemId = document.getElementById("bom-item-select").value;
  const variant = document.getElementById("bom-variant-select").value;
  const item = items.find(i => i.id === itemId);
  document.getElementById("bom-editor-title").textContent = item ? `${item.name} · ${variant}` : "Recipe";
  const container = document.getElementById("bom-ingredients");
  container.innerHTML = "";
  const ings = (bomData[itemId] && bomData[itemId][variant]) || [];
  if (!inventory.materials.length) {
    container.innerHTML = `<div class="empty" style="padding:20px;"><i class="fas fa-box-open"></i><p>Add raw materials first, then link them to this item.</p></div>`;
  } else if (!ings.length) {
    addIngredientRow();
  } else {
    ings.forEach(ing => addIngredientRow(ing.material_id, ing.qty));
  }
  updateBomCost();
}

function addIngredientRow(materialId = "", qty = "") {
  if (!inventory.materials.length) {
    window.showToast("Add a raw material first.", "warning");
    return;
  }
  const container = document.getElementById("bom-ingredients");
  if (container.querySelector(".empty")) container.innerHTML = "";
  const opts = [...inventory.materials].sort((a, b) => a.name.localeCompare(b.name))
    .map(m => `<option value="${escapeHTML(m.id)}" ${m.id === materialId ? "selected" : ""}>${escapeHTML(m.name)} (${escapeHTML(m.unit)})</option>`).join("");
  const row = document.createElement("div");
  row.className = "ing-row";
  row.innerHTML = `
    <select class="select ing-mat" onchange="updateBomCost()" aria-label="Material"><option value="">Choose material…</option>${opts}</select>
    <input type="number" class="input ing-qty" min="0" step="any" placeholder="Qty" value="${escapeHTML(qty)}" oninput="updateBomCost()" aria-label="Quantity">
    <button type="button" class="btn btn-icon btn-danger-soft" onclick="this.closest('.ing-row').remove(); updateBomCost();" aria-label="Remove"><i class="fas fa-xmark"></i></button>`;
  container.appendChild(row);
}

function readIngredientRows() {
  return [...document.querySelectorAll("#bom-ingredients .ing-row")].map(r => ({
    material_id: r.querySelector(".ing-mat").value,
    qty: parseFloat(r.querySelector(".ing-qty").value) || 0
  })).filter(x => x.material_id && x.qty > 0);
}

function recipeCost(ings) {
  return ings.reduce((s, ing) => {
    const m = materialById(ing.material_id);
    return s + (m ? Number(m.cost_per_unit) * Number(ing.qty) : 0);
  }, 0);
}

function variantPrice(itemId, variant) {
  const item = items.find(i => i.id === itemId);
  const v = item && (item.price_variants || []).find(p => p.label === variant);
  return v ? Number(v.price) : 0;
}

function updateBomCost() {
  const itemId = document.getElementById("bom-item-select").value;
  const variant = document.getElementById("bom-variant-select").value;
  const cost = recipeCost(readIngredientRows());
  const price = variantPrice(itemId, variant);
  const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
  document.getElementById("bom-cost-box").innerHTML =
    `<div>Food cost<br><b>${inr(cost)}</b></div><div>Selling price<br><b>${inr(price)}</b></div>` +
    `<div>Gross margin<br><b style="color:${margin < 60 ? "var(--warning-700)" : "var(--success-700)"}">${price ? margin + "%" : "—"}</b></div>`;
}

function saveRecipe(clear) {
  const item_id = document.getElementById("bom-item-select").value;
  const variant = document.getElementById("bom-variant-select").value;
  if (!item_id || !variant) return;
  const ingredients = clear === true ? [] : readIngredientRows();
  api("/api/bom", { method: "POST", body: { item_id, variant, ingredients } })
    .then(() => api("/api/bom"))
    .then(bom => {
      bomData = bom || {};
      window.showToast(ingredients.length ? "Recipe saved." : "Recipe cleared.", "success");
      populateBomItemSelect();
      renderRecipesTable();
    })
    .catch(err => window.showToast(err.message, "error"));
}

function clearRecipe() {
  if (confirm("Remove all ingredients from this recipe?")) saveRecipe(true);
}

function editRecipe(itemId, variant) {
  document.getElementById("bom-item-select").value = itemId;
  onBomItemChange();
  document.getElementById("bom-variant-select").value = variant;
  renderBomEditor();
  document.getElementById("bom-item-select").scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderRecipesTable() {
  const tbody = document.getElementById("inv-recipes-tbody");
  const rows = [];
  Object.keys(bomData).forEach(itemId => {
    const item = items.find(i => i.id === itemId);
    Object.keys(bomData[itemId] || {}).forEach(variant => {
      const ings = bomData[itemId][variant] || [];
      rows.push({ itemId, name: item ? item.name : itemId, variant, ings, cost: recipeCost(ings), price: variantPrice(itemId, variant) });
    });
  });
  if (!rows.length) {
    tbody.innerHTML = emptyRow(7, "No recipes yet. Choose a menu item above and add its ingredients.");
    return;
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  tbody.innerHTML = rows.map(r => {
    const margin = r.price > 0 ? Math.round(((r.price - r.cost) / r.price) * 100) : 0;
    const ingText = r.ings.map(i => { const m = materialById(i.material_id); return m ? `${escapeHTML(m.name)} ${fmtQty(i.qty)} ${escapeHTML(m.unit)}` : ""; }).filter(Boolean).join(", ");
    return `<tr>
      <td data-label="Item" class="strong">${escapeHTML(r.name)}</td>
      <td data-label="Size">${escapeHTML(r.variant)}</td>
      <td data-label="Ingredients" style="font-size:13px;">${ingText}</td>
      <td data-label="Food cost" class="nowrap">${inr(r.cost)}</td>
      <td data-label="Price" class="nowrap">${inr(r.price)}</td>
      <td data-label="Margin"><span class="badge ${margin < 60 ? "badge-warning" : "badge-success"}">${r.price ? margin + "%" : "—"}</span></td>
      <td class="actions"><button class="btn btn-secondary btn-sm" onclick="editRecipe('${jsArg(r.itemId)}', '${jsArg(r.variant)}')"><i class="fas fa-pen"></i> Edit</button></td>
    </tr>`;
  }).join("");
}

/* ════════════════════════════════════════════════════════════════════════
   Settings (Admin only)
   ════════════════════════════════════════════════════════════════════════ */

function loadSettings() {
  api("/api/settings")
    .then(s => {
      document.getElementById("set-business-name").value = s.business_name || "";
      document.getElementById("set-business-address").value = s.business_address || "";
      document.getElementById("set-business-phone").value = s.business_phone || "";
      document.getElementById("set-gstin").value = s.gstin || "";
      document.getElementById("set-tables-count").value = s.tables_count || 15;
      document.getElementById("set-pay-upi").checked = !!(s.payment_methods || {}).UPI;
      document.getElementById("set-pay-cash").checked = !!(s.payment_methods || {}).Cash;
      document.getElementById("set-pay-card").checked = !!(s.payment_methods || {}).Card;
      document.getElementById("set-bom-enabled").checked = !!s.bom_enabled;
      document.getElementById("set-bom-deduct").value = s.bom_deduct_on || "order";
      document.getElementById("set-bom-block").checked = !!s.block_on_low_stock;
      refreshBomSettingState();
    })
    .catch(err => window.showToast(err.message, "error"));
}

function refreshBomSettingState() {
  const on = document.getElementById("set-bom-enabled").checked;
  document.querySelectorAll(".bom-dep").forEach(row => {
    row.style.opacity = on ? "" : "0.45";
    row.querySelectorAll("input, select").forEach(el => { el.disabled = !on; });
  });
}

function saveSettings(e) {
  e.preventDefault();
  const body = {
    business_name: document.getElementById("set-business-name").value.trim(),
    business_address: document.getElementById("set-business-address").value.trim(),
    business_phone: document.getElementById("set-business-phone").value.trim(),
    gstin: document.getElementById("set-gstin").value.trim(),
    tables_count: parseInt(document.getElementById("set-tables-count").value, 10) || 15,
    payment_methods: {
      UPI: document.getElementById("set-pay-upi").checked,
      Cash: document.getElementById("set-pay-cash").checked,
      Card: document.getElementById("set-pay-card").checked,
    },
    bom_enabled: document.getElementById("set-bom-enabled").checked,
    bom_deduct_on: document.getElementById("set-bom-deduct").value,
    block_on_low_stock: document.getElementById("set-bom-block").checked,
  };
  if (!body.payment_methods.UPI && !body.payment_methods.Cash && !body.payment_methods.Card) {
    window.showToast("Keep at least one payment method turned on.", "error");
    return;
  }
  const btn = document.getElementById("btn-save-settings");
  btn.disabled = true;
  api("/api/settings", { method: "POST", body })
    .then(async () => {
      window.showToast("Settings saved.", "success");
      await loadPublicSettings();
      applyRolePermissions();
    })
    .catch(err => window.showToast(err.message, "error"))
    .finally(() => { btn.disabled = false; });
}
