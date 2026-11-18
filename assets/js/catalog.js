
import { getStoreData, getActiveInvitations } from "./data.js";
import { renderInvitation } from "./template-renderer.js";
import { getPriceRange, money } from "./pricing.js";

const $ = s => document.querySelector(s);

let data, items;

const params = new URLSearchParams(location.search);

try {
    data = await getStoreData();
    items = getActiveInvitations(data);

    populateFilters();

    $("#occasionFilter").value = params.get("occasion") || "";
    $("#styleFilter").value = params.get("style") || "";

    render();

} catch (e) {
    $("#catalogMessage").hidden = false;
    $("#catalogMessage").textContent = e.message;
}

function populateFilters() {

    const occ = [...new Set(items.flatMap(i => i.occasions))].sort();
    const sty = [...new Set(items.flatMap(i => i.styles))].sort();

    occ.forEach(x => $("#occasionFilter").add(new Option(x, x)));
    sty.forEach(x => $("#styleFilter").add(new Option(x, x)));

    $("#occasionFilter").addEventListener("change", update);
    $("#styleFilter").addEventListener("change", update);

    $("#clearFilters").addEventListener("click", () => {
        $("#occasionFilter").value = "";
        $("#styleFilter").value = "";
        update();
    });
}

function update() {

    const p = new URLSearchParams();

    if ($("#occasionFilter").value)
        p.set("occasion", $("#occasionFilter").value);

    if ($("#styleFilter").value)
        p.set("style", $("#styleFilter").value);

    history.replaceState(
        {},
        "",
        location.pathname + (p.size ? "?" + p : "")
    );

    render();
}

async function render() {

    const occasion = $("#occasionFilter").value;
    const style = $("#styleFilter").value;

    const matches = items.filter(i =>
        (!occasion || i.occasions.includes(occasion)) &&
        (!style || i.styles.includes(style))
    );

    $("#resultCount").textContent =
        `${matches.length} design${matches.length === 1 ? "" : "s"} found`;

    $("#catalogGrid").replaceChildren();

    $("#catalogMessage").hidden = matches.length > 0;

    if (!matches.length) {
        $("#catalogMessage").textContent =
            "No matching designs. Try clearing one or both filters.";
    }

    for (const i of matches) {

        const card = document.createElement("article");
        card.className = "catalog-card";

        const art = document.createElement("div");
        art.className = "catalog-art";

        const info = document.createElement("div");
        info.className = "catalog-info";

        const range = getPriceRange(i);

        info.innerHTML = `
            <span class="format-label">
                ${esc(i.pages.length)} page${i.pages.length === 1 ? "" : "s"}
                · ${esc(i.formats.join(", "))}
            </span>

            <h2>${esc(i.title)}</h2>

            <p>
                ${range
                    ? `${money(range.min)}–${money(range.max)} per invitation`
                    : "Contact us for pricing"}
            </p>

            <small class="muted">
                Per-invitation price varies by quantity.
            </small>

            <a class="button"
               href="../invitation/?id=${encodeURIComponent(i.id)}&${params.toString()}">
                View design
            </a>
        `;

        card.append(art, info);
        // Make the entire information section clickable
const invitationUrl = `../invitation/?id=${encodeURIComponent(i.id)}&${params.toString()}`;

info.style.cursor = "pointer";
info.setAttribute("role", "link");
info.setAttribute("tabindex", "0");
info.setAttribute("aria-label", `View ${i.title}`);

info.addEventListener("click", (e) => {
    // Let the actual button/link handle its own click
    if (e.target.closest("a, button")) return;

    location.href = invitationUrl;
});

info.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        location.href = invitationUrl;
    }
});
        $("#catalogGrid").append(card);

        try {

            const result = await renderInvitation({
                invitation: i,
                target: art,
                size: "thumb"
            });

            addPreviewControls(art, result.pages);

        } catch (e) {
            art.textContent = "Preview unavailable";
        }
    }
}


// Add arrows and page dots to an invitation preview

function addPreviewControls(container, pages) {

    if (pages.length <= 1) return;

    const stack = container.querySelector(".catalog-page-stack");
    if (!stack) return;

    let currentPage = 0;

    // Keep the original page order
    const pageElements = [...stack.children];

    const prev = document.createElement("button");
    prev.className = "preview-arrow preview-prev";
    prev.type = "button";
    prev.innerHTML = "&#8249;";
    prev.setAttribute("aria-label", "Previous page");

    const next = document.createElement("button");
    next.className = "preview-arrow preview-next";
    next.type = "button";
    next.innerHTML = "&#8250;";
    next.setAttribute("aria-label", "Next page");

    const dots = document.createElement("div");
    dots.className = "preview-dots";

    pages.forEach((page, index) => {

        const dot = document.createElement("button");

        dot.type = "button";
        dot.className = "preview-dot";
        dot.setAttribute("aria-label", `Show page ${index + 1}`);

        dot.addEventListener("click", () => {
            showPage(index);
        });

        dots.appendChild(dot);
    });

    function showPage(index) {

        currentPage = (index + pages.length) % pages.length;

        // Rotate the stack so the selected page is first
        const rotated = [
            ...pageElements.slice(currentPage),
            ...pageElements.slice(0, currentPage)
        ];

        rotated.forEach((page, position) => {

            // Move each page into its new stack position
            page.style.setProperty("--page-index", position);
            page.style.setProperty(
                "--page-offset",
                `${position * 120}px`
            );

            page.style.zIndex = 100 - position;

            stack.appendChild(page);
        });

        // Update dots
        [...dots.children].forEach((dot, i) => {
            dot.classList.toggle("is-active", i === currentPage);
        });
    }

    prev.addEventListener("click", () => {
        showPage(currentPage - 1);
    });

    next.addEventListener("click", () => {
        showPage(currentPage + 1);
    });

    container.append(prev, next, dots);

    showPage(0);
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
