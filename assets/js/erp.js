/**
 * erp.js — Kitchen ERP screens for Mosaic Engine HMS
 * P&L · Takeaway & delivery · Kitchen stations · Recipe costing · Stock counts ·
 * Wastage · Production & labels · Purchasing approvals/scorecard · Permissions ·
 * Food safety · Staff & shifts · Outlets
 * Uses helpers from admin.js: api, escapeHTML, jsArg, inr, round2, formatDateTime,
 * formatTime, emptyRow, openModal, closeModal, can, currentRole, publicSettings.
 */
(function () {
  const $ = id => document.getElementById(id);
  const esc = escapeHTML;
  const q3 = n => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 });
  const pct = n => (n == null ? "—" : (Math.round(n * 10) / 10) + "%");

  const ERP = { rules: {}, state: { pnlDays: 1, costDays: 30, wasteDays: 1, channel: "Takeaway", cart: [], pay: null, staffDate: null } };
  window.ERP = ERP;

  /* ── Building blocks ─────────────────────────────────────────────────── */
  function header(title, desc, actions = "") {
    return `<div class="page-header"><div><h2>${title}</h2><p>${desc}</p></div><div class="page-actions">${actions}</div></div>`;
  }
  function card(title, icon, body, sub = "", flush = false) {
    return `<div class="card"><div class="card-header"><h3><i class="fas ${icon}"></i> ${title}</h3>${sub ? `<span class="sub">${sub}</span>` : ""}</div>
      <div class="${flush ? "table-wrap cards" : "card-body"}">${body}</div></div>`;
  }
  function kpis(list) {
    return `<div class="stats-grid">${list.map(k => `<div class="stat-card"><div class="stat-icon" style="background:${k.bg || "#e7efee"};color:${k.fg || "#2f5d5c"};"><i class="fas ${k.icon}"></i></div>
      <div style="min-width:0;"><div class="stat-value"${k.color ? ` style="color:${k.color}"` : ""}>${k.value}</div><div class="stat-label">${k.label}</div></div></div>`).join("")}</div>`;
  }
  function table(head, rows, emptyMsg) {
    return `<table class="table responsive"><thead><tr>${head.map(h => `<th${h.startsWith(">") ? ' class="text-right"' : ""}>${h.replace(/^>/, "")}</th>`).join("")}</tr></thead>
      <tbody>${rows.length ? rows.join("") : emptyRow(head.length, emptyMsg || "Nothing here yet.")}</tbody></table>`;
  }
  function td(label, html, cls = "") { return `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}>${html}</td>`; }
  function bars(obj, color = "var(--primary)", fmt = inr) {
    const entries = Object.entries(obj || {});
    if (!entries.length) return '<p class="muted" style="font-size:13px;">No data for this period yet.</p>';
    const mx = Math.max(1, ...entries.map(e => Math.abs(e[1])));
    return `<div class="erp-bars">${entries.map(([k, v]) => `<div class="erp-bar"><span class="k">${esc(k)}</span><span class="t"><i style="width:${Math.abs(v) / mx * 100}%;background:${color}"></i></span><span class="v">${fmt(v)}</span></div>`).join("")}</div>`;
  }
  function seg(name, opts, active) {
    return `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<button type="button" class="${String(v) === String(active) ? "active" : ""}" onclick="ERP.set('${name}', '${jsArg(v)}')">${l}</button>`).join("")}</div>`;
  }
  ERP.set = (name, v) => {
    ERP.state[name] = isNaN(v) || v === "" ? v : Number(v);
    const map = { pnlDays: "pnl", costDays: "costing", wasteDays: "wastage", channel: "counter" };
    if (map[name]) ERP[map[name]]();
  };
  function badge(text, kind) { return `<span class="badge ${kind ? "badge-" + kind : ""}">${esc(text)}</span>`; }
  function lockAttr(perm) { return can(perm) ? "" : ` disabled title="Your role does not have this permission"`; }
  function loading(sec) { $(sec).innerHTML = `<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>Loading…</p></div>`; }
  function failed(sec, err) { $(sec).innerHTML = `<div class="notice warn"><i class="fas fa-triangle-exclamation"></i><div>${esc(err.message)}</div></div>`; }
  function matOptions(mats, filter) {
    return [...mats].filter(filter || (() => true)).sort((a, b) => a.name.localeCompare(b.name))
      .map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.unit)})</option>`).join("");
  }

  // Generic popup used by the ERP screens
  function modal(title, body, footer, wide) {
    let el = $("erp-modal");
    if (!el) {
      el = document.createElement("div");
      el.className = "modal-backdrop"; el.id = "erp-modal";
      el.addEventListener("click", e => { if (e.target === el) closeModal("erp-modal"); });
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="modal ${wide ? "modal-lg" : ""}" role="dialog" aria-modal="true"><div class="modal-header"><h3>${title}</h3>
      <button class="btn btn-icon btn-ghost" type="button" onclick="closeModal('erp-modal')" aria-label="Close"><i class="fas fa-xmark"></i></button></div>
      <div class="modal-body">${body}</div><div class="modal-footer">${footer}</div></div>`;
    openModal("erp-modal");
  }
  ERP.modal = modal;

  /* ── Rules (settings for each module, no code needed) ────────────────── */
  ERP.loadRules = async () => { try { ERP.rules = await api("/api/erp/rules"); } catch (e) { ERP.rules = ERP.rules || {}; } return ERP.rules; };

  // fields: [key, label, type, hint, opts]
  function rulesCard(fields, title = "Rules", note = "") {
    const dis = can("editSettings") ? "" : " disabled";
    const r = ERP.rules;
    const id = "rules-" + fields.map(f => f[0]).join("-").slice(0, 40);
    const inputs = fields.map(([k, label, type, hint, opts]) => {
      let inp;
      if (type === "bool") inp = `<label class="switch"><input type="checkbox" data-rule="${k}" ${r[k] ? "checked" : ""}${dis}><span class="slider"></span></label>`;
      else if (type === "select") inp = `<select class="select" data-rule="${k}"${dis}>${opts.map(([v, l]) => `<option value="${v}" ${r[k] === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
      else if (type === "list") inp = `<textarea class="textarea" data-rule="${k}" data-list="1" style="min-height:90px;"${dis}>${esc((r[k] || []).join("\n"))}</textarea>`;
      else inp = `<input class="input" type="${type === "text" ? "text" : "number"}" step="any" data-rule="${k}" value="${esc(r[k] == null ? "" : r[k])}"${dis}>`;
      return `<div class="field"><label>${label}</label>${inp}${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
    }).join("");
    return `<div class="card" id="${id}"><div class="card-header"><h3><i class="fas fa-sliders"></i> ${title}</h3><span class="sub">${can("editSettings") ? "Change without code" : "Only roles with “Edit settings & limits” can change these"}</span></div>
      <div class="card-body">${note ? `<p class="muted" style="font-size:13px;margin-bottom:12px;">${note}</p>` : ""}<div class="form-grid">${inputs}</div></div>
      ${can("editSettings") ? `<div class="card-footer"><button class="btn btn-primary" type="button" onclick="ERP.saveRules('${id}')"><i class="fas fa-floppy-disk"></i> Save rules</button></div>` : ""}</div>`;
  }
  ERP.saveRules = async (id, extra = {}) => {
    const body = Object.assign({}, extra);
    document.querySelectorAll(`#${id} [data-rule]`).forEach(el => {
      const k = el.dataset.rule;
      if (el.type === "checkbox") body[k] = el.checked;
      else if (el.dataset.list) body[k] = el.value.split("\n").map(x => x.trim()).filter(Boolean);
      else if (el.type === "number") body[k] = el.value === "" ? undefined : parseFloat(el.value);
      else body[k] = el.value;
    });
    try {
      await api("/api/erp/rules", { method: "POST", body });
      await ERP.loadRules();
      window.showToast("Rules saved.", "success");
      if (activeTab && TABS[activeTab]) TABS[activeTab].onOpen();
    } catch (e) { window.showToast(e.message, "error"); }
  };

  ERP.badges = async () => {
    try {
      const b = await api("/api/erp/badges");
      const set = (id, n) => { const el = $(id); if (el) { el.textContent = n; el.classList.toggle("hidden", !n); } };
      set("nav-incoming-badge", b.incoming); set("nav-waste-badge", b.wastage); set("nav-safety-badge", b.safety); set("nav-expiry-badge", b.expiring);
      if (b.approvals) { const el = $("nav-po-badge"); if (el) { el.textContent = b.approvals; el.classList.remove("hidden"); el.title = `${b.approvals} awaiting approval`; } }
    } catch (e) { /* ignore */ }
  };
  window.refreshErpBadges = ERP.badges;

  /* ═══════════════════════ P&L & FOOD COST ═══════════════════════ */
  ERP.pnl = async () => {
    const sec = "sec-pnl"; loading(sec);
    try {
      await ERP.loadRules();
      const d = await api(`/api/erp/pnl?days=${ERP.state.pnlDays}`);
      const over = d.actual_pct > d.target_food_cost;
      const wa = d.owner_whatsapp ? `https://wa.me/${d.owner_whatsapp}?text=${encodeURIComponent(d.whatsapp.replace(/\*/g, ""))}` : "";
      $(sec).innerHTML = header("P&amp;L &amp; food cost", "What your sales cost: recipe food cost, wastage, stock-count variance, aggregator commission and labour, down to contribution.",
          seg("pnlDays", [[1, "Today"], [7, "7 days"], [30, "30 days"]], ERP.state.pnlDays)) +
        kpis([
          { icon: "fa-indian-rupee-sign", label: `Sales excl. tax & service · ${d.label}`, value: inr(d.sales) },
          { icon: "fa-calculator", label: "Theoretical food cost", value: pct(d.theoretical_pct), fg: "#3f7cac", bg: "#e3eef7" },
          { icon: "fa-chart-line", label: `Actual food cost (target ${d.target_food_cost}%)`, value: pct(d.actual_pct), color: over ? "var(--danger)" : "var(--success)", fg: "#d97e4a", bg: "#fbeee5" },
          { icon: "fa-trash-can", label: "Wastage", value: inr(d.wastage), fg: "#c95b5b", bg: "#f9e6e6" },
          { icon: "fa-user-clock", label: `Labour · ${d.labour_hours} h`, value: `${inr(d.labour)} <small style="font-size:12px;color:var(--muted)">${pct(d.labour_pct)}</small>`, fg: "#8e6bbf", bg: "#efe9f7" },
          { icon: "fa-sack-dollar", label: "Contribution", value: inr(d.contribution), color: d.contribution < 0 ? "var(--danger)" : "", fg: "#4f9d69", bg: "#e4f3e9" },
        ]) +
        (d.uncosted_sales > 0 ? `<div class="notice warn"><i class="fas fa-circle-info"></i><div>${inr(d.uncosted_sales)} of sales are on items without a recipe, so their food cost is not counted. Add recipes under <b>Recipe costing</b>.</div></div>` : "") +
        `<div class="grid-2-even">` +
        card(`Contribution P&amp;L · ${d.label}`, "fa-scale-balanced", `<table class="table"><tbody>
          <tr><td>Food &amp; beverage sales (${d.bills} bills)</td><td class="text-right amount">${inr(d.sales)}</td></tr>
          <tr><td>Service charge collected</td><td class="text-right">${inr(d.service_charge)}</td></tr>
          <tr><td>Theoretical food cost (recipes)</td><td class="text-right">− ${inr(d.food_cost)}</td></tr>
          <tr><td>Wastage</td><td class="text-right">− ${inr(d.wastage)}</td></tr>
          <tr><td>Stock-count variance</td><td class="text-right">${inr(d.variance)}</td></tr>
          <tr><td>Swiggy / Zomato commission</td><td class="text-right">− ${inr(d.commission)}</td></tr>
          <tr><td>Labour (clocked hours × rate)</td><td class="text-right">− ${inr(d.labour)}</td></tr>
          <tr><td><b>Contribution</b></td><td class="text-right amount">${inr(d.contribution)}</td></tr></tbody></table>`, "Live from every module", true) +
        card("Sales by channel", "fa-chart-bar", bars(d.by_channel) + `<h4 style="font-size:13px;margin:16px 0 8px;">Top sellers (portions)</h4>` + bars(d.top_sellers, "var(--accent)", v => v)) +
        `</div><div class="grid-2-even">` +
        card("Daily summary for WhatsApp", "fa-brands fa-whatsapp", `<pre class="wa-box">${esc(d.whatsapp)}</pre>
          <div class="form-actions" style="justify-content:flex-start;margin-top:12px;">
            <button class="btn btn-secondary" type="button" onclick="ERP.copyText(ERP._wa)"><i class="fas fa-copy"></i> Copy</button>
            ${wa ? `<a class="btn btn-primary" href="${esc(wa)}" target="_blank" rel="noopener"><i class="fas fa-paper-plane"></i> Open in WhatsApp</a>` : `<span class="muted" style="font-size:12.5px;">Add the owner's WhatsApp number in the rules to send it in one tap.</span>`}
          </div><p class="muted" style="font-size:12px;margin-top:10px;">Sending automatically every night needs a WhatsApp Business API provider (BSP) account.</p>`) +
        rulesCard([["target_food_cost", "Target food cost (%)", "number", "Actual food cost above this shows in red."], ["owner_whatsapp", "Owner's WhatsApp number", "text", "10-digit mobile, India assumed."]], "P&L rules") +
        `</div>`;
      ERP._wa = d.whatsapp.replace(/\*/g, "");
    } catch (e) { failed(sec, e); }
  };
  ERP.copyText = t => {
    try { navigator.clipboard.writeText(t).then(() => window.showToast("Copied.", "success"), () => window.showToast("Copy was blocked by the browser.", "warning")); }
    catch (e) { window.showToast("Copy was blocked by the browser.", "warning"); }
  };

  /* ═══════════════════════ TAKEAWAY & DELIVERY ═══════════════════════ */
  ERP.counter = async () => {
    const sec = "sec-counter";
    try {
      await ERP.loadRules();
      const d = await api("/api/erp/counter");
      ERP._counter = d;
      const ch = ERP.state.channel;
      const agg = ch === "Swiggy" || ch === "Zomato";
      if (!ERP.state.pay || !d.payment_methods.includes(ERP.state.pay)) ERP.state.pay = d.payment_methods[0];
      const priceOf = (v) => agg ? Math.round(v.price * (1 + d.markup / 100)) : Number(v.price);
      const q = (ERP.state.search || "").toLowerCase();
      const tiles = [];
      d.menu.forEach(m => (m.variants || []).forEach(v => {
        if (q && !m.name.toLowerCase().includes(q)) return;
        const off = !m.available || m.alcoholic || (agg && !m.online);
        const why = m.alcoholic ? "Dine-in only" : !m.available ? "Out of stock" : "Not sold online";
        tiles.push(`<button type="button" class="pos-tile" ${off ? `disabled title="${why}"` : ""} onclick="ERP.addCart('${jsArg(m.id)}','${jsArg(v.label)}')">
          <b>${esc(m.name)}</b><span>${esc(v.label)} · ${inr(priceOf(v))}${off ? ` · ${why}` : ""}</span></button>`);
      }));
      const lines = ERP.state.cart.map((l, i) => {
        const m = d.menu.find(x => x.id === l.id); const v = m && m.variants.find(x => x.label === l.variant);
        return { ...l, name: m ? m.name : l.id, price: v ? priceOf(v) : 0, i };
      });
      const sub = lines.reduce((s, l) => s + l.price * l.quantity, 0);
      const g = Number(publicSettings.gst_percent) || 0;
      const cg = round2(sub * g / 200);
      const total = Math.round(round2(sub + cg * 2));
      ERP._counterTotal = total;
      const statusBadge = s => badge(s, { Received: "danger", Preparing: "warning", Ready: "success", Served: "" }[s]);
      $(sec).innerHTML = header("Takeaway &amp; delivery", "Counter takeaway, your own delivery and Swiggy / Zomato orders — same kitchen, same stock, one invoice series.") +
        (d.incoming.length ? card(`Online orders waiting (${d.incoming.length})`, "fa-bell", table(["Platform", "Order", "Items", ">"], d.incoming.map(o => `<tr>${td("Platform", esc(o.platform), "strong")}${td("Order", esc(o.ref), "mono")}
          ${td("Items", o.items.map(i => `${i.quantity}× ${esc((d.menu.find(m => m.id === i.id) || { name: i.id }).name)}`).join(", "))}
          <td class="actions"><button class="btn btn-success btn-sm" onclick="ERP.incoming('${jsArg(o.id)}', true)">Accept</button><button class="btn btn-danger-soft btn-sm" onclick="ERP.incoming('${jsArg(o.id)}', false)">Reject</button></td></tr>`)), "Auto-accept is off", true) : "") +
        `<div class="grid-2">` +
        card("New order", "fa-bag-shopping", `
          ${seg("channel", [["Takeaway", '<i class="fas fa-person-walking"></i> Takeaway'], ["Delivery", '<i class="fas fa-motorcycle"></i> Own delivery'], ["Swiggy", "Swiggy"], ["Zomato", "Zomato"]], ch)}
          <div class="form-grid" style="margin-top:14px;">
            <div class="field"><label for="co-name">Guest name</label><input class="input" id="co-name" maxlength="40" value="${esc(ERP.state.name || "")}" oninput="ERP.state.name=this.value"></div>
            <div class="field"><label for="co-phone">Mobile (optional)</label><input class="input" id="co-phone" inputmode="numeric" maxlength="10" value="${esc(ERP.state.phone || "")}" oninput="ERP.state.phone=this.value"></div>
            ${agg ? `<div class="field"><label for="co-ref">${ch} order ID *</label><input class="input" id="co-ref" maxlength="30" value="${esc(ERP.state.ref || "")}" oninput="ERP.state.ref=this.value"></div>` : ""}
            ${ch === "Delivery" ? `<div class="field" style="grid-column:1/-1;"><label for="co-addr">Delivery address *</label><input class="input" id="co-addr" maxlength="200" value="${esc(ERP.state.addr || "")}" oninput="ERP.state.addr=this.value"></div>` : ""}
          </div>
          <div class="input-group" style="margin:14px 0 10px;"><i class="fas fa-magnifying-glass"></i><input class="input" type="search" placeholder="Search menu…" value="${esc(ERP.state.search || "")}" oninput="ERP.state.search=this.value; clearTimeout(ERP._st); ERP._st=setTimeout(ERP.counter, 250)"></div>
          <div class="pos-grid">${tiles.join("") || '<p class="muted">No items match.</p>'}</div>
          <p class="muted" style="font-size:12px;margin-top:8px;">Alcohol is dine-in only. ${agg ? `Online prices include the ${d.markup}% markup.` : ""}</p>`) +
        card("Cart", "fa-cart-shopping", `${lines.length ? `<div class="cart-lines">${lines.map(l => `<div class="cart-line"><div><b>${esc(l.name)}</b><small>${esc(l.variant)} · ${inr(l.price)}</small></div>
            <div class="qty"><button class="btn btn-icon btn-sm btn-secondary" onclick="ERP.qty(${l.i},-1)" aria-label="Less">−</button><span>${l.quantity}</span><button class="btn btn-icon btn-sm btn-secondary" onclick="ERP.qty(${l.i},1)" aria-label="More">+</button></div>
            <div class="amt">${inr(l.price * l.quantity)}</div></div>`).join("")}</div>` : '<p class="muted" style="font-size:13px;">Tap items to add them.</p>'}
          <div class="po-totals" style="max-width:none;"><div class="row"><span>Subtotal</span><span>${inr(sub)}</span></div>
            <div class="row"><span>CGST + SGST ${g}% (no service charge off-premise)</span><span>${inr(cg * 2)}</span></div>
            <div class="row total"><span>Total</span><span>${inr(total)}</span></div></div>
          ${agg ? `<p class="muted" style="font-size:12.5px;margin-top:10px;">Prepaid on ${ch}. Payout = total − ${d.commission}% commission.</p>` :
            `<div class="field" style="margin-top:12px;"><span class="label">Paid by</span>${seg("pay", d.payment_methods.map(m => [m, m]), ERP.state.pay)}</div>`}
          <div class="form-actions"><button class="btn btn-secondary" type="button" onclick="ERP.state.cart=[]; ERP.counter()">Clear</button>
          ${!agg && ERP.state.pay === "UPI" && publicSettings.upi_id ? `<button class="btn btn-secondary" type="button" onclick="ERP.counterQR()" ${lines.length ? "" : "disabled"}><i class="fas fa-qrcode"></i> UPI QR</button>` : ""}
          <button class="btn btn-primary" type="button" onclick="ERP.placeCounter()" ${lines.length ? "" : "disabled"}><i class="fas fa-paper-plane"></i> Send to kitchen &amp; bill</button></div>`) +
        `</div>` +
        card("Today's orders", "fa-list", table(["No.", "Channel", "Guest / ref", "Items", "Total", "Kitchen", "Invoice"], d.orders.map(o => `<tr>${td("No.", esc(o.no), "mono strong")}${td("Channel", esc(o.channel))}${td("Guest / ref", esc(o.ref))}
            ${td("Items", o.items.map(i => `${i.quantity}× ${esc(i.name)}`).join(", "))}${td("Total", inr(o.total), "amount")}${td("Kitchen", statusBadge(o.status))}${td("Invoice", `<span class="mono" style="font-size:12px;">${esc(o.invoice_no)}</span>`)}</tr>`), "No takeaway or delivery orders yet today."), "", true) +
        `<div class="grid-2-even">` +
        card("Channel settlement · today", "fa-indian-rupee-sign", table(["Channel", ">Orders", ">Sales", ">Commission", ">Payout"], d.settlement.map(s => `<tr>${td("Channel", esc(s.channel), "strong")}${td("Orders", s.orders, "text-right")}${td("Sales", inr(s.sales), "text-right")}${td("Commission", s.commission ? inr(s.commission) : "—", "text-right")}${td("Payout", inr(s.payout), "text-right amount")}</tr>`), "No sales yet today."), "", true) +
        card("Virtual brands · today", "fa-tags", bars(d.brands, "var(--accent)") + `<p class="muted" style="font-size:12px;margin-top:10px;">Set an item's brand in Menu Items or below; each brand can list separately on Swiggy and Zomato.</p>`) +
        `</div>` +
        card("Online menu (Swiggy / Zomato)", "fa-globe", table(["Item", "Brand", ">Online price", "Online"], d.menu.filter(m => !m.alcoholic).map(m => `<tr>${td("Item", esc(m.name), "strong")}
            ${td("Brand", `<input class="input" style="max-width:180px;" data-brand="${esc(m.id)}" value="${esc(m.brand)}" ${can("editSettings") ? "" : "disabled"}>`)}
            ${td("Online price", inr(Math.round((m.variants[0] || { price: 0 }).price * (1 + d.markup / 100))), "text-right")}
            ${td("Online", `<label class="switch"><input type="checkbox" data-online="${esc(m.id)}" ${m.online ? "checked" : ""} ${can("editSettings") ? "" : "disabled"}><span class="slider"></span></label>`)}</tr>`)) +
          (can("editSettings") ? `<div class="card-footer"><button class="btn btn-primary" onclick="ERP.saveOnlineMenu()"><i class="fas fa-floppy-disk"></i> Save online menu</button></div>` : ""), "Availability is pushed by your aggregator middleware", true) +
        `<div class="grid-2-even">` +
        rulesCard([["auto_accept_online", "Auto-accept online orders", "bool", "Off = staff accept each order here."], ["aggregator_commission", "Aggregator commission (%)", "number"], ["aggregator_markup", "Online price markup (%)", "number"]], "Channel rules") +
        integrationCard("aggregator", "Swiggy / Zomato via middleware", `{"platform": "Swiggy", "order_id": "SWG-88412", "customer_name": "Aman",\n "items": [{"id": "item-crispy-corn", "variant": "Portion", "quantity": 2}]}`,
          "Swiggy and Zomato only connect through partner middleware such as UrbanPiper. Point its order webhook here (it may need a small mapping to this format).") +
        `</div>`;
    } catch (e) { failed(sec, e); }
  };
  ERP.addCart = (id, variant) => {
    const l = ERP.state.cart.find(x => x.id === id && x.variant === variant);
    if (l) l.quantity++; else ERP.state.cart.push({ id, variant, quantity: 1 });
    ERP.counter();
  };
  ERP.qty = (i, d) => { const l = ERP.state.cart[i]; l.quantity += d; if (l.quantity <= 0) ERP.state.cart.splice(i, 1); ERP.counter(); };
  ERP.counterQR = () => {
    const link = window.UPI.link(publicSettings.upi_id, publicSettings.upi_name, ERP._counterTotal, `${ERP.state.channel} order`);
    $("upi-modal-amount").textContent = inr(ERP._counterTotal);
    $("upi-modal-payee").textContent = publicSettings.upi_name || publicSettings.business_name;
    $("upi-modal-id").textContent = publicSettings.upi_id;
    window.UPI.renderQR($("upi-modal-qr"), link, 260);
    openModal("upi-modal");
  };
  ERP.placeCounter = async () => {
    const ch = ERP.state.channel, agg = ch === "Swiggy" || ch === "Zomato";
    const body = { action: "order", channel: ch, customer_name: ERP.state.name || "", customer_phone: (ERP.state.phone || "").replace(/\D/g, ""),
      ref: ERP.state.ref || "", address: ERP.state.addr || "", items: ERP.state.cart,
      payments: agg ? [] : [{ method: ERP.state.pay, amount: ERP._counterTotal, label: "Payment" }] };
    try {
      const r = await api("/api/erp/counter", { method: "POST", body });
      window.showToast(`${r.order.no} sent to the kitchen · ${r.invoice.invoice_no} · ${inr(r.invoice.total)}`, "success");
      Object.assign(ERP.state, { cart: [], name: "", phone: "", ref: "", addr: "" });
      await ERP.counter();
      historicalInvoices.unshift(r.invoice);
      viewHistoricalInvoiceDetails(r.invoice.invoice_id);
    } catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.incoming = async (id, ok) => {
    try { await api("/api/erp/counter", { method: "POST", body: { action: ok ? "accept" : "reject", id } }); window.showToast(ok ? "Order accepted and sent to the kitchen." : "Order rejected.", "info"); ERP.counter(); ERP.badges(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.saveOnlineMenu = async () => {
    const itemsUpd = [...document.querySelectorAll("[data-online]")].map(el => ({ id: el.dataset.online, online: el.checked, brand: (document.querySelector(`[data-brand="${CSS.escape(el.dataset.online)}"]`) || {}).value }));
    try { await api("/api/erp/stations", { method: "POST", body: { items: itemsUpd } }); window.showToast("Online menu saved.", "success"); await loadData(); ERP.counter(); }
    catch (e) { window.showToast(e.message, "error"); }
  };

  function integrationCard(kind, title, sample, note) {
    if (currentRole() !== "Admin") return card(title, "fa-plug", `<p class="muted" style="font-size:13px;">${note}</p><p class="muted" style="font-size:12.5px;">An Admin can see the webhook address and key.</p>`);
    const url = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}api/integrations/${kind}`;
    return card(title, "fa-plug", `<p class="muted" style="font-size:13px;margin-bottom:10px;">${note}</p>
      <div class="field"><span class="label">Webhook URL (POST, JSON)</span><code class="code-box">${esc(url)}</code></div>
      <div class="field" style="margin-top:10px;"><span class="label">Header <span class="mono">X-Integration-Key</span></span>
        <code class="code-box" id="ik-${kind}">${esc((ERP.rules.integration_key || "").slice(0, 6))}••••••••</code>
        <div class="form-actions" style="justify-content:flex-start;margin-top:6px;"><button class="btn btn-secondary btn-sm" type="button" onclick="ERP.copyText(ERP.rules.integration_key)"><i class="fas fa-copy"></i> Copy key</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="if(confirm('Create a new key? Every connected device and service must be updated.')) ERP.saveRules('x', {regenerate_integration_key: true})"><i class="fas fa-rotate"></i> New key</button></div></div>
      <div class="field" style="margin-top:10px;"><span class="label">Body</span><pre class="code-box">${esc(sample)}</pre></div>
      <p class="muted" style="font-size:12px;">For another outlet, add <span class="mono">?outlet=ID</span> to the URL.</p>`);
  }

  /* ═══════════════════════ KITCHEN STATIONS ═══════════════════════ */
  ERP.stations = async () => {
    const sec = "sec-stations"; loading(sec);
    try {
      await ERP.loadRules();
      const d = await api("/api/erp/stations");
      const ed = can("editSettings");
      $(sec).innerHTML = header("Kitchen stations", "Each item goes to its station on the Kitchen Display with its own target time. Late tickets turn red, stale ones escalate, and bills wait until food is served.",
          `<a class="btn btn-secondary" href="kitchen.html"><i class="fas fa-fire-burner"></i> Open Kitchen Display</a>`) +
        `<div class="grid-2">` +
        `<div>` + rulesCard([["kds_warn_pct", "Warn at % of target", "number", "Ticket turns amber."], ["kds_stale_min", "Escalate stale tickets after (min)", "number", "Written to the Audit Log as a manager alert."],
          ["block_bill_until_served", "Block bill until all food is served", "bool"], ["stations", "Stations (one per line)", "list", "e.g. Fry, Cold, Hot, Bar, Tandoor"]], "Kitchen rules") +
        card("Station printers", "fa-print", `<p class="muted" style="font-size:13px;">Each ticket on the Kitchen Display has a <b>Print</b> button for a station printer connected to that screen. Fully automatic printing to several printers needs a small print agent installed on a PC in the kitchen.</p>`) + `</div>` +
        card("Routing and target times", "fa-route", table(["Item", "Station", ">Target (min)"], d.items.map(it => `<tr>${td("Item", esc(it.name) + (it.alcoholic ? " " + badge("Bar", "info") : ""), "strong")}
            ${td("Station", `<select class="select" data-stn="${esc(it.id)}" ${ed ? "" : "disabled"}>${d.stations.map(s => `<option ${s === it.station ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>`)}
            ${td("Target", `<input class="input" type="number" min="1" max="180" style="max-width:90px;" data-tgt="${esc(it.id)}" value="${it.target_min}" ${ed ? "" : "disabled"}>`, "text-right")}</tr>`)) +
          (ed ? `<div class="card-footer"><button class="btn btn-primary" onclick="ERP.saveStations()"><i class="fas fa-floppy-disk"></i> Save routing</button></div>` : ""), "Replaces the fixed 15-minute warning", true) +
        `</div>`;
    } catch (e) { failed(sec, e); }
  };
  ERP.saveStations = async () => {
    const upd = [...document.querySelectorAll("[data-stn]")].map(el => ({ id: el.dataset.stn, station: el.value, target_min: parseInt(document.querySelector(`[data-tgt="${CSS.escape(el.dataset.stn)}"]`).value, 10) || 1 }));
    try { await api("/api/erp/stations", { method: "POST", body: { items: upd } }); window.showToast("Routing saved.", "success"); loadData(); }
    catch (e) { window.showToast(e.message, "error"); }
  };

  /* ═══════════════════════ RECIPE COSTING ═══════════════════════ */
  ERP.costing = async () => {
    const sec = "sec-costing"; loading(sec);
    try {
      await ERP.loadRules();
      const d = await api(`/api/erp/costing?days=${ERP.state.costDays}`);
      ERP._cost = d;
      const costed = d.rows.filter(r => r.cost !== null);
      const avg = costed.length ? costed.reduce((s, r) => s + r.food_cost_pct, 0) / costed.length : 0;
      const over = costed.filter(r => r.food_cost_pct > d.target).length;
      const cls = { Star: "success", Plowhorse: "info", Puzzle: "warning", Dog: "danger" };
      ERP.state.costFilter = ERP.state.costFilter || "all";
      const list = d.rows.filter(r => ERP.state.costFilter === "all" || (ERP.state.costFilter === "costed" ? r.cost !== null : r.cost === null));
      $(sec).innerHTML = header("Recipe costing", "A live cost on every recipe and size: plate cost, food cost % and margin, plus menu engineering from what actually sells.",
          seg("costDays", [[7, "7 days"], [30, "30 days"], [90, "90 days"]], ERP.state.costDays)) +
        kpis([
          { icon: "fa-list-check", label: "Sizes with a recipe", value: `${costed.length} / ${d.rows.length}` },
          { icon: "fa-percent", label: "Average food cost", value: pct(avg), color: avg > d.target ? "var(--danger)" : "", fg: "#d97e4a", bg: "#fbeee5" },
          { icon: "fa-triangle-exclamation", label: `Above target (${d.target}%)`, value: over, fg: "#c95b5b", bg: "#f9e6e6" },
          { icon: "fa-scale-balanced", label: "Costing basis", value: d.basis === "last" ? "Last rate" : "Average", fg: "#3f7cac", bg: "#e3eef7" },
        ]) +
        card("Menu engineering", "fa-star", `<div style="margin-bottom:12px;">${seg("costFilter", [["all", "All"], ["costed", "With recipe"], ["missing", "No recipe"]], ERP.state.costFilter)}</div>` +
          table(["Item", "Size", ">Price", ">Plate cost", ">Food cost", ">Margin", ">Sold", "Class", ">"], list.map(r => `<tr>${td("Item", esc(r.name), "strong")}${td("Size", esc(r.variant))}${td("Price", inr(r.price), "text-right")}
            ${td("Plate cost", r.cost === null ? '<span class="muted">No recipe</span>' : inr(r.cost), "text-right")}
            ${td("Food cost", r.food_cost_pct === null ? "—" : `<span style="color:${r.food_cost_pct > d.target ? "var(--danger)" : "var(--success-700)"};font-weight:700;">${pct(r.food_cost_pct)}</span>`, "text-right")}
            ${td("Margin", r.margin === null ? "—" : inr(r.margin), "text-right")}${td("Sold", r.sold, "text-right")}${td("Class", r.class ? badge(r.class, cls[r.class]) : "—")}
            <td class="actions"><button class="btn btn-secondary btn-sm" onclick="ERP.recipe('${jsArg(r.item_id)}','${jsArg(r.variant)}')">${r.cost === null ? '<i class="fas fa-plus"></i> Recipe' : '<i class="fas fa-eye"></i> Recipe'}</button></td></tr>`)) +
          `<p class="muted" style="font-size:12px;margin-top:10px;"><b>Star</b> popular &amp; profitable · <b>Plowhorse</b> popular, low margin · <b>Puzzle</b> profitable, slow · <b>Dog</b> neither. Based on the last ${d.days} days.</p>`, "", false) +
        rulesCard([["costing_basis", "Costing basis", "select", "Rates update from goods receipts.", [["avg", "Weighted average"], ["last", "Last purchase rate"]]], ["target_food_cost", "Target food cost (%)", "number"]], "Costing rules");
    } catch (e) { failed(sec, e); }
  };
  // Recipe card with qty, yield loss %, rate and cost — editable with "Edit recipes & costs"
  ERP.recipe = async (itemId, variant) => {
    const r = ERP._cost.rows.find(x => x.item_id === itemId && x.variant === variant);
    let stock;
    try { stock = await api("/api/erp/stock"); } catch (e) { window.showToast(e.message, "error"); return; }
    ERP._mats = stock.materials;
    const ed = can("editRecipe");
    const rows = (r.lines.length ? r.lines : [{}]).map(l => recipeRow(l, ed)).join("");
    modal(`${esc(r.name)} · ${esc(r.variant)}`, `
      <div class="cost-kpis"><div><b>${inr(r.price)}</b><span>Price</span></div><div><b id="rc-cost">${r.cost === null ? "—" : inr(r.cost)}</b><span>Plate cost</span></div><div><b id="rc-pct">${pct(r.food_cost_pct)}</b><span>Food cost</span></div></div>
      <div class="rc-head"><span>Ingredient</span><span>Qty / serving</span><span>Loss %</span><span class="text-right">Cost</span><span></span></div>
      <div id="rc-rows">${rows}</div>
      ${ed ? `<button class="btn btn-secondary btn-sm" type="button" onclick="document.getElementById('rc-rows').insertAdjacentHTML('beforeend', ERP._row()); ERP.rcCalc();"><i class="fas fa-plus"></i> Ingredient</button>` : '<p class="muted" style="font-size:12.5px;">Read-only — your role cannot edit recipes.</p>'}
      <p class="muted" style="font-size:12px;margin-top:12px;">Loss % covers trimming, peeling and yield loss: 0.2 kg at 10% loss uses 0.22 kg of stock. Semi-finished items (sauces) take their cost from Production batches.</p>`,
      `<button class="btn btn-secondary" onclick="closeModal('erp-modal')">Close</button>${ed ? `<button class="btn btn-primary" onclick="ERP.saveRecipe('${jsArg(itemId)}','${jsArg(variant)}')"><i class="fas fa-floppy-disk"></i> Save recipe</button>` : ""}`, true);
    ERP._rcPrice = r.price;
    ERP.rcCalc();
  };
  function recipeRow(l, ed = true) {
    const opts = ERP._mats.slice().sort((a, b) => a.name.localeCompare(b.name)).map(m => `<option value="${esc(m.id)}" ${m.id === l.material_id ? "selected" : ""}>${esc(m.name)} (${esc(m.unit)}) · ${inr(m.rate)}</option>`).join("");
    const dis = ed ? "" : " disabled";
    return `<div class="rc-row"><select class="select rc-mat" onchange="ERP.rcCalc()"${dis}><option value="">Choose…</option>${opts}</select>
      <input class="input rc-qty" type="number" step="any" min="0" value="${l.qty == null ? "" : l.qty}" oninput="ERP.rcCalc()"${dis}>
      <input class="input rc-loss" type="number" step="any" min="0" max="90" value="${l.loss_pct == null ? "" : l.loss_pct}" oninput="ERP.rcCalc()"${dis}>
      <span class="rc-cost text-right">—</span>${ed ? `<button class="btn btn-icon btn-sm btn-danger-soft" type="button" onclick="this.parentElement.remove(); ERP.rcCalc();" aria-label="Remove"><i class="fas fa-xmark"></i></button>` : "<span></span>"}</div>`;
  }
  ERP._row = () => recipeRow({});
  ERP.rcCalc = () => {
    let tot = 0;
    document.querySelectorAll("#rc-rows .rc-row").forEach(row => {
      const m = ERP._mats.find(x => x.id === row.querySelector(".rc-mat").value);
      const c = m ? (parseFloat(row.querySelector(".rc-qty").value) || 0) * (1 + (parseFloat(row.querySelector(".rc-loss").value) || 0) / 100) * m.rate : 0;
      tot += c;
      row.querySelector(".rc-cost").textContent = m ? inr(c) : "—";
    });
    $("rc-cost").textContent = inr(tot);
    const p = ERP._rcPrice ? tot / ERP._rcPrice * 100 : 0;
    $("rc-pct").textContent = pct(p);
    $("rc-pct").style.color = p > (ERP.rules.target_food_cost || 100) ? "var(--danger)" : "var(--success-700)";
  };
  ERP.saveRecipe = async (itemId, variant) => {
    const ingredients = [...document.querySelectorAll("#rc-rows .rc-row")].map(row => ({ material_id: row.querySelector(".rc-mat").value,
      qty: parseFloat(row.querySelector(".rc-qty").value) || 0, loss_pct: parseFloat(row.querySelector(".rc-loss").value) || 0 })).filter(x => x.material_id && x.qty > 0);
    try { await api("/api/bom", { method: "POST", body: { item_id: itemId, variant, ingredients } }); closeModal("erp-modal"); window.showToast("Recipe saved.", "success"); ERP.costing(); }
    catch (e) { window.showToast(e.message, "error"); }
  };

  /* ═══════════════════════ STOCK COUNTS & TRANSFERS ═══════════════════════ */
  ERP.counts = async () => {
    const sec = "sec-counts"; loading(sec);
    try {
      await ERP.loadRules();
      const d = await api("/api/erp/stock");
      const mats = d.materials.slice().sort((a, b) => a.name.localeCompare(b.name));
      const sc = can("stockCount");
      $(sec).innerHTML = header("Stock counts &amp; transfers", "Main store and kitchen / bar held separately, physical counts that post variance to the P&amp;L, and use-by alerts.") +
        kpis([
          { icon: "fa-boxes-stacked", label: "Stock value", value: inr(d.stock_value) },
          { icon: "fa-cart-flatbed", label: "At or below reorder", value: mats.filter(m => m.low).length, fg: "#b45309", bg: "#fef3c7" },
          { icon: "fa-hourglass-half", label: `Use-by within ${d.expiry_alert_days} days`, value: mats.filter(m => m.expiring).length, fg: "#c95b5b", bg: "#f9e6e6" },
          { icon: "fa-scale-unbalanced", label: "Count variance today", value: inr(d.variance_today), fg: "#8e6bbf", bg: "#efe9f7" },
        ]) +
        card("Stock by location", "fa-warehouse", table(["Material", ">Main store", ">Kitchen / bar", ">Total", "Status", "Use by", ">Physical count"], mats.map(m => `<tr>${td("Material", esc(m.name), "strong")}
            ${td("Main store", q3(m.store), "text-right")}${td("Kitchen / bar", q3(m.kitchen), "text-right")}${td("Total", `<b>${q3(m.stock)}</b> ${esc(m.unit)}`, "text-right nowrap")}
            ${td("Status", m.low ? badge("Reorder", "warning") : badge("OK", "success"))}
            ${td("Use by", m.expires_on ? (m.expired ? badge("Expired " + m.expires_on, "danger") : m.expiring ? badge(m.expires_on, "danger") : esc(m.expires_on)) : '<span class="muted">—</span>')}
            ${td("Physical count", `<input class="input" type="number" step="any" min="0" style="max-width:110px;" data-count="${esc(m.id)}" placeholder="${q3(m.stock)}"${sc ? "" : " disabled"}>`, "text-right")}</tr>`), "No raw materials yet — add them in BOM & Inventory.") +
          `<div class="card-footer"><span class="muted" style="font-size:12.5px;margin-right:auto;">Enter counted quantities for any rows; the difference posts as variance.</span><button class="btn btn-primary" onclick="ERP.postCount()"${lockAttr("stockCount")}><i class="fas fa-clipboard-check"></i> Post stock count</button></div>`, "", true) +
        `<div class="grid-2-even">` +
        card("Issue from main store to kitchen / bar", "fa-right-left", `<div class="form-grid">
            <div class="field"><label>Material</label><select class="select" id="is-mat">${matOptions(mats)}</select></div>
            <div class="field"><label>Quantity</label><input class="input" type="number" step="any" min="0" id="is-qty" value="1"></div>
            <div class="field"><label>Direction</label><select class="select" id="is-dir"><option value="issue">Main store → kitchen / bar</option><option value="return">Kitchen / bar → main store</option></select></div></div>
            <div class="form-actions"><button class="btn btn-primary" onclick="ERP.issue()"${lockAttr("stockCount")}><i class="fas fa-arrow-right-arrow-left"></i> Move stock</button></div>` +
          table(["No.", "Material", ">Qty", "Route", "When"], d.transfers.slice(0, 10).map(t => `<tr>${td("No.", esc(t.no), "mono")}${td("Material", esc(t.name))}${td("Qty", `${q3(t.qty)} ${esc(t.unit)}`, "text-right")}${td("Route", `${esc(t.from)} → ${esc(t.to)}`)}${td("When", formatDateTime(t.timestamp), "muted nowrap")}</tr>`), "No transfers yet.")) +
        card("Variance history", "fa-chart-simple", table(["Count", "Material", ">System", ">Counted", ">Value"], d.variances.slice(0, 20).map(v => `<tr>${td("Count", esc(v.no), "mono")}${td("Material", esc(v.name))}${td("System", q3(v.system), "text-right")}${td("Counted", q3(v.counted), "text-right")}
            ${td("Value", v.value < 0 ? badge(inr(v.value), "danger") : badge(inr(v.value), "success"), "text-right")}</tr>`), "No counts posted yet.") +
          `<p class="muted" style="font-size:12px;margin-top:10px;">Negative variance on kegs or cheese usually means over-pouring or over-portioning.</p>`) +
        `</div>` + rulesCard([["expiry_alert_days", "Use-by alert (days before)", "number", "Shelf life per material is set in BOM & Inventory."]], "Stock rules");
    } catch (e) { failed(sec, e); }
  };
  ERP.postCount = async () => {
    const counts = [...document.querySelectorAll("[data-count]")].filter(i => i.value !== "").map(i => ({ material_id: i.dataset.count, counted: parseFloat(i.value) }));
    if (!counts.length) { window.showToast("Enter at least one counted quantity.", "warning"); return; }
    if (!confirm(`Post a stock count for ${counts.length} material(s)? Stock will be set to the counted figures.`)) return;
    try { const r = await api("/api/erp/stock", { method: "POST", body: { action: "count", counts } }); window.showToast(`${r.no} posted · variance ${inr(r.variance)}`, r.variance < 0 ? "warning" : "success"); ERP.counts(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.issue = async () => {
    try { const r = await api("/api/erp/stock", { method: "POST", body: { action: "issue", material_id: $("is-mat").value, qty: parseFloat($("is-qty").value), direction: $("is-dir").value } }); window.showToast(`${r.no} recorded.`, "success"); ERP.counts(); }
    catch (e) { window.showToast(e.message, "error"); }
  };

  /* ═══════════════════════ WASTAGE ═══════════════════════ */
  ERP.wastage = async () => {
    const sec = "sec-wastage"; loading(sec);
    try {
      await ERP.loadRules();
      const [d, st] = await Promise.all([api(`/api/erp/wastage?days=${ERP.state.wasteDays}`), api("/api/erp/stock")]);
      const mats = st.materials;
      $(sec).innerHTML = header("Wastage", `Log what was thrown away and why. Entries above ${inr(d.limit)} wait for someone with “Approve wastage” before stock is written off. Reused leftovers are tracked separately.`,
          seg("wasteDays", [[1, "Today"], [7, "7 days"], [30, "30 days"]], ERP.state.wasteDays)) +
        `<div class="grid-2-even">` +
        card("Log wastage", "fa-trash-can", `<div class="form-grid">
            <div class="field"><label>Material</label><select class="select" id="w-mat">${matOptions(mats)}</select></div>
            <div class="field"><label>Quantity</label><input class="input" type="number" step="any" min="0" id="w-qty" value="0.5"></div>
            <div class="field"><label>Reason</label><select class="select" id="w-reason">${d.reasons.map(r => `<option>${esc(r)}</option>`).join("")}</select></div>
            <div class="field"><label>Note</label><input class="input" id="w-note" maxlength="120" placeholder="optional"></div></div>
            <div class="form-actions"><button class="btn btn-primary" onclick="ERP.logWaste()"><i class="fas fa-plus"></i> Log wastage</button></div>`) +
        card(`Wastage by reason · ${inr(d.total)}`, "fa-chart-bar", bars(d.by_reason, "var(--danger)") + `<p class="muted" style="font-size:12.5px;margin-top:10px;">${pct(d.pct_of_sales)} of sales in this period.</p>`) +
        `</div>` +
        card("Wastage log", "fa-list", table(["No.", "When", "Material", ">Qty", "Reason", ">Value", "By", "Status", ">"], d.entries.slice(0, 80).map(w => `<tr>${td("No.", esc(w.no), "mono")}${td("When", formatDateTime(w.timestamp), "muted nowrap")}${td("Material", esc(w.name), "strong")}
            ${td("Qty", `${q3(w.qty)} ${esc(w.unit)}`, "text-right")}${td("Reason", esc(w.reason) + (w.note ? `<br><small class="muted">${esc(w.note)}</small>` : ""))}${td("Value", inr(w.value), "text-right amount")}${td("By", esc(w.by))}
            ${td("Status", badge(w.status, w.status === "Approved" ? "success" : w.status === "Rejected" ? "danger" : "warning"))}
            <td class="actions">${w.status === "Pending approval" ? `<button class="btn btn-success btn-sm" onclick="ERP.approveWaste('${jsArg(w.no)}', true)"${lockAttr("approveWaste")}>Approve</button><button class="btn btn-danger-soft btn-sm" onclick="ERP.approveWaste('${jsArg(w.no)}', false)"${lockAttr("approveWaste")}>Reject</button>` : ""}</td></tr>`), "Nothing logged yet."), "", true) +
        `<div class="grid-2-even">` +
        card("Leftover reuse", "fa-recycle", `<div class="form-grid">
            <div class="field"><label>Material</label><select class="select" id="r-mat">${matOptions(mats)}</select></div>
            <div class="field"><label>Quantity</label><input class="input" type="number" step="any" min="0" id="r-qty" value="0.5"></div>
            <div class="field"><label>Reused as</label><input class="input" id="r-to" list="r-to-list" placeholder="Staff meal"><datalist id="r-to-list"><option>Staff meal</option><option>Soup of the day</option><option>Kathi filling</option></datalist></div></div>
            <div class="form-actions"><button class="btn btn-secondary" onclick="ERP.reuse()"><i class="fas fa-recycle"></i> Record reuse</button></div>` +
          table(["When", "Material", ">Qty", "Used for", ">Recovered"], d.reuse.slice(0, 10).map(r => `<tr>${td("When", formatDateTime(r.timestamp), "muted nowrap")}${td("Material", esc(r.name))}${td("Qty", `${q3(r.qty)} ${esc(r.unit)}`, "text-right")}${td("Used for", esc(r.used_for))}${td("Recovered", inr(r.value), "text-right")}</tr>`), "Reuse leaves stock without counting as waste.")) +
        rulesCard([["waste_limit", "Approval needed above (₹)", "number"], ["waste_reasons", "Reasons (one per line)", "list"]], "Wastage rules") +
        `</div>`;
    } catch (e) { failed(sec, e); }
  };
  ERP.logWaste = async () => {
    try {
      const r = await api("/api/erp/wastage", { method: "POST", body: { action: "log", material_id: $("w-mat").value, qty: parseFloat($("w-qty").value), reason: $("w-reason").value, note: $("w-note").value } });
      window.showToast(r.pending ? `${r.no} is above the limit — sent for approval.` : `${r.no} written off.`, r.pending ? "warning" : "success"); ERP.wastage(); ERP.badges();
    } catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.approveWaste = async (no, ok) => {
    try { await api("/api/erp/wastage", { method: "POST", body: { action: ok ? "approve" : "reject", no } }); window.showToast(ok ? "Approved and written off." : "Rejected.", "info"); ERP.wastage(); ERP.badges(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.reuse = async () => {
    try { await api("/api/erp/wastage", { method: "POST", body: { action: "reuse", material_id: $("r-mat").value, qty: parseFloat($("r-qty").value), used_for: $("r-to").value } }); window.showToast("Reuse recorded.", "success"); ERP.wastage(); }
    catch (e) { window.showToast(e.message, "error"); }
  };

  /* ═══════════════════════ PRODUCTION & LABELS ═══════════════════════ */
  ERP.production = async () => {
    const sec = "sec-production"; loading(sec);
    try {
      await ERP.loadRules();
      const [d, st] = await Promise.all([api("/api/erp/production"), api("/api/erp/stock")]);
      ERP._prod = d; ERP._mats = st.materials;
      const sel = ERP.state.prodItem && d.semi.find(s => s.material.id === ERP.state.prodItem) ? ERP.state.prodItem : (d.semi[0] && d.semi[0].material.id);
      ERP.state.prodItem = sel;
      const cur = d.semi.find(s => s.material.id === sel);
      const others = d.outlets.filter(o => o.id !== d.current_outlet);
      const planned = ERP.state.prodPlanned || 2;
      const req = cur ? cur.ingredients.map(l => {
        const m = st.materials.find(x => x.id === l.material_id) || { stock: 0 };
        const need = l.qty * (1 + l.loss_pct / 100) * planned;
        return `<tr>${td("Raw material", esc(l.name))}${td("Required", `${q3(need)} ${esc(l.unit)}`, "text-right")}${td("Available", q3(m.stock), "text-right")}${td("", m.stock >= need ? badge("OK", "success") : badge("Short", "danger"))}</tr>`;
      }) : [];
      $(sec).innerHTML = header("Production &amp; labels", "Make sauces and other semi-finished items in batches with actual yield, print use-by labels, send stock to another outlet on a challan, and plan tomorrow's prep.") +
        (!d.semi.length ? `<div class="notice"><i class="fas fa-circle-info"></i><div>Add a raw material with category <b>Semi-finished</b> (e.g. “Caesar dressing, L”) in BOM &amp; Inventory to start producing it here. You can then use it in menu recipes like any other ingredient.</div></div>` : "") +
        (d.semi.length ? `<div class="grid-2">` +
          card("Batch", "fa-blender", `<div class="form-grid">
              <div class="field"><label>Item</label><select class="select" onchange="ERP.state.prodItem=this.value; ERP.production()">${d.semi.map(s => `<option value="${esc(s.material.id)}" ${s.material.id === sel ? "selected" : ""}>${esc(s.material.name)}</option>`).join("")}</select></div>
              <div class="field"><label>Planned (${esc(cur.material.unit)})</label><input class="input" type="number" step="any" min="0" id="b-plan" value="${planned}" onchange="ERP.state.prodPlanned=parseFloat(this.value)||1; ERP.production()"></div>
              <div class="field"><label>Actual yield (${esc(cur.material.unit)})</label><input class="input" type="number" step="any" min="0" id="b-act" value="${round2(planned * 0.95)}"></div></div>` +
            (cur.ingredients.length ? `<div style="margin-top:12px;">${table(["Raw material", ">Required", ">Available", ""], req)}</div>` : `<p class="notice warn" style="margin-top:12px;"><i class="fas fa-circle-info"></i> No recipe yet — set the ingredients per 1 ${esc(cur.material.unit)} on the right.</p>`) +
            `<div class="form-actions"><button class="btn btn-primary" onclick="ERP.produce()" ${cur.ingredients.length ? "" : "disabled"}><i class="fas fa-play"></i> Produce batch</button></div>`) +
          card(`Recipe · per 1 ${esc(cur.material.unit)} of ${esc(cur.material.name)}`, "fa-flask", `<div class="cost-kpis"><div><b>${inr(cur.cost_per_unit)}</b><span>Cost per ${esc(cur.material.unit)}</span></div><div><b>${inr(cur.material.cost_per_unit)}</b><span>Current stock cost</span></div></div>
              <div class="rc-head"><span>Ingredient</span><span>Qty</span><span>Loss %</span><span class="text-right">Cost</span><span></span></div>
              <div id="rc-rows">${(cur.ingredients.length ? cur.ingredients : [{}]).map(l => recipeRow(l, can("editRecipe"))).join("")}</div>
              ${can("editRecipe") ? `<button class="btn btn-secondary btn-sm" type="button" onclick="document.getElementById('rc-rows').insertAdjacentHTML('beforeend', ERP._row()); ERP.rcCalc();"><i class="fas fa-plus"></i> Ingredient</button>` : ""}
              <span id="rc-cost" class="hidden"></span><span id="rc-pct" class="hidden"></span>`) +
          `</div>` +
          (can("editRecipe") ? `<div class="form-actions" style="margin-top:-8px;margin-bottom:20px;"><button class="btn btn-primary" onclick="ERP.saveProdRecipe('${jsArg(cur.material.id)}')"><i class="fas fa-floppy-disk"></i> Save production recipe</button></div>` : "") : "") +
        card("Batches", "fa-boxes-packing", table(["Batch", "When", "Item", ">Planned", ">Actual", ">Yield", ">Cost / unit", "Use by", ">"], d.batches.slice(0, 30).map(b => `<tr>${td("Batch", esc(b.no), "mono strong")}${td("When", formatDateTime(b.timestamp), "muted nowrap")}${td("Item", esc(b.name))}
            ${td("Planned", `${q3(b.planned)} ${esc(b.unit)}`, "text-right")}${td("Actual", `${q3(b.actual)} ${esc(b.unit)}`, "text-right")}
            ${td("Yield", b.yield_pct < 100 - (d.tolerance || 5) ? badge(b.yield_pct + "%", "warning") : badge(b.yield_pct + "%", "success"), "text-right")}${td("Cost / unit", inr(b.cost_per_unit), "text-right")}${td("Use by", esc(b.use_by || "—"))}
            <td class="actions"><button class="btn btn-secondary btn-sm" onclick="ERP.printLabel('${jsArg(b.no)}')"><i class="fas fa-tag"></i> Label</button></td></tr>`), "No batches yet."), "", true) +
        `<div class="grid-2-even">` +
        card("Dispatch to another outlet", "fa-truck", others.length ? `<div class="form-grid">
            <div class="field"><label>Material</label><select class="select" id="dc-mat">${matOptions(st.materials)}</select></div>
            <div class="field"><label>Quantity</label><input class="input" type="number" step="any" min="0" id="dc-qty" value="1"></div>
            <div class="field"><label>To outlet</label><select class="select" id="dc-to">${others.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("")}</select></div></div>
            <div class="form-actions"><button class="btn btn-primary" onclick="ERP.dispatch()"${lockAttr("stockCount")}><i class="fas fa-file-export"></i> Create challan</button></div>` +
            table(["Challan", "Material", ">Qty", "To", "Status", ">"], d.dispatches.slice(0, 10).map(x => `<tr>${td("Challan", esc(x.no), "mono")}${td("Material", esc(x.name))}${td("Qty", `${q3(x.qty)} ${esc(x.unit)}`, "text-right")}${td("To", esc(x.to_name))}
              ${td("Status", badge(x.status, x.status === "Received" ? "success" : "warning"))}<td class="actions">${x.status === "In transit" ? `<button class="btn btn-secondary btn-sm" onclick="ERP.recvDC('${jsArg(x.no)}')">Mark received</button>` : ""}</td></tr>`), "No challans yet.")
          : '<p class="muted" style="font-size:13px;">Add another outlet (Administration → Outlets) to send stock from a central kitchen.</p>') +
        card("Tomorrow's prep list", "fa-clipboard-list", table(["Station", "Item", ">Portions"], d.prep.map(p => `<tr>${td("Station", esc(p.station))}${td("Item", `${esc(p.name)} <small class="muted">${esc(p.variant)}</small>`)}${td("Portions", p.portions, "text-right amount")}</tr>`), "Prep suggestions appear once there are sales."), "Last 7 days' daily average × 1.2", true) +
        `</div>`;
      if (cur) { ERP._rcPrice = 0; ERP.rcCalc(); }
    } catch (e) { failed(sec, e); }
  };
  ERP.saveProdRecipe = async (mid) => {
    const ingredients = [...document.querySelectorAll("#rc-rows .rc-row")].map(row => ({ material_id: row.querySelector(".rc-mat").value,
      qty: parseFloat(row.querySelector(".rc-qty").value) || 0, loss_pct: parseFloat(row.querySelector(".rc-loss").value) || 0 })).filter(x => x.material_id && x.qty > 0);
    try { await api("/api/erp/production", { method: "POST", body: { action: "recipe", material_id: mid, ingredients } }); window.showToast("Production recipe saved.", "success"); ERP.production(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.produce = async () => {
    try {
      const r = await api("/api/erp/production", { method: "POST", body: { action: "produce", material_id: ERP.state.prodItem, planned: parseFloat($("b-plan").value), actual: parseFloat($("b-act").value) } });
      window.showToast(`${r.batch.no}: ${r.batch.actual} ${r.batch.unit} made (yield ${r.batch.yield_pct}%).`, "success");
      await ERP.production(); ERP.printLabel(r.batch.no);
    } catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.printLabel = (no) => {
    const b = ERP._prod.batches.find(x => x.no === no);
    if (!b) return;
    const w = window.open("", "_blank");
    if (!w) { window.showToast("Allow pop-ups to print the label.", "warning"); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.no)}</title><style>
      body{font-family:Arial,sans-serif;margin:0;padding:10px} .l{width:62mm;border:2px solid #000;padding:8px 10px;border-radius:6px}
      h1{font-size:16px;margin:0 0 4px;text-transform:uppercase} p{margin:2px 0;font-size:12px} b{font-size:13px} @page{size:auto;margin:6mm}
    </style></head><body><div class="l"><h1>${esc(b.name)}</h1><p><b>${esc(b.no)}</b> · ${esc(q3(b.actual))} ${esc(b.unit)}</p>
      <p>Made: ${esc(formatDateTime(b.timestamp))}</p><p><b>Use by: ${esc(b.use_by || "—")}</b></p><p>Made by: ${esc(b.by)}</p><p>Store chilled ≤ 5°C unless stated</p>
      </div><script>window.onload=function(){window.print();}<\/script></body></html>`);
    w.document.close();
  };
  ERP.dispatch = async () => {
    try { const r = await api("/api/erp/production", { method: "POST", body: { action: "dispatch", material_id: $("dc-mat").value, qty: parseFloat($("dc-qty").value), outlet_id: $("dc-to").value } }); window.showToast(`Challan ${r.no} created.`, "success"); ERP.production(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.recvDC = async (no) => {
    try { await api("/api/erp/production", { method: "POST", body: { action: "receive_dispatch", no } }); window.showToast("Marked received.", "success"); ERP.production(); }
    catch (e) { window.showToast(e.message, "error"); }
  };

  /* ═══════════════════════ PURCHASING: scorecard & rules ═══════════════════════ */
  ERP.scorecard = async () => {
    const el = $("vendor-scorecard");
    el.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i></div>';
    try {
      const d = await api("/api/erp/vendors");
      el.innerHTML = card("Vendor scorecard", "fa-star-half-stroke", table(["Supplier", ">POs", ">Deliveries", ">On time", ">Lines rejected", ">Rate alerts", ">Received value"], d.map(v => `<tr>${td("Supplier", esc(v.supplier), "strong")}${td("POs", v.pos, "text-right")}${td("Deliveries", v.receipts, "text-right")}
          ${td("On time", v.on_time_pct == null ? "—" : badge(v.on_time_pct + "%", v.on_time_pct >= 90 ? "success" : v.on_time_pct >= 70 ? "warning" : "danger"), "text-right")}
          ${td("Lines rejected", `${v.rejected}${v.reject_pct ? ` <small class="muted">(${v.reject_pct}%)</small>` : ""}`, "text-right")}${td("Rate alerts", v.rate_alerts ? badge(v.rate_alerts, "warning") : 0, "text-right")}${td("Received value", inr(v.value), "text-right amount")}</tr>`), "No suppliers yet."), "From goods receipts with quality checks", true);
    } catch (e) { el.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; }
  };
  ERP.poRules = async () => {
    await ERP.loadRules();
    $("po-rules").innerHTML = rulesCard([["po_limit", "PO needs approval above (₹)", "number", "Raised by a role without “Approve purchase orders”."], ["rate_variance_pct", "Flag invoice rate above PO rate by (%)", "number"],
      ["qty_tolerance_pct", "Accept over-delivery up to (%)", "number"]], "Approval & QC rules", "At receipt each line is checked for temperature and quality; failed lines are rejected and not added to stock. The invoice rate re-costs every recipe using that item.");
  };

  /* ═══════════════════════ PERMISSIONS & LIMITS ═══════════════════════ */
  ERP.perms = async () => {
    const sec = "sec-perms"; loading(sec);
    try {
      await ERP.loadRules();
      const [d, log] = await Promise.all([api("/api/erp/permissions"), api("/api/audit-log").catch(() => [])]);
      const roles = ["Admin", "Owner", "Receptionist", "Waiter", "Kitchen"];
      const ed = currentRole() === "Admin";
      const recent = (log || []).filter(a => /approv|reject|permission|discount|void|closed table/i.test(a.action)).slice(0, 12);
      $(sec).innerHTML = header("Permissions &amp; limits", "Switch individual actions on or off for each role, and set value limits. The server enforces these on every request.") +
        card("Action permissions by role", "fa-user-shield", `<table class="table perm-table"><thead><tr><th>Action</th>${roles.map(r => `<th class="text-right">${r}</th>`).join("")}</tr></thead><tbody>
          ${Object.entries(d.labels).map(([p, l]) => `<tr><td class="strong">${esc(l)}</td>${roles.map(r => `<td class="text-right"><label class="switch"><input type="checkbox" ${d.roles[r] && d.roles[r][p] ? "checked" : ""} ${r === "Admin" || !ed ? "disabled" : ""} onchange="ERP.setPerm('${r}','${p}',this.checked)" aria-label="${esc(r)}: ${esc(l)}"><span class="slider"></span></label></td>`).join("")}</tr>`).join("")}
          </tbody></table>`, ed ? "Admin always has every permission" : "Only an Admin can change these", true) +
        `<div class="grid-2-even">` +
        rulesCard([["po_limit", "PO approval above (₹)", "number"], ["waste_limit", "Wastage approval above (₹)", "number"], ["max_discount_pct", "Max discount without a manager (%)", "number", "Larger discounts need Admin or Owner."]], "Value limits") +
        card("Recent approvals &amp; sensitive actions", "fa-clock-rotate-left", table(["When", "User", "Action"], recent.map(a => `<tr>${td("When", formatDateTime(a.timestamp), "muted nowrap")}${td("User", esc(a.user), "strong")}${td("Action", esc(a.action))}</tr>`), "Approvals, discounts and voids appear here and in the Audit Log."), "", true) +
        `</div>`;
    } catch (e) { failed(sec, e); }
  };
  ERP.setPerm = async (role, perm, value) => {
    try { await api("/api/erp/permissions", { method: "POST", body: { role, perm, value } }); window.showToast(`${role}: permission ${value ? "granted" : "removed"}.`, "success"); }
    catch (e) { window.showToast(e.message, "error"); ERP.perms(); }
  };

  /* ═══════════════════════ FOOD SAFETY ═══════════════════════ */
  ERP.safety = async () => {
    const sec = "sec-safety"; loading(sec);
    try {
      await ERP.loadRules();
      const d = await api("/api/erp/safety");
      const mgr = ["Admin", "Owner"].includes(currentRole());
      const lim = l => [l.min != null ? `≥ ${l.min}°C` : "", l.max != null ? `≤ ${l.max}°C` : ""].filter(Boolean).join(" and ");
      const done = d.checklist.filter(c => c.done).length;
      $(sec).innerHTML = header("Food safety", "HACCP temperature logs with pass/fail limits, a daily opening checklist, and reminders for licences including the excise bar licence.") +
        (d.alerts ? `<div class="notice warn"><i class="fas fa-triangle-exclamation"></i><div><b>${d.alerts} alert(s):</b> failed temperature readings today or licences expiring within 15 days.</div></div>` : "") +
        `<div class="grid-2-even">` +
        card("Temperature log", "fa-temperature-half", `<div class="form-grid">
            <div class="field"><label>Equipment</label><select class="select" id="t-eq">${d.limits.map(l => `<option>${esc(l.name)}</option>`).join("")}</select></div>
            <div class="field"><label>Reading (°C)</label><input class="input" type="number" step="0.1" id="t-val" value="4"></div></div>
            <div class="form-actions"><button class="btn btn-primary" onclick="ERP.logTemp()"><i class="fas fa-plus"></i> Log reading</button></div>
            <p class="muted" style="font-size:12px;">Limits: ${d.limits.map(l => `${esc(l.name)} ${lim(l)}`).join(" · ")}</p>` +
          table(["When", "Equipment", ">Reading", "Result", "Source"], d.temps.slice(0, 15).map(t => `<tr>${td("When", formatDateTime(t.timestamp), "muted nowrap")}${td("Equipment", esc(t.equipment))}${td("Reading", t.value + "°C", "text-right")}${td("Result", t.ok ? badge("Pass", "success") : badge("Fail", "danger"))}${td("Source", esc(t.source))}</tr>`), "No readings yet today.")) +
        card(`Opening checklist · ${done}/${d.checklist.length}`, "fa-list-check", d.checklist.map(c => `<div class="switch-row"><div><div class="t">${esc(c.item)}</div>${c.done ? `<div class="d">${esc(c.done.by)} · ${formatTime(c.done.timestamp)}</div>` : ""}</div>
            <label class="switch"><input type="checkbox" ${c.done ? "checked" : ""} onchange="ERP.check(${c.index}, this.checked)"><span class="slider"></span></label></div>`).join(""), "Resets every day") +
        `</div>` +
        card("Licences and contracts", "fa-file-shield", table(["Document", "Expires on", "Status", ">"], d.licences.map(l => `<tr>${td("Document", esc(l.name), "strong")}
            ${td("Expires on", mgr ? `<input class="input" type="date" style="max-width:170px;" value="${esc(l.expires_on || "")}" onchange="ERP.licence('${jsArg(l.id)}','${jsArg(l.name)}',this.value)">` : esc(l.expires_on || "—"))}
            ${td("Status", l.days_left == null ? '<span class="muted">Add a date</span>' : l.days_left < 0 ? badge("Expired", "danger") : l.days_left <= 15 ? badge(l.days_left + " days left", "danger") : l.days_left <= 60 ? badge(l.days_left + " days left", "warning") : badge(l.days_left + " days left", "success"))}
            <td class="actions">${mgr ? `<button class="btn btn-ghost btn-sm" onclick="if(confirm('Remove ${jsArg(l.name)}?')) ERP.licenceDel('${jsArg(l.id)}')" aria-label="Remove"><i class="fas fa-trash"></i></button>` : ""}</td></tr>`)) +
          (mgr ? `<div class="card-footer"><input class="input" id="lic-name" placeholder="New document, e.g. Music licence (PPL)" style="max-width:320px;"><input class="input" type="date" id="lic-date" style="max-width:170px;"><button class="btn btn-secondary" onclick="ERP.licence('', document.getElementById('lic-name').value, document.getElementById('lic-date').value)"><i class="fas fa-plus"></i> Add</button></div>` : ""), "Alerts 15 days before expiry", true) +
        `<div class="grid-2-even">` +
        limitsEditor(d.limits) +
        rulesCard([["checklist_items", "Opening checklist items (one per line)", "list"]], "Checklist rules") +
        `</div>` +
        integrationCard("sensor", "Temperature sensors (IoT)", `{"equipment": "Walk-in chiller", "value": 3.8}`, "Wi-Fi temperature sensors can post readings automatically. Failed readings raise an alert in the Audit Log.");
    } catch (e) { failed(sec, e); }
  };
  function limitsEditor(limits) {
    const ed = can("editSettings");
    return card("Temperature limits", "fa-sliders", `<div class="lim-head"><span>Equipment</span><span>Min °C</span><span>Max °C</span><span></span></div><div id="lim-rows">${limits.map(l => limRow(l, ed)).join("")}</div>
      ${ed ? `<div class="form-actions" style="justify-content:space-between;"><button class="btn btn-secondary btn-sm" type="button" onclick="document.getElementById('lim-rows').insertAdjacentHTML('beforeend', ERP._limRow())"><i class="fas fa-plus"></i> Equipment</button>
      <button class="btn btn-primary" type="button" onclick="ERP.saveLimits()"><i class="fas fa-floppy-disk"></i> Save limits</button></div>` : ""}`, ed ? "Chillers ≤ 5°C, freezer ≤ −18°C, hot holding ≥ 63°C" : "");
  }
  function limRow(l, ed = true) {
    const dis = ed ? "" : " disabled";
    return `<div class="lim-row"><input class="input lm-n" value="${esc(l.name || "")}" placeholder="e.g. Ice-cream freezer"${dis}><input class="input lm-min" type="number" step="0.1" value="${l.min == null ? "" : l.min}"${dis}><input class="input lm-max" type="number" step="0.1" value="${l.max == null ? "" : l.max}"${dis}>${ed ? `<button class="btn btn-icon btn-sm btn-danger-soft" type="button" onclick="this.parentElement.remove()" aria-label="Remove"><i class="fas fa-xmark"></i></button>` : "<span></span>"}</div>`;
  }
  ERP._limRow = () => limRow({});
  ERP.saveLimits = async () => {
    const temp_limits = [...document.querySelectorAll("#lim-rows .lim-row")].map(r => ({ name: r.querySelector(".lm-n").value.trim(), min: r.querySelector(".lm-min").value, max: r.querySelector(".lm-max").value })).filter(x => x.name);
    try { await api("/api/erp/rules", { method: "POST", body: { temp_limits } }); await ERP.loadRules(); window.showToast("Limits saved.", "success"); ERP.safety(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.logTemp = async () => {
    try { const r = await api("/api/erp/safety", { method: "POST", body: { action: "temp", equipment: $("t-eq").value, value: parseFloat($("t-val").value) } }); window.showToast(r.pass ? "Reading logged — pass." : "OUT OF LIMIT — logged and the manager alerted in the Audit Log.", r.pass ? "success" : "error"); ERP.safety(); ERP.badges(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.check = async (index, done) => { try { await api("/api/erp/safety", { method: "POST", body: { action: "check", index, done } }); ERP.safety(); } catch (e) { window.showToast(e.message, "error"); } };
  ERP.licence = async (id, name, expires_on) => {
    if (!name || !name.trim()) { window.showToast("Enter the document name.", "warning"); return; }
    try { await api("/api/erp/safety", { method: "POST", body: { action: "licence", id, name, expires_on } }); window.showToast("Saved.", "success"); ERP.safety(); ERP.badges(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.licenceDel = async (id) => { try { await api("/api/erp/safety", { method: "POST", body: { action: "licence_delete", id } }); ERP.safety(); } catch (e) { window.showToast(e.message, "error"); } };

  /* ═══════════════════════ STAFF & SHIFTS ═══════════════════════ */
  ERP.staff = async () => {
    const sec = "sec-staff"; loading(sec);
    try {
      await ERP.loadRules();
      const date = ERP.state.staffDate || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const d = await api(`/api/erp/staff?date=${date}`);
      ERP._staff = d.staff;
      const mgr = ["Admin", "Owner"].includes(currentRole());
      const isToday = date === new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      $(sec).innerHTML = header("Staff &amp; shifts", "Daily roster, clock-in and clock-out, and labour cost against sales.",
          `<input class="input" type="date" value="${date}" style="width:auto;" onchange="ERP.state.staffDate=this.value; ERP.staff()">${mgr ? `<button class="btn btn-primary" onclick="ERP.staffForm()"><i class="fas fa-user-plus"></i> Add staff</button>` : ""}`) +
        kpis([
          { icon: "fa-user-check", label: "Clocked in now", value: `${d.staff.filter(s => s.clocked_in).length} / ${d.staff.length}`, fg: "#4f9d69", bg: "#e4f3e9" },
          { icon: "fa-indian-rupee-sign", label: "Labour cost", value: inr(d.labour), fg: "#3f7cac", bg: "#e3eef7" },
          { icon: "fa-percent", label: "Labour % of sales", value: isToday ? pct(d.labour_pct) : "—", color: d.labour_pct > 30 ? "var(--danger)" : "", fg: "#d97e4a", bg: "#fbeee5" },
        ]) +
        card("Roster", "fa-calendar-day", table(["Name", "Role", "Shift", ">Rate / hr", "Status", ">Hours", ">Cost", ">"], d.staff.map(s => `<tr>${td("Name", esc(s.name), "strong")}${td("Role", esc(s.title || "—"))}
            ${td("Shift", `<select class="select" style="max-width:140px;" onchange="ERP.shift('${jsArg(s.id)}', this.value)">${["Morning", "Evening", "Full day", "Off"].map(o => `<option ${s.shift === o ? "selected" : ""}>${o}</option>`).join("")}</select>`)}
            ${td("Rate", inr(s.rate), "text-right")}${td("Status", s.clocked_in ? badge("In", "success") : badge("Out"))}${td("Hours", s.hours, "text-right")}${td("Cost", inr(s.cost), "text-right")}
            <td class="actions">${isToday ? `<button class="btn ${s.clocked_in ? "btn-secondary" : "btn-success"} btn-sm" onclick="ERP.clock('${jsArg(s.id)}')">${s.clocked_in ? "Clock out" : "Clock in"}</button>` : ""}
              ${mgr ? `<button class="btn btn-ghost btn-sm" onclick="ERP.staffForm('${jsArg(s.id)}')" aria-label="Edit"><i class="fas fa-pen"></i></button>` : ""}</td></tr>`), "No staff yet. Add your team to plan shifts and track labour cost."), "", true) +
        `<div class="grid-2-even">` +
        card("Attendance", "fa-clock", table(["Name", "In", "Out", "Source"], d.attendance.map(a => `<tr>${td("Name", esc(a.name), "strong")}${td("In", formatDateTime(a.in), "nowrap")}${td("Out", a.out ? formatDateTime(a.out) : badge("On shift", "success"), "nowrap")}${td("Source", esc(a.source))}</tr>`), "No clock-ins on this day."), "", true) +
        integrationCard("attendance", "Biometric devices &amp; payroll", `{"staff_id": "stf-…", "type": "in"}\n(or {"device_id": "17", "type": "out"})`, "Biometric attendance devices can post punches here. Payroll stays in your HR tool; export hours from this screen.") +
        `</div>`;
    } catch (e) { failed(sec, e); }
  };
  ERP.staffForm = (id) => {
    const s = id ? ERP._staff.find(x => x.id === id) : {};
    modal(id ? `Edit ${esc(s.name)}` : "Add staff member", `<div class="form-grid">
      <div class="field"><label>Name *</label><input class="input" id="sf-name" value="${esc(s.name || "")}" maxlength="50"></div>
      <div class="field"><label>Role / title</label><input class="input" id="sf-title" value="${esc(s.title || "")}" placeholder="e.g. Line cook" maxlength="40"></div>
      <div class="field"><label>Rate per hour (₹)</label><input class="input" type="number" min="0" step="any" id="sf-rate" value="${s.rate || ""}"></div>
      <div class="field"><label>HMS username (optional)</label><input class="input" id="sf-user" value="${esc(s.username || "")}" maxlength="32"></div>
      <div class="field"><label>Biometric device ID (optional)</label><input class="input" id="sf-dev" value="${esc(s.device_id || "")}" maxlength="30"></div></div>`,
      `${id ? `<button class="btn btn-danger-soft" onclick="if(confirm('Remove this staff member?')) ERP.staffSave('${jsArg(id)}', true)">Remove</button>` : ""}<button class="btn btn-secondary" onclick="closeModal('erp-modal')">Cancel</button><button class="btn btn-primary" onclick="ERP.staffSave('${jsArg(id || "")}')"><i class="fas fa-floppy-disk"></i> Save</button>`);
  };
  ERP.staffSave = async (id, del) => {
    const body = del ? { action: "delete", id } : { action: "save", id, name: $("sf-name").value, title: $("sf-title").value, rate: parseFloat($("sf-rate").value) || 0, username: $("sf-user").value, device_id: $("sf-dev").value };
    try { await api("/api/erp/staff", { method: "POST", body }); closeModal("erp-modal"); window.showToast("Saved.", "success"); ERP.staff(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
  ERP.shift = async (sid, shift) => { try { await api(`/api/erp/staff?date=${ERP.state.staffDate || ""}`, { method: "POST", body: { action: "shift", staff_id: sid, shift } }); window.showToast("Shift saved.", "success"); } catch (e) { window.showToast(e.message, "error"); } };
  ERP.clock = async (sid) => { try { const r = await api("/api/erp/staff", { method: "POST", body: { action: "clock", staff_id: sid } }); window.showToast(r.clocked_in ? "Clocked in." : "Clocked out.", "success"); ERP.staff(); } catch (e) { window.showToast(e.message, "error"); } };

  /* ═══════════════════════ OUTLETS ═══════════════════════ */
  ERP.outlets = async () => {
    const sec = "sec-outlets"; loading(sec);
    try {
      const d = await api("/api/erp/outlets");
      ERP._outlets = d;
      const adm = currentRole() === "Admin";
      const base = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}index.html`;
      $(sec).innerHTML = header("Outlets", "Run several outlets and a central kitchen from one login. Each outlet inherits company settings and can override them.",
          adm ? `<button class="btn btn-primary" onclick="ERP.outletForm()"><i class="fas fa-plus"></i> Add outlet</button>` : "") +
        card("Outlet comparison · today", "fa-building", table(["Outlet", "Type", ">Tables", ">Service charge", ">Open tables", ">Bills", ">Sales", ">"], d.outlets.map(o => `<tr>${td("Outlet", esc(o.name) + (o.id === d.current ? " " + badge("You are here", "primary") : ""), "strong")}${td("Type", esc(o.type))}
            ${td("Tables", o.effective.tables_count, "text-right")}${td("Service charge", `${o.effective.service_charge_percent}%${o.overrides && o.overrides.service_charge_percent != null && o.overrides.service_charge_percent !== "" ? "" : ' <small class="muted">(company)</small>'}`, "text-right")}
            ${td("Open tables", o.open_tables, "text-right")}${td("Bills", o.bills_today, "text-right")}${td("Sales", inr(o.sales_today), "text-right amount")}
            <td class="actions">${o.id !== d.current ? `<button class="btn btn-secondary btn-sm" onclick="switchOutlet('${jsArg(o.id)}')">Switch</button>` : ""}${adm ? `<button class="btn btn-ghost btn-sm" onclick="ERP.outletForm('${jsArg(o.id)}')" aria-label="Edit"><i class="fas fa-pen"></i></button>` : ""}</td></tr>`)), "", true) +
        card("Table QR links", "fa-qrcode", `<p class="muted" style="font-size:13px;">Each outlet's table QR codes must include its ID so guests order at the right place:</p>
          ${d.outlets.map(o => `<div class="field" style="margin-top:8px;"><span class="label">${esc(o.name)}</span><code class="code-box">${esc(base)}?${o.id === "main" ? "" : `outlet=${esc(o.id)}&amp;`}table=1</code></div>`).join("")}
          <p class="muted" style="font-size:12px;margin-top:10px;">Stock, recipes and purchasing are shared across outlets (one central store). Send stock between outlets with a challan in Production.</p>`);
    } catch (e) { failed(sec, e); }
  };
  ERP.outletForm = (id) => {
    const o = id ? ERP._outlets.outlets.find(x => x.id === id) : { overrides: {} };
    const c = ERP._outlets.company;
    const f = (k, label, type = "text") => `<div class="field"><label>${label}</label><input class="input" type="${type}" data-ov="${k}" value="${esc(o.overrides && o.overrides[k] != null ? o.overrides[k] : "")}" placeholder="${esc(c[k])} (company)"></div>`;
    modal(id ? `Edit ${esc(o.name)}` : "Add outlet", `<div class="form-grid">
        <div class="field"><label>Outlet name *</label><input class="input" id="ol-name" value="${esc(o.name || "")}" maxlength="60"></div>
        <div class="field"><label>Type</label><select class="select" id="ol-type">${["Restaurant", "Bar", "Cloud kitchen", "Central kitchen"].map(t => `<option ${o.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
      <h4 style="font-size:13px;margin:16px 0 8px;">Overrides <span class="muted" style="font-weight:500;">— leave blank to inherit the company setting</span></h4>
      <div class="form-grid">${f("business_name", "Name on bills")}${f("business_address", "Address")}${f("business_phone", "Phone")}${f("gstin", "GSTIN")}
        ${f("tables_count", "Number of tables", "number")}${f("service_charge_percent", "Service charge %", "number")}${f("invoice_prefix", "Invoice prefix (separate series)")}</div>`,
      `${id && id !== "main" ? `<button class="btn btn-danger-soft" onclick="if(confirm('Remove this outlet?')) ERP.outletSave('${jsArg(id)}', true)">Remove</button>` : ""}<button class="btn btn-secondary" onclick="closeModal('erp-modal')">Cancel</button><button class="btn btn-primary" onclick="ERP.outletSave('${jsArg(id || "")}')"><i class="fas fa-floppy-disk"></i> Save</button>`, true);
  };
  ERP.outletSave = async (id, del) => {
    const overrides = {};
    document.querySelectorAll("[data-ov]").forEach(el => { overrides[el.dataset.ov] = el.value.trim(); });
    const body = del ? { action: "delete", id } : { action: "save", id, name: $("ol-name").value, type: $("ol-type").value, overrides };
    try { await api("/api/erp/outlets", { method: "POST", body }); closeModal("erp-modal"); window.showToast("Saved.", "success"); await loadSessionInfo(); ERP.outlets(); }
    catch (e) { window.showToast(e.message, "error"); }
  };
})();
