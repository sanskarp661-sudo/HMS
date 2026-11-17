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
      priceStr = `From ₹${minPrice}`;
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
        <button class="btn btn-primary" onclick="event.stopPropagation(); addItemToCart('${item.id}', '${item.name.replace(/'/g, "\\'")}', '${v.label}', ${v.price})" style="padding: 4px 10px; font-size: 11px; background:var(--primary); cursor:pointer; border-radius:4px; border:none; color:#fff;">
          <i class="fas fa-plus"></i> Add
        </button>
      `;
    } else {
      directAddHTML = `
        <button class="btn btn-secondary" onclick="event.stopPropagation(); window.openItemModalFromCard('${item.id}')" style="padding: 4px 10px; font-size: 11px; cursor:pointer; border-radius:4px; border:1px solid rgba(255,255,255,0.2); background:transparent; color:#fff;">
          Select
        </button>
      `;
    }
  }

  card.innerHTML = `
    <div class="item-info" style="display:flex; flex-direction:column; justify-content:space-between; flex:1;">
      <div>
        <div class="item-title-row">
          <h4 class="item-name">${item.name}</h4>
        </div>
        <p class="item-desc">${item.description || "Freshly made house special."}</p>
        <div style="margin-top: 4px;">${tagsHTML}</div>
      </div>
      <div class="item-prices" style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-top:8px;">
        <span class="price-row-display" style="font-weight:600; color:var(--primary);">${priceStr}</span>
        ${directAddHTML}
      </div>
    </div>
    <div class="item-image-wrapper">
      <img src="${imgURL}" alt="${item.name}" class="item-thumbnail" onerror="window.handleImageError(this, '${item.id}')">
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
          <button class="btn btn-primary" onclick="addItemToCart('${item.id}', '${item.name.replace(/'/g, "\\'")}', '${v.label}', ${v.price})" style="padding: 4px 8px; font-size: 11px; background:var(--primary); cursor:pointer;">
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

function initTableCartSystem() {
  const params = new URLSearchParams(window.location.search);
  const table = params.get("table");
  
  if (table) {
    window.activeTableNo = table.trim();
    
    const tableHeader = document.getElementById("table-number-header");
    if (tableHeader) {
      tableHeader.innerHTML = `<span style="color:var(--primary); font-weight:700;"><i class="fas fa-utensils"></i> Table ${window.activeTableNo}</span>`;
    }
    
    document.getElementById("btn-cart-trigger").style.display = "inline-flex";
    document.getElementById("btn-track-trigger").style.display = "inline-flex";
    
    try {
      const storedCart = localStorage.getItem(`luka_cart_table_${window.activeTableNo}`);
      if (storedCart) {
        cart = JSON.parse(storedCart);
        updateCartBadges();
      }
    } catch(e) {
      cart = {};
    }

    // Check for customer CRM details
    const storedName = sessionStorage.getItem("luka_guest_name");
    const storedPhone = sessionStorage.getItem("luka_guest_phone");
    if (!storedName || !storedPhone) {
      const welcomeTitle = document.getElementById("welcome-title");
      if (welcomeTitle) welcomeTitle.innerText = `Table ${window.activeTableNo} Ordering`;
      const welcomeModal = document.getElementById("welcome-modal");
      if (welcomeModal) welcomeModal.style.display = "flex";
    }
    
    pollOrderTracking();
    setInterval(pollOrderTracking, 10000);
  }
}

function updateCartBadges() {
  const badge = document.getElementById("cart-count-badge");
  const count = Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);
  if (badge) badge.innerText = count;
}

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
  if (drawer.style.display === "none") {
    drawer.style.display = "flex";
    renderCartItems();
  } else {
    drawer.style.display = "none";
  }
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
    container.innerHTML = `<div style="text-align:center; color: #9ca3af; margin-top: 40px; font-size:13px;">Your cart is empty. Add food or bar items to start ordering!</div>`;
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
      <div>
        <div style="font-weight:600; font-size:13px;">${item.name}</div>
        <div style="font-size:11px; color:#9ca3af;">${item.variant} • ₹${item.price}</div>
      </div>
      <div class="cart-qty-ctrl">
        <button class="cart-qty-btn" onclick="changeCartQty('${key}', -1)">-</button>
        <span style="font-size:13px; font-weight:600; min-width:16px; text-align:center;">${item.quantity}</span>
        <button class="cart-qty-btn" onclick="changeCartQty('${key}', 1)">+</button>
      </div>
    `;
    container.appendChild(row);
  });

  subtotalVal.innerText = `₹${subtotal}`;
}

function submitCartOrder() {
  const itemsArr = Object.values(cart);
  if (itemsArr.length === 0) {
    alert("Your cart is empty!");
    return;
  }

  const guestName = sessionStorage.getItem("luka_guest_name") || "Guest";
  const guestPhone = sessionStorage.getItem("luka_guest_phone") || "";

  fetch("/api/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      table_no: window.activeTableNo,
      customer_name: guestName,
      customer_phone: guestPhone,
      items: itemsArr
    })
  })
  .then(res => {
    if (!res.ok) throw new Error("Order placement failed.");
    return res.json();
  })
  .then(data => {
    window.showToast("Order placed successfully! Sending to kitchen...", "success");
    cart = {};
    localStorage.removeItem(`luka_cart_table_${window.activeTableNo}`);
    updateCartBadges();
    toggleCartDrawer();
    
    toggleTrackingModal(true);
    pollOrderTracking();
  })
  .catch(err => {
    window.showToast(err.message, "error");
  });
}

// Live Status Tracking Operations
let trackingModalOpen = false;
function toggleTrackingModal(forceOpen = false) {
  const modal = document.getElementById("tracking-modal");
  if (forceOpen) {
    modal.style.display = "flex";
    trackingModalOpen = true;
    renderTrackingRounds();
  } else if (modal.style.display === "none") {
    modal.style.display = "flex";
    trackingModalOpen = true;
    renderTrackingRounds();
  } else {
    modal.style.display = "none";
    trackingModalOpen = false;
  }
}

let activeRounds = [];
function pollOrderTracking() {
  if (!window.activeTableNo) return;

  fetch(`/api/orders?table=${encodeURIComponent(window.activeTableNo)}`)
    .then(res => res.json())
    .then(data => {
      const tableKey = `table_${window.activeTableNo}`;
      const session = data[tableKey];
      
      if (session && session.orders) {
        activeRounds = session.orders || [];
        const unservedRounds = activeRounds.filter(r => r.status !== "Served").length;
        const badge = document.getElementById("tracking-count-badge");
        if (badge) {
          if (unservedRounds > 0) {
            badge.innerText = unservedRounds;
            badge.style.display = "inline-flex";
          } else {
            badge.style.display = "none";
          }
        }
      } else {
        if (activeRounds.length > 0) {
          window.showToast("Your table session has been settled! Table is reset.", "info");
          activeRounds = [];
          cart = {};
          localStorage.removeItem(`luka_cart_table_${window.activeTableNo}`);
          sessionStorage.removeItem("luka_guest_name");
          sessionStorage.removeItem("luka_guest_phone");
          updateCartBadges();
          
          const badge = document.getElementById("tracking-count-badge");
          if (badge) badge.style.display = "none";

          // Re-trigger welcome details prompt
          const welcomeModal = document.getElementById("welcome-modal");
          if (welcomeModal) welcomeModal.style.display = "flex";
        }
      }
      
      if (trackingModalOpen) {
        renderTrackingRounds();
      }
    })
    .catch(err => console.error("Tracking status sync failed:", err));
}

function renderTrackingRounds() {
  const container = document.getElementById("tracking-rounds-list");
  const subtotalVal = document.getElementById("tracking-subtotal-val");
  container.innerHTML = "";

  if (activeRounds.length === 0) {
    container.innerHTML = `<div style="text-align:center; color: #9ca3af; margin-top: 40px; font-size:13px;">No rounds ordered yet for this table.</div>`;
    subtotalVal.innerText = "₹0";
    return;
  }

  let totalSpent = 0;
  activeRounds.forEach((round, index) => {
    const card = document.createElement("div");
    card.className = "round-card";
    
    let timeStr = "";
    if (round.timestamp && round.timestamp.includes("T")) {
      timeStr = round.timestamp.split("T")[1].substring(0, 5);
    }

    let statusClass = "received";
    if (round.status === "Preparing") statusClass = "preparing";
    if (round.status === "Ready") statusClass = "ready";
    if (round.status === "Served") statusClass = "served";

    card.innerHTML = `
      <div class="round-header">
        <span style="font-weight:700; color:var(--primary);">ROUND ${index + 1} • ${timeStr}</span>
        <span class="status-pill ${statusClass}">${round.status}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px; font-size:12px;">
        ${round.items.map(i => {
          const lineCost = i.price * i.quantity;
          totalSpent += lineCost;
          return `
            <div style="display:flex; justify-content:space-between; margin-top:4px;">
              <span>${i.name} (${i.variant}) <strong style="color:var(--primary);">x${i.quantity}</strong></span>
              <span>₹${lineCost}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
    container.appendChild(card);
  });

  const serviceCharge = Math.round(totalSpent * 0.10);
  const tax = Math.round(totalSpent * 0.05);
  const grandTotal = totalSpent + serviceCharge + tax;

  const subtotalEl = document.getElementById("tracking-subtotal-val");
  const svcEl = document.getElementById("tracking-service-charge-val");
  const taxEl = document.getElementById("tracking-tax-val");
  const totalEl = document.getElementById("tracking-total-val");

  if (subtotalEl) subtotalEl.innerText = `₹${totalSpent}`;
  if (svcEl) svcEl.innerText = `₹${serviceCharge}`;
  if (taxEl) taxEl.innerText = `₹${tax}`;
  if (totalEl) totalEl.innerText = `₹${grandTotal}`;
}

window.openItemModalFromCard = function(itemId) {
  const item = menuItems.find(i => i.id === itemId);
  if (item) openModal(item);
};

function requestCustomerCheckout() {
  if (!window.activeTableNo) return;

  const btn = document.getElementById("btn-request-checkout");
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing...`;

  fetch("/api/orders/request-checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ table_no: window.activeTableNo })
  })
  .then(res => {
    if (!res.ok) throw new Error("Checkout request failed.");
    return res.json();
  })
  .then(data => {
    window.showToast("Checkout requested! Staff has been notified to settle your bill.", "success");
    btn.innerHTML = `<i class="fas fa-check"></i> Bill Requested`;
  })
  .catch(err => {
    window.showToast(err.message, "error");
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-file-invoice-dollar"></i> Request Settle Bill`;
  });
}

window.submitWelcomeGuest = function(e) {
  e.preventDefault();
  const name = document.getElementById("guest-name-input").value.trim();
  const phone = document.getElementById("guest-phone-input").value.trim();
  
  if (name && phone) {
    sessionStorage.setItem("luka_guest_name", name);
    sessionStorage.setItem("luka_guest_phone", phone);
    
    const welcomeModal = document.getElementById("welcome-modal");
    if (welcomeModal) welcomeModal.style.display = "none";
    
    window.showToast(`Welcome, ${name}! Start ordering directly to Table ${window.activeTableNo}.`, "success");
  }
};
