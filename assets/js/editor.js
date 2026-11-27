import { getStoreData, getInvitation } from "./data.js";
import { renderInvitation, updateRenderedWording, centerAnchoredText } from "./template-renderer.js";
import {
    calculateEstimate,
    calculateEffectiveUnitPrice,
    getQuantityOptions,
    validatePricing,
    money,
    calculateAllAddOnsTotal,
    calculateAddOnTotal
} from "./pricing.js";
import { CONFIG } from "./config.js";
import { getActiveAddOns, isAddOnAvailableForInvitation } from "./addons-data.js";
import { createAdvancedControls } from "./field-advanced.js";
import { getLineHost, createExtraLine, removeExtraLine } from "./line-manager.js";
import { mountEventPicker } from "./event-autofill.js?v5";
import { initTour } from './tour.js';
import steps from './tour-steps.js';
initTour({ steps });

const $ = (s) => document.querySelector(s),
    params = new URLSearchParams(location.search),
    id = params.get("id");
const shrinkBackup = new Map();
let invitation,
    rendered,
    wording = {},
    selection = {},
    activePage = 0,
    activeFieldId = null;
let availableAddOns = [];
let selectedAddOns = {};
let fieldStyles = {};
let revealedHiddenFieldIds = new Set();
let extraLines = [];  
let removedFields = [];


let zoomPreview = null;
let zoomStage = null;
let zoomArtwork = null;
let zoomSlider = null;
let zoomLevel = 1;
let zoomFitScale = 1;
let zoomX = 0;
let zoomY = 0;
let zoomPointers = new Map();
let zoomDrag = null;
let zoomPinch = null;

// Where "Start over" goes. Change this if your home screen is elsewhere.
const HOME_URL = new URL("../", location.href).href;

// Move the review panel to the end of <body> so it can cover the whole screen.
$("#reviewPanel").classList.add("review-overlay");
document.body.append($("#reviewPanel"));

// Make "Continue editing" look like the Submit button.
$("#editOrder").className = $("#submitOrder").className;
$("#editOrder").textContent = "Continue editing";

// Put both buttons in one row so they can be spaced and centered.
const reviewActions = document.createElement("div");
reviewActions.className = "review-actions";
$("#editOrder").before(reviewActions);
reviewActions.append($("#editOrder"), $("#submitOrder"));

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
        design: invitation.designOptions[0]
    };

    buildQuantityOptions();
    buildOptions();

    rendered = await renderInvitation({
        invitation,
        target: document.createElement("div"),
        wording,
        options: selection
    });
    buildFields();
    setupZoomPreview();
    drawPages();
    
    // Date & times picker (autofills fields tagged with data-autofill)
const pickerSlot = document.createElement("div");
$("#fieldControls").before(pickerSlot);

mountEventPicker({
    container: pickerSlot,
    getTargets: () =>
        rendered.fields
            .filter((f) => !removedFields.includes(f.id) && !extraLines.some((e) => e.id === f.id))
            .map((f) => ({
                id: f.id,
                label: f.label,
                maxLength: f.maxLength,
                template:
                    f.autofill ??
                    f.occurrences.map((o) => o.node?.getAttribute?.("data-autofill")).find(Boolean)
            }))
            .filter((t) => t.template),
    setField: (fieldId, value) => {
        wording[fieldId] = value;
        const input = document.querySelector(`#fieldControls [data-field="${CSS.escape(fieldId)}"]`);
        if (input) input.value = value;
    },
    onApplied: () => {
        updateRenderedWording(rendered, wording, fieldStyles, extraLines);
        drawPages();
    },
    actions: {
        canSplit: (fieldId) => {
            const f = rendered.fields.find((x) => x.id === fieldId);
            return !!getLineHost(f?.occurrences[0]?.node);
        },
        split: async (fieldId, first, second) => {
            const entry = createExtraLine(extraLines, fieldId, "below");
            extraLines = [...extraLines, entry];
            if (fieldStyles[fieldId]) fieldStyles[entry.id] = { ...fieldStyles[fieldId] };
            wording[fieldId] = first;
            wording[entry.id] = second;
            await refresh();
            buildFields();
            return entry.id;
        },
        unsplit: async (fieldId, extraId) => {
            extraLines = removeExtraLine(extraLines, extraId);
            delete wording[extraId];
            delete fieldStyles[extraId];
            revealedHiddenFieldIds.delete(extraId);
            await refresh();
            buildFields();
        },
                canShrink: (fieldId) => {
            const f = rendered.fields.find((x) => x.id === fieldId);
            return Number.isFinite(parseFloat(f?.styleDefaults?.fontSize));
        },
        shrink: (fieldId, value) => {
            const f = rendered.fields.find((x) => x.id === fieldId);
            const base = parseFloat(f.styleDefaults.fontSize);
            const wanted = Number(f.maxLength) / value.length;      // e.g. 40 / 59 = 0.68
            const ratio = Math.max(0.6, Math.min(1, wanted));       // never below 60%

            if (!shrinkBackup.has(fieldId)) {
                shrinkBackup.set(fieldId, fieldStyles[fieldId]?.fontSize);   // remember any manual size
            }
            fieldStyles[fieldId] = {
                ...(fieldStyles[fieldId] || {}),
                fontSize: Math.max(6, Math.floor(base * ratio))
            };

            updateRenderedWording(rendered, wording, fieldStyles, extraLines);
            drawPages();
            buildFields();            // refreshes the Size box in "Advanced"
            return wanted >= 0.6;     // false = hit the floor, may still be tight
        },
        unshrink: (fieldId) => {
            const previous = shrinkBackup.get(fieldId);
            shrinkBackup.delete(fieldId);
            const next = { ...(fieldStyles[fieldId] || {}) };
            if (previous == null) delete next.fontSize; else next.fontSize = previous;
            if (Object.keys(next).length) fieldStyles[fieldId] = next;
            else delete fieldStyles[fieldId];

            updateRenderedWording(rendered, wording, fieldStyles, extraLines);
            drawPages();
            buildFields();
        }
    }
});
    
    // Load and display optional add-ons.
    availableAddOns = await getActiveAddOns();

    await buildAddOnControls();

    console.log("Add-on controls built.");

    updatePrice();
} catch (e) {
    $("#editorTitle").textContent = "Unable to load invitation";
    $("#fieldControls").textContent = e.message;
}

function setOverlayOpen(open) {
    document.body.classList.toggle("order-overlay-open", open);
}

function showReview() {
    const panel = $("#reviewPanel");
    $("#submitStatus").textContent = "";
    panel.hidden = false;
    panel.scrollTop = 0;
    setOverlayOpen(true);
    panel.setAttribute("tabindex", "-1");
    panel.focus();
}

function hideReview() {
    $("#reviewPanel").hidden = true;
    setOverlayOpen(false);
}

let orderState = null;

function showOrderState(kind, reference) {
    if (!orderState) {
        orderState = document.createElement("div");
        orderState.className = "order-state";
        orderState.setAttribute("role", "status");
        orderState.setAttribute("aria-live", "polite");
        document.body.append(orderState);
    }

    const box = document.createElement("div");
    box.className = "order-state-box";

    if (kind === "loading") {
        const spinner = document.createElement("div");
        spinner.className = "order-spinner";

        const text = document.createElement("p");
        text.textContent = "Submitting your order…";

        box.append(spinner, text);
    } else {
        const title = document.createElement("h2");
        title.textContent = "Order request received";

        const ref = document.createElement("p");
        ref.innerHTML = "Reference: <strong></strong>";
        ref.querySelector("strong").textContent = reference;

        const note = document.createElement("p");
        note.textContent =
            `We will email you a proof within 72 hours for approval. 
            Printing begins only after approval and payment.`;

        const startOver = document.createElement("button");
        startOver.type = "button";
        startOver.className = $("#submitOrder").className;
        startOver.textContent = "Start over";
        startOver.addEventListener("click", () => { location.href = HOME_URL; });

        box.append(title, ref, note, startOver);
    }

    orderState.replaceChildren(box);
    orderState.hidden = false;
    setOverlayOpen(true);
}

function hideOrderState() {
    if (orderState) orderState.hidden = true;
}

function activateField(fieldId) {
    activeFieldId = fieldId;

    const field = rendered.fields.find((f) => f.id === fieldId);
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
        priceElement.textContent = `+${money(difference)} per invitation`;
        priceElement.classList.add("price-increase");
    } else if (difference < -0.000001) {
        priceElement.textContent = `−${money(Math.abs(difference))} per invitation`;
        priceElement.classList.add("price-decrease");
    } else {
        priceElement.textContent = "No price change";
        priceElement.classList.add("price-neutral");
    }
}

function getOptionAdjustment(key, value) {
    if (key === "format") return Number(invitation.formatAdjustments?.[value] || 0);

    if (key === "paper") return Number(invitation.paperAdjustments?.[value] || 0);

    if (key === "design") return Number(invitation.customizationFees?.[value] || 0);

    return 0;
}

function getOptionBaseFee(key, value) {
    if (key === "design") return Number(invitation.designBaseFees?.[value] || 0);

    return 0;
}

// Combines the per-invitation change and the flat per-order change
// into one label, e.g. "+$0.25 per invitation, +$10.00 per order".
function formatOptionPriceChange(perUnit, flat) {
    const EPS = 0.000001;
    const parts = [];

    if (Math.abs(perUnit) > EPS) parts.push(formatAdjustment(perUnit));

    if (Math.abs(flat) > EPS) {
        parts.push(`${flat > 0 ? "+" : "−"}${money(Math.abs(flat))} / order`);
    }

    // Nothing changes: reuse your existing "no change" wording.
    return parts.length ? parts.join(", ") : formatAdjustment(0);
}

function buildOptions() {
    const groups = [
        ["format", "Card format", invitation.formats],
        ["paper", "Paper", invitation.papers],
        ["design", "Design option", invitation.designOptions]
    ];

    const container = $("#optionControls");
    container.replaceChildren();

    groups
        .filter((g) => g[2].length)
        .forEach(([key, label, values]) => {
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
                const currentAdjustment = getOptionAdjustment(key, selection[key]);
                const currentBaseFee = getOptionBaseFee(key, selection[key]);

                values.forEach((value) => {
                    const difference = getOptionAdjustment(key, value) - currentAdjustment;
                    const baseDifference = getOptionBaseFee(key, value) - currentBaseFee;

                    const EPS = 0.000001;
                    const up = difference > EPS || baseDifference > EPS;
                    const down = difference < -EPS || baseDifference < -EPS;

                    const option = document.createElement("button");
                    option.type = "button";
                    option.className = "custom-price-option";

                    const name = document.createElement("span");
                    name.textContent = value;

                    const price = document.createElement("span");
                    price.className =
                        "dropdown-price " +
                        (up && !down ? "price-increase" : down && !up ? "price-decrease" : "price-neutral");

                    price.textContent = formatOptionPriceChange(difference, baseDifference);

                    option.append(name, price);

                    option.addEventListener("click", () => {
    selection[key] = value;

    // Switching to plain Black resets all custom field colors.
    if (
        key === "design" &&
        String(value).trim().toLowerCase() === "black"
    ) {
        Object.keys(fieldStyles).forEach(fieldId => {
            if (fieldStyles[fieldId]) {
                delete fieldStyles[fieldId].color;

                if (Object.keys(fieldStyles[fieldId]).length === 0) {
                    delete fieldStyles[fieldId];
                }
            }
        });
    }

    updateTrigger();
    updateMenu();
    closeMenu();

    refresh();

    // Rebuild advanced panels to show/hide the color controls.
    if (key === "design") {
        buildFields();
    }
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

    const compatibleAddOns = availableAddOns.filter((addOn) => isAddOnAvailableForInvitation(addOn, id));

    if (!compatibleAddOns.length) {
        container.textContent = "No optional add-ons are currently available.";
        return;
    }

    const invitationQty = Number($("#quantity").value);

    for (const addOn of compatibleAddOns) {
        const min = addOn.quantityMinimum;
        const max = addOn.quantityMaximum;
        const step = Math.max(1, addOn.quantityStep);

        const quantities = [];

        for (let qty = min; qty <= max; qty += step) {
            quantities.push(qty);
        }

        const defaultQty = quantities.includes(invitationQty)
            ? invitationQty
            : quantities.length
              ? quantities.reduce((best, qty) =>
                    Math.abs(qty - invitationQty) < Math.abs(best - invitationQty) ? qty : best
                )
              : min;

        const state = {
            enabled: false,
            quantity: defaultQty,
            design: addOn.designs[0]?.id || "",
            wordingByDesign: {},
            customInfo: {},
            rendered: null,
            revealedHiddenFieldIdsByDesign: {},
        };

        selectedAddOns[addOn.id] = state;

        const wrapper = document.createElement("div");
        wrapper.className = "addon-card";

        // Heading
        const heading = document.createElement("div");
        heading.className = "addon-heading";

        const title = document.createElement("strong");
        title.textContent = addOn.title;

        const description = document.createElement("p");
        description.className = "muted";
        description.textContent = addOn.description;

        heading.append(title, description);

        // Yes / No toggle
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

        // Configuration area
        const configuration = document.createElement("div");
        configuration.className = "addon-configuration";
        configuration.hidden = true;

        function setEnabled(enabled) {
            state.enabled = enabled;

            yesButton.classList.toggle("active", enabled);
            noButton.classList.toggle("active", !enabled);

            yesButton.setAttribute("aria-pressed", String(enabled));
            noButton.setAttribute("aria-pressed", String(!enabled));

            configuration.hidden = !enabled;
            if (enabled) centerAnchoredText(configuration);
            updatePrice();
        }

        yesButton.addEventListener("click", () => setEnabled(true));
        noButton.addEventListener("click", () => setEnabled(false));

        toggle.append(yesButton, noButton);

        // Custom quantity dropdown with price differences.
        const quantityLabel = document.createElement("label");
        quantityLabel.className = "addon-quantity-label";
        quantityLabel.textContent = "Quantity";

        const quantityDropdown = document.createElement("div");
        quantityDropdown.className = "custom-price-dropdown";

        const quantityTrigger = document.createElement("button");
        quantityTrigger.type = "button";
        quantityTrigger.className = "custom-price-trigger";

        const quantityMenu = document.createElement("div");
        quantityMenu.className = "custom-price-menu";
        quantityMenu.hidden = true;

        const quantityPrice = document.createElement("span");
        quantityPrice.className = "addon-current-price";

        function updateQuantityMenu() {
            quantityMenu.replaceChildren();

            const currentDesign = addOn.designs.find((d) => d.id === state.design);

            quantities.forEach((qty) => {
                const total = calculateAddOnTotal(addOn, currentDesign, qty);

                const perItem = total / qty;

                const option = document.createElement("button");
                option.type = "button";
                option.className = "custom-price-option";

                const name = document.createElement("span");
                name.textContent = qty;

                const price = document.createElement("span");
                price.className = "dropdown-price";
                price.textContent = `(${money(total)} · ${money(perItem)}/each)`;

                option.append(name, price);

                option.addEventListener("click", () => {
                    state.quantity = qty;

                    updateQuantityTrigger();
                    updateAddOnPriceDisplays();
                    updatePrice();

                    quantityMenu.hidden = true;
                    quantityTrigger.setAttribute("aria-expanded", "false");
                });

                quantityMenu.appendChild(option);
            });
        }

        function updateQuantityTrigger() {
            quantityTrigger.replaceChildren();

            const currentDesign = addOn.designs.find((d) => d.id === state.design);

            const total = calculateAddOnTotal(addOn, currentDesign, state.quantity);

            const perItem = total / state.quantity;

            const name = document.createElement("span");
            name.textContent = state.quantity;

            const price = document.createElement("span");
            price.className = "dropdown-price";
            price.textContent = `(${money(total)} · ${money(perItem)}/each)`;

            quantityTrigger.append(name, price);
        }

        quantityTrigger.addEventListener("click", () => {
            const opening = quantityMenu.hidden;

            if (opening) updateQuantityMenu();

            quantityMenu.hidden = !opening;
            quantityTrigger.setAttribute("aria-expanded", String(opening));
        });

        // Close dropdown when clicking anywhere outside it.
        document.addEventListener("click", (event) => {
            if (!quantityDropdown.contains(event.target)) {
                quantityMenu.hidden = true;
                quantityTrigger.setAttribute("aria-expanded", "false");
            }
        });

        quantityDropdown.append(quantityTrigger, quantityMenu);
        quantityLabel.appendChild(quantityDropdown);

        // Design choices
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

            const designPrice = document.createElement("span");
            designPrice.className = "addon-design-price dropdown-price";

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
                console.warn(error);
            }

            radio.addEventListener("change", async () => {
                if (!radio.checked) return;

                state.design = design.id;

                // Render the newly selected design and its editable fields.
                await renderAddOnSelection(addOn, state, selectedPreview, fieldsContainer);
                updateAddOnPriceDisplays();
                updatePrice();
            });

            designLabel.append(radio, designTitle, designPrice, preview);
            designsContainer.appendChild(designLabel);
        }

        // Full preview of the selected design
        const selectedPreviewHeading = document.createElement("h4");
        selectedPreviewHeading.textContent = "Selected design preview";

        const selectedPreview = document.createElement("div");
        selectedPreview.className = "addon-selected-preview";

        // Editable wording fields discovered from the template
        const fieldsHeading = document.createElement("h4");
        fieldsHeading.textContent = "Personalize this add-on";

        const fieldsContainer = document.createElement("div");
        fieldsContainer.className = "addon-field-controls";

        // Extra information not printed in the template
        const customFieldsContainer = document.createElement("div");
        customFieldsContainer.className = "addon-custom-fields";

        buildAddOnCustomFields(addOn, state, customFieldsContainer);

        function updateAddOnPriceDisplays() {
            updateQuantityTrigger();
            updateQuantityMenu();

            for (const label of designsContainer.children) {
                const radio = label.querySelector("input");
                const priceElement = label.querySelector(".addon-design-price");

                const candidateDesign = addOn.designs.find((d) => d.id === radio.value);

                const candidateTotal = calculateAddOnTotal(addOn, candidateDesign, state.quantity);

                // Show the actual total price, not the difference.
                priceElement.textContent = money(candidateTotal);
                priceElement.classList.remove("price-increase", "price-decrease", "price-neutral");
            }
        }

        updateAddOnPriceDisplays();
        configuration.append(
            quantityLabel,
            designHeading,
            designsContainer,
            selectedPreviewHeading,
            selectedPreview,
            fieldsHeading,
            fieldsContainer,
            customFieldsContainer
        );

        wrapper.append(heading, toggle, configuration);
        container.appendChild(wrapper);

        // Render the initially selected design.
        if (state.design) {
            await renderAddOnSelection(addOn, state, selectedPreview, fieldsContainer);
        } else {
            setAddOnSectionVisible(selectedPreview, false);
            setAddOnSectionVisible(fieldsContainer, false);
        }
    } // end of for loop
}     // end of buildAddOnControls
        
// Shows or hides a section's content together with the <h4> heading right before it.
function setAddOnSectionVisible(container, visible) {
    container.hidden = !visible;
    const heading = container.previousElementSibling;
    if (heading?.tagName === "H4") heading.hidden = !visible;
}

async function renderAddOnSelection(addOn, state, previewContainer, fieldsContainer) {
    const design = addOn.designs.find((d) => d.id === state.design);

    previewContainer.replaceChildren();
    fieldsContainer.replaceChildren();

    if (!design || !design.pages?.length) {
        setAddOnSectionVisible(previewContainer, false);
        setAddOnSectionVisible(fieldsContainer, false);
        state.rendered = null;
        return;
    }

    setAddOnSectionVisible(previewContainer, true);

    // Keep wording separate for each design.
    if (!state.wordingByDesign[state.design]) {
        state.wordingByDesign[state.design] = {};
    }

    const wording = state.wordingByDesign[state.design];

    try {
        state.rendered = await renderInvitation({
            invitation: { pages: design.pages },
            target: previewContainer,
            wording,
            options: {}
        });

        buildAddOnWordingFields(state, state.rendered, wording, fieldsContainer);
    } catch (error) {
        previewContainer.textContent = "Preview unavailable.";
        console.error(`Could not render ${addOn.title}:`, error);
    }

    // Only show "Personalize this add-on" if there is something in it.
    setAddOnSectionVisible(fieldsContainer, fieldsContainer.childElementCount > 0);
}

function buildAddOnWordingFields(state,rendered,wording,container) {
    container.replaceChildren();

if (!rendered?.fields?.length) {
        return;
    }

    if (!state.revealedHiddenFieldIdsByDesign) {
        state.revealedHiddenFieldIdsByDesign = {};
    }

    const designId = state.design || "default";

    if (!state.revealedHiddenFieldIdsByDesign[designId]) {
        state.revealedHiddenFieldIdsByDesign[designId] = new Set();
    }

    const revealedIds =
        state.revealedHiddenFieldIdsByDesign[designId];

    const hiddenGroups = getHiddenFieldGroups(rendered.fields);
    const hiddenGroupByField = new Map();

    hiddenGroups.forEach(group => {
        group.forEach(field => {
            hiddenGroupByField.set(field, group);
        });
    });

    rendered.fields.forEach(field => {

        if (
            field.hiddenFromEditor &&
            !revealedIds.has(field.id)
        ) {
            const group = hiddenGroupByField.get(field);

            if (group[0] === field) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "show-more-fields";
                button.textContent =
                    `+ Show ${group.length} hidden field${group.length === 1 ? "" : "s"}`;

                button.addEventListener("click", () => {
                    group.forEach(groupField => {
                        revealedIds.add(groupField.id);
                    });

                    buildAddOnWordingFields(
                        state,
                        rendered,
                        wording,
                        container
                    );
                });

                container.appendChild(button);
            }

            return;
        }

        const fieldWrap = document.createElement("div");
        fieldWrap.className = "field-control-wrap";

        if (field.hiddenFromEditor) {
            fieldWrap.classList.add("field-revealed");
        }

        const label = document.createElement("label");
        label.className = "field-control";
        label.textContent =
            field.label + (field.required ? " *" : "");

        const input = field.multiline
            ? document.createElement("textarea")
            : document.createElement("input");

        input.dataset.field = field.id;
        input.placeholder = field.placeholder;
        input.maxLength = field.maxLength;

        input.value =
            wording[field.id] ?? field.defaultValue ?? "";

        if (field.required) {
            input.required = true;
        }

        input.addEventListener("input", () => {
            wording[field.id] = input.value;
            updateRenderedWording(rendered, wording);
        });

        label.appendChild(input);
        fieldWrap.appendChild(label);
        container.appendChild(fieldWrap);
    });

    // One hide button for all revealed fields in this add-on design.
    const revealedFields = rendered.fields.filter(field =>
        field.hiddenFromEditor && revealedIds.has(field.id)
    );

    if (revealedFields.length) {
        const hideButton = document.createElement("button");
        hideButton.type = "button";
        hideButton.className = "hide-revealed-fields";
        hideButton.textContent = "Hide optional fields";

        hideButton.addEventListener("click", () => {
            revealedFields.forEach(field => {
                revealedIds.delete(field.id);
            });

            buildAddOnWordingFields(
                state,
                rendered,
                wording,
                container
            );
        });

        container.appendChild(hideButton);
    }
}

function buildAddOnCustomFields(addOn, state, container) {
    container.replaceChildren();

    const customFields = Array.isArray(addOn.customFields) ? addOn.customFields : [];

    customFields.forEach((field) => {
        const wrapper = document.createElement("div");
        wrapper.className = "field-control-wrap";

        const label = document.createElement("label");
        label.className = "field-control";
        label.textContent = field.label + (field.required ? " *" : "");

        const input = field.type === "textarea" ? document.createElement("textarea") : document.createElement("input");

        input.dataset.customField = field.id;
        input.placeholder = field.placeholder || "";
        input.value = state.customInfo[field.id] || "";

        if (field.required) input.required = true;

        input.addEventListener("input", () => {
            state.customInfo[field.id] = input.value;
        });

        label.appendChild(input);
        wrapper.appendChild(label);
        container.appendChild(wrapper);
    });
}

function formatAdjustment(amount) {
    if (amount > 0.000001) return `+${money(amount)} / invitation`;

    if (amount < -0.000001) return `−${money(Math.abs(amount))} / invitation`;

    return "";
}

function formatPriceDifference(amount) {
    if (amount > 0.000001) return `+$${amount.toFixed(2)}`;

    if (amount < -0.000001) return `−$${Math.abs(amount).toFixed(2)}`;

    return "No price change";
}

function setPriceDifference(element, amount) {
    element.textContent = formatPriceDifference(amount);

    element.classList.remove("price-increase", "price-decrease", "price-neutral");

    element.classList.add(
        amount > 0.000001 ? "price-increase" : amount < -0.000001 ? "price-decrease" : "price-neutral"
    );
}

function buildQuantityOptions() {
    const quantityInput = $("#quantity");
    const trigger = $("#mainQuantityTrigger");
    const menu = $("#mainQuantityMenu");
    const dropdown = $("#mainQuantityDropdown");

    const quantities = getQuantityOptions(invitation);

    quantityInput.value = quantities.includes(50) ? "50" : quantities.length ? String(quantities[0]) : "";

    function closeMenu() {
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
    }

    function updateTrigger() {
        trigger.replaceChildren();

        const qty = Number(quantityInput.value);

        if (!qty) {
            trigger.textContent = "Select quantity";
            return;
        }

        const total = calculateEstimate(invitation, selection, qty);
        const perItem = total / qty;

        const name = document.createElement("span");
        name.textContent = qty;

        const price = document.createElement("span");
        price.className = "dropdown-price";
        price.textContent = `( $ ${total.toFixed(2)} · $ ${perItem.toFixed(2)}/each)`;

        trigger.append(name, price);
    }

    function updateMenu() {
        menu.replaceChildren();

        quantities.forEach((qty) => {
            const total = calculateEstimate(invitation, selection, qty);
            const perItem = total / qty;

            const option = document.createElement("button");
            option.type = "button";
            option.className = "custom-price-option";

            const name = document.createElement("span");
            name.textContent = qty;

            const price = document.createElement("span");
            price.className = "dropdown-price";
            price.textContent = `( $ ${total.toFixed(2)} · $ ${perItem.toFixed(2)}/each)`;

            option.append(name, price);

            option.addEventListener("click", () => {
                quantityInput.value = String(qty);

                updateTrigger();
                closeMenu();
                updatePrice();
            });

            menu.appendChild(option);
        });
    }

    trigger.addEventListener("click", () => {
        const opening = menu.hidden;

        if (opening) {
            updateMenu();
        }

        menu.hidden = !opening;
        trigger.setAttribute("aria-expanded", String(opening));
    });

    document.addEventListener("click", (event) => {
        if (!dropdown.contains(event.target)) {
            closeMenu();
        }
    });

    updateMenu();
    updateTrigger();
}

function updateQuantityOptionPrices() {
    const trigger = $("#mainQuantityTrigger");
    const menu = $("#mainQuantityMenu");

    if (!trigger || !menu || !invitation) return;

    const qty = Number($("#quantity").value);

    if (qty) {
        const total = calculateEstimate(invitation, selection, qty);
        const perItem = total / qty;

        trigger.replaceChildren();

        const name = document.createElement("span");
        name.textContent = qty;

        const price = document.createElement("span");
        price.className = "dropdown-price";
        price.textContent = `( $ ${total.toFixed(2)} · $ ${perItem.toFixed(2)}/each)`;

        trigger.append(name, price);
    }

    // Refresh all available quantity prices.
    const quantities = getQuantityOptions(invitation);
    menu.replaceChildren();

    quantities.forEach((q) => {
        const total = calculateEstimate(invitation, selection, q);
        const perItem = total / q;

        const option = document.createElement("button");
        option.type = "button";
        option.className = "custom-price-option";

        const name = document.createElement("span");
        name.textContent = q;

        const price = document.createElement("span");
        price.className = "dropdown-price";
        price.textContent = `( $ ${total.toFixed(2)} · $ ${perItem.toFixed(2)}/each)`;

        option.append(name, price);

        option.addEventListener("click", () => {
            $("#quantity").value = String(q);

            updateQuantityOptionPrices();
            updatePrice();

            menu.hidden = true;
            trigger.setAttribute("aria-expanded", "false");
        });

        menu.appendChild(option);
    });
}

function getHiddenFieldGroups(fields) {
    const groups = [];
    let currentGroup = [];

    fields.forEach(field => {
        if (field.hiddenFromEditor) {
            currentGroup.push(field);
        } else {
            if (currentGroup.length) {
                groups.push(currentGroup);
                currentGroup = [];
            }
        }
    });

    if (currentGroup.length) {
        groups.push(currentGroup);
    }

    return groups;
}

function buildFields() {
    const container = $("#fieldControls");
    container.replaceChildren();
    
    const activeFields = rendered.fields.filter((f) => !removedFields.includes(f.id));

    if (!rendered.fields.length) {
        container.textContent =
            "This design has no editable wording fields.";
        return;
    }

    const sections = invitation.pages.map(page => {
        const section = document.createElement("div");
        section.className = "field-page-section";

        const heading = document.createElement("h3");
        heading.textContent = page.label;

        section.appendChild(heading);
        container.appendChild(section);

        return section;
    });

    // Identify separate groups of consecutive hidden fields.
    const hiddenGroups = getHiddenFieldGroups(activeFields);
    const hiddenGroupByField = new Map();

    hiddenGroups.forEach(group => {
        group.forEach(field => {
            hiddenGroupByField.set(field, group);
        });
    });

    const revealedContainers = new Map();
    // Render fields in their original order.
    activeFields.forEach(f => {

        if (
            f.hiddenFromEditor &&
            !revealedHiddenFieldIds.has(f.id)
        ) {
            const group = hiddenGroupByField.get(f);

            if (group[0] === f) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "show-more-fields";
                button.textContent =
                    `+ Show ${group.length} hidden field${group.length === 1 ? "" : "s"}`;

                button.addEventListener("click", () => {
                    group.forEach(field => {
                        revealedHiddenFieldIds.add(field.id);
                    });
                    buildFields();
                });

                const pageIndex =
                    f.occurrences[0]?.pageIndex ?? 0;

                sections[pageIndex].appendChild(button);
            }

            return;
        }

        const pageIndex = f.occurrences[0]?.pageIndex ?? 0;
        const section = sections[pageIndex];

        const fieldWrap = document.createElement("div");
        fieldWrap.className = "field-control-wrap";

        if (f.hiddenFromEditor) {
            fieldWrap.classList.add("field-revealed");
        }

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
            updateRenderedWording(rendered, wording, fieldStyles, extraLines);
            drawPages();
        };

        input.addEventListener("input", updateField);
        input.addEventListener("blur", updateField);

        label.appendChild(input);

        const inputRow = document.createElement("div");
        inputRow.className = "field-input-row";

        const keyboardButton = document.createElement("button");
        keyboardButton.type = "button";
        keyboardButton.className = "hebrew-keyboard-toggle";
        keyboardButton.textContent = "⌨";
        keyboardButton.setAttribute(
            "data-tooltip",
            "Open Hebrew keyboard"
        );
        keyboardButton.setAttribute(
            "aria-label",
            "Open Hebrew keyboard"
        );

        const labelRow = document.createElement("div");
        labelRow.className = "field-label-row";
        labelRow.appendChild(label);
        
const isExtra = extraLines.some((e) => e.id === f.id);
const tools = document.createElement("span");
tools.className = "field-line-tools";

if (getLineHost(f.occurrences[0]?.node)) {
    tools.append(
        lineButton("↑ Add line", "Add a line above", () => insertLine(f.id, "above")),
        lineButton("↓ Add line", "Add a line below", () => insertLine(f.id, "below"))
    );
}
if (isExtra) {
    tools.append(lineButton("✕ Remove", "Remove this line", () => removeLine(f.id), "danger"));
} else if (!f.required) {
    tools.append(lineButton("✕ Remove", "Remove this line from the invitation", () => removeTemplateLine(f.id), "danger"));
}


        

        inputRow.append(input, keyboardButton);

        let advancedPanel = null;

        if (f.advanced) {
            const adv = createAdvancedControls(
                f,
                fieldStyles,
                () => {
                    updateRenderedWording(
                        rendered, wording, fieldStyles, extraLines
                    );
                    drawPages();
                },
                selection.design
            );

            labelRow.append(adv.toggle);
            advancedPanel = adv.panel;
            if (tools.children.length) advancedPanel.append(tools);         
        }
        if (!advancedPanel && tools.children.length) labelRow.append(tools);

        const keyboard = createHebrewKeyboard(input, updateField);

        keyboardButton.addEventListener("click", () => {
            const shouldOpen = keyboard.hidden;

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

        fieldWrap.append(labelRow, inputRow, keyboard);

        if (advancedPanel) {
            fieldWrap.append(advancedPanel);
        }

        section.appendChild(fieldWrap);
    });

// One "Hide optional fields" button after each revealed group.
hiddenGroups.forEach((group) => {
    const revealed = group.filter((f) => revealedHiddenFieldIds.has(f.id));
    if (!revealed.length) return;

    const lastField = revealed[revealed.length - 1];

    const lastWrapper = container
        .querySelector(`[data-field="${CSS.escape(lastField.id)}"]`)
        ?.closest(".field-control-wrap");

    if (!lastWrapper) return;

    const hideButton = document.createElement("button");
    hideButton.type = "button";
    hideButton.className = "hide-revealed-fields";
    hideButton.textContent = "Hide optional fields";

    hideButton.addEventListener("click", () => {
        // Only this group is hidden again; other open groups stay open.
        group.forEach((f) => revealedHiddenFieldIds.delete(f.id));
        buildFields();
    });

    lastWrapper.after(hideButton);
});
sections.forEach((section, pageIndex) => {
    const gone = rendered.fields.filter(
        (f) => removedFields.includes(f.id) && (f.occurrences[0]?.pageIndex ?? 0) === pageIndex
    );
    if (!gone.length) return;

    const box = document.createElement("div");
    box.className = "removed-lines";

    const title = document.createElement("strong");
    title.textContent = `Removed lines (${gone.length})`;
    box.appendChild(title);

    gone.forEach((f) => {
        const row = document.createElement("div");
        row.className = "removed-line-row";

        const name = document.createElement("span");
        name.textContent = f.label;

        row.append(name, lineButton("↺ Restore", `Restore ${f.label}`, () => restoreLine(f.id)));
        box.appendChild(row);
    });

    section.appendChild(box);
});    
}

function createHebrewKeyboard(input, updateField) {
    const keyboard = document.createElement("div");
    keyboard.className = "hebrew-keyboard";
    keyboard.hidden = true;

    const rows = [
        ["ק", "ר", "א", "ט", "ו", "ן", "ם", "פ"],
        ["ש", "ד", "ג", "כ", "ע", "י", "ח", "ל", "ך", "ף"],
        ["ז", "ס", "ב", "ה", "נ", "מ", "צ", "ת", "ץ"],
        [".", ",", "?", "!", ":", ";", "'", '"', "־", "׳", "״"]
    ];

    function insertText(text) {
        input.focus();

        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;

        const newValue = input.value.slice(0, start) + text + input.value.slice(end);

        if (newValue.length > input.maxLength) return;

        input.setRangeText(text, start, end, "end");

        input.dispatchEvent(new Event("input", { bubbles: true }));
        updateField();
    }

    rows.forEach((chars) => {
        const row = document.createElement("div");
        row.className = "hebrew-keyboard-row";

        chars.forEach((char) => {
            const key = document.createElement("button");
            key.type = "button";
            key.className = "hebrew-key";
            key.textContent = char;

            key.addEventListener("mousedown", (e) => e.preventDefault());
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

        key.addEventListener("mousedown", (e) => e.preventDefault());
        key.addEventListener("click", action);

        specialRow.appendChild(key);
    }

    addSpecialKey("Space", "space-key", () => insertText(" "), "Insert space");

    addSpecialKey(
        "⌫",
        "backspace-key",
        () => {
            input.focus();

            let start = input.selectionStart ?? input.value.length;
            let end = input.selectionEnd ?? start;

            if (start === end && start > 0) {
                start--;
            }

            input.setRangeText("", start, end, "end");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            updateField();
        },
        "Backspace"
    );

    addSpecialKey(
        "↵ Enter",
        "enter-key",
        () => {
            // A single-line input cannot contain a newline.
            // In that case Enter inserts a space instead.
            insertText(input.tagName === "TEXTAREA" ? "\n" : " ");
        },
        "Insert newline"
    );

    keyboard.appendChild(specialRow);

    return keyboard;
}

function highlightActiveField(activeElement) {
    const matches = [...activeElement.querySelectorAll("[data-field]")].filter(
        (el) => el.getAttribute("data-field") === activeFieldId
    );

    matches.forEach((el) => {
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

            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");

            rect.setAttribute("x", bounds.x - 8);
            rect.setAttribute("y", bounds.y - 8);
            rect.setAttribute("width", bounds.width + 16);
            rect.setAttribute("height", bounds.height + 16);
            rect.setAttribute("rx", "5");
            rect.setAttribute("class", "field-highlight-box");
            const t = el.closest("text")?.getAttribute("transform");
            if (t) rect.setAttribute("transform", t);

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

    activePage = Math.max(0, Math.min(activePage, rendered.pages.length - 1));

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
        centerAnchoredText(thumbFrame);  
    });

    // Display only the selected page in the large preview.
    const activeElement = rendered.pages[activePage].element.cloneNode(true);

    large.append(activeElement);
    centerAnchoredText(activeElement);
    syncZoomPreview();

    if (activeFieldId) {
        highlightActiveField(activeElement);
    }

    $("#pageLabel").textContent =
        `${rendered.pages[activePage].page.label} · Page ${activePage + 1} of ${rendered.pages.length}`;
    
    const k = Number(activeElement.querySelector("svg")?.dataset.flowScale || 1);
if (k < 0.995) $("#pageLabel").textContent += ` · text scaled to ${Math.round(k * 100)}%`;

    $("#prevPage").disabled = activePage === 0;
    $("#nextPage").disabled = activePage === rendered.pages.length - 1;
}

function refresh() {
    const target = document.createElement("div");
    return renderInvitation({
        invitation,
        target,
        wording,
        styles: fieldStyles,
        extraLines,
        removedFields,
        options: selection
    }).then((r) => {
        rendered = r;
        drawPages();
        updatePrice();
    });
}

function updatePrice() {
    if (!invitation) return;
    updateQuantityOptionPrices();
    const qty = Number($("#quantity").value);
    const invoice = $("#orderInvoice");

    const liveTotal = document.getElementById("liveOrderTotalAmount");

    // Validate quantity.
    if (!getQuantityOptions(invitation).includes(qty)) {
        $("#estimate").textContent = "Estimated order total: —";
        $("#unitEstimate").textContent = "";

        if (invoice) {
            invoice.replaceChildren();

            const message = document.createElement("p");
            message.className = "muted";
            message.textContent = "Select a quantity to see your invoice.";

            invoice.appendChild(message);
        }

        if (liveTotal) liveTotal.textContent = "—";

        return;
    }

    // Calculate invitation price.
    // Calculate invitation price.
    const invitationTotal = calculateEstimate(invitation, selection, qty);

    let addOnTotal = 0;

    const invoiceItems = []; // must come first

    // Invitation line item (replacement block starts here).
    const designBaseFee = Number(invitation.designBaseFees?.[selection.design] || 0);
    const cardsTotal = invitationTotal - designBaseFee;

    invoiceItems.push({
        title: invitation.title,
        description: `${qty} invitations · ${money(cardsTotal / qty)} each`,
        price: cardsTotal
    });

    if (designBaseFee > 0) {
        invoiceItems.push({
            title: "Design fee",
            description: selection.design,
            price: designBaseFee
        });
    }

    // Calculate each selected add-on separately.
    for (const [addOnId, state] of Object.entries(selectedAddOns)) {
        if (!state.enabled) continue;

        const addOn = availableAddOns.find((a) => a.id === addOnId);
        if (!addOn) continue;

        const design = addOn.designs?.find((d) => d.id === state.design);

        const itemTotal = calculateAddOnTotal(addOn, design, state.quantity);

        addOnTotal += itemTotal;

        invoiceItems.push({
            title: addOn.title,
            description: `${state.quantity} units` + (design ? ` · ${design.title}` : ""),
            price: itemTotal
        });
    }

    // Calculate grand total.
    const total = invitationTotal + addOnTotal;

    // Update the floating total.
    if (liveTotal) {
        liveTotal.textContent = money(total);
    }

    // Update the existing estimate text for order review.
    $("#estimate").textContent = "Estimated order total: " + money(total);

    $("#unitEstimate").textContent = money(invitationTotal / qty) + " average per invitation, not including add-ons";

    // Build the itemized invoice.
    if (!invoice) return;

    invoice.replaceChildren();

    // Invoice heading.
    const heading = document.createElement("h3");
    heading.className = "invoice-heading";
    heading.textContent = "Order Summary";

    invoice.appendChild(heading);

    // Invoice items.
    invoiceItems.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "invoice-item";

        const details = document.createElement("div");
        details.className = "invoice-item-details";

        const title = document.createElement("strong");
        title.className = "invoice-item-title";
        title.textContent = item.title;

        const description = document.createElement("span");
        description.className = "invoice-item-description";
        description.textContent = item.description;

        details.append(title, description);

        const price = document.createElement("strong");
        price.className = "invoice-item-price";
        price.textContent = money(item.price);

        row.append(details, price);

        invoice.appendChild(row);
    });

    // Divider.
    const divider = document.createElement("div");
    divider.className = "invoice-divider";

    invoice.appendChild(divider);

    // Grand total.
    const totalRow = document.createElement("div");
    totalRow.className = "invoice-total";

    const totalLabel = document.createElement("strong");
    totalLabel.textContent = "Total";

    const totalAmount = document.createElement("strong");
    totalAmount.className = "invoice-total-amount";
    totalAmount.textContent = money(total);

    totalRow.append(totalLabel, totalAmount);

    invoice.appendChild(totalRow);
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
    const name = $("#customerName").value.trim();
    const email = $("#customerEmail").value.trim();
    const qty = Number($("#quantity").value);

    const validQuantities = getQuantityOptions(invitation);

    if (
        !name ||
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !Number.isInteger(qty) ||
        !validQuantities.includes(qty)
    ) {
        alert("Enter your name, a valid email, and select one of the available quantities.");
        return;
    }

    // Validate enabled add-ons.
    for (const [addOnId, state] of Object.entries(selectedAddOns)) {
        if (!state.enabled) continue;

        const addOn = availableAddOns.find((a) => a.id === addOnId);
        if (!addOn) continue;

        const wording = state.wordingByDesign?.[state.design] || {};

        // Validate required template wording.
        if (state.rendered) {
            for (const field of state.rendered.fields) {
                if (!field.required) continue;

                const value = wording[field.id] ?? field.defaultValue ?? "";

                if (!String(value).trim()) {
                    alert(`Please complete "${field.label}" for ${addOn.title}.`);
                    return;
                }
            }
        }

        // Validate extra information, such as a return address.
        for (const field of addOn.customFields || []) {
            if (!field.required) continue;

            if (!String(state.customInfo?.[field.id] || "").trim()) {
                alert(`Please enter "${field.label}" for ${addOn.title}.`);
                return;
            }
        }
    }

    // Collect selected add-ons BEFORE building the summary.
    const orderAddOns = Object.entries(selectedAddOns)
        .filter(([addOnId, state]) => state.enabled)
        .map(([addOnId, state]) => ({
            addOnId,
            quantity: Number(state.quantity),
            designId: state.design,
            wording: state.wordingByDesign?.[state.design] || {},
            customInfo: { ...(state.customInfo || {}) }
        }));

    // Build order summary.
    const summary = {
        Invitation: invitation.title,
        Format: selection.format,
        Paper: selection.paper,
        Design: selection.design,
        Quantity: qty,
        Name: name,
        Email: email,
        Phone: $("#customerPhone").value,
        Notes: $("#orderNotes").value,
        Estimate: $("#estimate").textContent
    };

    summary["Add-ons"] = orderAddOns.length
        ? orderAddOns
              .map((addOn) => {
                  const definition = availableAddOns.find((a) => a.id === addOn.addOnId);

                  const design = definition?.designs.find((d) => d.id === addOn.designId);

                  return `${definition?.title || addOn.addOnId} — ${design?.title || ""} — Quantity: ${addOn.quantity}`;
              })
              .join("; ")
        : "None";

    // Save pending order.
    window.pendingOrder = {
        invitationId: id,
        selection,
        wording,
        fieldStyles: { ...fieldStyles },
        quantity: qty,
        addOns: orderAddOns,
        customer: {
            name,
            email,
            phone: $("#customerPhone").value,
            notes: $("#orderNotes").value
        },
        extraLines: extraLines.map((e) => ({ ...e })),
        removedFields: [...removedFields]
    };

    $("#reviewSummary").innerHTML =
        "<dl>" +
        Object.entries(summary)
            .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
            .join("") +
        "</dl>";

    showReview();
});

$("#editOrder").addEventListener("click", hideReview);
$("#submitOrder").addEventListener("click", async () => {
    const status = $("#submitStatus");
    status.textContent = "";
    $("#submitOrder").disabled = true;

    $("#reviewPanel").hidden = true;   // the page stays locked; the loader takes over
    showOrderState("loading");

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

        showOrderState("done", result.reference);
    } catch (e) {
        // Back to the review screen so they can try again.
        hideOrderState();
        $("#reviewPanel").hidden = false;
        status.textContent =
            `We could not confirm your order: ${e.message}. Please try again or contact the business. Do not assume your request was received.`;
    } finally {
        $("#submitOrder").disabled = false;
    }
});

const togglePageSelector = $("#togglePageSelector");
const previewPanel = document.querySelector(".preview-panel");

togglePageSelector?.addEventListener("click", () => {
    const isCollapsed = previewPanel.classList.toggle("page-selector-collapsed");

    togglePageSelector.setAttribute("aria-expanded", String(!isCollapsed));

    togglePageSelector.setAttribute("aria-label", isCollapsed ? "Show page selector" : "Hide page selector");

    togglePageSelector.title = isCollapsed ? "Show page selector" : "Hide page selector";
});

document.addEventListener("click", (event) => {
    // Keep the highlight while interacting with the wording controls.
    if (event.target.closest("#fieldControls input, #fieldControls textarea, .hebrew-keyboard")) {
        return;
    }

    if (activeFieldId !== null) {
        activeFieldId = null;
        drawPages();
    }
});
function esc(s) {
    return String(s ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
}


/* =========================================
   FULL-SCREEN INVITATION ZOOM PREVIEW
========================================= */


function setupZoomPreview() {
    const previewWrap = document.querySelector(".large-preview-wrap");

    if (!previewWrap || zoomPreview) return;

    // Add the zoom button
    const zoomButton = document.createElement("button");
    zoomButton.type = "button";
    zoomButton.className = "preview-zoom-button";
    zoomButton.textContent = "⤢";
    zoomButton.title = "View invitation full screen";
    zoomButton.setAttribute("aria-label", "View invitation full screen");

    previewWrap.appendChild(zoomButton);

    // Build the full-screen overlay
    zoomPreview = document.createElement("div");
    zoomPreview.className = "zoom-preview-overlay";
    zoomPreview.hidden = true;

    
zoomPreview.innerHTML = `
    <button type="button" class="zoom-close" aria-label="Close preview">×</button>

    <button type="button" class="zoom-page-arrow zoom-page-prev"
        aria-label="Previous page">‹</button>

    <div class="zoom-stage">
        <div class="zoom-artwork"></div>
    </div>

    <button type="button" class="zoom-page-arrow zoom-page-next"
        aria-label="Next page">›</button>

    <div class="zoom-toolbar">
        <button type="button" class="zoom-minus" aria-label="Zoom out">−</button>
        <input class="zoom-slider" type="range"
            min="100" max="400" value="100" step="5"
            aria-label="Zoom level">
        <button type="button" class="zoom-plus" aria-label="Zoom in">+</button>
        <span class="zoom-percentage">100%</span>
        <button type="button" class="zoom-reset">Reset</button>
    </div>
`;

    document.body.appendChild(zoomPreview);

    zoomStage = zoomPreview.querySelector(".zoom-stage");
    zoomArtwork = zoomPreview.querySelector(".zoom-artwork");
    zoomSlider = zoomPreview.querySelector(".zoom-slider");

    zoomButton.addEventListener("click", openZoomPreview);

    zoomPreview.querySelector(".zoom-close")
        .addEventListener("click", closeZoomPreview);

    zoomPreview.querySelector(".zoom-minus")
        .addEventListener("click", () => changeZoom(-0.25));

    zoomPreview.querySelector(".zoom-plus")
        .addEventListener("click", () => changeZoom(0.25));

    zoomPreview.querySelector(".zoom-reset")
        .addEventListener("click", resetZoom);
    
    zoomPreview.querySelector(".zoom-page-prev")
    .addEventListener("click", () => {
        if (activePage > 0) {
            activePage--;
            drawPages();
            resetZoom();
        }
    });

zoomPreview.querySelector(".zoom-page-next")
    .addEventListener("click", () => {
        if (activePage < rendered.pages.length - 1) {
            activePage++;
            drawPages();
            resetZoom();
        }
    });

    zoomSlider.addEventListener("input", () => {
        setZoom(Number(zoomSlider.value) / 100);
    });

    // Mouse wheel zoom
    zoomStage.addEventListener("wheel", event => {
        event.preventDefault();

        const rect = zoomStage.getBoundingClientRect();

        zoomAtPoint(
            event.clientX - rect.left,
            event.clientY - rect.top,
            event.deltaY < 0 ? 1.15 : 1 / 1.15
        );
    }, { passive: false });

    // Drag and touch gestures
    zoomStage.addEventListener("pointerdown", event => {
        if (!zoomPreview || zoomPreview.hidden) return;

        zoomStage.setPointerCapture(event.pointerId);

        zoomPointers.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY
        });

        if (zoomPointers.size === 1) {
            zoomDrag = {
                pointerX: event.clientX,
                pointerY: event.clientY,
                startX: zoomX,
                startY: zoomY
            };
        } else if (zoomPointers.size === 2) {
            const points = [...zoomPointers.values()];

            zoomPinch = {
                distance: pointerDistance(points[0], points[1]),
                midpoint: pointerMidpoint(points[0], points[1]),
                scale: zoomLevel
            };

            zoomDrag = null;
        }
    });

    zoomStage.addEventListener("pointermove", event => {
        if (!zoomPointers.has(event.pointerId)) return;

        zoomPointers.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY
        });

        if (zoomPointers.size === 1 && zoomDrag) {
            zoomX = zoomDrag.startX + event.clientX - zoomDrag.pointerX;
            zoomY = zoomDrag.startY + event.clientY - zoomDrag.pointerY;
            updateZoomTransform();
        }

        if (zoomPointers.size === 2 && zoomPinch) {
            const points = [...zoomPointers.values()];
            const distance = pointerDistance(points[0], points[1]);
            const midpoint = pointerMidpoint(points[0], points[1]);

            const factor = distance / zoomPinch.distance;

            const rect = zoomStage.getBoundingClientRect();

            zoomAtPoint(
                midpoint.x - rect.left,
                midpoint.y - rect.top,
                factor,
                zoomPinch.scale
            );
        }
    });

    function finishPointer(event) {
        zoomPointers.delete(event.pointerId);

        if (zoomPointers.size === 0) {
            zoomDrag = null;
            zoomPinch = null;
        } else if (zoomPointers.size === 1) {
            const remaining = [...zoomPointers.values()][0];

            zoomDrag = {
                pointerX: remaining.x,
                pointerY: remaining.y,
                startX: zoomX,
                startY: zoomY
            };

            zoomPinch = null;
        }
    }

    zoomStage.addEventListener("pointerup", finishPointer);
    zoomStage.addEventListener("pointercancel", finishPointer);

    // Escape closes the overlay
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !zoomPreview.hidden) {
            closeZoomPreview();
        }
    });

    // Recalculate fit if the screen changes size
    window.addEventListener("resize", () => {
        if (!zoomPreview.hidden) {
            resetZoom();
        }
    });
}

function pointerDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerMidpoint(a, b) {
    return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
    };
}

function syncZoomPreview() {
    if (!zoomArtwork) return;

    const currentPage = document.querySelector("#largePreview .invitation-page");

    if (!currentPage) {
        zoomArtwork.replaceChildren();
        return;
    }

    const clone = currentPage.cloneNode(true);

    // Remove editor-only selection highlights
    clone.querySelectorAll(".field-highlight, .field-highlight-box")
        .forEach(element => {
            if (element.classList.contains("field-highlight-box")) {
                element.remove();
            } else {
                element.classList.remove("field-highlight");
            }
        });

    zoomArtwork.replaceChildren(clone);
    sizeZoomArtwork(); 

    if (!zoomPreview.hidden) {
        resetZoom();
    }
    
    zoomPreview.querySelector(".zoom-page-prev").disabled =
    activePage === 0;

zoomPreview.querySelector(".zoom-page-next").disabled =
    activePage === rendered.pages.length - 1;
}

function openZoomPreview() {
    if (!zoomPreview || !zoomArtwork) return;

    syncZoomPreview();

    if (!zoomArtwork.firstElementChild) return;

    zoomPreview.hidden = false;
    document.body.classList.add("zoom-preview-open");

    zoomPointers.clear();
    zoomDrag = null;
    zoomPinch = null;

    requestAnimationFrame(resetZoom);
}

function closeZoomPreview() {
    if (!zoomPreview) return;

    zoomPreview.hidden = true;
    document.body.classList.remove("zoom-preview-open");

    zoomPointers.clear();
    zoomDrag = null;
    zoomPinch = null;
}

function resetZoom() {
    if (!zoomStage || !zoomArtwork) return;

    const rect = zoomStage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const { w, h } = getZoomArtSize();

    zoomFitScale = Math.min(
        rect.width * 0.84 / w,
        rect.height * 0.84 / h
    );

    zoomLevel = 1;

    zoomX = (rect.width - w * zoomFitScale) / 2;
    zoomY = (rect.height - h * zoomFitScale) / 2;

    updateZoomTransform();
}

function getZoomArtSize() {
    const svg = zoomArtwork?.querySelector("svg");
    const vb = svg?.viewBox?.baseVal;
    return vb && vb.width && vb.height
        ? { w: vb.width, h: vb.height }
        : { w: 400, h: 600 }; // fallback for non-SVG pages
}

function sizeZoomArtwork() {
    const { w, h } = getZoomArtSize();
    zoomArtwork.style.width = `${w}px`;
    zoomArtwork.style.height = `${h}px`;

    // Make sure the page fills the artwork box exactly.
    const page = zoomArtwork.querySelector(".invitation-page");
    const svg = zoomArtwork.querySelector("svg");
    if (page) { page.style.width = "100%"; page.style.height = "100%"; }
    if (svg) { svg.style.width = "100%"; svg.style.height = "100%"; }
}

function updateZoomTransform() {
    const scale = zoomFitScale * zoomLevel;

    zoomArtwork.style.transform =
        `translate(${zoomX}px, ${zoomY}px) scale(${scale})`;

    zoomSlider.value = Math.round(zoomLevel * 100);

    zoomPreview.querySelector(".zoom-percentage").textContent =
        `${Math.round(zoomLevel * 100)}%`;
}

function setZoom(newLevel) {
    const rect = zoomStage.getBoundingClientRect();

    zoomAtPoint(
        rect.width / 2,
        rect.height / 2,
        newLevel / zoomLevel
    );
}

function changeZoom(amount) {
    setZoom(Math.max(1, Math.min(4, zoomLevel + amount)));
}

function zoomAtPoint(x, y, factor, startingLevel = zoomLevel) {
    const newLevel = Math.max(
        1,
        Math.min(4, startingLevel * factor)
    );

    const oldScale = zoomFitScale * startingLevel;
    const newScale = zoomFitScale * newLevel;

    // Keep the point under the cursor/fingers stationary
    zoomX = x - (x - zoomX) * (newScale / oldScale);
    zoomY = y - (y - zoomY) * (newScale / oldScale);

    zoomLevel = newLevel;

    updateZoomTransform();
}

function lineButton(label, title, onClick, extra = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "field-line-button " + extra;
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", onClick);
    return b;
}

async function insertLine(refId, position) {
    const entry = createExtraLine(extraLines, refId, position);
    extraLines = [...extraLines, entry];
    if (fieldStyles[refId]) fieldStyles[entry.id] = { ...fieldStyles[refId] };
    activeFieldId = entry.id;
    await refresh();
    buildFields();
    const input = document.querySelector(`#fieldControls [data-field="${CSS.escape(entry.id)}"]`);
    input?.focus();
    input?.select();
}

function removeLine(id) {
    extraLines = removeExtraLine(extraLines, id);
    delete wording[id];
    delete fieldStyles[id];
    revealedHiddenFieldIds.delete(id);
    if (activeFieldId === id) activeFieldId = null;
    refresh().then(buildFields);
}

function removeTemplateLine(id) {
    if (!removedFields.includes(id)) removedFields = [...removedFields, id];
    revealedHiddenFieldIds.delete(id);
    if (activeFieldId === id) activeFieldId = null;
    refresh().then(buildFields);
}

function restoreLine(id) {
    removedFields = removedFields.filter((x) => x !== id);
    refresh().then(buildFields);
}