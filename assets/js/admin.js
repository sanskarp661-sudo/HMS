// Dynamic Toast Alert helper (self-contained)
window.showToast = function(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = "position: fixed; bottom: 24px; right: 24px; z-index: 10000; display: flex; flex-direction: column; gap: 8px;";
    document.body.appendChild(container);
  }
  
  const toast = document.createElement("div");
  toast.style.cssText = `
    padding: 12px 20px;
    border-radius: 8px;
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    gap: 8px;
    transform: translateY(20px);
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  `;
  
  let bg = "#10b981"; // success green
  let icon = '<i class="fas fa-check-circle"></i>';
  if (type === "error") {
    bg = "#ef4444"; // red
    icon = '<i class="fas fa-exclamation-circle"></i>';
  } else if (type === "warning") {
    bg = "#f59e0b"; // orange
    icon = '<i class="fas fa-exclamation-triangle"></i>';
  } else if (type === "info") {
    bg = "#3b82f6"; // blue
    icon = '<i class="fas fa-info-circle"></i>';
  }
  
  toast.style.backgroundColor = bg;
  toast.innerHTML = `${icon} <span>${message}</span>`;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.transform = "translateY(0)";
    toast.style.opacity = "1";
  }, 10);
  
  setTimeout(() => {
    toast.style.transform = "translateY(-20px)";
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
};

// Admin CMS Logic
let categories = [];
let items = [];
let currentUploadedMedia = []; // temporary holder for item media urls

// If the server says the login has expired (401), clear the local login
// state and go back to the login screen.
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
        alert("Your session has expired. Please log in again.");
        window.location.reload();
      }
      return res;
    });
  };
})();

function clearLocalLogin() {
  sessionStorage.removeItem("luka_logged_in");
  sessionStorage.removeItem("luka_logged_user");
  sessionStorage.removeItem("luka_logged_role");
}

function showAdminDashboard() {
  document.getElementById("login-panel").style.display = "none";
  document.getElementById("admin-dashboard").style.display = "flex";
  loadData();
}

document.addEventListener("DOMContentLoaded", () => {
  // Confirm the login with the server; the browser's copy alone is not trusted
  if (sessionStorage.getItem("luka_logged_in") === "true") {
    fetch("/api/session")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.authenticated === false) {
          clearLocalLogin();
          return;
        }
        if (data && data.authenticated) {
          sessionStorage.setItem("luka_logged_user", data.username);
          sessionStorage.setItem("luka_logged_role", data.role);
        }
        showAdminDashboard();
      })
      .catch(() => clearLocalLogin());
  }

  // Setup drag and drop uploader
  setupMediaUploader();
});

// Server-side login verification against users.json
function verifyLogin() {
  const username = document.getElementById("username-input").value.trim();
  const password = document.getElementById("passcode-input").value;

  if (!username) {
    window.showToast("Please enter your name/username!", "error");
    return;
  }
  if (!password) {
    window.showToast("Please enter your password!", "error");
    return;
  }

  fetch("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  })
  .then(res => {
    if (res.status === 401) {
      throw new Error("Invalid username or password");
    } else if (!res.ok) {
      throw new Error("Server login error");
    }
    return res.json();
  })
  .then(data => {
    if (data.status === "success") {
      sessionStorage.setItem("luka_logged_in", "true");
      sessionStorage.setItem("luka_logged_user", data.username);
      sessionStorage.setItem("luka_logged_role", data.role || "Staff");
      document.getElementById("login-panel").style.display = "none";
      document.getElementById("admin-dashboard").style.display = "flex";
      loadData();
      window.showToast(`Welcome back, ${data.username}!`, "success");
    } else {
      window.showToast(data.message || "Login failed", "error");
    }
  })
  .catch(err => {
    window.showToast(err.message || "Connection failed during login", "error");
  });
}

function logoutAdmin() {
  clearLocalLogin();
  fetch("/api/logout", { method: "POST" })
    .catch(() => {})
    .finally(() => window.location.reload());
}

function switchAdminTab(tab) {
  const itemsBtn     = document.getElementById("nav-btn-items");
  const ordersBtn    = document.getElementById("nav-btn-orders");
  const invoicesBtn  = document.getElementById("nav-btn-invoices");
  const catsBtn      = document.getElementById("nav-btn-categories");
  const logsBtn      = document.getElementById("nav-btn-logs");
  const usersBtn     = document.getElementById("nav-btn-users");
  const dashBtn      = document.getElementById("nav-btn-dashboard");

  [itemsBtn, ordersBtn, invoicesBtn, catsBtn, logsBtn, usersBtn, dashBtn].forEach(b => {
    if (b) b.classList.remove("active");
  });

  ["sec-items","sec-table-orders","sec-invoices","sec-categories","sec-logs","sec-users","sec-dashboard"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove("active");
  });

  if (tab === "items") {
    if (itemsBtn) itemsBtn.classList.add("active");
    document.getElementById("sec-items").classList.add("active");
  } else if (tab === "orders") {
    if (ordersBtn) ordersBtn.classList.add("active");
    document.getElementById("sec-table-orders").classList.add("active");
    loadAdminTableOrders();
  } else if (tab === "invoices") {
    if (invoicesBtn) invoicesBtn.classList.add("active");
    document.getElementById("sec-invoices").classList.add("active");
    loadHistoricalInvoices();
  } else if (tab === "categories") {
    if (catsBtn) catsBtn.classList.add("active");
    document.getElementById("sec-categories").classList.add("active");
  } else if (tab === "logs") {
    if (logsBtn) logsBtn.classList.add("active");
    document.getElementById("sec-logs").classList.add("active");
    loadAuditLogs();
  } else if (tab === "users") {
    if (usersBtn) usersBtn.classList.add("active");
    document.getElementById("sec-users").classList.add("active");
    loadUsers();
  } else if (tab === "dashboard") {
    if (dashBtn) dashBtn.classList.add("active");
    document.getElementById("sec-dashboard").classList.add("active");
    loadDashboard();
  }
}

// Fetch database from server
function loadData() {
  fetch("/api/menu")
    .then(res => {
      if (!res.ok) throw new Error("Database load error");
      return res.json();
    })
    .then(data => {
      categories = data.categories || [];
      items = data.items || [];
      
      // Seed category selection dropdown
      populateCategorySelects();
      
      // Render
      renderAdminItems();
      renderAdminCategories();
      applyRolePermissions();
    })
    .catch(err => {
      console.warn("Loading CMS database failed, fallback to local seeds:", err);
      if (window.LukaSeedData) {
        categories = window.LukaSeedData.initialCategories || [];
        items = window.LukaSeedData.initialItems || [];
      }
      populateCategorySelects();
      renderAdminItems();
      renderAdminCategories();
      applyRolePermissions();
    });
}

function saveMenuData(actionDescription = "Modified Menu Catalog") {
  const staffUser = sessionStorage.getItem("luka_logged_user") || "System";
  fetch("/api/menu", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Staff-User": encodeURIComponent(staffUser),
      "X-Audit-Action": encodeURIComponent(actionDescription)
    },
    body: jsonStringifyDatabase()
  })
  .then(res => {
    if (!res.ok) throw new Error("Save database error");
    return res.json();
  })
  .then(data => {
    window.showToast("Changes published immediately!", "success");
  })
  .catch(err => {
    console.error("Failed to post edits to server:", err);
    window.showToast("Warning: Server sync failed. Saved local changes.", "warning");
  });
}

function jsonStringifyDatabase() {
  return JSON.stringify({ categories, items });
}

// Seed the dropdown selectors inside Item Edit form
function populateCategorySelects() {
  const formSelect = document.getElementById("item-category-select");
  const filterSelect = document.getElementById("table-filter-cat");
  
  formSelect.innerHTML = "";
  filterSelect.innerHTML = '<option value="all">All Categories</option>';
  
  // Sort alphabetically or display order
  categories.sort((a,b) => a.display_order - b.display_order).forEach(cat => {
    const opt1 = document.createElement("option");
    opt1.value = cat.id;
    opt1.innerText = `${cat.section === "food" ? "Food" : "Drinks"} — ${cat.name}`;
    formSelect.appendChild(opt1);
    
    const opt2 = document.createElement("option");
    opt2.value = cat.id;
    opt2.innerText = cat.name;
    filterSelect.appendChild(opt2);
  });
}

// Media Uploader Form Listeners (FR-14)
function setupMediaUploader() {
  const zone = document.getElementById("media-drag-zone");
  const input = document.getElementById("media-file-input");
  
  zone.addEventListener("click", () => input.click());
  
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  
  zone.addEventListener("dragleave", () => {
    zone.classList.remove("dragover");
  });
  
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      uploadMediaFile(e.dataTransfer.files[0]);
    }
  });
  
  input.addEventListener("change", () => {
    if (input.files.length > 0) {
      uploadMediaFile(input.files[0]);
    }
  });
}

// Post file to API server
function uploadMediaFile(file) {
  if (file.size > 15 * 1024 * 1024) {
    window.showToast("Media file is too large. Max size is 15MB.", "error");
    return;
  }
  
  window.showToast("Uploading media asset...", "info");
  
  const formData = new FormData();
  formData.append("file", file);
  
  fetch("/api/upload", {
    method: "POST",
    body: formData
  })
  .then(res => {
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  })
  .then(data => {
    if (data.status === "success" && data.url) {
      currentUploadedMedia.push(data.url);
      renderMediaPreviews();
      window.showToast("Media uploaded successfully!", "success");
    } else {
      window.showToast("Upload failed: " + data.message, "error");
    }
  })
  .catch(err => {
    console.error(err);
    window.showToast("Server connection error during upload", "error");
  });
}

function renderMediaPreviews() {
  const container = document.getElementById("media-previews");
  container.innerHTML = "";
  
  currentUploadedMedia.forEach((url, idx) => {
    const div = document.createElement("div");
    div.className = "preview-thumbnail";
    
    const isVideo = url.toLowerCase().endsWith(".mp4");
    if (isVideo) {
      div.innerHTML = `
        <video src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm);"></video>
        <button type="button" onclick="removeMediaPreview(${idx})"><i class="fas fa-times"></i></button>
      `;
    } else {
      div.innerHTML = `
        <img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm);">
        <button type="button" onclick="removeMediaPreview(${idx})"><i class="fas fa-times"></i></button>
      `;
    }
    container.appendChild(div);
  });
}

function removeMediaPreview(idx) {
  currentUploadedMedia.splice(idx, 1);
  renderMediaPreviews();
}

// Pricing variant builder rows (FR-4 & FR-13)
function addPriceVariantRow(label = "", price = "") {
  const container = document.getElementById("price-variants-container");
  const div = document.createElement("div");
  div.className = "variant-row";
  div.innerHTML = `
    <input type="text" class="input-control variant-label" required placeholder="Variant Label (e.g. 30ml, Glass, Portion)" value="${label}" style="flex:2;">
    <input type="number" class="input-control variant-price" required placeholder="Price (INR)" value="${price}" min="0" style="flex:1;">
    <button type="button" class="btn btn-danger" onclick="removePriceVariantRow(this)" style="padding: 10px 14px;"><i class="fas fa-trash"></i></button>
  `;
  container.appendChild(div);
}

function removePriceVariantRow(btn) {
  btn.parentElement.remove();
}

// Open/Close Add Item form
function toggleItemForm() {
  const formBox = document.getElementById("item-form-box");
  const toggleBtn = document.getElementById("btn-add-item-toggle");
  
  if (formBox.style.display === "none") {
    formBox.style.display = "block";
    toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Item Form';
    resetItemForm();
    toggleFormFieldsForRole();
  } else {
    formBox.style.display = "none";
    toggleBtn.innerHTML = '<i class="fas fa-plus"></i> Add New Menu Item';
  }
}

function resetItemForm() {
  document.getElementById("item-crud-form").reset();
  document.getElementById("edit-item-id").value = "";
  document.getElementById("form-item-title").innerText = "Add New Menu Item";
  
  currentUploadedMedia = [];
  document.getElementById("media-previews").innerHTML = "";
  
  // Clear and seed 1 pricing variant default row
  const container = document.getElementById("price-variants-container");
  container.innerHTML = "";
  addPriceVariantRow("Portion", "");
}

// Render Items table
function renderAdminItems() {
  const tbody = document.getElementById("admin-items-tbody");
  const catFilter = document.getElementById("table-filter-cat").value;
  tbody.innerHTML = "";
  
  let listItems = items;
  if (catFilter !== "all") {
    listItems = items.filter(item => item.category_id === catFilter);
  }

  // Sort by category first, then display order
  listItems.sort((a, b) => {
    const catA = categories.find(c => c.id === a.category_id);
    const catB = categories.find(c => c.id === b.category_id);
    const orderCat = (catA?.display_order || 0) - (catB?.display_order || 0);
    if (orderCat !== 0) return orderCat;
    return a.display_order - b.display_order;
  });

  listItems.forEach(item => {
    const cat = categories.find(c => c.id === item.category_id);
    const catName = cat ? cat.name : "Unassigned";
    
    // Low / High prices details
    const priceVariantsStr = item.price_variants.map(v => `${v.label}: ₹${v.price}`).join(", ");
    
    const row = document.createElement("tr");
    
    let tagColors = item.availability === "Available" ? "status-available" : (item.availability === "Seasonal" ? "status-seasonal" : "status-86d");
    
    const role = sessionStorage.getItem("luka_logged_role") || "Staff";
    let actionsHTML = "";
    if (role === "Waiter") {
      actionsHTML = `<span style="font-size:12px; color:#9ca3af; font-weight:600;"><i class="fas fa-lock" style="margin-right:4px;"></i> View Only</span>`;
    } else if (role === "Receptionist") {
      actionsHTML = `<button class="btn btn-secondary" onclick="editItem('${item.id}')" style="padding: 6px 10px; font-size:12px;"><i class="fas fa-edit"></i> Edit Stock</button>`;
    } else {
      actionsHTML = `
        <button class="btn btn-secondary" onclick="editItem('${item.id}')" style="padding: 6px 10px; font-size:12px;"><i class="fas fa-edit"></i> Edit</button>
        <button class="btn btn-danger" onclick="deleteItem('${item.id}')" style="padding: 6px 10px; font-size:12px;"><i class="fas fa-trash"></i> Delete</button>
      `;
    }

    row.innerHTML = `
      <td style="font-weight: 600;">${item.name}</td>
      <td>${catName}</td>
      <td style="font-size:12px; color:var(--text-muted);">${priceVariantsStr}</td>
      <td><span class="status-badge ${tagColors}">${item.availability}</span></td>
      <td><span class="status-badge" style="background:${item.status === 'Published'?'#dbeafe':'#f3f4f6'}; color:${item.status === 'Published'?'#1e40af':'#4b5563'};">${item.status}</span></td>
      <td style="text-align: right; white-space: nowrap;">
        ${actionsHTML}
      </td>
    `;
    tbody.appendChild(row);
  });
}

// Edit existing item
function editItem(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;

  // Toggle form visible
  const formBox = document.getElementById("item-form-box");
  const toggleBtn = document.getElementById("btn-add-item-toggle");
  formBox.style.display = "block";
  toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Item Form';
  
  // Fill inputs
  document.getElementById("edit-item-id").value = item.id;
  document.getElementById("form-item-title").innerText = `Edit Menu Item: ${item.name}`;
  document.getElementById("item-name-input").value = item.name;
  document.getElementById("item-category-select").value = item.category_id;
  document.getElementById("item-desc-input").value = item.description || "";
  document.getElementById("item-avail-select").value = item.availability;
  document.getElementById("item-status-select").value = item.status;
  document.getElementById("item-order-input").value = item.display_order || 1;

  // Checklist tags
  document.getElementById("tag-veg-check").checked = item.tags.includes("Veg");
  document.getElementById("tag-nonveg-check").checked = item.tags.includes("Non-Veg");
  document.getElementById("tag-spicy-check").checked = item.tags.includes("Spicy");
  document.getElementById("tag-sig-check").checked = item.tags.includes("Signature");
  document.getElementById("tag-best-check").checked = item.tags.includes("Bestseller");

  // Media
  currentUploadedMedia = [...(item.media || [])];
  renderMediaPreviews();

  // Price variants
  const container = document.getElementById("price-variants-container");
  container.innerHTML = "";
  if (item.price_variants && item.price_variants.length > 0) {
    item.price_variants.forEach(v => addPriceVariantRow(v.label, v.price));
  } else {
    addPriceVariantRow("Portion", "");
  }

  // Scroll to form
  formBox.scrollIntoView({ behavior: "smooth" });
  
  toggleFormFieldsForRole();
}

// Role-based Layout Restrictions (FR-20)
function applyRolePermissions() {
  const role = sessionStorage.getItem("luka_logged_role") || "Staff";

  const navBtnCats     = document.getElementById("nav-btn-categories");
  const navBtnLogs     = document.getElementById("nav-btn-logs");
  const navBtnUsers    = document.getElementById("nav-btn-users");
  const navBtnOrders   = document.getElementById("nav-btn-orders");
  const navBtnInvoices = document.getElementById("nav-btn-invoices");
  const navBtnDash     = document.getElementById("nav-btn-dashboard");
  const navBtnKitchen  = document.getElementById("nav-btn-kitchen");
  const btnAddItemToggle = document.getElementById("btn-add-item-toggle");

  // Default: show everything
  [navBtnCats, navBtnLogs, navBtnUsers, navBtnOrders, navBtnInvoices, navBtnDash, navBtnKitchen, btnAddItemToggle]
    .forEach(el => { if (el) el.style.display = "inline-flex"; });

  if (role === "Kitchen") {
    // Kitchen: only Table Orders (read) + Kitchen Display link
    if (navBtnCats)     navBtnCats.style.display     = "none";
    if (navBtnLogs)     navBtnLogs.style.display     = "none";
    if (navBtnUsers)    navBtnUsers.style.display    = "none";
    if (navBtnInvoices) navBtnInvoices.style.display = "none";
    if (navBtnDash)     navBtnDash.style.display     = "none";
    if (btnAddItemToggle) btnAddItemToggle.style.display = "none";
    // Auto-redirect to kitchen.html
    window.location.href = "kitchen.html";
  } else if (role === "Waiter") {
    // Waiters: only Table Orders — hide everything else
    if (navBtnCats)     navBtnCats.style.display    = "none";
    if (navBtnLogs)     navBtnLogs.style.display     = "none";
    if (navBtnUsers)    navBtnUsers.style.display    = "none";
    if (navBtnInvoices) navBtnInvoices.style.display = "none";
    if (navBtnDash)     navBtnDash.style.display     = "none";
    if (navBtnKitchen)  navBtnKitchen.style.display  = "none";
    if (btnAddItemToggle) btnAddItemToggle.style.display = "none";
  } else if (role === "Receptionist") {
    // Receptionists: Menu Items, Table Orders, Sales Invoices
    if (navBtnCats)  navBtnCats.style.display  = "none";
    if (navBtnLogs)  navBtnLogs.style.display  = "none";
    if (navBtnUsers) navBtnUsers.style.display = "none";
    if (navBtnDash)  navBtnDash.style.display  = "none";
    if (navBtnKitchen) navBtnKitchen.style.display = "none";
  } else if (role === "Owner") {
    // Owners: everything except Manage Users
    if (navBtnUsers) navBtnUsers.style.display = "none";
  }
  // Admin: all tabs visible (default)
}

function toggleFormFieldsForRole() {
  const role = sessionStorage.getItem("luka_logged_role") || "Staff";
  const isWaiter = role === "Waiter";
  
  const nameInput = document.getElementById("item-name-input");
  const categorySelect = document.getElementById("item-category-select");
  const descInput = document.getElementById("item-desc-input");
  const orderInput = document.getElementById("item-order-input");
  const statusSelect = document.getElementById("item-status-select");
  const tagChecks = [
    document.getElementById("tag-veg-check"),
    document.getElementById("tag-nonveg-check"),
    document.getElementById("tag-spicy-check"),
    document.getElementById("tag-sig-check"),
    document.getElementById("tag-best-check")
  ];
  const mediaZone = document.getElementById("media-drag-zone");
  
  const priceVariantsContainer = document.getElementById("price-variants-container");
  const priceVariantsBox = priceVariantsContainer ? priceVariantsContainer.closest(".form-box") || priceVariantsContainer.parentElement : null;
  
  if (nameInput) nameInput.disabled = isWaiter;
  if (categorySelect) categorySelect.disabled = isWaiter;
  if (descInput) descInput.disabled = isWaiter;
  if (orderInput) orderInput.disabled = isWaiter;
  if (statusSelect) statusSelect.disabled = isWaiter;
  tagChecks.forEach(chk => { if (chk) chk.disabled = isWaiter; });
  
  if (mediaZone) {
    if (isWaiter) {
      mediaZone.style.pointerEvents = "none";
      mediaZone.style.opacity = "0.5";
    } else {
      mediaZone.style.pointerEvents = "auto";
      mediaZone.style.opacity = "1";
    }
  }
  
  if (priceVariantsBox) {
    if (isWaiter) {
      priceVariantsBox.style.display = "none";
    } else {
      priceVariantsBox.style.display = "block";
    }
  }
}

// User Profiles CRUD (FR-22) (Admin Only)
let usersList = {};

function toggleUserForm() {
  const formBox = document.getElementById("user-form-box");
  const toggleBtn = document.getElementById("btn-add-user-toggle");
  
  if (formBox.style.display === "none") {
    formBox.style.display = "block";
    toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Form';
    resetUserForm();
  } else {
    formBox.style.display = "none";
    toggleBtn.innerHTML = '<i class="fas fa-user-plus"></i> Add New User Profile';
  }
}

function resetUserForm() {
  document.getElementById("user-crud-form").reset();
  document.getElementById("edit-user-original-name").value = "";
  document.getElementById("form-user-title").innerText = "Create New User Profile";
  document.getElementById("btn-save-user").innerText = "Create Profile";
  document.getElementById("user-name-input").disabled = false;
  const pw = document.getElementById("user-password-input");
  pw.required = true;
  pw.placeholder = "Min. 6 characters";
}

function escapeHTML(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function loadUsers() {
  const tbody = document.getElementById("admin-users-tbody");
  tbody.innerHTML = "<tr><td colspan='4' style='text-align:center;'>Loading staff accounts...</td></tr>";

  const staffUser = sessionStorage.getItem("luka_logged_user") || "System";
  fetch("/api/users", {
    method: "GET",
    headers: {
      "X-Staff-User": encodeURIComponent(staffUser)
    }
  })
  .then(res => {
    if (!res.ok) throw new Error("Users read access denied.");
    return res.json();
  })
  .then(data => {
    usersList = data || {};
    renderUsersTable();
  })
  .catch(err => {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan='4' style='text-align:center;color:red;'>${err.message || "Failed to load profiles."}</td></tr>`;
  });
}

function renderUsersTable() {
  const tbody = document.getElementById("admin-users-tbody");
  tbody.innerHTML = "";

  const usernames = Object.keys(usersList);
  if (usernames.length === 0) {
    tbody.innerHTML = "<tr><td colspan='4' style='text-align:center;color:var(--text-muted);'>No staff profiles found.</td></tr>";
    return;
  }

  usernames.forEach(name => {
    const profile = usersList[name];
    const role = escapeHTML(profile.role || "Staff");
    name = escapeHTML(name);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="font-weight:600;"><i class="fas fa-user" style="color:var(--primary); margin-right:6px;"></i>${name}</td>
      <td><span class="status-badge" style="background:rgba(255,255,255,0.08); color:#fff; font-weight:600;">${role}</span></td>
      <td style="font-size:12px; color:var(--text-muted);"><i class="fas fa-lock" style="margin-right:4px;"></i>Encrypted (hidden)</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-secondary" onclick="editUserProfile('${name}')" style="padding: 6px 10px; font-size:12px;"><i class="fas fa-key"></i> Edit</button>
        <button class="btn btn-danger" onclick="deleteUserProfile('${name}')" style="padding: 6px 10px; font-size:12px;"><i class="fas fa-user-minus"></i> Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function editUserProfile(name) {
  const profile = usersList[name];
  if (!profile) return;

  const formBox = document.getElementById("user-form-box");
  formBox.style.display = "block";
  document.getElementById("btn-add-user-toggle").innerHTML = '<i class="fas fa-chevron-up"></i> Hide Form';

  document.getElementById("edit-user-original-name").value = name;
  document.getElementById("form-user-title").innerText = `Edit Profile: ${name}`;
  document.getElementById("user-name-input").value = name;
  document.getElementById("user-name-input").disabled = true;
  const pw = document.getElementById("user-password-input");
  pw.value = "";
  pw.required = false;
  pw.placeholder = "Leave blank to keep current password";
  document.getElementById("user-role-select").value = profile.role || "Waiter";
  document.getElementById("btn-save-user").innerText = "Update Profile";

  formBox.scrollIntoView({ behavior: "smooth" });
}

function saveUserProfile(e) {
  e.preventDefault();

  const originalName = document.getElementById("edit-user-original-name").value.trim();
  const username = document.getElementById("user-name-input").value.trim().toLowerCase();
  const password = document.getElementById("user-password-input").value.trim();
  const role = document.getElementById("user-role-select").value;

  if (!username || !role || (!originalName && !password)) {
    window.showToast("All fields are required!", "error");
    return;
  }
  if (password && password.length < 6) {
    window.showToast("Password must be at least 6 characters.", "error");
    return;
  }

  if (originalName) {
    // A blank password tells the server to keep the current one
    usersList[originalName] = password ? { password, role } : { role };
  } else {
    if (usersList[username]) {
      window.showToast("Username already exists!", "error");
      return;
    }
    usersList[username] = { password, role };
  }

  const staffUser = sessionStorage.getItem("luka_logged_user") || "System";
  fetch("/api/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Staff-User": encodeURIComponent(staffUser)
    },
    body: JSON.stringify(usersList)
  })
  .then(res => {
    if (!res.ok) throw new Error("Failed to save credentials database.");
    return res.json();
  })
  .then(data => {
    window.showToast(originalName ? "User updated successfully!" : "New user created successfully!", "success");
    toggleUserForm();
    loadUsers();
  })
  .catch(err => {
    window.showToast(err.message, "error");
  });
}

function deleteUserProfile(name) {
  const loggedInUser = (sessionStorage.getItem("luka_logged_user") || "").toLowerCase();
  if (name.toLowerCase() === loggedInUser) {
    alert("You cannot delete your own logged-in admin account!");
    return;
  }

  if (confirm(`Are you sure you want to delete staff account "${name}"?`)) {
    delete usersList[name];
    
    const staffUser = sessionStorage.getItem("luka_logged_user") || "System";
    fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Staff-User": encodeURIComponent(staffUser)
      },
      body: JSON.stringify(usersList)
    })
    .then(res => {
      if (!res.ok) throw new Error("Failed to delete user profile.");
      return res.json();
    })
    .then(data => {
      window.showToast("Staff profile deleted.", "info");
      loadUsers();
    })
    .catch(err => {
      window.showToast(err.message, "error");
    });
  }
}

// Save or Create Item trigger
function saveItem(e) {
  e.preventDefault();
  
  const idInput = document.getElementById("edit-item-id").value;
  const name = document.getElementById("item-name-input").value.trim();
  const categoryId = document.getElementById("item-category-select").value;
  const description = document.getElementById("item-desc-input").value.trim();
  const availability = document.getElementById("item-avail-select").value;
  const status = document.getElementById("item-status-select").value;
  const displayOrder = parseInt(document.getElementById("item-order-input").value) || 1;

  // Build tags
  const tags = [];
  if (document.getElementById("tag-veg-check").checked) tags.push("Veg");
  if (document.getElementById("tag-nonveg-check").checked) tags.push("Non-Veg");
  if (document.getElementById("tag-spicy-check").checked) tags.push("Spicy");
  if (document.getElementById("tag-sig-check").checked) tags.push("Signature");
  if (document.getElementById("tag-best-check").checked) tags.push("Bestseller");
  
  // Set default Alcoholic / Non-Alcoholic
  const catObj = categories.find(c => c.id === categoryId);
  if (catObj) {
    if (catObj.section === "drinks") {
      const nonAlcoCats = ["cat-mocktails", "cat-beverages"];
      if (nonAlcoCats.includes(categoryId)) {
        tags.push("Non-Alcoholic");
      } else {
        tags.push("Alcoholic");
      }
    }
  }

  // Parse price variants
  const variantRows = document.querySelectorAll(".variant-row");
  const price_variants = [];
  variantRows.forEach(row => {
    const label = row.querySelector(".variant-label").value.trim();
    const price = parseFloat(row.querySelector(".variant-price").value) || 0;
    if (label) {
      price_variants.push({ label, price });
    }
  });

  if (price_variants.length === 0) {
    window.showToast("Please add at least one valid price variant.", "error");
    return;
  }

  if (idInput) {
    // Edit Mode
    const idx = items.findIndex(i => i.id === idInput);
    if (idx !== -1) {
      items[idx] = {
        ...items[idx],
        name,
        category_id: categoryId,
        description,
        tags,
        availability,
        status,
        display_order: displayOrder,
        media: currentUploadedMedia,
        price_variants
      };
      window.showToast("Item details updated", "success");
    }
  } else {
    // Create Mode
    const newItem = {
      id: `item-${Date.now()}`,
      category_id: categoryId,
      name,
      description,
      tags,
      availability,
      media: currentUploadedMedia,
      price_variants,
      display_order: displayOrder,
      status
    };
    items.push(newItem);
    window.showToast("New item created", "success");
  }

  // Save and sync
  const actionMsg = idInput ? `Updated menu item: "${name}"` : `Added new menu item: "${name}"`;
  saveMenuData(actionMsg);
  
  // Close form
  toggleItemForm();
  
  // Refresh UI list
  renderAdminItems();
}

function deleteItem(itemId) {
  const target = items.find(i => i.id === itemId);
  const itemName = target ? target.name : itemId;
  if (confirm(`Are you sure you want to delete "${itemName}"?`)) {
    items = items.filter(i => i.id !== itemId);
    saveMenuData(`Deleted menu item: "${itemName}"`);
    renderAdminItems();
    window.showToast("Item deleted", "info");
  }
}

// Category CRUD handlers
function renderAdminCategories() {
  const tbody = document.getElementById("admin-categories-tbody");
  tbody.innerHTML = "";
  
  categories.sort((a,b) => a.display_order - b.display_order).forEach(cat => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="font-weight:600;">${cat.name}</td>
      <td style="text-transform: capitalize;">${cat.section}</td>
      <td>${cat.display_order}</td>
      <td><span class="status-badge" style="background:${cat.visible?'#d1fae5':'#fee2e2'}; color:${cat.visible?'#065f46':'#991b1b'};">${cat.visible?'Visible':'Hidden'}</span></td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-secondary" onclick="editCategory('${cat.id}')" style="padding: 6px 10px; font-size:12px;"><i class="fas fa-edit"></i> Edit</button>
        <button class="btn btn-danger" onclick="deleteCategory('${cat.id}')" style="padding: 6px 10px; font-size:12px;"><i class="fas fa-trash"></i> Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function editCategory(catId) {
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;

  document.getElementById("edit-cat-id").value = cat.id;
  document.getElementById("form-category-title").innerText = `Edit Category: ${cat.name}`;
  document.getElementById("cat-name-input").value = cat.name;
  document.getElementById("cat-section-select").value = cat.section;
  document.getElementById("cat-order-input").value = cat.display_order;
  document.getElementById("cat-visible-check").checked = cat.visible;
  
  document.getElementById("cat-name-input").focus();
}

function resetCategoryForm() {
  document.getElementById("category-crud-form").reset();
  document.getElementById("edit-cat-id").value = "";
  document.getElementById("form-category-title").innerText = "Add New Category";
}

function saveCategory(e) {
  e.preventDefault();
  
  const idInput = document.getElementById("edit-cat-id").value;
  const name = document.getElementById("cat-name-input").value.trim();
  const section = document.getElementById("cat-section-select").value;
  const displayOrder = parseInt(document.getElementById("cat-order-input").value) || 1;
  const visible = document.getElementById("cat-visible-check").checked;

  if (idInput) {
    // Edit
    const idx = categories.findIndex(c => c.id === idInput);
    if (idx !== -1) {
      categories[idx] = {
        ...categories[idx],
        name,
        section,
        display_order: displayOrder,
        visible
      };
      window.showToast("Category updated", "success");
    }
  } else {
    // Create
    const newCat = {
      id: `cat-${Date.now()}`,
      name,
      section,
      display_order: displayOrder,
      visible
    };
    categories.push(newCat);
    window.showToast("New category created", "success");
  }

  const actionMsg = idInput ? `Updated category: "${name}"` : `Created category: "${name}"`;
  saveMenuData(actionMsg);
  resetCategoryForm();
  
  // Refresh selectors and lists
  populateCategorySelects();
  renderAdminCategories();
  renderAdminItems();
}

function deleteCategory(catId) {
  // Check if items belong to this category (prevent orphan items)
  const hasItems = items.some(item => item.category_id === catId);
  if (hasItems) {
    alert("Cannot delete category! There are menu items currently assigned to this category. Please reassign those items first.");
    return;
  }

  const target = categories.find(c => c.id === catId);
  const catName = target ? target.name : catId;

  if (confirm(`Are you sure you want to delete category "${catName}"?`)) {
    categories = categories.filter(c => c.id !== catId);
    saveMenuData(`Deleted category: "${catName}"`);
    populateCategorySelects();
    renderAdminCategories();
    window.showToast("Category deleted", "info");
  }
}

// Audit Logs Retrieval and Rendering (FR-18)
let auditLogs = [];

function loadAuditLogs() {
  const tbody = document.getElementById("admin-logs-tbody");
  tbody.innerHTML = "<tr><td colspan='3' style='text-align:center;'>Loading logs...</td></tr>";

  fetch("/api/audit-log")
    .then(res => res.json())
    .then(data => {
      auditLogs = data || [];
      renderAuditLogs();
    })
    .catch(err => {
      console.error(err);
      tbody.innerHTML = "<tr><td colspan='3' style='text-align:center;color:red;'>Failed to load audit logs from server</td></tr>";
    });
}

function renderAuditLogs() {
  const tbody = document.getElementById("admin-logs-tbody");
  const q = document.getElementById("log-search-box").value.trim().toLowerCase();
  tbody.innerHTML = "";

  const filtered = auditLogs.filter(log => {
    if (!q) return true;
    return (log.user || "").toLowerCase().includes(q) || (log.action || "").toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = "<tr><td colspan='3' style='text-align:center;color:var(--text-muted);'>No audit logs matching query found.</td></tr>";
    return;
  }

  filtered.forEach(log => {
    const row = document.createElement("tr");
    
    // Format UTC timestamp nicely for display
    let timeStr = log.timestamp || "";
    if (timeStr.includes("T")) {
      timeStr = timeStr.replace("T", " ").substring(0, 19) + " UTC";
    }

    row.innerHTML = `
      <td style="font-family:monospace; font-size:12px; color:var(--text-muted);">${timeStr}</td>
      <td style="font-weight:600;"><i class="fas fa-user-edit" style="color:var(--primary); margin-right:6px;"></i>${log.user}</td>
      <td style="font-size:13px;">${log.action}</td>
    `;
    tbody.appendChild(row);
  });
}

// Active Table Orders dashboard controllers (FR-21 & FR-23)
let activeOrdersList = {};
let selectedAdminTableNo = null;

function loadAdminTableOrders() {
  fetch("/api/orders")
    .then(res => res.json())
    .then(data => {
      activeOrdersList = data || {};
      renderTablesGrid();
      
      if (selectedAdminTableNo) {
        showTableDetail(selectedAdminTableNo);
      }
    })
    .catch(err => {
      console.error("Failed to load table orders:", err);
      window.showToast("Failed to sync orders from kitchen.", "error");
    });
}

function renderTablesGrid() {
  const container = document.getElementById("admin-tables-grid");
  container.innerHTML = "";

  // Generate 15 table buttons
  for (let i = 1; i <= 15; i++) {
    const tableKey = `table_${i}`;
    const tableSession = activeOrdersList[tableKey];
    const hasOrders = tableSession && tableSession.orders && tableSession.orders.length > 0;
    const isCheckoutReq = tableSession && tableSession.status === "Checkout Requested";
    
    const btn = document.createElement("div");
    btn.className = `table-grid-btn`;
    if (isCheckoutReq) {
      btn.classList.add("checkout-requested-table");
    } else if (hasOrders) {
      btn.classList.add("active-table");
    }
    if (selectedAdminTableNo === String(i)) btn.classList.add("selected-table");
    
    let statusLabel = 'VACANT';
    if (isCheckoutReq) statusLabel = '<i class="fas fa-exclamation-circle"></i> BILL REQ';
    else if (hasOrders) statusLabel = '<i class="fas fa-dot-circle"></i> ACTIVE';

    btn.innerHTML = `
      <div style="font-size:16px;">T-${i}</div>
      <div style="font-size:10px; font-weight:normal; margin-top:2px; white-space:nowrap;">
        ${statusLabel}
      </div>
    `;
    btn.onclick = () => {
      selectedAdminTableNo = String(i);
      document.querySelectorAll(".table-grid-btn").forEach(el => el.classList.remove("selected-table"));
      btn.classList.add("selected-table");
      showTableDetail(selectedAdminTableNo);
    };
    
    container.appendChild(btn);
  }
}

function showTableDetail(tableNo) {
  const emptyState = document.getElementById("table-detail-empty-state");
  const contentPane = document.getElementById("table-detail-content");
  const title = document.getElementById("detail-table-title");
  const btnBill = document.getElementById("btn-generate-bill");
  const roundsContainer = document.getElementById("detail-rounds-container");

  title.innerHTML = `Table ${tableNo} Dining Details`;
  
  const tableKey = `table_${tableNo}`;
  const session = activeOrdersList[tableKey];

  if (session && session.customer_name) {
    title.innerHTML = `
      Table ${tableNo} Dining Details
      <div style="font-size:12px; font-weight:normal; color:var(--text-muted); margin-top:4px;">
        <i class="fas fa-user" style="color:var(--primary); margin-right:4px;"></i>Guest: <strong>${escapeHTML(session.customer_name)}</strong> 
        <span style="margin:0 8px; color:rgba(255,255,255,0.25);">|</span> 
        <i class="fas fa-phone" style="color:var(--primary); margin-right:4px;"></i>Phone: <strong>${escapeHTML(session.customer_phone || 'N/A')}</strong>
      </div>
    `;
  }
  
  // Show/Hide checkout actions based on role
  const role = sessionStorage.getItem("luka_logged_role") || "Staff";
  if (role === "Waiter") {
    btnBill.style.display = "none";
  } else {
    btnBill.style.display = "inline-flex";
  }

  if (!session || !session.orders || session.orders.length === 0) {
    emptyState.style.display = "flex";
    emptyState.innerHTML = `
      <i class="fas fa-utensils" style="font-size: 50px; margin-bottom: 16px; color: var(--primary); opacity: 0.25;"></i>
      <h3 style="color:#fff; margin-bottom:8px;">Table ${tableNo} is Vacant</h3>
      <p style="font-size:13px; color:var(--text-muted);">No active dining session is set. Customers ordering directly via table QR code link will appear here instantly.</p>
    `;
    contentPane.style.display = "none";
    return;
  }

  emptyState.style.display = "none";
  contentPane.style.display = "flex";
  roundsContainer.innerHTML = "";

  session.orders.forEach((round, index) => {
    const roundDiv = document.createElement("div");
    roundDiv.className = "round-card";
    roundDiv.style.background = "rgba(255,255,255,0.02)";
    roundDiv.style.border = "1px solid var(--border-color)";
    roundDiv.style.borderRadius = "8px";
    roundDiv.style.padding = "16px";
    roundDiv.style.display = "flex";
    roundDiv.style.flexDirection = "column";
    roundDiv.style.gap = "10px";

    let timeStr = "";
    if (round.timestamp && round.timestamp.includes("T")) {
      timeStr = round.timestamp.replace("T", " ").substring(0, 16) + " UTC";
    }

    roundDiv.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
        <span style="font-weight:700; color:var(--primary);">ROUND ${index + 1} <span style="font-size:11px; font-weight:normal; color:var(--text-muted); margin-left:8px;">(${timeStr})</span></span>
        <div style="display:flex; align-items:center; gap:8px;">
          <label style="font-size:12px; color:var(--text-muted);">Status:</label>
          <select class="input-control" onchange="updateAdminOrderStatus('${tableNo}', '${round.order_id}', this.value)" style="padding:4px 8px; font-size:12px; width:130px; background:#111827; border-color:#4b5563; color:#fff;">
            <option value="Received" ${round.status==='Received'?'selected':''}>Received</option>
            <option value="Preparing" ${round.status==='Preparing'?'selected':''}>Preparing</option>
            <option value="Ready" ${round.status==='Ready'?'selected':''}>Ready</option>
            <option value="Served" ${round.status==='Served'?'selected':''}>Served</option>
          </select>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${round.items.map(i => `
          <div style="display:flex; justify-content:space-between; font-size:13px;">
            <span><strong style="color:var(--primary); margin-right:8px;">${i.quantity}x</strong>${i.name} (${i.variant})</span>
            <span style="color:var(--text-muted);">₹${i.price * i.quantity}</span>
          </div>
        `).join("")}
      </div>
    `;
    roundsContainer.appendChild(roundDiv);
  });
}

function updateAdminOrderStatus(tableNo, orderId, status) {
  const staff = sessionStorage.getItem("luka_logged_user") || "System";
  fetch("/api/orders/update-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Staff-User": encodeURIComponent(staff)
    },
    body: JSON.stringify({ table_no: tableNo, order_id: orderId, status: status })
  })
  .then(res => {
    if (!res.ok) throw new Error("Failed to update status");
    return res.json();
  })
  .then(data => {
    window.showToast("Order status updated successfully!", "success");
    loadAdminTableOrders();
  })
  .catch(err => {
    window.showToast(err.message, "error");
  });
}

// Checkout & Billing functions
let currentCheckoutBill = null;

function checkoutTable() {
  const tableKey = `table_${selectedAdminTableNo}`;
  const session = activeOrdersList[tableKey];
  if (!session) return;

  // Compile bill details
  let subtotal = 0;
  const itemsList = [];
  session.orders.forEach(round => {
    round.items.forEach(i => {
      const lineCost = i.price * i.quantity;
      subtotal += lineCost;
      
      const existing = itemsList.find(x => x.name === i.name && x.variant === i.variant);
      if (existing) {
        existing.quantity += i.quantity;
      } else {
        itemsList.push({ ...i });
      }
    });
  });

  const serviceCharge = Math.round(subtotal * 0.10);
  const tax = Math.round(subtotal * 0.05);
  const grandTotal = subtotal + serviceCharge + tax;

  const billInvoiceId = `INV-${Date.now()}`;
  activeReceiptObject = {
    invoice_id: billInvoiceId,
    table_no: selectedAdminTableNo,
    customer_name: session.customer_name || 'Guest',
    customer_phone: session.customer_phone || 'N/A',
    timestamp: new Date().toISOString(),
    subtotal: subtotal,
    service_charge: serviceCharge,
    tax: tax,
    grand_total: grandTotal,
    items: itemsList
  };

  currentCheckoutBill = {
    table_no: selectedAdminTableNo,
    subtotal,
    service_charge: serviceCharge,
    tax: tax,
    grand_total: grandTotal,
    items: itemsList
  };

  // Populate bill elements
  document.getElementById("bill-meta-info").innerHTML = `
    <strong>Invoice ID:</strong> ${billInvoiceId}<br>
    <strong>Table Number:</strong> Table ${selectedAdminTableNo}<br>
    <strong>Guest Name:</strong> ${escapeHTML(session.customer_name || 'Guest')}<br>
    <strong>Contact Number:</strong> ${session.customer_phone || 'N/A'}<br>
    <strong>Billing Date:</strong> ${new Date().toLocaleString()}
  `;

  const container = document.getElementById("bill-items-list");
  container.innerHTML = "";
  itemsList.forEach(item => {
    const row = document.createElement("div");
    row.className = "bill-item-line";
    row.innerHTML = `
      <span>${item.name} (${item.variant}) x${item.quantity}</span>
      <span>₹${item.price * item.quantity}</span>
    `;
    container.appendChild(row);
  });

  document.getElementById("bill-subtotal").innerText = `₹${subtotal}`;
  document.getElementById("bill-service-charge").innerText = `₹${serviceCharge}`;
  document.getElementById("bill-tax").innerText = `₹${tax}`;
  document.getElementById("bill-grand-total").innerText = `₹${grandTotal}`;

  // Show Modal and ensure confirm settle button is visible
  const billModal = document.getElementById("bill-modal");
  const settleBtn = billModal.querySelector("button[onclick='confirmBillCheckout()']");
  if (settleBtn) settleBtn.style.display = "inline-flex";

  billModal.classList.add("active-modal");
}

function closeBillModal() {
  document.getElementById("bill-modal").classList.remove("active-modal");
  currentCheckoutBill = null;
}

function confirmBillCheckout() {
  if (!currentCheckoutBill) return;

  const staff = sessionStorage.getItem("luka_logged_user") || "System";
  fetch("/api/orders/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Staff-User": encodeURIComponent(staff)
    },
    body: JSON.stringify({ table_no: currentCheckoutBill.table_no })
  })
  .then(res => {
    if (!res.ok) throw new Error("Table checkout failed. Waiters cannot checkout tables.");
    return res.json();
  })
  .then(data => {
    const msg = data.sms_message || `Table ${currentCheckoutBill.table_no} order session settled.`;
    window.showToast(`Settle Successful! SMS Sent: "${msg}"`, "success");
    closeBillModal();
    selectedAdminTableNo = null;
    loadAdminTableOrders();
  })
  .catch(err => {
    window.showToast(err.message, "error");
  });
}

// Sales Invoices archive controllers (FR-23)
let historicalInvoices = [];
   
function loadHistoricalInvoices() {
  const tbody = document.getElementById("admin-invoices-tbody");
  tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>Loading invoices history...</td></tr>";

  const staff = sessionStorage.getItem("luka_logged_user") || "System";
  fetch("/api/invoices", {
    method: "GET",
    headers: {
      "X-Staff-User": encodeURIComponent(staff)
    }
  })
  .then(res => {
    if (!res.ok) throw new Error("Invoices read access denied.");
    return res.json();
  })
  .then(data => {
    historicalInvoices = data || [];
    renderInvoicesTable(historicalInvoices);
  })
  .catch(err => {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan='8' style='text-align:center;color:red;'>${err.message || "Failed to load invoices."}</td></tr>`;
  });
}

function renderInvoicesTable(list) {
  const tbody = document.getElementById("admin-invoices-tbody");
  tbody.innerHTML = "";

  if (list.length === 0) {
    tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;color:var(--text-muted);'>No generated invoices found.</td></tr>";
    return;
  }

  list.forEach(inv => {
    let dateStr = "";
    if (inv.timestamp && inv.timestamp.includes("T")) {
      dateStr = inv.timestamp.replace("T", " ").substring(0, 16) + " UTC";
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="font-weight:600; font-family:monospace; font-size:12px; color:var(--primary);">${inv.invoice_id}</td>
      <td style="font-size:12px; color:var(--text-muted);">${dateStr}</td>
      <td><span class="status-badge" style="background:rgba(255,255,255,0.08); color:#fff; font-weight:600;">Table ${inv.table_no}</span></td>
      <td>₹${inv.subtotal}</td>
      <td>₹${inv.service_charge}</td>
      <td>₹${inv.tax}</td>
      <td style="font-weight:700; color:var(--primary);">₹${inv.total}</td>
      <td style="text-align:right;">
        <button class="btn btn-secondary" onclick="viewHistoricalInvoiceDetails('${inv.invoice_id}')" style="padding: 6px 12px; font-size:12px;">
          <i class="fas fa-eye"></i> View Bill
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function filterHistoricalInvoices() {
  const q = document.getElementById("invoice-search-input").value.trim().toLowerCase();
  if (!q) {
    renderInvoicesTable(historicalInvoices);
    return;
  }

  const filtered = historicalInvoices.filter(inv => {
    return inv.invoice_id.toLowerCase().includes(q) || 
           `table ${inv.table_no}`.toLowerCase().includes(q) ||
           String(inv.table_no).includes(q);
  });
  renderInvoicesTable(filtered);
}

function viewHistoricalInvoiceDetails(invoiceId) {
  const inv = historicalInvoices.find(x => x.invoice_id === invoiceId);
  if (!inv) return;

  activeReceiptObject = {
    invoice_id: inv.invoice_id,
    table_no: inv.table_no,
    customer_name: inv.customer_name || 'Guest',
    customer_phone: inv.customer_phone || 'N/A',
    timestamp: inv.timestamp,
    subtotal: inv.subtotal,
    service_charge: inv.service_charge,
    tax: inv.tax,
    grand_total: inv.total,
    items: inv.items
  };

  document.getElementById("bill-meta-info").innerHTML = `
    <strong>Invoice ID:</strong> ${inv.invoice_id}<br>
    <strong>Table Number:</strong> Table ${inv.table_no}<br>
    <strong>Guest Name:</strong> ${escapeHTML(inv.customer_name || 'Guest')}<br>
    <strong>Contact Number:</strong> ${inv.customer_phone || 'N/A'}<br>
    <strong>Billing Date:</strong> ${inv.timestamp.replace("T", " ").substring(0, 16)} UTC
  `;

  const container = document.getElementById("bill-items-list");
  container.innerHTML = "";
  inv.items.forEach(item => {
    const row = document.createElement("div");
    row.className = "bill-item-line";
    row.innerHTML = `
      <span>${item.name} (${item.variant}) x${item.quantity}</span>
      <span>₹${item.price * item.quantity}</span>
    `;
    container.appendChild(row);
  });

  document.getElementById("bill-subtotal").innerText = `₹${inv.subtotal}`;
  document.getElementById("bill-service-charge").innerText = `₹${inv.service_charge}`;
  document.getElementById("bill-tax").innerText = `₹${inv.tax}`;
  document.getElementById("bill-grand-total").innerText = `₹${inv.total}`;

  const billModal = document.getElementById("bill-modal");
  const settleBtn = billModal.querySelector("button[onclick='confirmBillCheckout()']");
  if (settleBtn) settleBtn.style.display = "none";

  billModal.classList.add("active-modal");
}

let activeReceiptObject = null;

function printInvoice() {
  window.print();
}

function downloadInvoicePDF() {
  if (!activeReceiptObject) {
    window.showToast("No active receipt to download.", "error");
    return;
  }

  const element = document.querySelector("#bill-modal .form-box");
  const footer = document.getElementById("bill-actions-footer");
  
  if (footer) footer.style.visibility = "hidden";

  const opt = {
    margin:       0.3,
    filename:     `${activeReceiptObject.invoice_id}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, backgroundColor: '#18181b', logging: false, useCORS: true },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save().then(() => {
    if (footer) footer.style.visibility = "visible";
    window.showToast("Invoice PDF downloaded successfully!", "success");
  }).catch(err => {
    console.error("PDF Export Error:", err);
    if (footer) footer.style.visibility = "visible";
    window.showToast("Failed to generate PDF.", "error");
  });
}
