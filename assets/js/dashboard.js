/**
 * dashboard.js — Sales analytics for Mosaic Engine HMS
 * Requires Chart.js (loaded in admin.html).
 */

let chartRevenue = null;
let chartCategory = null;
let chartHourly = null;
let chartPayments = null;

const DB_COLORS = {
  teal: "#2f5d5c", tealSoft: "rgba(47,93,92,0.14)",
  orange: "#d97e4a", orangeSoft: "rgba(217,126,74,0.18)",
  grid: "rgba(31,46,45,0.07)", tick: "#6b7776",
  palette: ["#2f5d5c", "#d97e4a", "#5b8c8a", "#e8b04b", "#8e6bbf", "#c95b5b", "#4f9d69", "#3f7cac", "#a3a380", "#b77b5c"]
};

function dbMoney(n) {
  return "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

let dashWaits = 0;
function loadDashboard() {
  const cards = document.getElementById("db-summary-cards");
  if (typeof Chart === "undefined" && dashWaits < 20) {
    // Chart library still downloading — show placeholders and try again shortly
    dashWaits++;
    cards.innerHTML = Array(6).fill('<div class="stat-card skeleton"></div>').join("");
    setTimeout(loadDashboard, 300);
    return;
  }
  if (typeof Chart === "undefined") {
    cards.innerHTML = `<div class="notice warn" style="grid-column:1/-1;margin:0;"><i class="fas fa-triangle-exclamation"></i>
      <div><b>Charts could not load.</b> The dashboard needs an internet connection for its chart library. Check the connection and press Refresh.</div></div>`;
    return;
  }
  cards.innerHTML = Array(6).fill('<div class="stat-card skeleton"></div>').join("");

  const get = path => fetch(path, { credentials: "same-origin" }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

  Promise.all([
    get("/api/dashboard/summary"),
    get("/api/dashboard/revenue"),
    get("/api/dashboard/items"),
    get("/api/dashboard/categories"),
    get("/api/dashboard/hourly"),
    get("/api/dashboard/payments"),
  ])
  .then(([summary, revenue, items, categories, hourly, payments]) => {
    dashWaits = 0;
    renderSummaryCards(summary);
    renderRevenueChart(revenue);
    renderTopItems(items);
    renderCategoryChart(categories);
    renderHourlyChart(hourly);
    renderPaymentsChart(payments);
  })
  .catch(err => {
    console.error("Dashboard load error:", err);
    cards.innerHTML = `<div class="notice warn" style="grid-column:1/-1;margin:0;"><i class="fas fa-triangle-exclamation"></i><div>Could not load dashboard data. Please press Refresh.</div></div>`;
  });
}

function renderSummaryCards(d) {
  const cards = [
    { icon: "fa-indian-rupee-sign", label: "Today's revenue",   value: dbMoney(d.today_revenue),   fg: "#2f5d5c", bg: "#e7efee" },
    { icon: "fa-receipt",           label: "Bills today",       value: d.today_invoices || 0,      fg: "#3f7cac", bg: "#e3eef7" },
    { icon: "fa-chair",             label: "Tables dining now", value: d.active_tables || 0,       fg: "#4f9d69", bg: "#e4f3e9" },
    { icon: "fa-calculator",        label: "Average bill",      value: dbMoney(d.avg_bill),        fg: "#8e6bbf", bg: "#efe9f7" },
    { icon: "fa-calendar-days",     label: "Revenue · 30 days", value: dbMoney(d.monthly_revenue), fg: "#d97e4a", bg: "#fbeee5" },
    { icon: "fa-fire-burner",       label: "Pending in kitchen", value: d.pending_orders || 0,     fg: "#c95b5b", bg: "#f9e6e6" },
  ];
  if (d.bom_enabled) {
    cards.push({ icon: "fa-boxes-stacked", label: "Low-stock materials", value: d.low_stock_count || 0, fg: d.low_stock_count ? "#b45309" : "#4f9d69", bg: d.low_stock_count ? "#fef3c7" : "#e4f3e9" });
  }
  document.getElementById("db-summary-cards").innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-icon" style="background:${c.bg};color:${c.fg};"><i class="fas ${c.icon}"></i></div>
      <div style="min-width:0;">
        <div class="stat-value">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>
    </div>`).join("");
}

function baseScales(horizontal) {
  const money = v => "₹" + Number(v).toLocaleString("en-IN");
  return {
    x: { grid: { color: horizontal ? DB_COLORS.grid : "transparent" }, ticks: { color: DB_COLORS.tick, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, beginAtZero: true },
    y: { grid: { color: horizontal ? "transparent" : DB_COLORS.grid }, ticks: { color: DB_COLORS.tick, font: { size: 11 }, callback: horizontal ? undefined : money }, beginAtZero: true }
  };
}

// Shows a friendly message over a chart that has nothing to plot
function chartEmpty(canvasId, isEmpty, msg) {
  const wrap = document.getElementById(canvasId).parentElement;
  let note = wrap.querySelector(".chart-empty");
  if (!note) {
    note = document.createElement("div");
    note.className = "chart-empty";
    note.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:#6b7776;font-size:13px;padding:20px;pointer-events:none;";
    wrap.appendChild(note);
  }
  note.textContent = msg;
  note.style.display = isEmpty ? "flex" : "none";
}

function renderRevenueChart(data) {
  chartEmpty("chart-revenue", !(data || []).some(d => d.revenue > 0), "No bills settled in the last 30 days yet.");
  const ctx = document.getElementById("chart-revenue").getContext("2d");
  if (chartRevenue) chartRevenue.destroy();
  chartRevenue = new Chart(ctx, {
    type: "bar",
    data: {
      labels: (data || []).map(d => d.date),
      datasets: [{
        label: "Revenue",
        data: (data || []).map(d => d.revenue),
        backgroundColor: DB_COLORS.teal,
        hoverBackgroundColor: DB_COLORS.orange,
        borderRadius: 4,
        maxBarThickness: 26,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => dbMoney(c.parsed.y) } } },
      scales: baseScales(false)
    }
  });
}

function renderCategoryChart(data) {
  chartEmpty("chart-category", !(data || []).length, "No sales to show yet.");
  const ctx = document.getElementById("chart-category").getContext("2d");
  if (chartCategory) chartCategory.destroy();
  const list = (data || []).slice(0, 8);
  chartCategory = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: list.map(d => d.category),
      datasets: [{ data: list.map(d => d.revenue), backgroundColor: DB_COLORS.palette, borderColor: "#ffffff", borderWidth: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: DB_COLORS.tick, font: { size: 11 }, boxWidth: 10, padding: 10 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${dbMoney(c.parsed)}` } }
      }
    }
  });
}

function renderPaymentsChart(data) {
  chartEmpty("chart-payments", !(data || []).length, "No payments in the last 30 days yet.");
  const ctx = document.getElementById("chart-payments").getContext("2d");
  if (chartPayments) chartPayments.destroy();
  const list = data || [];
  const colors = { UPI: "#2f5d5c", Cash: "#d97e4a", Card: "#3f7cac", "Not recorded": "#c7c2b6" };
  chartPayments = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: list.map(d => `${d.method} (${d.count})`),
      datasets: [{ data: list.map(d => d.amount), backgroundColor: list.map((d, i) => colors[d.method] || DB_COLORS.palette[i % 10]), borderColor: "#ffffff", borderWidth: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: DB_COLORS.tick, font: { size: 11 }, boxWidth: 10, padding: 10 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${dbMoney(c.parsed)}` } }
      }
    }
  });
}

function renderHourlyChart(data) {
  chartEmpty("chart-hourly", !(data || []).some(d => d.orders > 0), "Busy hours appear once bills are settled.");
  const ctx = document.getElementById("chart-hourly").getContext("2d");
  if (chartHourly) chartHourly.destroy();
  chartHourly = new Chart(ctx, {
    type: "bar",
    data: {
      labels: (data || []).map(d => d.hour),
      datasets: [{ label: "Bills", data: (data || []).map(d => d.orders), backgroundColor: DB_COLORS.orangeSoft, borderColor: DB_COLORS.orange, borderWidth: 1.5, borderRadius: 4, hoverBackgroundColor: DB_COLORS.orange }]
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: baseScales(true)
    }
  });
}

function renderTopItems(data) {
  const tbody = document.getElementById("db-items-tbody");
  if (!data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No sales yet.</td></tr>`;
    return;
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  tbody.innerHTML = data.slice(0, 10).map((item, i) => `
    <tr>
      <td data-label="Rank"><span class="rank">${i + 1}</span></td>
      <td data-label="Item" class="strong">${esc(item.name)}</td>
      <td data-label="Qty sold">${item.qty}</td>
      <td data-label="Revenue" class="amount">${dbMoney(item.revenue)}</td>
    </tr>`).join("");
}

function exportDashboardPDF() {
  if (!window.html2pdf) {
    window.showToast("PDF tool is still loading — try again in a moment.", "warning");
    return;
  }
  window.showToast("Preparing PDF…", "info");
  html2pdf().set({
    margin: [10, 10],
    filename: `MosaicEngine_Dashboard_${new Date().toLocaleDateString("en-IN").replace(/\//g, "-")}.pdf`,
    image: { type: "jpeg", quality: 0.95 },
    html2canvas: { scale: 1.5, backgroundColor: "#f4f2ed" },
    jsPDF: { unit: "mm", format: "a3", orientation: "landscape" }
  }).from(document.getElementById("sec-dashboard")).save()
    .then(() => window.showToast("Dashboard PDF exported.", "success"));
}
