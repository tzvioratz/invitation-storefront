import { getStoreData, getInvitation } from "./data.js";
import { renderInvitation, updateRenderedWording } from "./template-renderer.js";
import {calculateEstimate, calculateEffectiveUnitPrice, getQuantityOptions, validatePricing, money } from "./pricing.js";
import { CONFIG } from "./config.js";
import {getActiveAddOns, isAddOnAvailableForInvitation} from "./addons-data.js";
const $ = (s) => document.querySelector(s),
    params = new URLSearchParams(location.search),
    id = params.get("id");
let invitation,
    rendered,
    wording = {},
    selection = {},
    activePage = 0,
    activeFieldId=null;
let availableAddOns = [];
let selectedAddOns = {};
try {
    const data = await getStoreData();
    invitation = getInvitation(data, id);
    if (!invitation) throw new Error("This invitation is not available.");
    $("#editorTitle").textContent = invitation.title;
    $("#returnLink").href = "../invitation/?id=" + encodeURIComponent(id);
// Make sure the invitation's pricing configuration is valid.
validatePricing(invitation);

selection = {
    format: invitation.formats[0],
    paper: invitation.papers[0],
    font: invitation.fonts[0],
    color: invitation.colors[0],
    design: invitation.designOptions[0]
};

buildQuantityOptions();
buildOptions();

// Load and display optional add-ons.
availableAddOns = await getActiveAddOns();

console.log("Add-ons loaded:", availableAddOns);

await buildAddOnControls();

console.log("Add-on controls built.");

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







function updateOptionPrice(key, values, priceElement) {
    const selectedValue = selection[key];

    // First option is the baseline/default option.
    const defaultAdjustment = getOptionAdjustment(key, values[0]);
    const selectedAdjustment = getOptionAdjustment(key, selectedValue);

    const difference = selectedAdjustment - defaultAdjustment;

    priceElement.className = "option-price";

    if (difference > 0.000001) {
        priceElement.textContent =
            `+${money(difference)} per invitation`;
        priceElement.classList.add("price-increase");
    } else if (difference < -0.000001) {
        priceElement.textContent =
            `−${money(Math.abs(difference))} per invitation`;
        priceElement.classList.add("price-decrease");
    } else {
        priceElement.textContent = "No price change";
        priceElement.classList.add("price-neutral");
    }
}


function getOptionAdjustment(key, value) {
    if (key === "format")
        return Number(invitation.formatAdjustments?.[value] || 0);

    if (key === "paper")
        return Number(invitation.paperAdjustments?.[value] || 0);

    if (key === "design")
        return Number(invitation.customizationFees?.[value] || 0);

    return 0;
}

function buildOptions() {
    const groups = [
        ["format", "Card format", invitation.formats],
        ["paper", "Paper", invitation.papers],
        ["font", "Font", invitation.fonts],
        ["color", "Color", invitation.colors],
        ["design", "Design option", invitation.designOptions]
    ];

    const container = $("#optionControls");
    container.replaceChildren();

    groups.filter(g => g[2].length).forEach(([key, label, values]) => {
        const wrapper = document.createElement("div");
        wrapper.className = "option-price-group";

        const heading = document.createElement("label");
        heading.textContent = label;

        const dropdown = document.createElement("div");
        dropdown.className = "custom-price-dropdown";

        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "custom-price-trigger";
        trigger.setAttribute("aria-expanded", "false");

        const menu = document.createElement("div");
        menu.className = "custom-price-menu";
        menu.hidden = true;

        function updateMenu() {
            menu.replaceChildren();

            // Compare every option against the CURRENT selection.
            const currentAdjustment =
                getOptionAdjustment(key, selection[key]);

            values.forEach(value => {
                const difference =
                    getOptionAdjustment(key, value) - currentAdjustment;

                const option = document.createElement("button");
                option.type = "button";
                option.className = "custom-price-option";

                const name = document.createElement("span");
                name.textContent = value;

                const price = document.createElement("span");
                price.className = "dropdown-price " +
                    (difference > 0.000001 ? "price-increase" :
                     difference < -0.000001 ? "price-decrease" :
                     "price-neutral");

                price.textContent = formatAdjustment(difference);

                option.append(name, price);

                option.addEventListener("click", () => {
                    selection[key] = value;
                    updateTrigger();
                    updateMenu();
                    closeMenu();
                    refresh();
                });

                menu.appendChild(option);
            });
        }

        function updateTrigger() {
            trigger.replaceChildren();

            const name = document.createElement("span");
            name.textContent = selection[key];

            const price = document.createElement("span");
            price.className = "dropdown-price price-neutral";
            price.textContent = "";

            trigger.append(name, price);
        }

        function closeMenu() {
            menu.hidden = true;
            trigger.setAttribute("aria-expanded", "false");
        }

        trigger.addEventListener("click", () => {
            const opening = menu.hidden;

            if (opening) updateMenu();

            menu.hidden = !opening;
            trigger.setAttribute("aria-expanded", String(opening));
        });

        updateTrigger();
        updateMenu();

        dropdown.append(trigger, menu);
        document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target)) {
        closeMenu();
    }
});
        heading.appendChild(dropdown);
        wrapper.appendChild(heading);
        container.appendChild(wrapper);
    });
}


async function buildAddOnControls() {
    const container = $("#addOnControls");
    container.replaceChildren();
    selectedAddOns = {};

    const compatibleAddOns = availableAddOns.filter(addOn =>
        isAddOnAvailableForInvitation(addOn, id)
    );

    if (!compatibleAddOns.length) {
        container.textContent =
            "No optional add-ons are currently available.";
        return;
    }

    const invitationQty = Number($("#quantity").value);
    const invitationQuantities = getQuantityOptions(invitation);

    for (const addOn of compatibleAddOns) {
        const min = addOn.quantityMinimum;
        const max = addOn.quantityMaximum;
        const step = Math.max(1, addOn.quantityStep);

        // Use the same quantity choices as the invitation,
        // filtered by this add-on's allowed range and step.
        const quantities = invitationQuantities.filter(qty =>
            qty >= min &&
            qty <= max &&
            Number.isInteger((qty - min) / step)
        );

        const defaultQty = quantities.includes(invitationQty)
            ? invitationQty
            : quantities.length
                ? quantities.reduce((best, qty) =>
                    Math.abs(qty - invitationQty) <
                    Math.abs(best - invitationQty) ? qty : best
                  )
                : min;

        const state = {
            enabled: false,
            quantity: defaultQty,
            design: addOn.designs[0]?.id || "",
            wording: {},
            rendered: null
        };

        selectedAddOns[addOn.id] = state;

        const wrapper = document.createElement("div");
        wrapper.className = "addon-card";

        // Heading.
        const heading = document.createElement("div");
        heading.className = "addon-heading";

        const title = document.createElement("strong");
        title.textContent = addOn.title;

        const description = document.createElement("p");
        description.className = "muted";
        description.textContent = addOn.description;

        heading.append(title, description);

        // Yes / No toggle.
        const toggle = document.createElement("div");
        toggle.className = "addon-yes-no";
        toggle.setAttribute("role", "group");
        toggle.setAttribute("aria-label", `Include ${addOn.title}?`);

        const yesButton = document.createElement("button");
        yesButton.type = "button";
        yesButton.className = "addon-choice-button";
        yesButton.textContent = "Yes";

        const noButton = document.createElement("button");
        noButton.type = "button";
        noButton.className = "addon-choice-button active";
        noButton.textContent = "No";

        function setEnabled(enabled) {
            state.enabled = enabled;

            yesButton.classList.toggle("active", enabled);
            noButton.classList.toggle("active", !enabled);

            yesButton.setAttribute("aria-pressed", String(enabled));
            noButton.setAttribute("aria-pressed", String(!enabled));

            configuration.hidden = !enabled;
            updatePrice();
        }

        yesButton.addEventListener("click", () => setEnabled(true));
        noButton.addEventListener("click", () => setEnabled(false));

        toggle.append(yesButton, noButton);

        // Configuration, hidden until Yes is selected.
        const configuration = document.createElement("div");
        configuration.className = "addon-configuration";
        configuration.hidden = true;

        // Quantity dropdown.
        const quantityLabel = document.createElement("label");
        quantityLabel.textContent = "Quantity";

        const quantitySelect = document.createElement("select");
        quantitySelect.className = "addon-quantity";

        quantities.forEach(qty => {
            quantitySelect.add(
                new Option(qty.toString(), qty.toString())
            );
        });

        if (quantities.length) {
            quantitySelect.value = String(defaultQty);
        } else {
            quantitySelect.disabled = true;
            quantityLabel.append(
                document.createTextNode(
                    " No matching quantities are available."
                )
            );
        }

        quantitySelect.addEventListener("change", () => {
            state.quantity = Number(quantitySelect.value);
            updatePrice();
        });

        quantityLabel.appendChild(quantitySelect);

        // Design choices.
        const designHeading = document.createElement("h4");
        designHeading.textContent = "Choose a design";

        const designsContainer = document.createElement("div");
        designsContainer.className = "addon-design-options";

        for (const design of addOn.designs) {
            const designLabel = document.createElement("label");
            designLabel.className = "addon-design-option";

            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = `addon-design-${addOn.id}`;
            radio.value = design.id;
            radio.checked = design.id === state.design;

            const designTitle = document.createElement("span");
            designTitle.textContent = design.title;

            const preview = document.createElement("div");
            preview.className = "addon-design-preview";

            try {
                await renderInvitation({
                    invitation: { pages: design.pages },
                    target: preview,
                    wording: {},
                    options: {},
                    size: "thumb"
                });
            } catch (error) {
                preview.textContent = "Preview unavailable";
                console.warn(
                    `Could not preview add-on design ${design.id}:`,
                    error
                );
            }

            radio.addEventListener("change", () => {
                if (!radio.checked) return;

                state.design = design.id;
                updatePrice();
            });

            designLabel.append(radio, designTitle, preview);
            designsContainer.appendChild(designLabel);
        }

        configuration.append(
            quantityLabel,
            designHeading,
            designsContainer
        );

        wrapper.append(heading, toggle, configuration);
        container.appendChild(wrapper);
    }
}


function formatAdjustment(amount) {
    if (amount > 0.000001)
        return `+${money(amount)} / invitation`;

    if (amount < -0.000001)
        return `−${money(Math.abs(amount))} / invitation`;

    return "";
}




function buildQuantityOptions() {
    const select = $("#quantity");
    const quantities = getQuantityOptions(invitation);

    select.replaceChildren();

    quantities.forEach(qty => {
        select.add(new Option(qty.toString(), qty.toString()));
    });

    if (quantities.length) {
        select.value = quantities.includes(50)
            ? "50"
            : String(quantities[0]);
    }

    select.addEventListener("change", updatePrice);
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

function calculateAddOnTotal(addOn, state) {
    if (!state.enabled) return 0;

    const qty = state.quantity;

    // Find the applicable per-unit price tier.
    const tier = addOn.quantityPricing.find(t =>
        qty >= t.min && qty <= t.max
    );

    const unitPrice = tier ? tier.unitPrice : 0;

    // One-time base charge plus quantity-based charge.
    let total = addOn.baseCharge + (unitPrice * qty);

    // Add the selected design's price adjustment.
    const design = addOn.designs.find(d =>
        d.id === state.design
    );

    if (design) {
        if (design.priceAdjustmentType === "perUnit") {
            total += design.priceAdjustment * qty;
        } else {
            total += design.priceAdjustment;
        }
    }

    return total;
}

function updatePrice() {
    if (!invitation) return;

    const qty = Number($("#quantity").value);

    if (!getQuantityOptions(invitation).includes(qty)) {
        $("#estimate").textContent = "Estimated order total: —";
        $("#unitEstimate").textContent = "";
        return;
    }

    const invitationTotal = calculateEstimate(
        invitation,
        selection,
        qty
    );

    let addOnTotal = 0;

    for (const [addOnId, state] of Object.entries(selectedAddOns)) {
        if (!state.enabled) continue;

        const addOn = availableAddOns.find(a => a.id === addOnId);
        if (!addOn) continue;

        addOnTotal += calculateAddOnTotal(addOn, state);
    }

    const total = invitationTotal + addOnTotal;

    $("#estimate").textContent =
        "Estimated order total: " + money(total);

    $("#unitEstimate").textContent =
        money(total / qty) + " average per invitation, including add-ons";
}


$("#prevPage").addEventListener("click", () => {
    activePage = Math.max(0, activePage - 1);
    drawPages();
});
$("#nextPage").addEventListener("click", () => {
    activePage = Math.min(rendered.pages.length - 1, activePage + 1);
    drawPages();
});
$("#reviewButton").addEventListener("click", () => {
    const name = $("#customerName").value.trim(),
        email = $("#customerEmail").value.trim(),
        qty = Number($("#quantity").value);
    const validQuantities = getQuantityOptions(invitation);

if (
    !name ||
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !Number.isInteger(qty) ||
    !validQuantities.includes(qty)
) {
    alert(
        "Enter your name, a valid email, and select one of the available quantities."
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
        status.style.whiteSpace = "pre-line";
        status.textContent = `Order request received. 
        Reference: ${result.reference}. 
        We will prepare a proof for your approval. 
        Printing begins only after approval.`;
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

