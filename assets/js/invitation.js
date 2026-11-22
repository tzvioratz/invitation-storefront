
import { getStoreData, getInvitation } from "./data.js";
import { renderInvitation } from "./template-renderer.js";
import { getPriceRange, money } from "./pricing.js";

const $ = (s) => document.querySelector(s);

const p = new URLSearchParams(location.search);
const id = p.get("id");

try {
  const data = await getStoreData();
  const inv = getInvitation(data, id);

  if (!inv) {
    throw new Error("This invitation is not available.");
  }

  document.title = inv.title;
  $("#detailTitle").textContent = inv.title;
  $("#detailDescription").textContent = inv.description;

  // Pricing
  const range = getPriceRange(inv);

  $("#detailPrice").textContent = range
    ? `${money(range.min)}–${money(range.max)} per invitation`
    : "Contact us for pricing";

  // Invitation details
  $("#detailMeta").innerHTML = [
    ["Occasions", inv.occasions],
    ["Styles", inv.styles],
    ["Formats", inv.formats]
  ]
    .map(([k, v]) => `<p><b>${k}:</b> ${v.map(esc).join(", ")}</p>`)
    .join("");

  // Render invitation preview
  const target = $("#detailPages");

  await renderInvitation({
    invitation: inv,
    target
  });

  target.classList.add("detail-pages");

  // Customize link
  const link = new URL("../customize/", location.href);
  link.searchParams.set("id", id);
    
    // Preload the customize page.
const prefetch = document.createElement("link");

prefetch.rel = "prefetch";
prefetch.as = "document";
prefetch.href = link.href;

document.head.appendChild(prefetch);

  if (p.get("occasion")) {
    link.searchParams.set("occasion", p.get("occasion"));
  }

  if (p.get("style")) {
    link.searchParams.set("style", p.get("style"));
  }

  $("#customizeLink").href = link;

  // Back to catalog link
  const back = new URL("../catalog/", location.href);

  if (p.get("occasion")) {
    back.searchParams.set("occasion", p.get("occasion"));
  }

  if (p.get("style")) {
    back.searchParams.set("style", p.get("style"));
  }

  $("#backToCatalog").href = back;

} catch (e) {
  console.error("Invitation detail page error:", e);

  $("#detailTitle").textContent = "Invitation unavailable";
  $("#detailDescription").textContent = e.message;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}
