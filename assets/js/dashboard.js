/**
 * dashboard.js — Sales Analytics Dashboard Logic
 * Downtown Luka v1.1
 * Requires: Chart.js (loaded in admin.html)
 */

// ─── Chart instances (kept for destroy on re-render) ────────────────────────
let chartRevenue  = null;
let chartCategory = null;
let chartHourly   = null;

// ─── Main loader ─────────────────────────────────────────────────────────────
function loadDashboard() {
  const staff = sessionStorage.getItem("luka_logged_user") || "admin";
  const headers = { "X-Staff-User": encodeURIComponent(staff) };

  // Safeguard: Check if Chart.js is loaded (offline or CDN blocked)
  if (typeof Chart === "undefined") {
    document.getElementById("db-summary-cards").innerHTML = `
      <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: #fb923c; background: rgba(251,146,60,0.08); border: 1px solid rgba(251,146,60,0.2); border-radius: 12px; margin-bottom: 20px;">
        <i class="fas fa-exclamation-triangle" style="font-size: 28px; margin-bottom: 12px;"></i>
        <h3 style="font-size: 16px; font-weight: 700; color: #f3f4f6;">Chart.js CDN Offline / Failed to Load</h3>
        <p style="font-size: 13px; color: #9ca3af; margin-top: 6px; max-width: 500px; margin-left: auto; margin-right: auto;">
          The Analytics Dashboard requires an active internet connection to load the Chart.js visualization library. 
          Please check your network connection and refresh.
        </p>
      </div>
    `;
    return;
  }

  // Show loading state
  document.getElementById("db-summary-cards").innerHTML = dashLoadingCards();

  Promise.all([
    fetch("/api/dashboard/summary",    { headers }).then(r => r.json()),
    fetch("/api/dashboard/revenue",    { headers }).then(r => r.json()),
    fetch("/api/dashboard/items",      { headers }).then(r => r.json()),
    fetch("/api/dashboard/categories", { headers }).then(r => r.json()),
    fetch("/api/dashboard/hourly",     { headers }).then(r => r.json()),
  ])
  .then(([summary, revenue, items, categories, hourly]) => {
    renderSummaryCards(summary);
    renderRevenueChart(revenue);
    renderTopItems(items);
    renderCategoryChart(categories);
    renderHourlyChart(hourly);
  })
  .catch(err => {
    console.error("Dashboard load error:", err);
    document.getElementById("db-summary-cards").innerHTML =
      `<p style="color:#ef4444;padding:20px;">Failed to load dashboard data. Please try again.</p>`;
  });
}

// ─── Summary Cards ───────────────────────────────────────────────────────────
function renderSummaryCards(data) {
  const cards = [
    { icon: "fa-indian-rupee-sign", label: "Today's Revenue",   value: `₹${(data.today_revenue || 0).toLocaleString("en-IN")}`, color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    { icon: "fa-receipt",           label: "Today's Invoices",   value: data.today_invoices || 0,                                  color: "#60a5fa", bg: "rgba(96,165,250,0.1)" },
    { icon: "fa-chair",             label: "Active Tables",       value: data.active_tables || 0,                                   color: "#34d399", bg: "rgba(52,211,153,0.1)" },
    { icon: "fa-calculator",        label: "Average Bill",        value: `₹${(data.avg_bill || 0).toLocaleString("en-IN", {maximumFractionDigits:0})}`, color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
    { icon: "fa-calendar-days",     label: "Monthly Revenue",     value: `₹${(data.monthly_revenue || 0).toLocaleString("en-IN")}`, color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
    { icon: "fa-fire-flame-curved", label: "Pending Kitchen Orders", value: data.pending_orders || 0,                               color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  ];

  document.getElementById("db-summary-cards").innerHTML = cards.map(c => `
    <div class="db-card">
      <div class="db-card-icon" style="background:${c.bg}; color:${c.color};">
        <i class="fas ${c.icon}"></i>
      </div>
      <div class="db-card-body">
        <div class="db-card-value" style="color:${c.color}">${c.value}</div>
        <div class="db-card-label">${c.label}</div>
      </div>
    </div>
  `).join("");
}

function dashLoadingCards() {
  return Array(6).fill(0).map(() => `
    <div class="db-card" style="opacity:0.4;">
      <div class="db-card-icon" style="background:rgba(255,255,255,0.05);"><i class="fas fa-spinner fa-spin"></i></div>
      <div class="db-card-body"><div class="db-card-value">—</div><div class="db-card-label">Loading…</div></div>
    </div>`).join("");
}

// ─── Revenue Chart (30-day bar) ───────────────────────────────────────────────
function renderRevenueChart(data) {
  const labels = (data || []).map(d => d.date);
  const values = (data || []).map(d => d.revenue);
  const ctx    = document.getElementById("chart-revenue").getContext("2d");

  if (chartRevenue) chartRevenue.destroy();
  chartRevenue = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Daily Revenue (₹)",
        data: values,
        backgroundColor: "rgba(245,158,11,0.25)",
        borderColor: "#f59e0b",
        borderWidth: 2,
        borderRadius: 6,
        hoverBackgroundColor: "rgba(245,158,11,0.5)",
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `₹${ctx.parsed.y.toLocaleString("en-IN")}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#94a3b8", font: { size: 11 }, maxTicksLimit: 10 }
        },
        y: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: {
            color: "#94a3b8",
            callback: v => "₹" + v.toLocaleString("en-IN")
          },
          beginAtZero: true
        }
      }
    }
  });
}

// ─── Category Doughnut ────────────────────────────────────────────────────────
function renderCategoryChart(data) {
  const labels = (data || []).map(d => d.category);
  const values = (data || []).map(d => d.revenue);
  const colours = [
    "#f59e0b","#60a5fa","#34d399","#a78bfa","#fb923c",
    "#f87171","#2dd4bf","#e879f9","#fbbf24","#4ade80"
  ];
  const ctx = document.getElementById("chart-category").getContext("2d");

  if (chartCategory) chartCategory.destroy();
  chartCategory = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colours.slice(0, labels.length),
        borderWidth: 2,
        borderColor: "#17171f",
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#94a3b8", font: { size: 11 }, padding: 12 }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ₹${ctx.parsed.toLocaleString("en-IN")}`
          }
        }
      }
    }
  });
}

// ─── Peak Hours Chart ─────────────────────────────────────────────────────────
function renderHourlyChart(data) {
  const labels = (data || []).map(d => d.hour);
  const values = (data || []).map(d => d.orders);
  const ctx    = document.getElementById("chart-hourly").getContext("2d");

  if (chartHourly) chartHourly.destroy();
  chartHourly = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Orders",
        data: values,
        backgroundColor: "rgba(96,165,250,0.25)",
        borderColor: "#60a5fa",
        borderWidth: 2,
        borderRadius: 4,
        hoverBackgroundColor: "rgba(96,165,250,0.5)",
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#94a3b8" },
          beginAtZero: true
        },
        y: {
          grid: { display: false },
          ticks: { color: "#94a3b8", font: { size: 11 } }
        }
      }
    }
  });
}

// ─── Top Items Table ──────────────────────────────────────────────────────────
function renderTopItems(data) {
  const tbody = document.getElementById("db-items-tbody");
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:20px;">No sales data yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((item, i) => `
    <tr>
      <td><span class="db-rank">#${i + 1}</span></td>
      <td style="font-weight:600">${item.name}</td>
      <td>${item.qty}</td>
      <td style="color:#f59e0b;font-weight:700">₹${(item.revenue || 0).toLocaleString("en-IN")}</td>
    </tr>
  `).join("");
}

// ─── Export PDF ───────────────────────────────────────────────────────────────
function exportDashboardPDF() {
  const el = document.getElementById("sec-dashboard");
  if (!window.html2pdf) { alert("PDF library not loaded."); return; }

  window.showToast("Preparing PDF export…", "info");
  const opt = {
    margin:     [10, 10],
    filename:   `DowntownLuka_Dashboard_${new Date().toLocaleDateString("en-IN").replace(/\//g,"-")}.pdf`,
    image:      { type: "jpeg", quality: 0.95 },
    html2canvas:{ scale: 1.5, backgroundColor: "#111118" },
    jsPDF:      { unit: "mm", format: "a3", orientation: "landscape" }
  };
  html2pdf().set(opt).from(el).save().then(() => {
    window.showToast("Dashboard PDF exported!", "success");
  });
}
