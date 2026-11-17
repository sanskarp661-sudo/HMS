/**
 * upi-qr.js — UPI payment links and QR codes (Mosaic Engine HMS)
 * Uses qrcode-generator (loaded from jsDelivr) to draw an SVG QR code.
 */
(function () {
  // Standard UPI deep link understood by GPay, PhonePe, Paytm, BHIM and bank apps
  function upiLink(upiId, payeeName, amount, note) {
    const p = new URLSearchParams();
    p.set("pa", upiId);
    if (payeeName) p.set("pn", payeeName);
    if (amount > 0) p.set("am", (Math.round(amount * 100) / 100).toFixed(2));
    p.set("cu", "INR");
    if (note) p.set("tn", String(note).slice(0, 60));
    return "upi://pay?" + p.toString().replace(/\+/g, "%20");
  }

  // Draws the QR as inline SVG into `el`. Returns false if the library is missing.
  function renderQR(el, text, sizePx) {
    if (typeof window.qrcode !== "function") {
      el.innerHTML = '<p style="font-size:13px;color:#b45309;">QR code could not load. Check the internet connection.</p>';
      return false;
    }
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const cells = qr.getModuleCount();
    const cell = Math.max(2, Math.floor((sizePx || 220) / (cells + 8)));
    el.innerHTML = qr.createSvgTag({ cellSize: cell, margin: cell * 4, scalable: true });
    const svg = el.querySelector("svg");
    if (svg) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "UPI payment QR code");
      svg.style.width = (sizePx || 220) + "px";
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      svg.style.background = "#fff";
    }
    return true;
  }

  window.UPI = { link: upiLink, renderQR: renderQR };
})();
