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

// Automatic extension-agnostic image resolution (FR-21)
window.handleImageError = function(imgEl, itemId) {
  // Extract path to inspect current suffix
  const src = imgEl.src || "";
  if (src.endsWith(".jpg")) {
    imgEl.src = `uploads/${itemId}.png`;
  } else if (src.endsWith(".png")) {
    imgEl.src = `uploads/${itemId}.jpeg`;
  } else if (src.endsWith(".jpeg")) {
    imgEl.src = "images.jpg"; // Brand logo default fallback
  } else {
    imgEl.src = "images.jpg";
  }
};

// Public Menu Script
let menuCategories = [];
let menuItems = [];
let activeSection = null; // 'food' or 'drinks'
let activeFilters = {
  search: "",
  diet: "all" // 'all', 'veg', 'nonveg', 'spicy', 'signature'
};

document.addEventListener("DOMContentLoaded", () => {
  loadMenuData();
  initTableCartSystem();
  
  // Bind search events
  const searchBox = document.getElementById("search-box");
  const btnClearSearch = document.getElementById("btn-clear-search");
  
  searchBox.addEventListener("input", (e) => {
    activeFilters.search = e.target.value.trim().toLowerCase();
    btnClearSearch.style.display = activeFilters.search ? "block" : "none";
    renderMenu();
  });
  
  btnClearSearch.addEventListener("click", () => {
    searchBox.value = "";
    activeFilters.search = "";
    btnClearSearch.style.display = "none";
    renderMenu();
  });

  // Handle direct url hashes (e.g., #food or #drinks)
  const hash = window.location.hash.toLowerCase();
  if (hash === "#food" || hash === "#drinks") {
    selectSection(hash.substring(1));
  }
});

// Load menu data from API or fall back to local seed data
function loadMenuData() {
  const loadingContainer = document.getElementById("menu-loading");
  if (loadingContainer) loadingContainer.style.display = "grid";

  fetch("/api/menu")
    .then(res => {
      if (!res.ok) throw new Error("Server response error");
      return res.json();
    })
    .then(data => {
      menuCategories = data.categories || [];
      menuItems = data.items || [];
      
      // Auto-upgrade database if server runs the old minimal seed
      if (menuItems.length < 50 && window.LukaSeedData) {
        console.log("Upgrading server database to complete menu database (100+ items)...");
        menuCategories = window.LukaSeedData.initialCategories || [];
        menuItems = window.LukaSeedData.initialItems || [];
        
        fetch("/api/menu", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ categories: menuCategories, items: menuItems })
        }).catch(err => console.error("Database self-healing upgrade failed:", err));
      }
      
      initApp();
    })
    .catch(err => {
      console.warn("Could not load API menu data. Falling back to local seed data:", err);
      if (window.LukaSeedData) {
        menuCategories = window.LukaSeedData.initialCategories || [];
        menuItems = window.LukaSeedData.initialItems || [];
      }
      initApp();
    });
}

function initApp() {
  const loadingContainer = document.getElementById("menu-loading");
  if (loadingContainer) loadingContainer.style.display = "none";
  
  // If we already selected a section, render it
  if (activeSection) {
    renderCategoryTabs();
    renderMenu();
  }
}

// Handle food vs bar section selection
function selectSection(section) {
  activeSection = section;
  window.location.hash = section;
  
  // Toggle body classes for theme overrides
  if (section === "drinks") {
    document.body.classList.add("drinks-mode");
  } else {
    document.body.classList.remove("drinks-mode");
  }

  // Adjust display states
  document.getElementById("menu-hero").style.display = "none";
  document.getElementById("main-section-cards").style.display = "none";
  document.getElementById("menu-workspace").style.display = "block";
  
  // Set section title
  const workspaceTitle = document.getElementById("workspace-title");
  workspaceTitle.innerText = section === "food" ? "Food Menu" : "Drinks & Bar";
  
  // Render tabs & contents
  renderCategoryTabs();
  renderFilterChips();
  renderMenu();
}

function goBackToLanding() {
  activeSection = null;
  window.location.hash = "";
  document.body.classList.remove("drinks-mode");
  
  document.getElementById("menu-hero").style.display = "flex";
  document.getElementById("main-section-cards").style.display = "grid";
  document.getElementById("menu-workspace").style.display = "none";
}

// Render filter option chips (Veg / Nonveg / Spicy)
function renderFilterChips() {
  const container = document.getElementById("filter-chip-container");
  container.innerHTML = "";

  const chips = [
    { label: "All Items", key: "all" },
    { label: "🟢 Veg Only", key: "veg" },
    { label: "🔴 Non-Veg", key: "nonveg" }
  ];

  // Add spicy filter for Food, signature for Drinks
  if (activeSection === "food") {
    chips.push({ label: "🌶️ Spicy", key: "spicy" });
  } else {
    chips.push({ label: "⭐ Signature", key: "signature" });
  }

  chips.forEach(chip => {
    const btn = document.createElement("button");
    btn.className = `filter-chip ${activeFilters.diet === chip.key ? "active" : ""}`;
    btn.innerText = chip.label;
    btn.addEventListener("click", () => {
      activeFilters.diet = chip.key;
      // Re-highlight active chip
      const activeBtn = container.querySelector(".filter-chip.active");
      if (activeBtn) activeBtn.classList.remove("active");
      btn.classList.add("active");
      renderMenu();
    });
    container.appendChild(btn);
  });
}

// Render sticky Category navigation tabs
function renderCategoryTabs() {
  const container = document.getElementById("category-tab-container");
  container.innerHTML = "";
  
  // Filter categories to active section with at least 1 published item
  const sectionCats = menuCategories
    .filter(cat => cat.section === activeSection && cat.visible)
    .sort((a, b) => a.display_order - b.display_order);

  // Filter categories which have items (FR-19)
  const activeCats = sectionCats.filter(cat => {
    return menuItems.some(item => item.category_id === cat.id && item.status === "Published" && item.availability === "Available");
  });

  activeCats.forEach((cat, idx) => {
    const btn = document.createElement("button");
    btn.className = `tab-btn ${idx === 0 ? "active" : ""}`;
    btn.innerText = cat.name;
    btn.setAttribute("data-cat-id", cat.id);
    
    btn.addEventListener("click", () => {
      // De-active others
      container.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      // Scroll to category block
      const element = document.getElementById(cat.id);
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
    });
    container.appendChild(btn);
  });
}

// Main rendering engine
function renderMenu() {
  const container = document.getElementById("categories-container");
  const emptyState = document.getElementById("empty-state");
  container.innerHTML = "";
  
  // Get active items matching section and filters
  let filteredItems = menuItems.filter(item => {
    // 1. Availability check
    if (item.status !== "Published" || item.availability !== "Available") return false;
    
    // 2. Section check
    const cat = menuCategories.find(c => c.id === item.category_id);
    if (!cat || cat.section !== activeSection || !cat.visible) return false;

    // 3. Search query check
    if (activeFilters.search) {
      const q = activeFilters.search;
      const nameMatch = item.name.toLowerCase().includes(q);
      const descMatch = item.description.toLowerCase().includes(q);
      const tagsMatch = item.tags.some(t => t.toLowerCase().includes(q));
      if (!nameMatch && !descMatch && !tagsMatch) return false;
    }

    // 4. Diet/Tag filter check
    if (activeFilters.diet !== "all") {
      if (activeFilters.diet === "veg" && !item.tags.includes("Veg")) return false;
      if (activeFilters.diet === "nonveg" && !item.tags.includes("Non-Veg")) return false;
      if (activeFilters.diet === "spicy" && !item.tags.includes("Spicy")) return false;
      if (activeFilters.diet === "signature" && !item.tags.includes("Signature")) return false;
    }

    return true;
  });

  // Handle empty state
  if (filteredItems.length === 0) {
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  // If search is active, show flat list to expedite scrolling (FR-8)
  if (activeFilters.search) {
    const searchBlock = document.createElement("div");
    searchBlock.className = "category-block";
    
    const title = document.createElement("h3");
    title.className = "category-title-header";
    title.innerText = `Search Results (${filteredItems.length})`;
    searchBlock.appendChild(title);
    
    const grid = document.createElement("div");
    grid.className = "menu-grid";
    
    filteredItems.forEach(item => {
      const card = createItemCard(item, true);
      grid.appendChild(card);
    });
    
    searchBlock.appendChild(grid);
    container.appendChild(searchBlock);
    return;
  }

  // Normal category-grouped view
  const sectionCats = menuCategories
    .filter(cat => cat.section === activeSection && cat.visible)
    .sort((a, b) => a.display_order - b.display_order);

  sectionCats.forEach(cat => {
    const catItems = filteredItems.filter(item => item.category_id === cat.id);
    if (catItems.length === 0) return; // Hide empty categories (FR-19)

    const block = document.createElement("div");
    block.className = "category-block";
    block.id = cat.id;
    
    const title = document.createElement("h3");
    title.className = "category-title-header";
    title.innerText = cat.name;
    block.appendChild(title);
    
    const grid = document.createElement("div");
    grid.className = "menu-grid";
    
    catItems.sort((a,b) => a.display_order - b.display_order).forEach(item => {
      const card = createItemCard(item, false);
      grid.appendChild(card);
    });
    
    block.appendChild(grid);
    container.appendChild(block);
  });

  setupScrollObserver();
}

// Card factory
function createItemCard(item, showCategoryName) {
  const card = document.createElement("div");
  card.className = "item-card";
  card.addEventListener("click", () => openModal(item));

  // Determine low price display
  let priceStr = "";
  if (item.price_variants && item.price_variants.length > 0) {
    const prices = item.price_variants.map(v => v.price);
    const minPrice = Math.min(...prices);
    if (item.price_variants.length > 1) {
      priceStr = `<small>from</small>₹${minPrice}`;
    } else {
      priceStr = `₹${minPrice}`;
    }
  }

  // Tag badges rendering
  let tagsHTML = "";
  if (item.tags.includes("Veg")) {
    tagsHTML += `<span class="tag-badge tag-veg"><i class="fas fa-circle"></i> Veg</span> `;
  } else if (item.tags.includes("Non-Veg")) {
    tagsHTML += `<span class="tag-badge tag-nonveg"><i class="fas fa-circle"></i> Non-Veg</span> `;
  }
  
  if (item.tags.includes("Spicy")) {
    tagsHTML += `<span class="tag-badge tag-spicy"><i class="fas fa-pepper-hot"></i> Spicy</span> `;
  }

  // Image Thumbnail with media fallback (FR-21)
  let imgURL = "images.jpg"; // Default fallback
  if (item.media && item.media.length > 0) {
    imgURL = item.media[0];
  } else {
    imgURL = `uploads/${item.id}.jpg`;
  }

  // Render category badge if search results
  let catBadgeHTML = "";
  if (showCategoryName) {
    const cat = menuCategories.find(c => c.id === item.category_id);
    if (cat) {
      catBadgeHTML = `<div class="item-badge-tag">${cat.name}</div>`;
    }
  }

  let directAddHTML = "";
  if (window.activeTableNo) {
    if (item.price_variants && item.price_variants.length === 1) {
      const v = item.price_variants[0];
      directAddHTML = `
        <button class="add-btn" onclick="event.stopPropagation(); addItemToCart('${item.id}', '${item.name.replace(/'/g, "\\'")}', '${v.label.replace(/'/g, "\\'")}', ${v.price})" aria-label="Add ${item.name}">
          <i class="fas fa-plus"></i> Add
        </button>
      `;
    } else {
      directAddHTML = `
        <button class="select-btn" onclick="event.stopPropagation(); window.openItemModalFromCard('${item.id}')" aria-label="Choose size for ${item.name}">
          Choose <i class="fas fa-chevron-right" style="font-size:10px;"></i>
        </button>
      `;
    }
  }

  card.innerHTML = `
    <div class="item-info">
      <div class="item-title-row">
        <h4 class="item-name">${item.name}</h4>
      </div>
      <p class="item-desc">${item.description || "Freshly made house special."}</p>
      ${tagsHTML ? `<div class="item-tags">${tagsHTML}</div>` : ""}
      <div class="item-prices">
        <span class="price-row-display">${priceStr}</span>
        ${directAddHTML}
      </div>
    </div>
    <div class="item-image-wrapper">
      <img src="${imgURL}" alt="${item.name}" class="item-thumbnail" loading="lazy" onerror="window.handleImageError(this, '${item.id}')">
      ${catBadgeHTML}
    </div>
  `;

  return card;
}

// Modal handling
function openModal(item) {
  const modal = document.getElementById("item-modal");
  const modalName = document.getElementById("modal-name");
  const modalDesc = document.getElementById("modal-desc");
  const modalImg = document.getElementById("modal-img");
  const modalVideo = document.getElementById("modal-video");
  const modalTags = document.getElementById("modal-tags-container");
  const modalTypeBadge = document.getElementById("modal-type-badge");
  const priceTbody = document.getElementById("modal-price-tbody");

  modalName.innerText = item.name;
  modalDesc.innerText = item.description || "Downtown Luka established custom chef selection.";
  
  modalTypeBadge.innerHTML = "";
  if (item.tags.includes("Veg")) {
    modalTypeBadge.innerHTML = `<span class="tag-badge tag-veg"><i class="fas fa-circle"></i> Veg</span>`;
  } else if (item.tags.includes("Non-Veg")) {
    modalTypeBadge.innerHTML = `<span class="tag-badge tag-nonveg"><i class="fas fa-circle"></i> Non-Veg</span>`;
  }

  modalTags.innerHTML = "";
  item.tags.forEach(tag => {
    if (tag !== "Veg" && tag !== "Non-Veg") {
      const span = document.createElement("span");
      span.className = "tag-badge";
      span.style.background = "#e5e7eb";
      span.style.color = "#1f2937";
      span.innerText = tag;
      modalTags.appendChild(span);
    }
  });

  let mediaURL = "images.jpg";
  if (item.media && item.media.length > 0) {
    mediaURL = item.media[0];
  } else {
    mediaURL = `uploads/${item.id}.jpg`;
  }

  const isVideo = mediaURL.toLowerCase().endsWith(".mp4");
  if (isVideo) {
    modalImg.style.display = "none";
    modalVideo.style.display = "block";
    modalVideo.src = mediaURL;
    modalVideo.load();
  } else {
    modalVideo.style.display = "none";
    modalVideo.src = "";
    modalImg.style.display = "block";
    modalImg.src = mediaURL;
    modalImg.onerror = () => { window.handleImageError(modalImg, item.id); };
  }

  // Populate prices table (FR-4)
  priceTbody.innerHTML = "";
  const priceTable = priceTbody.parentElement;
  const headerRow = priceTable.querySelector("thead tr");
  
  if (window.activeTableNo) {
    if (headerRow) {
      headerRow.innerHTML = `
        <th>Option / Size</th>
        <th>Price (INR)</th>
        <th style="text-align: right;">Action</th>
      `;
    }
  } else {
    if (headerRow) {
      headerRow.innerHTML = `
        <th>Option / Size</th>
        <th style="text-align: right;">Price (INR)</th>
      `;
    }
  }

  item.price_variants.forEach(v => {
    const row = document.createElement("tr");
    
    let cartActionHTML = "";
    if (window.activeTableNo) {
      cartActionHTML = `
        <td style="text-align: right;">
          <button class="add-btn" onclick="addItemToCart('${item.id}', '${item.name.replace(/'/g, "\\'")}', '${v.label.replace(/'/g, "\\'")}', ${v.price})">
            <i class="fas fa-plus"></i> Add
          </button>
        </td>
      `;
    }
    
    row.innerHTML = `
      <td>${v.label}</td>
      <td class="price-val">₹${v.price}</td>
      ${cartActionHTML}
    `;
    priceTbody.appendChild(row);
  });

  modal.classList.add("active");
}

function closeModal() {
  const modal = document.getElementById("item-modal");
  const modalVideo = document.getElementById("modal-video");
  
  modal.classList.remove("active");
  modalVideo.pause();
  modalVideo.src = "";
}

// Track active category scroll coordinates to auto-highlight tabs
let scrollObserver = null;
function setupScrollObserver() {
  if (scrollObserver) scrollObserver.disconnect();

  const tabContainer = document.getElementById("category-tab-container");
  const categoryBlocks = document.querySelectorAll(".category-block");
  
  scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const catId = entry.target.id;
        const targetTab = tabContainer.querySelector(`[data-cat-id="${catId}"]`);
        
        if (targetTab) {
          tabContainer.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
          targetTab.classList.add("active");
          
          // Auto-scroll the tab container horizontally to keep the active tab visible
          const tabOffsetLeft = targetTab.offsetLeft;
          const containerHalfWidth = tabContainer.offsetWidth / 2;
          tabContainer.scrollTo({
            left: tabOffsetLeft - containerHalfWidth + (targetTab.offsetWidth / 2),
            behavior: "smooth"
          });
        }
      }
    });
  }, {
    rootMargin: "-20% 0px -70% 0px" // triggers when category block crosses the upper center
  });

  categoryBlocks.forEach(block => {
    if (block.id) scrollObserver.observe(block);
  });
}

// Cart and Live Ordering Operations (FR-21)
window.activeTableNo = null;
let cart = {};

// ─── Table session (one per dining party) ────────────────────────────────
// The guest who opens the table gets a secret token, stored only on this
// phone. Friends join with the 4-digit table PIN. Without either, nobody can
// see or add to the party's bill. When staff settle the bill the session ends.
let tableSession = null;     // last session data from the server
let pollHandle = null;
let publicCfg = { upi_id: "", upi_name: "", service_charge_percent: 10 };

// Multi-outlet: table QR codes for other outlets carry ?outlet=ID
const GUEST_OUTLET = (new URLSearchParams(location.search).get("outlet") || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
function withOutlet(path) { return GUEST_OUTLET ? path + (path.includes("?") ? "&" : "?") + "outlet=" + encodeURIComponent(GUEST_OUTLET) : path; }
function tokenKey() { return `hms_table_token_${GUEST_OUTLET ? GUEST_OUTLET + "_" : ""}${window.activeTableNo}`; }
function getToken() { try { return localStorage.getItem(tokenKey()) || ""; } catch (e) { return ""; } }
function setToken(t) { try { t ? localStorage.setItem(tokenKey(), t) : localStorage.removeItem(tokenKey()); } catch (e) {} }

function tableFetch(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json", "X-Table-Token": getToken() }, opts.headers || {});
  return fetch(withOutlet(path), Object.assign({}, opts, { headers })).then(async res => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || "Something went wrong. Please try again.");
      err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  });
}

function initTableCartSystem() {
  const params = new URLSearchParams(window.location.search);
  const table = (params.get("table") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
  if (!table) return;
  window.activeTableNo = table;

  const tableHeader = document.getElementById("table-number-header");
  if (tableHeader) {
    tableHeader.innerHTML = `<span style="color:var(--primary); font-weight:700;"><i class="fas fa-utensils"></i> Table ${table}</span>`;
  }
  document.getElementById("btn-cart-trigger").style.display = "inline-flex";
  document.getElementById("btn-track-trigger").style.display = "inline-flex";
  document.getElementById("welcome-title").innerText = `Table ${table}`;

  try {
    const storedCart = localStorage.getItem(`luka_cart_table_${table}`);
    if (storedCart) cart = JSON.parse(storedCart) || {};
  } catch (e) { cart = {}; }
  updateCartBadges();

  fetch(withOutlet("/api/settings/public")).then(r => r.ok ? r.json() : null).then(cfg => {
    if (!cfg) return;
    publicCfg = Object.assign(publicCfg, cfg);
    const f = document.getElementById("footer-charges");
    if (f && cfg.service_charge_percent > 0) {
      f.textContent = `Prices exclude taxes. A ${cfg.service_charge_percent}% service charge may be added to your bill — it is optional and we'll remove it if you ask.`;
    } else if (f) {
      f.textContent = "Prices exclude taxes.";
    }
  }).catch(() => {});

  if (getToken()) {
    refreshSession(true);
  } else {
    openWelcome();
  }
  pollHandle = setInterval(() => { if (getToken() && !document.hidden) refreshSession(false); }, 10000);
}

// Decide whether to show "start a new order" or "join with PIN"
function openWelcome(mode) {
  const modal = document.getElementById("welcome-modal");
  modal.style.display = "flex";
  if (mode) return showWelcomeMode(mode);
  fetch(withOutlet(`/api/table/status?table=${encodeURIComponent(window.activeTableNo)}`))
    .then(r => r.json())
    .then(st => showWelcomeMode(st && st.busy ? "join" : "start"))
    .catch(() => showWelcomeMode("start"));
}

window.showWelcomeMode = function(mode) {
  document.getElementById("welcome-guest-form").style.display = mode === "start" ? "block" : "none";
  document.getElementById("welcome-join-form").style.display = mode === "join" ? "block" : "none";
  document.getElementById("welcome-error").textContent = "";
  document.getElementById("join-error").textContent = "";
  const focus = mode === "join" ? "guest-pin-input" : "guest-name-input";
  setTimeout(() => { const el = document.getElementById(focus); if (el && window.innerWidth > 640) el.focus(); }, 50);
};

function closeWelcome() {
  document.getElementById("welcome-modal").style.display = "none";
}

// The party's bill was settled or closed by staff: clear everything on this phone
function endSession(message) {
  setToken("");
  tableSession = null;
  cart = {};
  try { localStorage.removeItem(`luka_cart_table_${window.activeTableNo}`); } catch (e) {}
  updateCartBadges();
  renderSessionUI();
  closeDrawers();
  if (message) window.showToast(message, "info");
  openWelcome();
}

function refreshSession(first) {
  return tableFetch(`/api/table/session?table=${encodeURIComponent(window.activeTableNo)}`)
    .then(sess => {
      tableSession = sess;
      closeWelcome();
      renderSessionUI();
      if (first) window.showToast(`Welcome back! You're ordering on Table ${window.activeTableNo}.`, "success");
    })
    .catch(err => {
      if (err.code === "no_session") {
        endSession(first ? "" : "Your bill has been settled. Thank you for dining with us!");
      } else if (err.code === "not_your_table") {
        endSession(first ? "" : "This table was closed by our staff.");
      }
    });
}

window.submitWelcomeGuest = function(e) {
  e.preventDefault();
  const name = document.getElementById("guest-name-input").value.trim();
  const phone = document.getElementById("guest-phone-input").value.replace(/\D/g, "");
  const errEl = document.getElementById("welcome-error");
  errEl.textContent = "";
  if (name.length < 2) { errEl.textContent = "Please enter your name."; return; }
  if (!/^[6-9]\d{9}$/.test(phone)) { errEl.textContent = "Please enter a valid 10-digit mobile number."; return; }
  const btn = document.getElementById("btn-start-order");
  btn.disabled = true;
  tableFetch("/api/table/start", { method: "POST", body: JSON.stringify({ table_no: window.activeTableNo, name, phone }) })
    .then(res => {
      setToken(res.token);
      tableSession = res.session;
      closeWelcome();
      renderSessionUI();
      window.showToast(`Welcome, ${name}! Start ordering on Table ${window.activeTableNo}.`, "success");
    })
    .catch(err => {
      if (err.code === "table_busy") {
        showWelcomeMode("join");
      } else {
        errEl.textContent = err.message;
      }
    })
    .finally(() => { btn.disabled = false; });
};

window.submitJoinTable = function(e) {
  e.preventDefault();
  const pin = document.getElementById("guest-pin-input").value.replace(/\D/g, "");
  const errEl = document.getElementById("join-error");
  errEl.textContent = "";
  tableFetch("/api/table/join", { method: "POST", body: JSON.stringify({ table_no: window.activeTableNo, pin }) })
    .then(res => {
      setToken(res.token);
      tableSession = res.session;
      closeWelcome();
      renderSessionUI();
      window.showToast(`You've joined ${res.session.customer_name}'s table.`, "success");
    })
    .catch(err => {
      if (err.code === "no_session") showWelcomeMode("start");
      errEl.textContent = err.message;
    });
};

function updateCartBadges() {
  const badge = document.getElementById("cart-count-badge");
  const count = Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);
  const total = Object.values(cart).reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (badge) badge.innerText = count;
  const bar = document.getElementById("cart-bar");
  if (bar) {
    document.getElementById("cart-bar-count").innerText = count;
    document.getElementById("cart-bar-total").innerText = `₹${total.toLocaleString("en-IN")}`;
    const drawerOpen = document.getElementById("cart-drawer").style.display === "flex";
    bar.classList.toggle("show", count > 0 && !drawerOpen);
  }
}

// Drawers share one backdrop and lock page scrolling while open
function syncDrawerState() {
  const anyOpen = ["cart-drawer", "tracking-modal"].some(id => document.getElementById(id).style.display === "flex");
  document.getElementById("drawer-backdrop").classList.toggle("show", anyOpen);
  document.body.classList.toggle("no-scroll", anyOpen);
  updateCartBadges();
}

function closeDrawers() {
  document.getElementById("cart-drawer").style.display = "none";
  document.getElementById("tracking-modal").style.display = "none";
  trackingModalOpen = false;
  syncDrawerState();
}

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (document.getElementById("item-modal").classList.contains("active")) closeModal();
  else closeDrawers();
});

function addItemToCart(itemId, itemName, variantLabel, price) {
  const key = `${itemId}_${variantLabel}`;
  if (cart[key]) {
    cart[key].quantity += 1;
  } else {
    cart[key] = {
      id: itemId,
      name: itemName,
      variant: variantLabel,
      price: price,
      quantity: 1
    };
  }
  
  localStorage.setItem(`luka_cart_table_${window.activeTableNo}`, JSON.stringify(cart));
  updateCartBadges();
  window.showToast(`Added ${itemName} (${variantLabel}) to your cart!`, "success");
}

function toggleCartDrawer() {
  const drawer = document.getElementById("cart-drawer");
  if (drawer.style.display !== "flex") {
    document.getElementById("tracking-modal").style.display = "none";
    trackingModalOpen = false;
    drawer.style.display = "flex";
    renderCartItems();
  } else {
    drawer.style.display = "none";
  }
  syncDrawerState();
}

function changeCartQty(key, change) {
  if (cart[key]) {
    cart[key].quantity += change;
    if (cart[key].quantity <= 0) {
      delete cart[key];
    }
    localStorage.setItem(`luka_cart_table_${window.activeTableNo}`, JSON.stringify(cart));
    updateCartBadges();
    renderCartItems();
  }
}

function renderCartItems() {
  const container = document.getElementById("cart-items-list");
  const subtotalVal = document.getElementById("cart-subtotal-val");
  container.innerHTML = "";

  const itemsArr = Object.keys(cart);
  if (itemsArr.length === 0) {
    container.innerHTML = `<div class="drawer-empty"><i class="fas fa-bag-shopping"></i>Your cart is empty.<br>Tap <b>Add</b> on any dish or drink to start.</div>`;
    subtotalVal.innerText = "₹0";
    return;
  }

  let subtotal = 0;
  itemsArr.forEach(key => {
    const item = cart[key];
    const lineTotal = item.price * item.quantity;
    subtotal += lineTotal;

    const row = document.createElement("div");
    row.className = "cart-item-row";
    row.innerHTML = `
      <div style="min-width:0;">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-meta">${item.variant} · ₹${item.price} · <b>₹${lineTotal}</b></div>
      </div>
      <div class="cart-qty-ctrl">
        <button class="cart-qty-btn" onclick="changeCartQty('${key.replace(/'/g, "\\'")}', -1)" aria-label="Remove one">−</button>
        <span>${item.quantity}</span>
        <button class="cart-qty-btn" onclick="changeCartQty('${key.replace(/'/g, "\\'")}', 1)" aria-label="Add one">+</button>
      </div>
    `;
    container.appendChild(row);
  });

  subtotalVal.innerText = `₹${subtotal}`;
}

function submitCartOrder() {
  const itemsArr = Object.values(cart);
  if (itemsArr.length === 0) {
    window.showToast("Your cart is empty.", "warning");
    return;
  }
  if (!getToken()) {
    closeDrawers();
    openWelcome();
    return;
  }
  const btn = document.getElementById("btn-send-order");
  btn.disabled = true;
  tableFetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ table_no: window.activeTableNo, items: itemsArr.map(i => ({ id: i.id, variant: i.variant, quantity: i.quantity })) })
  })
  .then(data => {
    window.showToast("Order sent to the kitchen!", "success");
    cart = {};
    localStorage.removeItem(`luka_cart_table_${window.activeTableNo}`);
    updateCartBadges();
    tableSession = data.session;
    renderSessionUI();
    toggleTrackingModal(true);
  })
  .catch(err => {
    if (err.code === "no_session" || err.code === "not_your_table") {
      endSession("Your previous bill was closed. Please start a new order — your cart is kept.");
    } else {
      window.showToast(err.message, "error");
    }
  })
  .finally(() => { btn.disabled = false; });
}

// Live Status Tracking Operations
let trackingModalOpen = false;
function toggleTrackingModal(forceOpen = false) {
  const modal = document.getElementById("tracking-modal");
  if (forceOpen === true || modal.style.display !== "flex") {
    document.getElementById("cart-drawer").style.display = "none";
    modal.style.display = "flex";
    trackingModalOpen = true;
    renderTrackingRounds();
  } else {
    modal.style.display = "none";
    trackingModalOpen = false;
  }
  syncDrawerState();
}

function rupees(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function escHTML(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Header badge, PIN and bill button reflect the current session only
function renderSessionUI() {
  const rounds = tableSession ? tableSession.orders || [] : [];
  const badge = document.getElementById("tracking-count-badge");
  const unserved = rounds.filter(r => r.status !== "Served").length;
  badge.innerText = unserved;
  badge.style.display = unserved > 0 ? "inline-flex" : "none";
  if (trackingModalOpen) renderTrackingRounds();
}

function renderTrackingRounds() {
  const container = document.getElementById("tracking-rounds-list");
  const breakdown = document.getElementById("tracking-breakdown");
  const pinBox = document.getElementById("table-pin-box");
  const upiBox = document.getElementById("upi-pay-box");
  const btn = document.getElementById("btn-request-checkout");
  const rounds = tableSession ? tableSession.orders || [] : [];

  pinBox.style.display = tableSession ? "grid" : "none";
  if (tableSession) document.getElementById("table-pin").textContent = tableSession.pin;

  if (!rounds.length) {
    container.innerHTML = `<div class="drawer-empty"><i class="fas fa-receipt"></i>No orders yet for your table.</div>`;
    breakdown.innerHTML = "";
    upiBox.style.display = "none";
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";

  container.innerHTML = rounds.map((round, index) => {
    const timeStr = round.timestamp ? new Date(round.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
    const cls = { Preparing: "preparing", Ready: "ready", Served: "served" }[round.status] || "received";
    return `<div class="round-card">
      <div class="round-header">
        <span style="font-weight:700;">Round ${index + 1} <span style="color:var(--text-muted);font-weight:500;">· ${timeStr}</span></span>
        <span class="status-pill ${cls}">${escHTML(round.status)}</span>
      </div>
      ${round.items.map(i => `<div class="round-line"><span><strong style="color:var(--primary);">${i.quantity}×</strong> ${escHTML(i.name)} <span style="color:var(--text-muted);font-size:12.5px;">· ${escHTML(i.variant)}</span></span><span>${rupees(i.price * i.quantity)}</span></div>`).join("")}
    </div>`;
  }).join("");

  const b = tableSession.bill;
  const rows = [[`Subtotal`, rupees(b.subtotal)]];
  if (b.discount > 0) rows.push([`Discount`, "− " + rupees(b.discount), "discount"]);
  if (b.service_charge > 0) rows.push([`Service charge ${b.service_charge_percent}% <small>(optional)</small>`, rupees(b.service_charge)]);
  if (b.cgst > 0) rows.push([`CGST ${b.gst_percent / 2}%`, rupees(b.cgst)]);
  if (b.sgst > 0) rows.push([`SGST ${b.gst_percent / 2}%`, rupees(b.sgst)]);
  if (b.vat > 0) rows.push([`VAT on liquor ${b.liquor_vat_percent}%`, rupees(b.vat)]);
  if (Math.abs(b.round_off) > 0.001) rows.push([`Round off`, rupees(b.round_off)]);
  breakdown.innerHTML = rows.map(([k, v, c]) => `<div class="bill-row ${c || ""}"><span>${k}</span><span>${v}</span></div>`).join("") +
    `<div class="drawer-total" style="margin:6px 0 0; padding-top:8px; border-top:1px solid var(--border-color);"><span>${tableSession.status === "Checkout Requested" ? "Total to pay" : "Total so far"}</span><span>${rupees(b.total)}</span></div>`;

  const billAsked = tableSession.status === "Checkout Requested";
  btn.disabled = billAsked;
  btn.innerHTML = billAsked ? `<i class="fas fa-check"></i> Bill requested — staff are on the way` : `<i class="fas fa-file-invoice-dollar"></i> Ask for the Bill`;

  // UPI: shown once the guest asks for the bill
  if (billAsked && publicCfg.upi_id && window.UPI) {
    const link = window.UPI.link(publicCfg.upi_id, publicCfg.upi_name, b.total, `Table ${window.activeTableNo} bill`);
    window.UPI.renderQR(document.getElementById("upi-qr"), link, 200);
    document.getElementById("upi-app-link").href = link;
    document.getElementById("upi-amount").textContent = rupees(b.total);
    document.getElementById("upi-payee").textContent = publicCfg.upi_name || publicCfg.upi_id;
    upiBox.style.display = "flex";
  } else {
    upiBox.style.display = "none";
  }
}

window.openItemModalFromCard = function(itemId) {
  const item = menuItems.find(i => i.id === itemId);
  if (item) openModal(item);
};

function requestCustomerCheckout() {
  if (!window.activeTableNo || !getToken()) return;
  const btn = document.getElementById("btn-request-checkout");
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Sending…`;
  tableFetch("/api/orders/request-checkout", { method: "POST", body: JSON.stringify({ table_no: window.activeTableNo }) })
    .then(data => {
      tableSession = data.session;
      window.showToast("Bill requested — our staff will be with you shortly.", "success");
      renderTrackingRounds();
    })
    .catch(err => {
      if (err.code === "no_session" || err.code === "not_your_table") endSession("This bill was already closed.");
      else { window.showToast(err.message, "error"); btn.disabled = false; renderTrackingRounds(); }
    });
}
