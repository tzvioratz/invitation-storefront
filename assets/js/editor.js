import { getStoreData, getInvitation } from "./data.js";
import { renderInvitation, updateRenderedWording } from "./template-renderer.js";
import { calculateEstimate, money } from "./pricing.js";
import { CONFIG } from "./config.js";
const $ = (s) => document.querySelector(s),
    params = new URLSearchParams(location.search),
    id = params.get("id");
let invitation,
    rendered,
    wording = {},
    selection = {},
    activePage = 0,
    activeFieldId=null;
try {
    const data = await getStoreData();
    invitation = getInvitation(data, id);
    if (!invitation) throw new Error("This invitation is not available.");
    $("#editorTitle").textContent = invitation.title;
    $("#returnLink").href = "../invitation/?id=" + encodeURIComponent(id);
    selection = {
        format: invitation.formats[0],
        paper: invitation.papers[0],
        font: invitation.fonts[0],
        color: invitation.colors[0],
        design: invitation.designOptions[0]
    };
    buildOptions();
    rendered = await renderInvitation({
        invitation,
        target: document.createElement("div"),
        wording,
        options: selection
    });
    buildFields();
    drawPages();
    updatePrice();
} catch (e) {
    $("#editorTitle").textContent = "Unable to load invitation";
    $("#fieldControls").textContent = e.message;
}


function activateField(fieldId) {
    activeFieldId = fieldId;

    const field = rendered.fields.find(f => f.id === fieldId);
    if (!field || !field.occurrences.length) return;

    // Switch to the first page containing this field.
    activePage = field.occurrences[0].pageIndex;

    // Rebuild the preview with the selected field highlighted.
    drawPages();
}

function buildOptions() {
    const groups = [
        ["format", "Card format", invitation.formats],
        ["paper", "Paper", invitation.papers],
        ["font", "Font", invitation.fonts],
        ["color", "Color", invitation.colors],
        ["design", "Design option", invitation.designOptions]
    ];
    $("#optionControls").innerHTML = groups
        .filter((g) => g[2].length)
        .map(
            ([key, label, values]) =>
                `<label>${label}<select data-choice="${key}">${values.map((v) => `<option>${esc(v)}</option>`).join("")}</select></label>`
        )
        .join("");
    $("#optionControls")
        .querySelectorAll("select")
        .forEach((el) =>
            el.addEventListener("change", () => {
                selection[el.dataset.choice] = el.value;
                refresh();
            })
        );
}

function buildFields() {
    const container = $("#fieldControls");
    container.replaceChildren();

    rendered.fields.forEach(f => {
        const label = document.createElement("label");
        label.textContent = f.label + (f.required ? " *" : "");

        const input = f.multiline
            ? document.createElement("textarea")
            : document.createElement("input");

        input.dataset.field = f.id;
        input.placeholder = f.placeholder;
        input.maxLength = f.maxLength;

        if (f.required) input.required = true;

        // Show the template's existing wording in the input.
        input.value = wording[f.id] ?? f.defaultValue ?? "";

        // Clicking or tabbing into a field switches the preview.
        input.addEventListener("focus", () => activateField(f.id));

        // Update the wording and redraw the preview.
        const updateField = () => {
            wording[f.id] = input.value;
            updateRenderedWording(rendered, wording);
            drawPages();
        };

        input.addEventListener("input", updateField);
        input.addEventListener("blur", updateField);

        label.append(input);

        const hint = document.createElement("small");
        hint.className = "field-help";
        hint.textContent =
            `Appears on: ${[...new Set(
                f.occurrences.map(o => invitation.pages[o.pageIndex].label)
            )].join(", ")}`;

        container.append(label, hint);
    });

    if (!rendered.fields.length) {
        container.textContent =
            "This design has no editable wording fields.";
    }
}


function highlightActiveField(activeElement) {
    const matches = [
        ...activeElement.querySelectorAll("[data-field]")
    ].filter(el =>
        el.getAttribute("data-field") === activeFieldId
    );

    matches.forEach(el => {
        el.classList.add("field-highlight");

        // HTML fields use CSS outlines.
        if (el.namespaceURI !== "http://www.w3.org/2000/svg") {
            return;
        }

        // SVG fields get a rectangular outline around the text.
        const svg = el.ownerSVGElement;
        if (!svg) return;

        try {
            const bounds = el.getBBox();

            const rect = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "rect"
            );

            rect.setAttribute("x", bounds.x - 8);
            rect.setAttribute("y", bounds.y - 8);
            rect.setAttribute("width", bounds.width + 16);
            rect.setAttribute("height", bounds.height + 16);
            rect.setAttribute("rx", "5");
            rect.setAttribute("class", "field-highlight-box");

            svg.appendChild(rect);
        } catch (error) {
            console.warn("Could not highlight SVG field:", error);
        }
    });
}

function drawPages() {
    const thumbs = $("#pageThumbs");
    const large = $("#largePreview");
    const spread = $("#spreadPreview");

    if (!rendered || !rendered.pages.length) return;

    activePage = Math.max(
        0,
        Math.min(activePage, rendered.pages.length - 1)
    );

    thumbs.replaceChildren();
    large.replaceChildren();
    spread.replaceChildren();

    rendered.pages.forEach((p, i) => {
        const b = document.createElement("button");
        b.className = "thumb" + (i === activePage ? " active" : "");
        b.type = "button";

        const thumbFrame = document.createElement("div");
        thumbFrame.className = "thumb-frame";

        thumbFrame.append(p.element.cloneNode(true));
        b.append(thumbFrame);

        const l = document.createElement("span");
        l.className = "thumb-label";
        l.textContent = p.page.label;
        b.append(l);

        b.addEventListener("click", () => {
            activePage = i;
            drawPages();
        });

        thumbs.append(b);

        spread.append(p.element.cloneNode(true));
    });

    // Add the selected page to the large preview.
    const activeElement =
        rendered.pages[activePage].element.cloneNode(true);

    large.append(activeElement);

    // Highlight the selected field if it appears on this page.
    if (activeFieldId) {
        highlightActiveField(activeElement);
    }

    $("#pageLabel").textContent =
        `${rendered.pages[activePage].page.label} · Page ${activePage + 1} of ${rendered.pages.length}`;

    $("#prevPage").disabled = activePage === 0;
    $("#nextPage").disabled =
        activePage === rendered.pages.length - 1;
}

function refresh() {
    const target = document.createElement("div");
    renderInvitation({ invitation, target, wording, options: selection }).then((r) => {
        rendered = r;
        drawPages();
        updatePrice();
    });
}
function updatePrice() {
    const qty = Number($("#quantity").value) || 0;
    $("#estimate").textContent = "Estimated subtotal: " + money(calculateEstimate(invitation, selection, qty));
}
$("#prevPage").addEventListener("click", () => {
    activePage = Math.max(0, activePage - 1);
    drawPages();
});
$("#nextPage").addEventListener("click", () => {
    activePage = Math.min(rendered.pages.length - 1, activePage + 1);
    drawPages();
});
$("#quantity").addEventListener("input", updatePrice);
$("#reviewButton").addEventListener("click", () => {
    const name = $("#customerName").value.trim(),
        email = $("#customerEmail").value.trim(),
        qty = Number($("#quantity").value);
    if (
        !name ||
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !Number.isInteger(qty) ||
        qty < Number(invitation.quantityMinimum || 1) ||
        qty > 1000
    ) {
        alert(
            "Enter your name, a valid email, and a valid quantity (minimum " + (invitation.quantityMinimum || 1) + ")."
        );
        return;
    }
    const summary = {
        Invitation: invitation.title,
        Format: selection.format,
        Paper: selection.paper,
        Font: selection.font,
        Color: selection.color,
        Design: selection.design,
        Quantity: qty,
        Name: name,
        Email: email,
        Phone: $("#customerPhone").value,
        Notes: $("#orderNotes").value,
        Wording: JSON.stringify(wording),
        Estimate: $("#estimate").textContent
    };
    window.pendingOrder = {
        invitationId: id,
        selection,
        wording,
        quantity: qty,
        customer: { name, email, phone: $("#customerPhone").value, notes: $("#orderNotes").value }
    };
    $("#reviewSummary").innerHTML =
        "<dl>" +
        Object.entries(summary)
            .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
            .join("") +
        "</dl>";
    $("#reviewPanel").hidden = false;
    $("#reviewPanel").scrollIntoView({ behavior: "smooth" });
});
$("#editOrder").addEventListener("click", () => ($("#reviewPanel").hidden = true));
$("#submitOrder").addEventListener("click", async () => {
    const status = $("#submitStatus");
    status.textContent = "Submitting…";
    $("#submitOrder").disabled = true;
    try {
        if (!CONFIG.backendUrl || CONFIG.backendUrl.includes("REPLACE_WITH"))
            throw new Error("The order backend has not been configured. No order was submitted.");
        const response = await fetch(CONFIG.backendUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(window.pendingOrder)
        });
        const result = await response.json();
        if (!result.success || !result.reference)
            throw new Error(result.error || "The server did not confirm the order.");
        status.textContent = `Order request received. Reference: ${result.reference}. We will prepare a proof for your approval. Printing begins only after approval.`;
    } catch (e) {
        status.textContent = `We could not confirm your order: ${e.message}. Please try again or contact the business. Do not assume your request was received.`;
    } finally {
        $("#submitOrder").disabled = false;
    }
});
function esc(s) {
    return String(s ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
}