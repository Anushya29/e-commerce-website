let allProducts = [];
let selectedCategory = "all";

window.addEventListener("DOMContentLoaded", loadProducts);

async function loadProducts() {
  const statusMsg = document.getElementById("statusMsg");
  try {
    const response = await fetch(`${API}/products`);
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    allProducts = await response.json();

    if (allProducts.length === 0) {
      statusMsg.textContent = "No products yet. Add some via the admin page.";
      return;
    }

    statusMsg.textContent = `${allProducts.length} piece(s) in the collection`;
    buildCategoryFilters(allProducts);
    renderProducts(allProducts);

    document.getElementById("search").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      if (q) {
        document.getElementById("subFilterRow").innerHTML = "";
        renderProducts(allProducts.filter(p =>
          [p.productName, p.category, p.subcategory, p.color, p.description].join(" ").toLowerCase().includes(q)));
      } else {
        selectFilter("all", document.querySelector('[data-category="all"]'));
      }
    });

  } catch (error) {
    console.error("Failed to load products:", error);
    statusMsg.textContent = "Could not reach the backend. Check that the Spring Boot app is running on port 8080.";
  }
}

function buildCategoryFilters(products) {
  const filterRow = document.getElementById("filterRow");
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))];

  categories.forEach((cat) => {
    const pill = document.createElement("button");
    pill.className = "filter-pill";
    pill.textContent = cat;
    pill.dataset.category = cat;
    pill.addEventListener("click", () => selectFilter(cat, pill));
    filterRow.appendChild(pill);
  });

  filterRow.querySelector('[data-category="all"]').addEventListener("click", (e) => selectFilter("all", e.target));
}

function selectFilter(category, clickedPill) {
  selectedCategory = category;
  document.querySelectorAll("#filterRow .filter-pill").forEach(p => p.classList.remove("active"));
  clickedPill.classList.add("active");
  document.getElementById("search").value = "";

  buildSubFilters(category);

  const filtered = category === "all" ? allProducts : allProducts.filter(p => p.category === category);
  renderProducts(filtered);
}

// Second row: subcategories that exist WITHIN the chosen category (Flipkart/Meesho style)
function buildSubFilters(category) {
  const subRow = document.getElementById("subFilterRow");
  subRow.innerHTML = "";

  if (category === "all") return;

  const subs = [...new Set(
    allProducts.filter(p => p.category === category).map(p => p.subcategory).filter(Boolean)
  )];
  if (subs.length === 0) return;

  const allSubPill = document.createElement("button");
  allSubPill.className = "filter-pill sub-pill active";
  allSubPill.textContent = "All " + category;
  allSubPill.addEventListener("click", () => selectSubFilter(category, "all", allSubPill));
  subRow.appendChild(allSubPill);

  subs.forEach((sub) => {
    const pill = document.createElement("button");
    pill.className = "filter-pill sub-pill";
    pill.textContent = sub;
    pill.addEventListener("click", () => selectSubFilter(category, sub, pill));
    subRow.appendChild(pill);
  });
}

function selectSubFilter(category, subcategory, clickedPill) {
  document.querySelectorAll("#subFilterRow .filter-pill").forEach(p => p.classList.remove("active"));
  clickedPill.classList.add("active");

  const filtered = allProducts.filter(p =>
    p.category === category && (subcategory === "all" || p.subcategory === subcategory));
  renderProducts(filtered);
}

function renderProducts(products) {
  const productGrid = document.getElementById("productGrid");
  productGrid.innerHTML = "";

  if (products.length === 0) {
    productGrid.innerHTML = "<p class='msg'>No dresses in this category yet.</p>";
    return;
  }

  products.forEach((product) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.style.cursor = "pointer";

    card.innerHTML = `
      ${product.offerActive ? `<span class="offer-badge">${product.discountPercent}% OFF</span>` : ""}
      <img src="${product.imageUrl || 'https://placehold.co/300x400?text=Zivelle'}" alt="${product.productName}">
      <div class="card-body">
        <span class="category-tag">${(product.category || "").toUpperCase()}${product.subcategory ? " · " + product.subcategory : ""}</span>
        <h3>${product.productName}</h3>
        <div class="meta-row">
          <span>${product.size || ""}</span><span>·</span><span>${product.color || ""}</span>
        </div>
        <div class="price">${product.offerActive ? `<span class="old-price">₹${product.price}</span>₹${product.effectivePrice}` : `₹${product.price}`}</div>
        <button data-id="${product.productId}" ${product.stock === 0 ? "disabled" : ""}>
          ${product.stock === 0 ? "Out of stock" : "Add to bag"}
        </button>
      </div>
    `;

    card.addEventListener("click", () => (location.href = "product.html?id=" + product.productId));
    card.querySelector("button").addEventListener("click", (e) => {
      e.stopPropagation();
      quickAdd(product);
    });

    productGrid.appendChild(card);
  });
}

async function quickAdd(product) {
  const customer = getCustomer();

  if (customer) {
    const params = new URLSearchParams({ customerId: customer.customerId, productId: product.productId, quantity: 1 });
    try {
      const r = await fetch(`${API}/cart/add?` + params, { method: "POST" });
      if (!r.ok) throw new Error();
      toast(`${product.productName} added to bag`);
      trackQuickAdd(product);
    } catch {
      toast("Could not add to bag. Please try again.");
    }
  } else {
    addGuestItem({
      productId: product.productId, productName: product.productName, price: product.effectivePrice ?? product.price,
      imageUrl: product.imageUrl, quantity: 1, size: null, color: null
    });
    toast(`${product.productName} added to bag`);
    trackQuickAdd(product);
  }

  updateBagBadge();
}

// tells Google Analytics / Meta Pixel (only if the admin has set them up)
function trackQuickAdd(product) {
  const price = product.effectivePrice ?? product.price;
  track("add_to_cart", { value: price, items: [{ item_id: product.productId, item_name: product.productName, price, quantity: 1 }] });
}