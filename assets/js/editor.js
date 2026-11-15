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

    const sections = invitation.pages.map(page => {
        const section = document.createElement("div");
        section.className = "field-page-section";

        const heading = document.createElement("h3");
        heading.textContent = page.label;

        section.appendChild(heading);
        container.appendChild(section);

        return section;
    });

    rendered.fields.forEach(f => {
        const pageIndex = f.occurrences[0]?.pageIndex ?? 0;
        const section = sections[pageIndex];

        const fieldWrap = document.createElement("div");
        fieldWrap.className = "field-control-wrap";

        const label = document.createElement("label");
        label.className = "field-control";
        label.textContent = f.label + (f.required ? " *" : "");

        const input = f.multiline
            ? document.createElement("textarea")
            : document.createElement("input");

        input.dataset.field = f.id;
        input.placeholder = f.placeholder;
        input.maxLength = f.maxLength;

        if (f.required) input.required = true;

        input.value = wording[f.id] ?? f.defaultValue ?? "";

        input.addEventListener("focus", () => activateField(f.id));

        const updateField = () => {
            wording[f.id] = input.value;
            updateRenderedWording(rendered, wording);
            drawPages();
        };

        input.addEventListener("input", updateField);
        input.addEventListener("blur", updateField);

        label.appendChild(input);

        // Input and Hebrew keyboard button.
        const inputRow = document.createElement("div");
        inputRow.className = "field-input-row";

        const keyboardButton = document.createElement("button");
        keyboardButton.type = "button";
        keyboardButton.className = "hebrew-keyboard-toggle";
        keyboardButton.textContent = "⌨";
        keyboardButton.title = "Open Hebrew keyboard";
        keyboardButton.setAttribute("aria-label", "Open Hebrew keyboard");

        inputRow.append(input, keyboardButton);

        // Keyboard container, initially hidden.
        const keyboard = createHebrewKeyboard(input, updateField);

        keyboardButton.addEventListener("click", () => {
            const shouldOpen = keyboard.hidden;

            // Close other open keyboards.
            container.querySelectorAll(".hebrew-keyboard").forEach(kb => {
                kb.hidden = true;
            });

            container.querySelectorAll(".hebrew-keyboard-toggle").forEach(btn => {
                btn.classList.remove("active");
            });

            keyboard.hidden = !shouldOpen;

            if (shouldOpen) {
                keyboardButton.classList.add("active");
                input.focus();
            }
        });

        fieldWrap.append(label, inputRow, keyboard);
        section.appendChild(fieldWrap);
    });

    if (!rendered.fields.length) {
        container.textContent =
            "This design has no editable wording fields.";
    }
}

function createHebrewKeyboard(input, updateField) {
    const keyboard = document.createElement("div");
    keyboard.className = "hebrew-keyboard";
    keyboard.hidden = true;

    const rows = [
        ["ק", "ר", "א", "ט", "ו", "ן", "ם", "פ"],
        ["ש", "ד", "ג", "כ", "ע", "י", "ח", "ל", "ך", "ף"],
        ["ז", "ס", "ב", "ה", "נ", "מ", "צ", "ת", "ץ"],
        [".", ",", "?", "!", ":", ";", "'", "\"", "־", "׳", "״"]
    ];

    function insertText(text) {
        input.focus();

        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;

        const newValue =
            input.value.slice(0, start) +
            text +
            input.value.slice(end);

        if (newValue.length > input.maxLength) return;

        input.setRangeText(
            text,
            start,
            end,
            "end"
        );

        input.dispatchEvent(new Event("input", { bubbles: true }));
        updateField();
    }

    rows.forEach(chars => {
        const row = document.createElement("div");
        row.className = "hebrew-keyboard-row";

        chars.forEach(char => {
            const key = document.createElement("button");
            key.type = "button";
            key.className = "hebrew-key";
            key.textContent = char;

            key.addEventListener("mousedown", e => e.preventDefault());
            key.addEventListener("click", () => insertText(char));

            row.appendChild(key);
        });

        keyboard.appendChild(row);
    });

    // Special keys.
    const specialRow = document.createElement("div");
    specialRow.className = "hebrew-keyboard-row special-keys";

    function addSpecialKey(text, className, action, title) {
        const key = document.createElement("button");
        key.type = "button";
        key.className = "hebrew-key " + className;
        key.textContent = text;
        key.title = title || text;

        key.addEventListener("mousedown", e => e.preventDefault());
        key.addEventListener("click", action);

        specialRow.appendChild(key);
    }

    addSpecialKey("Space", "space-key", () => insertText(" "), "Insert space");

    addSpecialKey("⌫", "backspace-key", () => {
        input.focus();

        let start = input.selectionStart ?? input.value.length;
        let end = input.selectionEnd ?? start;

        if (start === end && start > 0) {
            start--;
        }

        input.setRangeText("", start, end, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        updateField();
    }, "Backspace");

    addSpecialKey("↵ Enter", "enter-key", () => {
        // A single-line input cannot contain a newline.
        // In that case Enter inserts a space instead.
        insertText(input.tagName === "TEXTAREA" ? "\n" : " ");
    }, "Insert newline");

    keyboard.appendChild(specialRow);

    return keyboard;
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

    if (!rendered || !rendered.pages.length) return;

    activePage = Math.max(
        0,
        Math.min(activePage, rendered.pages.length - 1)
    );

    thumbs.replaceChildren();
    large.replaceChildren();

    rendered.pages.forEach((p, i) => {
        const b = document.createElement("button");
        b.className = "thumb" + (i === activePage ? " active" : "");
        b.type = "button";

        const thumbFrame = document.createElement("div");
        thumbFrame.className = "thumb-frame";
        thumbFrame.append(p.element.cloneNode(true));

        b.append(thumbFrame);

        const label = document.createElement("span");
        label.className = "thumb-label";
        label.textContent = p.page.label;

        b.append(label);

        b.addEventListener("click", () => {
            activePage = i;
            drawPages();
        });

        thumbs.append(b);
    });

    // Display only the selected page in the large preview.
    const activeElement =
        rendered.pages[activePage].element.cloneNode(true);

    large.append(activeElement);

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