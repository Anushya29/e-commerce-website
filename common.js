const API = "https://e-commerce-backend-bke5.onrender.com/api";
// a customer can ask for a return within this many days of delivery (the backend uses the same number)
const RETURN_DAYS = 3;

// ---------- website text (the admin can change it in Content Management) ----------
// These are the ORIGINAL texts. The admin's changes are stored in the database and win over these.
const SITE_DEFAULTS = {
  shop_name: "Zivelle Boutique",
  hero_title: "Unique dresses,\nmade to be noticed.",
  hero_subtitle: "Curated boutique collections — evening gowns, ethnic wear, everyday elegance.",
  hero_phrases: "✨ New arrivals every week\n🚚 Free delivery over ₹2999\n💎 Premium fabrics, boutique prices\n🦋 Designed to turn heads\n👗 Handpicked styles, made for you\n🎉 Limited edition collections\n🌸 Elegance for every occasion\n💃 Where fashion meets confidence",
  about_title: "About Zivelle",
  about_text: "Zivelle is a dress boutique for people who like to stand out.\n\nEvery piece is hand-picked for its fabric, fit and finish, so you can find something that is truly yours, for a party, a wedding or just a good day.",
  contact_email: "zivelle@shop.com",
  contact_phone: "",
  contact_address: "Chennai, Tamil Nadu",
  footer_text: "🦋 Zivelle — unique dress collections"
};

// text from the admin's changes + the originals for everything not changed
// (asked from the server only once per page)
let _siteContentPromise = null;
function getSiteContent() {
  if (!_siteContentPromise) {
    _siteContentPromise = (async () => {
      try {
        const r = await fetch(`${API}/content`);
        const saved = r.ok ? await r.json() : {};
        return { ...SITE_DEFAULTS, ...saved };
      } catch {
        return { ...SITE_DEFAULTS };
      }
    })();
  }
  return _siteContentPromise;
}

// makes text safe to put inside a page (so typed text can never run as code)
const escHtml = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- logged-in customer ----------
const getCustomer = () => JSON.parse(localStorage.getItem("zCustomer") || "null");

function logout() {
  localStorage.removeItem("zCustomer");
  location.href = "login.html";
}

// Used ONLY on pages that truly need a login first (My Orders).
// Shopping and the bag no longer call this — login is asked for at checkout instead.
function requireLogin() {
  const c = getCustomer();
  if (!c) {
    localStorage.setItem("zRedirect", location.pathname.split("/").pop());
    location.href = "login.html";
  }
  return c;
}

// Called after a successful login/register.
// Moves anything the guest added to their browser bag into the real server cart,
// then sends them back to wherever they were trying to go (usually checkout).
async function finishLogin(customer) {
  localStorage.setItem("zCustomer", JSON.stringify(customer));

  for (const item of getGuestBag()) {
    const params = new URLSearchParams({
      customerId: customer.customerId, productId: item.productId, quantity: item.quantity
    });
    if (item.size) params.set("size", item.size);
    if (item.color) params.set("color", item.color);
    try { await fetch(`${API}/cart/add?` + params, { method: "POST" }); } catch {}
  }
  clearGuestBag();

  const next = localStorage.getItem("zRedirect") || "index.html";
  localStorage.removeItem("zRedirect");
  location.href = next;
}

// ---------- guest bag: lives in the browser only, until the person logs in ----------
const getGuestBag = () => JSON.parse(localStorage.getItem("zGuestBag") || "[]");
const saveGuestBag = (items) => localStorage.setItem("zGuestBag", JSON.stringify(items));
const clearGuestBag = () => localStorage.removeItem("zGuestBag");

function addGuestItem(item) {
  const items = getGuestBag();
  const match = items.find(i => i.productId === item.productId && i.size === item.size && i.color === item.color);
  if (match) match.quantity += item.quantity;
  else items.push(item);
  saveGuestBag(items);
}

const guestBagCount = () => getGuestBag().reduce((s, i) => s + i.quantity, 0);

// ---------- small popup when something is added to the bag ----------
function toast(message, isError = false) {
  let wrap = document.getElementById("toastWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toastWrap";
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.className = isError ? "toast error" : "toast";
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), isError ? 5200 : 2500);
}

// ---------- left sidebar, used on every customer-facing page ----------
function renderSidebar(active) {
  const c = getCustomer();
  const links = [["index.html", "🦋 Shop", "index"], ["bag.html", "🛍 Bag", "bag"]];
  if (c) links.push(["orders.html", "📦 My Orders", "orders"]);
  links.push(["about.html", "ℹ️ About", "about"]);

  document.getElementById("sidebar").innerHTML = `
    <a class="brand" href="index.html">🦋 Zivelle</a>
    <nav class="side-nav">
      ${links.map(([href, label, key]) =>
        `<a href="${href}" class="${key === active ? "active" : ""}">${label}${key === "bag" ? ' <span class="badge" id="bagBadge"></span>' : ""}</a>`
      ).join("")}
      ${c
        ? `<button onclick="logout()">🚪 Logout<small>${c.name}</small></button>`
        : `<a href="login.html" class="${active === "login" ? "active" : ""}">👤 Login</a>`}
    </nav>`;

  updateBagBadge();
  if (c) startOrderStatusWatcher();   // NEW: watch for status changes (shipped, delivered, etc.)
  loadTrackers();                      // Google Analytics / Meta Pixel, if the admin has set them up
  renderFooter();                      // the same footer on every shop page
}

// ---------- notify the customer when an admin changes their order status ----------
function startOrderStatusWatcher() {
  const c = getCustomer();
  if (!c || window.__zWatcherStarted) return;   // only once per page, only if logged in
  window.__zWatcherStarted = true;

  // Ask the browser for permission to show a system notification (works even if
  // the person has switched to another tab, as long as this site tab is still open).
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  const storeKey = `zOrderState_${c.customerId}`;   // v2: tracks the return status too

  const checkOnce = async () => {
    try {
      const orders = await (await fetch(`${API}/orders/customer/${c.customerId}`)).json();
      const prev = JSON.parse(localStorage.getItem(storeKey) || "{}");
      const next = {};

      orders.forEach(o => {
        const state = `${o.status}|${o.returnStatus || ""}`;
        next[o.orderId] = state;
        // Only notify if we've SEEN this order before with a DIFFERENT status
        // (so the very first check after login doesn't spam old orders).
        if (prev[o.orderId] && prev[o.orderId] !== state) {
          const oldReturn = prev[o.orderId].split("|")[1] || "";
          const msg = (o.returnStatus || "") !== oldReturn
            ? `Return for order #${o.orderId}: ${o.returnStatus.toLowerCase()}`
            : `Order #${o.orderId} is now ${o.status}`;
          toast(msg);
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("🦋 Zivelle", { body: msg });
          }
        }
      });

      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch { /* backend not reachable right now - just skip this round */ }
  };

  checkOnce();
  setInterval(checkOnce, 20000);   // re-check every 20 seconds while this tab is open
}

async function updateBagBadge() {
  const badge = document.getElementById("bagBadge");
  if (!badge) return;
  const c = getCustomer();
  let count = 0;
  if (c) {
    try {
      const items = await (await fetch(`${API}/cart/${c.customerId}`)).json();
      count = items.reduce((s, i) => s + i.quantity, 0);
    } catch { count = 0; }
  } else {
    count = guestBagCount();
  }
  badge.textContent = count > 0 ? count : "";
}

// ---------- admin: attach the admin token to every /admin/ request ----------
const _origFetch = window.fetch;
window.fetch = (url, opts = {}) => {
  const isAdminCall = String(url).includes("/admin/") && !String(url).includes("/admin/login");
  if (isAdminCall) {
    opts.headers = { ...(opts.headers || {}), "X-Admin-Token": sessionStorage.getItem("zAdmin") || "" };
  }
  return _origFetch(url, opts).then(r => {
    if (isAdminCall && r.status === 401) {
      sessionStorage.removeItem("zAdmin");
      // the login page shows this message after the reload (an alert box can be blocked, and then the page just seems to "go back to login")
      sessionStorage.setItem("zAdminMsg", "Your admin session ended (the backend was restarted, or the login is not valid any more). Please login again.");
      location.reload();
    }
    return r;
  });
};


// ---------- in-page dialogs ----------
// The browser's own alert / prompt / confirm boxes are blocked or missing in some places
// (for example the browser built into VS Code). A button that uses them then seems to do nothing.
// These versions are drawn inside the page, so they always work.

function openModal(title, bodyHtml, { wide = false, onClose } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${escHtml(title)}</h3><button type="button" class="modal-x" aria-label="Close">✕</button></div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;

  let closed = false;
  const onKey = e => { if (e.key === "Escape") overlay.close(); };
  overlay.close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    if (onClose) onClose();
  };
  overlay.addEventListener("mousedown", e => { if (e.target === overlay) overlay.close(); });
  overlay.querySelector(".modal-x").onclick = () => overlay.close();
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return overlay;
}

// gives back the typed text ("" if left empty), or null when the person pressed Cancel
function askText(title, label, { value = "", placeholder = "", required = false } = {}) {
  return new Promise(resolve => {
    let result = null;
    const m = openModal(title, `
      ${label ? `<p class="msg">${escHtml(label)}</p>` : ""}
      <input id="askInput" value="${escHtml(value)}" placeholder="${escHtml(placeholder)}" autocomplete="off">
      <p class="modal-error" id="askErr"></p>
      <div class="modal-actions">
        <button type="button" class="ghost" id="askCancel">Cancel</button>
        <button type="button" id="askOk">OK</button>
      </div>`, { onClose: () => resolve(result) });

    const input = m.querySelector("#askInput");
    const submit = () => {
      const v = input.value.trim();
      if (required && !v) { m.querySelector("#askErr").textContent = "Please type something."; return; }
      result = v;
      m.close();
    };
    m.querySelector("#askOk").onclick = submit;
    m.querySelector("#askCancel").onclick = () => m.close();
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    input.focus();
  });
}

// gives back true (OK) or false (Cancel)
function askConfirm(title, message, { okText = "Yes", danger = false } = {}) {
  return new Promise(resolve => {
    let result = false;
    const m = openModal(title, `
      <p>${escHtml(message)}</p>
      <div class="modal-actions">
        <button type="button" class="ghost" id="cfCancel">Cancel</button>
        <button type="button" class="${danger ? "danger" : ""}" id="cfOk">${escHtml(okText)}</button>
      </div>`, { onClose: () => resolve(result) });

    m.querySelector("#cfOk").onclick = () => { result = true; m.close(); };
    m.querySelector("#cfCancel").onclick = () => m.close();
    m.querySelector("#cfOk").focus();
  });
}

// a red message that stays a little longer than the normal popup
const showError = message => toast(message, true);


// Anything unexpected that fails in the background now shows a red message,
// instead of the page silently doing nothing.
window.addEventListener("unhandledrejection", e => {
  const msg = String((e.reason && e.reason.message) || e.reason || "");
  showError(/Failed to fetch|NetworkError|Load failed/i.test(msg)
    ? "Cannot reach the backend. Is the Spring Boot app running on port 8080?"
    : "Something went wrong: " + msg);
});


// ---------- Google Analytics + Meta Pixel (the admin sets the IDs in Marketing Analytics) ----------
// Used on the shop pages only. The admin pages never load these.
let _trackReady = false;
const _trackQueue = [];

async function loadTrackers() {
  if (window.__trackersStarted) return;
  window.__trackersStarted = true;

  const c = await getSiteContent();
  const ga = String(c.ga_measurement_id || "").trim();
  const px = String(c.meta_pixel_id || "").trim();

  // the IDs are checked before they are used, so nothing odd can be put into the page
  if (/^G-[A-Z0-9]{6,14}$/.test(ga)) {
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${ga}`;
    document.head.appendChild(tag);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ga);
  }

  if (/^\d{8,20}$/.test(px)) {
    // the standard Meta Pixel loader
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", px);
    window.fbq("track", "PageView");
  }

  _trackReady = true;
  _trackQueue.splice(0).forEach(([name, data]) => sendTrack(name, data));
}

// track("view_item" | "add_to_cart" | "purchase", { value, id, items: [{ item_id, item_name, price, quantity }] })
function track(name, data = {}) {
  if (!_trackReady) { _trackQueue.push([name, data]); return; }   // sent as soon as the trackers are ready
  sendTrack(name, data);
}

function sendTrack(name, d) {
  const items = d.items || [];
  if (window.gtag) {
    if (name === "view_item" || name === "add_to_cart") window.gtag("event", name, { currency: "INR", value: d.value, items });
    if (name === "purchase") window.gtag("event", "purchase", { transaction_id: String(d.id), currency: "INR", value: d.value, items });
  }
  if (window.fbq) {
    const meta = { currency: "INR", value: d.value, content_type: "product", content_ids: items.map(i => String(i.item_id)) };
    if (name === "view_item") window.fbq("track", "ViewContent", meta);
    if (name === "add_to_cart") window.fbq("track", "AddToCart", meta);
    if (name === "purchase") window.fbq("track", "Purchase", { currency: "INR", value: d.value });
  }
}


// ---------- footer (the same on every shop page) ----------
async function renderFooter() {
  const page = document.querySelector(".page");
  if (!page) return;

  let f = document.getElementById("siteFooter");
  if (!f) {
    f = document.createElement("footer");
    f.id = "siteFooter";
    page.appendChild(f);
  }
  f.className = "site-footer";

  const c = await getSiteContent();
  const loggedIn = !!getCustomer();
  const contact = [
    c.contact_email ? `<li>✉️ <a href="mailto:${escHtml(c.contact_email)}">${escHtml(c.contact_email)}</a></li>` : "",
    c.contact_phone ? `<li>📞 <a href="tel:${escHtml(c.contact_phone)}">${escHtml(c.contact_phone)}</a></li>` : "",
    c.contact_address ? `<li>📍 ${escHtml(c.contact_address)}</li>` : ""
  ].join("");

  f.innerHTML = `
    <div class="footer-grid">
      <div>
        <div class="footer-brand">${escHtml(c.footer_text)}</div>
        <p class="footer-blurb">${escHtml(c.hero_subtitle)}</p>
      </div>
      <div>
        <h4>Quick links</h4>
        <ul>
          <li><a href="index.html">Shop</a></li>
          <li><a href="bag.html">My bag</a></li>
          ${loggedIn ? `<li><a href="orders.html">My orders</a></li>` : `<li><a href="login.html">Login / Register</a></li>`}
          <li><a href="about.html">About us</a></li>
        </ul>
      </div>
      <div>
        <h4>Customer care</h4>
        <ul>
          <li>Cancel an order any time before it is dispatched</li>
          <li>Return within ${RETURN_DAYS} days of delivery</li>
          <li>Pay by cash on delivery or UPI</li>
        </ul>
      </div>
      <div>
        <h4>Contact</h4>
        <ul>${contact || "<li>Contact details coming soon</li>"}</ul>
      </div>
    </div>
    <div class="footer-bottom">© ${new Date().getFullYear()} ${escHtml(c.shop_name)}. All rights reserved.</div>`;
}
