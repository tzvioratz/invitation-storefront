import { getStoreData } from "./data.js";
import { loadAddOnData } from "./addons-data.js";
import { createHebrewKeyboard } from "./hebrew-keyboard.js";
import { renderInvitation, updateRenderedWording, ensureGoogleFont } from "./template-renderer.js";
import { sanitizeFieldStyles, setFieldStyle } from "./field-discovery.js";
// Optional: used to load declared fonts for imported SVGs if template-renderer.js exports loadSvgFonts.
import * as templateRenderer from "./template-renderer.js";
import { createAdvancedControls } from "./field-advanced.js"

const $ = s => document.querySelector(s);

// Template pages are always drawn 400 x 600 CSS px (see editor.css).
const ART_W = 400, ART_H = 600, PX_PER_IN = 96, MAX_SHEETS = 120;

const ORDER_COLUMNS = [
    "Reference", "Created", "Invitation ID", "Invitation", "Customer", "Email", "Phone",
    "Quantity", "Format", "Paper", "Font", "Color", "Design", "Wording JSON", "Notes",
    "Estimated Order Total", "Base Charge", "Unit Price", "Format Adjustment",
    "Paper Adjustment", "Customization Fee", "Intermediate Premium", "Adjusted Unit Price",
    "Effective Price Per Invitation", "Add-ons JSON", "Add-on Total", "customFields",
    "Add-ons JSON", "Add-on Total", "customFields", "Field Styles JSON"
];

const SHEET_SIZES = {
    Letter: [8.5, 11], Legal: [8.5, 14], Tabloid: [11, 17],
    A4: [8.27, 11.69], A3: [11.69, 16.54]
};

const OPTION_GROUPS = [
    ["format", "Card format", "formats"],
    ["paper", "Paper", "papers"],
    ["font", "Font", "fonts"],
    ["color", "Color", "colors"],
    ["design", "Design option", "designOptions"]
];

const SETTINGS_KEY = "invitationStudio.printSettings.v1";
const SAVED_INPUTS = ["sheetSize", "sheetOrientation", "sheetW", "sheetH", "sheetMargin",
    "cardGap", "cardFit", "printMode", "extraCopies", "upMode"];
const SAVED_CHECKS = ["cropMarks", "sheetLabels"];

let store = null;          // invitation catalog
let addOnCatalog = null;   // { addOns, designs } or null
let orders = [];
let order = null;
let invitation = null;
let selection = {};
let sources = [];          // invitation first, then each add-on
let pieces = [];           // every page of every source
let activePiece = 0;
let activeSourceId = null;
let activeFieldId = null;
const printState = new Map(); // piece key -> { include, copies }
let printOrder = [];          // piece keys in the order they print
const overrides = new Map();  // piece key -> { element, name } for imported SVGs

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

function num(selector, fallback, min = 0) {
    const v = parseFloat($(selector).value);
    return Number.isFinite(v) && v >= min ? v : fallback;
}

function safeJSON(value, fallback) {
    if (!value) return { value: fallback, error: null };
    try { return { value: JSON.parse(value), error: null }; }
    catch (e) { return { value: fallback, error: e.message }; }
}

function parseTSV(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    text = text.replace(/^\uFEFF/, "");

    for (let i = 0; i < text.length; i++) {
        const c = text[i], n = text[i + 1];
        if (quoted) {
            if (c === '"' && n === '"') { cell += '"'; i++; }
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"' && cell === "") quoted = true;
        else if (c === "\t") { row.push(cell); cell = ""; }
        else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
        else cell += c;
    }
    if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }

    return rows.filter(r => r.some(v => v.trim() !== ""));
}

function parseOrders(text) {
    const rows = parseTSV(text);
    if (!rows.length) throw new Error("Nothing to load. Paste a row from the Orders sheet.");

    let headers = ORDER_COLUMNS;
    if (/^reference$/i.test(rows[0][0].trim())) {
        headers = rows.shift().map(h => h.trim());
        if (!rows.length) throw new Error("Only the header row was pasted. Include an order row too.");
    }

    return rows.map(r => {
        const raw = Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]));
        return normalizeOrder(raw);
    });
}

function normalizeOrder(raw) {
    const warnings = [];

    const wording = safeJSON(raw["Wording JSON"], {});
    if (wording.error) warnings.push("Wording JSON could not be read (" + wording.error + ").");

    const addOns = safeJSON(raw["Add-ons JSON"], []);
    if (addOns.error) warnings.push("Add-ons JSON could not be read (" + addOns.error + ").");
    
    const styles = safeJSON(raw["Field Styles JSON"], {});
    if (styles.error) warnings.push("Field Styles JSON could not be read (" + styles.error + ").");

    return {
        raw,
        warnings,
        reference: raw["Reference"],
        invitationId: raw["Invitation ID"],
        quantity: Math.round(Number(String(raw["Quantity"]).replace(/[^\d.]/g, ""))) || 0,
        selection: {
            format: raw["Format"], paper: raw["Paper"], font: raw["Font"],
            color: raw["Color"], design: raw["Design"]
        },
        wording: wording.value && typeof wording.value === "object" && !Array.isArray(wording.value)
            ? wording.value : {},
        fieldStyles: sanitizeFieldStyles(styles.value),
        addOns: Array.isArray(addOns.value) ? addOns.value : []
        
    };
}

// ------------------------------------------------------------
// Loading an order
// ------------------------------------------------------------

async function renderSource(src) {
    if (src.type === "addon") {
        src.design = src.designs.find(d => d.id === src.designId) || null;
    }

    const pages = src.type === "invitation" ? invitation.pages : (src.design?.pages || []);

    // Load any fonts the customer picked, or they'll print in a fallback font.
    const families = new Set(
        Object.values(src.styles || {}).map(s => s.fontFamily).filter(Boolean)
    );
    await Promise.all([...families].map(f =>
        ensureGoogleFont(f).catch(e => console.warn("Could not load font:", f, e))
    ));

    src.rendered = await renderInvitation({
        invitation: { pages },
        target: document.createElement("div"),
        wording: src.wording,
        styles: src.styles || {},
        options: src.type === "invitation" ? selection : {}
    });
}

async function loadOrder(o) {
    const status = $("#loadStatus");
    status.textContent = "Loading…";

    invitation = store.invitations.find(i => i.id === o.invitationId);
    if (!invitation) {
        status.textContent = `Invitation "${o.invitationId}" was not found in the catalog.`;
        return;
    }

    order = o;
    selection = { ...o.selection };
    OPTION_GROUPS.forEach(([key, , listKey]) => {
        if (!selection[key]) selection[key] = invitation[listKey]?.[0] || "";
    });

    sources = [{
        id: "inv", type: "invitation", title: invitation.title,
        quantity: o.quantity, wording: { ...o.wording },     
        styles: { ...o.fieldStyles }, rendered: null
    }];

    o.addOns.forEach((a, index) => {
        const definition = addOnCatalog?.addOns.find(x => x.id === a.addOnId);
        const designs = addOnCatalog?.designs.filter(d => d.addOnId === a.addOnId) || [];
        const wording = { ...(a.wording || {}) };

        sources.push({
            id: "addon:" + index, type: "addon",
            original: a,
            title: a.title || definition?.title || a.addOnId,
            designs, designId: a.designId,
            quantity: Number(a.quantity) || 0,
            wordingByDesign: { [a.designId]: wording },
            wording,
            customInfo: { ...(a.customInfo || {}) },
            customFields: Array.isArray(definition?.customFields) ? definition.customFields : [],
            styles: sanitizeFieldStyles(a.fieldStyles),
            rendered: null
        });
    });

    printState.clear();
    printOrder = [];
    overrides.clear();
    activePiece = 0;
    activeSourceId = null;
    activeFieldId = null;

    await Promise.all(sources.map(renderSource));

    $("#orderBody").hidden = false;
    buildSummary();
    buildOptionControls();
    buildFieldControls();
    applyCardSizeFromFormat();
    refreshPieces();

    status.textContent = o.warnings.length
        ? "Loaded " + o.reference + ". " + o.warnings.join(" ")
        : "Loaded " + o.reference + ".";
}

// ------------------------------------------------------------
// Left column: summary, options, wording
// ------------------------------------------------------------

function buildSummary() {
    const r = order.raw;
    const rows = [
        ["Reference", r["Reference"]], ["Created", r["Created"]],
        ["Customer", r["Customer"]], ["Email", r["Email"]], ["Phone", r["Phone"]],
        ["Invitation", r["Invitation"]], ["Quantity", r["Quantity"]],
        ["Estimate", r["Estimated Order Total"]], ["Add-on total", r["Add-on Total"]],
        ["Notes", r["Notes"]]
    ];

    const dl = $("#orderSummary");
    dl.replaceChildren();
    rows.filter(([, v]) => v).forEach(([k, v]) => {
        dl.append(el("dt", "", k), el("dd", "", v));
    });

    const qty = $("#orderQuantity");
    qty.value = sources[0].quantity;
    qty.oninput = () => {
        sources[0].quantity = Math.max(0, Math.round(Number(qty.value)) || 0);
        buildPrintList();
        renderSheets();
    };
}

function buildOptionControls() {
    const container = $("#optionControls");
    container.replaceChildren();

    OPTION_GROUPS.forEach(([key, label, listKey]) => {
        const values = [...(invitation[listKey] || [])];
        const missing = selection[key] && !values.includes(selection[key]);
        if (missing) values.unshift(selection[key]);
        if (!values.length) return;

        const wrap = el("label", "");
        wrap.append(label);

        const select = document.createElement("select");
        values.forEach(v => {
            const text = missing && v === selection[key] ? `${v} (not in catalog)` : v;
            select.add(new Option(text, v));
        });
        select.value = selection[key];

        select.addEventListener("change", async () => {
            selection[key] = select.value;
            if (key === "format") applyCardSizeFromFormat();
            await renderSource(sources[0]);
            refreshPieces();
        });

        wrap.append(select);
        container.append(wrap);
    });
}

function buildFieldControls() {
    const root = $("#fieldControls");
    root.replaceChildren();

    sources.forEach(src => {
        src.block = el("div", "source-block");
        root.append(src.block);
        fillSourceBlock(src);
    });
}
function getRevealedIds(src) {
    if (src.type === "invitation") {
        if (!src.revealedHiddenFieldIds) {
            src.revealedHiddenFieldIds = new Set();
        }

        return src.revealedHiddenFieldIds;
    }

    // Each add-on design has its own revealed-field state.
    if (!src.revealedHiddenFieldIdsByDesign) {
        src.revealedHiddenFieldIdsByDesign = {};
    }

    if (!src.revealedHiddenFieldIdsByDesign[src.designId]) {
        src.revealedHiddenFieldIdsByDesign[src.designId] = new Set();
    }

    return src.revealedHiddenFieldIdsByDesign[src.designId];
}


function getHiddenFieldGroups(fields) {
    const groups = [];
    let currentGroup = [];
    let currentPage = null;

    fields.forEach(field => {
        const pageIndex = field.occurrences[0]?.pageIndex ?? 0;

        // Never combine groups across pages.
        if (currentGroup.length && pageIndex !== currentPage) {
            groups.push(currentGroup);
            currentGroup = [];
        }

        if (field.hiddenFromEditor) {
            currentGroup.push(field);
            currentPage = pageIndex;
        } else {
            if (currentGroup.length) {
                groups.push(currentGroup);
                currentGroup = [];
            }

            currentPage = pageIndex;
        }
    });

    if (currentGroup.length) {
        groups.push(currentGroup);
    }

    return groups;
}

function fillSourceBlock(src) {
    const block = src.block;
    block.replaceChildren();

    block.append(el("h3", "source-title",
        (src.type === "invitation" ? "Invitation: " : "Add-on: ") + src.title));

    if (src.type === "addon") buildAddOnHeader(src, block);

    const pages = src.rendered?.pages || [];

    if (!pages.length) {
        block.append(el("p", "source-message",
            src.type === "addon"
                ? `Design "${src.designId}" was not found in the add-on catalog.`
                : "This invitation has no pages."));
    } else {
        const sections = pages.map(p => {
            const section = el("div", "field-page-section");
            section.append(el("h3", "", p.page.label));
            block.append(section);
            return section;
        });

        const revealedIds = getRevealedIds(src);

        // Identify consecutive groups of hidden fields.
        const hiddenGroups = getHiddenFieldGroups(src.rendered.fields);
        const hiddenGroupByField = new Map();

        hiddenGroups.forEach(group => {
            group.forEach(field => {
                hiddenGroupByField.set(field, group);
            });
        });

        const fieldWrappers = new Map();

        // Render fields in their original positions.
        src.rendered.fields.forEach(f => {
            const pageIndex = f.occurrences[0]?.pageIndex ?? 0;
            const section = sections[pageIndex];

            if (
                f.hiddenFromEditor &&
                !revealedIds.has(f.id)
            ) {
                const group = hiddenGroupByField.get(f);

                if (group[0] === f) {
                    const button = el(
                        "button",
                        "show-more-fields",
                        `+ Show ${group.length} hidden field${group.length === 1 ? "" : "s"}`
                    );

                    button.type = "button";

                    button.addEventListener("click", () => {
                        group.forEach(field => {
                            revealedIds.add(field.id);
                        });

                        fillSourceBlock(src);
                    });

                    section.append(button);
                }

                return;
            }

            const fieldWrap = buildFieldControl(src, f, block);

            if (f.hiddenFromEditor) {
                fieldWrap.classList.add("field-revealed");
            }

            section.append(fieldWrap);
            fieldWrappers.set(f.id, fieldWrap);
        });

        // One hide button per page, immediately after its last revealed field.
        sections.forEach((section, pageIndex) => {
            const revealedInSection = src.rendered.fields.filter(f =>
                f.hiddenFromEditor &&
                revealedIds.has(f.id) &&
                (f.occurrences[0]?.pageIndex ?? 0) === pageIndex
            );

            if (!revealedInSection.length) return;

            const lastField = revealedInSection[revealedInSection.length - 1];
            const lastWrapper = fieldWrappers.get(lastField.id);

            if (!lastWrapper) return;

            const hideButton = el(
                "button",
                "hide-revealed-fields",
                "Hide optional fields"
            );

            hideButton.type = "button";

            hideButton.addEventListener("click", () => {
                revealedInSection.forEach(f => {
                    revealedIds.delete(f.id);
                });

                fillSourceBlock(src);
            });

            lastWrapper.after(hideButton);
        });

        if (!src.rendered.fields.length) {
            block.append(el("p", "source-message",
                "This design has no editable wording fields."));
        }
    }

    if (src.type === "addon") buildCustomInfo(src, block);
}

function buildAddOnHeader(src, block) {
    if (src.designs.length) {
        const label = el("label", "");
        label.append("Design");

        const select = document.createElement("select");
        src.designs.forEach(d => {
            select.add(new Option(d.title + (d.active ? "" : " (inactive)"), d.id));
        });
        if (!src.designs.some(d => d.id === src.designId)) {
            select.add(new Option(src.designId + " (not found)", src.designId), 0);
        }
        select.value = src.designId;

        select.addEventListener("change", async () => {
            src.designId = select.value;
            src.wordingByDesign[src.designId] ??= {};
            src.wording = src.wordingByDesign[src.designId];

            [...printState.keys()]
                .filter(k => k.startsWith(src.id + "#"))
                .forEach(k => printState.delete(k));

            [...overrides.keys()]
                .filter(k => k.startsWith(src.id + "#"))
                .forEach(k => overrides.delete(k));

            await renderSource(src);
            fillSourceBlock(src);
            refreshPieces();
        });

        label.append(select);
        block.append(label);
    }

    const qtyLabel = el("label", "");
    qtyLabel.append("Quantity");
    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "0";
    qty.step = "1";
    qty.value = src.quantity;
    qty.addEventListener("input", () => {
        src.quantity = Math.max(0, Math.round(Number(qty.value)) || 0);
        buildPrintList();
        renderSheets();
    });
    qtyLabel.append(qty);
    block.append(qtyLabel);
}

function buildCustomInfo(src, block) {
    const keys = [...new Set([
        ...src.customFields.map(f => f.id),
        ...Object.keys(src.customInfo)
    ])];
    if (!keys.length) return;

    block.append(el("p", "source-sub", "Order information (not printed on the card)"));

    keys.forEach(key => {
        const definition = src.customFields.find(f => f.id === key);
        const value = src.customInfo[key] ?? "";
        const multiline = definition?.type === "textarea" || String(value).includes("\n");

        const label = el("label", "");
        label.append(definition?.label || key);

        const input = document.createElement(multiline ? "textarea" : "input");
        input.value = value;
        input.addEventListener("input", () => { src.customInfo[key] = input.value; });

        label.append(input);
        block.append(label);
    });
}

function buildFieldControl(src, f, scope) {
    const wrap = el("div", "field-control-wrap");

    const label = el("label", "field-control", f.label + (f.required ? " *" : ""));
    const input = document.createElement(f.multiline ? "textarea" : "input");

    input.dataset.field = f.id;
    input.placeholder = f.placeholder;
    input.maxLength = f.maxLength;
    input.value = src.wording[f.id] ?? f.defaultValue ?? "";

    const updateField = () => {
        src.wording[f.id] = input.value;
        updateRenderedWording(src.rendered, src.wording, src.styles);
        applyImportedWording(src);
        drawPageView();
        scheduleSheets();
    };

    input.addEventListener("focus", () => activateField(src, f.id));
    input.addEventListener("input", updateField);
    input.addEventListener("blur", updateField);
    label.append(input);

    const row = el("div", "field-input-row");
    const toggle = el("button", "hebrew-keyboard-toggle", "⌨");
    toggle.type = "button";
    toggle.title = "Open Hebrew keyboard";
    toggle.setAttribute("aria-label", "Open Hebrew keyboard");
    row.append(input, toggle);

    const keyboard = createHebrewKeyboard(input, updateField);

    toggle.addEventListener("click", () => {
        const open = keyboard.hidden;
        const root = $("#fieldControls");
        root.querySelectorAll(".hebrew-keyboard").forEach(k => { k.hidden = true; });
        root.querySelectorAll(".hebrew-keyboard-toggle").forEach(b => b.classList.remove("active"));
        keyboard.hidden = !open;
        if (open) { toggle.classList.add("active"); input.focus(); }
    });

const labelRow = el("div", "field-label-row");
labelRow.append(label);

let panel = null;
if (f.advanced) {
    const adv = createAdvancedControls(f, src.styles, () => {
        updateRenderedWording(src.rendered, src.wording, src.styles);
        applyImportedStyle(src, f.id); 
        drawPageView();
        scheduleSheets();
    });
    labelRow.append(adv.toggle);
    panel = adv.panel;
}

wrap.append(labelRow, row, keyboard);
if (panel) wrap.append(panel);    return wrap;
}

function activateField(src, fieldId) {
    activeSourceId = src.id;
    activeFieldId = fieldId;

    const f = src.rendered.fields.find(x => x.id === fieldId);
    if (!f) return;

    const pageIndex = f.occurrences[0]?.pageIndex ?? 0;
    const idx = pieces.findIndex(p => p.src === src && p.pageIndex === pageIndex);
    if (idx >= 0) activePiece = idx;

    drawPageView();
}

// ------------------------------------------------------------
// Pieces (every page that can be previewed or printed)
// ------------------------------------------------------------

function refreshPieces() {
    pieces = [];

    sources.forEach(src => {
        (src.rendered?.pages || []).forEach((p, pageIndex) => {
            const addOnName = src.type === "addon"
                ? `${src.title} (${src.design?.title || src.designId})`
                : src.title;

            pieces.push({
                key: `${src.id}#${pageIndex}`,
                src, pageIndex,
                page: p.page,
                element: overrides.get(`${src.id}#${pageIndex}`)?.element ?? p.element,
                imported: overrides.get(`${src.id}#${pageIndex}`)?.name || "",
                importedMissing: overrides.get(`${src.id}#${pageIndex}`)?.missing || [],
                label: `${addOnName} · ${p.page.label}`,
                shortLabel: src.type === "addon" ? `${src.title}: ${p.page.label}` : p.page.label
            });
        });
    });

    activePiece = Math.max(0, Math.min(activePiece, pieces.length - 1));

    // Keep the user's order for pages that still exist; add new pages at the end.
    const keys = pieces.map(p => p.key);
    printOrder = [
        ...printOrder.filter(k => keys.includes(k)),
        ...keys.filter(k => !printOrder.includes(k))
    ];

    buildPrintList();
    drawPageView();
    renderSheets();
}

// ------------------------------------------------------------
// Page preview (same idea as the editor)
// ------------------------------------------------------------

function highlightActiveField(root, fieldId) {
    [...root.querySelectorAll("[data-field]")]
        .filter(n => n.getAttribute("data-field") === fieldId)
        .forEach(node => {
            node.classList.add("field-highlight");

            if (node.namespaceURI !== "http://www.w3.org/2000/svg") return;
            const svg = node.ownerSVGElement;
            if (!svg) return;

            try {
                const b = node.getBBox();
                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("x", b.x - 8);
                rect.setAttribute("y", b.y - 8);
                rect.setAttribute("width", b.width + 16);
                rect.setAttribute("height", b.height + 16);
                rect.setAttribute("rx", "5");
                rect.setAttribute("class", "field-highlight-box");
                svg.appendChild(rect);
            } catch (e) {
                console.warn("Could not highlight SVG field:", e);
            }
        });
}

function drawPageView() {
    const thumbs = $("#pageThumbs");
    const large = $("#largePreview");
    thumbs.replaceChildren();
    large.replaceChildren();

    if (!pieces.length) {
        $("#pageLabel").textContent = "No pages to preview.";
        $("#prevPage").disabled = true;
        $("#nextPage").disabled = true;
        return;
    }

    pieces.forEach((p, i) => {
        const b = el("button", "thumb" + (i === activePiece ? " active" : ""));
        b.type = "button";

        const frame = el("div", "thumb-frame");
        frame.append(p.element.cloneNode(true));
        b.append(frame, el("span", "thumb-label", p.shortLabel));

        b.addEventListener("click", () => { activePiece = i; drawPageView(); });
        thumbs.append(b);
    });

    const piece = pieces[activePiece];
    const clone = piece.element.cloneNode(true);
    large.append(clone);

    if (activeFieldId && activeSourceId === piece.src.id) {
        highlightActiveField(clone, activeFieldId);
    }

    $("#pageLabel").textContent = `${piece.label} · Page ${activePiece + 1} of ${pieces.length}`;
    $("#prevPage").disabled = activePiece === 0;
    $("#nextPage").disabled = activePiece === pieces.length - 1;
}

// ------------------------------------------------------------
// Print settings
// ------------------------------------------------------------

function getSettings() {
    const sizeKey = $("#sheetSize").value;
    let [w, h] = sizeKey === "Custom"
        ? [num("#sheetW", 8.5, 1), num("#sheetH", 11, 1)]
        : SHEET_SIZES[sizeKey];

    const short = Math.min(w, h), long = Math.max(w, h);
    const landscape = $("#sheetOrientation").value === "landscape";

    const sw = landscape ? long : short;
    const sh = landscape ? short : long;
    const margin = num("#sheetMargin", 0.25);
    const gap = num("#cardGap", 0.25);

    let cw = num("#cardW", 5, 0.5);
    let ch = num("#cardH", 7, 0.5);
    let layout = null;

    // N-up: split the sheet into equal cells and size each card to its cell.
    const up = Number($("#upMode").value);
    if (up) {
        const options = up === 4 ? [[2, 2]] : up === 2 ? [[2, 1], [1, 2]] : [[1, 1]];

        const sized = options.map(([cols, rows]) => {
            const cellW = Math.max(0.1, (sw - 2 * margin - (cols - 1) * gap) / cols);
            const cellH = Math.max(0.1, (sh - 2 * margin - (rows - 1) * gap) / rows);
            // How large the 2:3 artwork can print in this cell.
            const fitScale = Math.min(cellW / ART_W, cellH / ART_H);
            return { cols, rows, cellW, cellH, fitScale };
        });

        // For 2-up, choose side by side or stacked, whichever prints the artwork larger.
        const best = sized.reduce((a, b) => (b.fitScale > a.fitScale ? b : a));

        cw = best.cellW;
        ch = best.cellH;
        layout = { cols: best.cols, rows: best.rows };

        $("#cardW").value = cw.toFixed(2);
        $("#cardH").value = ch.toFixed(2);
    }

    return {
        sw, sh, cw, ch, layout,
        fit: $("#cardFit").value,
        margin,
        gap,
        mode: $("#printMode").value,
        extra: Math.round(num("#extraCopies", 0)),
        marks: $("#cropMarks").checked,
        labels: $("#sheetLabels").checked
    };
}

function computeGrid(s) {
    if (s.layout) {
        return { ...s.layout, perSheet: s.layout.cols * s.layout.rows };
    }

    const usableW = s.sw - 2 * s.margin;
    const usableH = s.sh - 2 * s.margin;
    const cols = Math.max(0, Math.floor((usableW + s.gap) / (s.cw + s.gap) + 1e-9));
    const rows = Math.max(0, Math.floor((usableH + s.gap) / (s.ch + s.gap) + 1e-9));
    return { cols, rows, perSheet: cols * rows };
}

function applyCardSizeFromFormat() {
    const m = String(selection.format || "").match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
    if (!m) return;
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    $("#cardW").value = Math.min(a, b);
    $("#cardH").value = Math.max(a, b);
}

function loadSavedSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
        SAVED_INPUTS.forEach(id => { if (saved[id] !== undefined) $("#" + id).value = saved[id]; });
        SAVED_CHECKS.forEach(id => { if (saved[id] !== undefined) $("#" + id).checked = saved[id]; });
    } catch (e) { /* storage unavailable */ }
}

function saveSettings() {
    try {
        const data = {};
        SAVED_INPUTS.forEach(id => { data[id] = $("#" + id).value; });
        SAVED_CHECKS.forEach(id => { data[id] = $("#" + id).checked; });
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable */ }
}

// ------------------------------------------------------------
// Pages-to-print list
// ------------------------------------------------------------

function getPrintItems() {
    return printOrder
        .map(key => pieces.find(p => p.key === key))
        .filter(Boolean)
        .map(p => {
            const st = printState.get(p.key) || {};
            return { ...p, include: st.include ?? true, copies: st.copies ?? p.src.quantity };
        });
}

function movePrintItem(key, delta) {
    const from = printOrder.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= printOrder.length) return;
    printOrder.splice(to, 0, printOrder.splice(from, 1)[0]);
    buildPrintList();
    renderSheets();
}

function movePrintItemTo(key, targetKey) {
    const from = printOrder.indexOf(key);
    const to = printOrder.indexOf(targetKey);
    if (from < 0 || to < 0 || from === to) return;
    printOrder.splice(to, 0, printOrder.splice(from, 1)[0]);
    buildPrintList();
    renderSheets();
}

// ------------------------------------------------------------
// SVG export / import (edit a page in another program, then print the edited file)
// ------------------------------------------------------------

function exportPieceSVG(piece) {
    const svg = piece.element.querySelector("svg");
    if (!svg) return;

    const clone = svg.cloneNode(true);
    clone.querySelectorAll(".field-highlight-box").forEach(n => n.remove());
    clone.querySelectorAll(".field-highlight").forEach(n => n.classList.remove("field-highlight"));

    // Some programs drop data-* attributes but keep ids, so give every field node an id as well.
    const seen = new Map();
    clone.querySelectorAll("[data-field]").forEach(n => {
        const fieldId = n.getAttribute("data-field");
        const count = (seen.get(fieldId) || 0) + 1;
        seen.set(fieldId, count);
        if (!n.getAttribute("id")) {
            n.setAttribute("id", count === 1 ? `field-${fieldId}` : `field-${fieldId}-${count}`);
        }
    });

    let text = new XMLSerializer().serializeToString(clone);

    // Other programs don't know our CSS variables, so write the chosen values in directly.
    const color = piece.element.style.getPropertyValue("--invite-color").trim();
    const font = piece.element.style.getPropertyValue("--invite-font").trim().replace(/"/g, "'");
    if (color) text = text.replace(/var\(\s*--invite-color\s*(?:,[^)]*)?\)/g, color);
    if (font) text = text.replace(/var\(\s*--invite-font\s*(?:,[^)]*)?\)/g, font);

    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + text], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const name = `${order.reference}_${piece.label}`.replace(/[^\p{L}\p{N}.-]+/gu, "-").replace(/-+/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = name + ".svg";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importPieceSVG(piece, file) {
    const doc = new DOMParser().parseFromString(await file.text(), "image/svg+xml");
    if (doc.querySelector("parsererror")) throw new Error("That file isn't valid SVG.");

    const svg = doc.documentElement;
    if (svg.tagName.toLowerCase() !== "svg") throw new Error("That file isn't an SVG.");

    // Remove anything that could run code.
    svg.querySelectorAll("script").forEach(n => n.remove());
    [svg, ...svg.querySelectorAll("*")].forEach(n => {
        [...n.attributes].forEach(a => {
            if (/^on/i.test(a.name) ||
                (/^(xlink:)?href$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) {
                n.removeAttribute(a.name);
            }
        });
    });

    // Without a viewBox the artwork can't scale to the card, so build one from width and height.
    if (!svg.getAttribute("viewBox")) {
        const w = parseFloat(svg.getAttribute("width"));
        const h = parseFloat(svg.getAttribute("height"));
        if (w > 0 && h > 0) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }

    // Load any fonts the file declares (works when the renderer exports loadSvgFonts).
    try {
        await templateRenderer.loadSvgFonts?.(svg, location.href);
    } catch (e) {
        console.warn("Could not load fonts for the imported SVG:", e);
    }

    const wrapper = el("div", "invitation-page svg-page");
    wrapper.dataset.pageIndex = piece.pageIndex;
    wrapper.dataset.pageLabel = piece.page.label;
    wrapper.appendChild(document.importNode(svg, true));

    // Link the file's text to the wording fields and refill it with the current wording.
    const { map, missing } = bindImportedFields(piece, wrapper);

    overrides.set(piece.key, { element: wrapper, name: file.name, map, missing });
    refreshPieces();
}

function fieldValue(src, f) {
    return src.wording[f.id] ?? f.defaultValue ?? "";
}

// Finds a field's text in an imported SVG: by data-field first, then by the id written on export.
function findImportedFieldNodes(root, fieldId) {
    const direct = [...root.querySelectorAll("[data-field]")]
        .filter(n => n.getAttribute("data-field") === fieldId);
    if (direct.length) return direct;

    const base = ("field-" + fieldId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("^" + base + "(?:-\\d+|_\\d+_?)?$");

    return [...root.querySelectorAll("[id]")]
        .filter(n => pattern.test(n.id.replace(/_x5F_/gi, "_")));
}

function bindImportedFields(piece, wrapper) {
    const src = piece.src;
    const map = new Map();
    const missing = [];

    src.rendered.fields
        .filter(f => f.occurrences.some(o => o.pageIndex === piece.pageIndex))
        .forEach(f => {
            const nodes = findImportedFieldNodes(wrapper, f.id)
                .map(n => {
                    const tag = n.tagName.toLowerCase();
                    return tag === "text" || tag === "tspan" ? n : n.querySelector("text");
                })
                .filter(Boolean);

            if (!nodes.length) {
                missing.push(f.label);
                return;
            }

            nodes.forEach(n => {
                n.setAttribute("data-field", f.id);
                setImportedFieldValue(n, fieldValue(src, f));
            });
            map.set(f.id, nodes);
        });

    return { map, missing };
}

// Called after every wording edit so imported pages stay in step.
function applyImportedWording(src) {
    overrides.forEach((ov, key) => {
        if (!key.startsWith(src.id + "#")) return;

        ov.map.forEach((nodes, fieldId) => {
            const f = src.rendered.fields.find(x => x.id === fieldId);
            if (!f) return;
            nodes.forEach(n => setImportedFieldValue(n, fieldValue(src, f)));
        });
    });
}

// Applies one field's style overrides to any imported pages for this source.
function applyImportedStyle(src, fieldId) {
    const style = src.styles[fieldId] || {};

    overrides.forEach((ov, key) => {
        if (!key.startsWith(src.id + "#")) return;

        (ov.map.get(fieldId) || []).forEach(node => {
            setFieldStyle(node, style);
            // Programs like Illustrator and Inkscape often put fill and font-size
            // on each tspan, which would beat a style set only on the <text>.
            node.querySelectorAll?.("tspan").forEach(t => setFieldStyle(t, style));
        });
    });
}

// Replaces a text element's lines while keeping its position and styling,
// so layout changes made in another program survive.
function setImportedFieldValue(node, value) {
    const text = String(value ?? "");

    if (node.tagName.toLowerCase() !== "text") {
        node.textContent = text.replace(/\n/g, " ");
        return;
    }

    const ns = "http://www.w3.org/2000/svg";
    const tspans = [...node.querySelectorAll("tspan")];
    const first = tspans[0] || null;

    // Keep the first line's styling, but not its position or program-specific attributes.
    const styleAttrs = first
        ? [...first.attributes].filter(a => !/^(x|y|dx|dy|id)$/i.test(a.name) && !a.name.includes(":"))
        : [];

    const x = first?.getAttribute("x") ?? node.getAttribute("x");
    const y = first?.getAttribute("y");

    // Line spacing: copy it from the file if it has two or more lines.
    let step = "1.2em";
    if (tspans.length > 1) {
        const dy = tspans[1].getAttribute("dy");
        const y2 = parseFloat(tspans[1].getAttribute("y"));
        const y1 = parseFloat(y);
        if (dy) step = dy;
        else if (Number.isFinite(y1) && Number.isFinite(y2) && y2 !== y1) step = String(y2 - y1);
    }

    while (node.firstChild) node.removeChild(node.firstChild);

    text.split("\n").forEach((line, i) => {
        const t = document.createElementNS(ns, "tspan");
        styleAttrs.forEach(a => t.setAttribute(a.name, a.value));
        if (x != null) t.setAttribute("x", x);
        if (i === 0) {
            if (y != null) t.setAttribute("y", y);
        } else {
            t.setAttribute("dy", step);
        }
        t.textContent = line;
        node.appendChild(t);
    });
}

function buildPrintList() {
    const box = $("#printItems");
    box.replaceChildren();

    if (!pieces.length) {
        box.append(el("p", "source-message", "No pages to print."));
        return;
    }

    getPrintItems().forEach((item, index, all) => {
        const row = el("div", "print-item");

        const label = el("label", "");
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = item.include;
        check.addEventListener("change", () => {
            printState.set(item.key, { ...printState.get(item.key), include: check.checked });
            renderSheets();
        });
        label.append(check, item.label);

        const copies = document.createElement("input");
        copies.type = "number";
        copies.min = "0";
        copies.step = "1";
        copies.value = item.copies;
        copies.dataset.copiesFor = item.key;
        copies.title = "Copies";
        copies.addEventListener("input", () => {
            printState.set(item.key, {
                ...printState.get(item.key),
                copies: Math.max(0, Math.round(Number(copies.value)) || 0)
            });
            renderSheets();
        });

        const count = el("span", "sheet-count");
        count.dataset.sheetsFor = item.key;

        // Drag handle
        const handle = el("span", "drag-handle", "⠿");
        handle.draggable = true;
        handle.title = "Drag to reorder";
        handle.addEventListener("dragstart", e => {
            e.dataTransfer.setData("text/plain", item.key);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setDragImage(row, 0, 0);
            row.classList.add("dragging");
        });
        handle.addEventListener("dragend", () => row.classList.remove("dragging"));
        row.addEventListener("dragover", e => e.preventDefault());
        row.addEventListener("drop", e => {
            e.preventDefault();
            const draggedKey = e.dataTransfer.getData("text/plain");
            if (draggedKey) movePrintItemTo(draggedKey, item.key);
        });

        // Up / down buttons
        const moves = el("span", "move-buttons");
        const up = el("button", "move-button", "↑");
        up.type = "button";
        up.disabled = index === 0;
        up.setAttribute("aria-label", "Move up");
        up.addEventListener("click", () => movePrintItem(item.key, -1));

        const down = el("button", "move-button", "↓");
        down.type = "button";
        down.disabled = index === all.length - 1;
        down.setAttribute("aria-label", "Move down");
        down.addEventListener("click", () => movePrintItem(item.key, 1));

        moves.append(up, down);

        row.append(handle, label, copies, count, moves);

        // SVG actions
        const actions = el("div", "print-item-actions");

        if (item.page.type === "svg") {
            const exportButton = el("button", "text-button", "Export SVG");
            exportButton.type = "button";
            exportButton.addEventListener("click", () => exportPieceSVG(item));
            actions.append(exportButton);
        } else {
            actions.append(el("span", "", "Export is only available for SVG pages."));
        }

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".svg,image/svg+xml";
        fileInput.hidden = true;

        const importButton = el("button", "text-button", "Import edited SVG");
        importButton.type = "button";
        importButton.addEventListener("click", () => fileInput.click());
        actions.append(importButton);

        const message = el("span", "import-message");

        fileInput.addEventListener("change", async () => {
            const file = fileInput.files[0];
            if (!file) return;
            try {
                await importPieceSVG(item, file);
            } catch (e) {
                message.textContent = e.message;
            }
            fileInput.value = "";
        });

        if (item.imported) {
            const revert = el("button", "text-button", "Revert to original");
            revert.type = "button";
            revert.addEventListener("click", () => {
                overrides.delete(item.key);
                refreshPieces();
            });
            actions.append(revert);
            message.textContent = item.importedMissing.length
                ? `Using imported file: ${item.imported}. Not found in the file, so these won't update: ${item.importedMissing.join(", ")}.`
                : `Using imported file: ${item.imported}. Wording edits still update this page.`;
        }

        actions.append(message, fileInput);
        row.append(actions);
        box.append(row);
    });
}

// ------------------------------------------------------------
// Sheets
// ------------------------------------------------------------

const scheduleSheets = debounce(() => renderSheets(), 250);

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

function buildSheetPlan(items, grid, s) {
    const included = items.filter(i => i.include);

    if (s.mode === "proof") {
        return chunk(included.map(item => ({ item })), grid.perSheet);
    }

    return included.flatMap(item => {
        const n = Math.max(0, Math.round(item.copies)) + s.extra;
        return chunk(Array.from({ length: n }, () => ({ item })), grid.perSheet);
    });
}

function makeCardArt(element, s) {
    const box = el("div", "print-card-art");
    const clone = element.cloneNode(true);

    const wpx = s.cw * PX_PER_IN, hpx = s.ch * PX_PER_IN;
    let sx, sy, left = 0, top = 0;

    if (s.fit === "stretch") {
        sx = wpx / ART_W;
        sy = hpx / ART_H;
    } else {
        sx = sy = Math.min(wpx / ART_W, hpx / ART_H);
        left = (wpx - ART_W * sx) / 2;
        top = (hpx - ART_H * sy) / 2;
    }

    Object.assign(clone.style, {
        position: "absolute", left: left + "px", top: top + "px",
        width: ART_W + "px", height: ART_H + "px",
        maxWidth: "none", aspectRatio: "auto", margin: "0", boxShadow: "none",
        transformOrigin: "0 0", transform: `scale(${sx}, ${sy})`
    });

    box.append(clone);
    return box;
}

function makeCropMarks(s, length) {
    const ns = "http://www.w3.org/2000/svg";
    const offset = 0.03;
    const svg = document.createElementNS(ns, "svg");

    svg.setAttribute("class", "crop-marks");
    svg.setAttribute("viewBox", `0 0 ${s.cw} ${s.ch}`);
    svg.style.width = s.cw + "in";
    svg.style.height = s.ch + "in";

    [[0, 0, -1, -1], [s.cw, 0, 1, -1], [0, s.ch, -1, 1], [s.cw, s.ch, 1, 1]].forEach(([x, y, dx, dy]) => {
        [
            [x + dx * offset, y, x + dx * (offset + length), y],
            [x, y + dy * offset, x, y + dy * (offset + length)]
        ].forEach(([x1, y1, x2, y2]) => {
            const line = document.createElementNS(ns, "line");
            line.setAttribute("x1", x1); line.setAttribute("y1", y1);
            line.setAttribute("x2", x2); line.setAttribute("y2", y2);
            line.setAttribute("stroke", "#000");
            line.setAttribute("stroke-width", "0.007");
            svg.appendChild(line);
        });
    });

    return svg;
}

function updatePreviewScale(s) {
    const container = $("#sheets");
    const available = ($(".sheets-scroll").clientWidth || 600) - 34;
    const scale = Math.min(1, available / (s.sw * PX_PER_IN));
    container.style.setProperty("--preview-scale", scale.toFixed(3));
}

function renderSheets() {
    const s = getSettings();
    $("#pageSizeStyle").textContent = `@page { size: ${s.sw}in ${s.sh}in; margin: 0; }`;

    // In N-up mode the card size comes from the layout, so the inputs only display it.
    ["#cardW", "#cardH"].forEach(id => { $(id).disabled = !!s.layout; });

    const container = $("#sheets");
    container.replaceChildren();

    const summary = $("#layoutSummary");
    const warningsBox = $("#layoutWarnings");
    const warnings = [];

    document.querySelectorAll("[data-copies-for]").forEach(i => { i.disabled = s.mode === "proof"; });
    document.querySelectorAll("[data-sheets-for]").forEach(c => { c.textContent = ""; });

    if (!pieces.length) {
        container.append(el("p", "sheets-empty", "Load an order to see the print layout."));
        summary.textContent = "";
        warningsBox.textContent = "";
        return;
    }

    const grid = computeGrid(s);
    if (grid.perSheet < 1) {
        container.append(el("p", "sheets-empty", "The card does not fit on the sheet."));
        summary.textContent = "";
        warningsBox.textContent = "The card is larger than the printable area. Use a bigger sheet, a smaller card, or smaller margins.";
        return;
    }

    const items = getPrintItems();
    const plan = buildSheetPlan(items, grid, s);

    // Sheet count per page, shown beside each row.
    if (s.mode === "production") {
        items.forEach(item => {
            const span = document.querySelector(`[data-sheets-for="${CSS.escape(item.key)}"]`);
            if (!span || !item.include) return;
            const n = Math.max(0, Math.round(item.copies)) + s.extra;
            const sheets = Math.ceil(n / grid.perSheet);
            span.textContent = `${sheets} sheet${sheets === 1 ? "" : "s"}`;
        });
    }

    summary.textContent =
        `${grid.cols} × ${grid.rows} = ${grid.perSheet} per sheet · ${plan.length} sheet${plan.length === 1 ? "" : "s"} total`;

    // Warnings
    if (s.layout && (s.margin > 0 || s.gap > 0)) {
        warnings.push(
            `Each card prints at ${s.cw.toFixed(2)} × ${s.ch.toFixed(2)} in. For full-size cells ` +
            `(for example 4.25 × 5.5 in for 4-up on Letter), set the margin and gap to 0. Crop marks then won't show.`
        );
    }

    const artRatio = ART_W / ART_H;
    if (Math.abs(s.cw / s.ch - artRatio) / artRatio > 0.01) {
        const matching = (s.ch * artRatio).toFixed(2);
        warnings.push(
            `The artwork is 2:3 but the card is ${s.cw} × ${s.ch} in. "Fit" leaves blank space and "Stretch" distorts it. ` +
            `A 2:3 card ${s.ch} in tall is ${matching} in wide.`
        );
    }

    const room = Math.min(s.gap / 2, s.margin) - 0.03 - 0.01;
    const markLength = Math.min(0.15, room);
    if (s.marks && markLength < 0.04) {
        warnings.push("Crop marks need at least 0.1 in of gap between cards and 0.1 in of margin. They are hidden for now.");
    }

    let sheetsToDraw = plan;
    if (plan.length > MAX_SHEETS) {
        sheetsToDraw = plan.slice(0, MAX_SHEETS);
        warnings.push(`That is ${plan.length} sheets, so only the first ${MAX_SHEETS} are drawn and printed. Lower the copies and print in batches.`);
    }

    warningsBox.textContent = warnings.join("\n");

    // Draw
    const gridW = grid.cols * s.cw + (grid.cols - 1) * s.gap;
    const gridH = grid.rows * s.ch + (grid.rows - 1) * s.gap;
    const offX = (s.sw - gridW) / 2;
    const offY = (s.sh - gridH) / 2;

    sheetsToDraw.forEach((cards, sheetIndex) => {
        const sheet = el("div", "print-sheet");
        sheet.style.width = s.sw + "in";
        sheet.style.height = `calc(${s.sh}in - 0.5px)`;

        cards.forEach(({ item }, i) => {
            const col = i % grid.cols;
            const row = Math.floor(i / grid.cols);

            const card = el("div", "print-card");
            card.style.left = (offX + col * (s.cw + s.gap)) + "in";
            card.style.top = (offY + row * (s.ch + s.gap)) + "in";
            card.style.width = s.cw + "in";
            card.style.height = s.ch + "in";

            card.append(makeCardArt(item.element, s));
            if (s.marks && markLength >= 0.04) card.append(makeCropMarks(s, markLength));
            sheet.append(card);
        });

        if (s.labels) {
            const names = s.mode === "proof"
                ? "Proof"
                : cards[0].item.label;
            sheet.append(el("div", "sheet-label",
                `${order.reference} · ${names} · Sheet ${sheetIndex + 1} of ${sheetsToDraw.length}`));
        }

        container.append(sheet);
    });

    updatePreviewScale(s);
}

function setView(name) {
    const sheets = name === "sheets";
    $("#pageView").hidden = sheets;
    $("#sheetsView").hidden = !sheets;
    $("#tabPage").classList.toggle("active", !sheets);
    $("#tabSheets").classList.toggle("active", sheets);

    if (sheets) renderSheets();
    else drawPageView();
}

// ------------------------------------------------------------
// Copy corrected data back out
// ------------------------------------------------------------

async function copyText(text, button) {
    const original = button.textContent;
    try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
    } catch (e) {
        window.prompt("Copy this text:", text);
    }
    setTimeout(() => { button.textContent = original; }, 1500);
}

function correctedAddOns() {
    return sources.filter(s => s.type === "addon").map(src => ({
        ...src.original,
        designId: src.designId,
        designTitle: src.design?.title ?? src.original.designTitle,
        quantity: src.quantity,
        wording: src.wording,
        customInfo: src.customInfo
    }));
}

// ------------------------------------------------------------
// Wiring
// ------------------------------------------------------------

function onSettingsChange() {
    $$custom();
    saveSettings();
    renderSheets();
}

function $$custom() {
    const custom = $("#sheetSize").value === "Custom";
    document.querySelectorAll(".custom-size").forEach(l => { l.hidden = !custom; });
}

function showOrderPicker() {
    const wrap = $("#orderPickerWrap");
    const picker = $("#orderPicker");
    picker.replaceChildren();

    orders.forEach((o, i) => {
        picker.add(new Option(`${o.reference || "Row " + (i + 1)} — ${o.raw["Customer"] || ""}`, String(i)));
    });

    wrap.hidden = orders.length < 2;
}

$("#loadOrder").addEventListener("click", async () => {
    const status = $("#loadStatus");
    try {
        orders = parseOrders($("#orderPaste").value);
        showOrderPicker();
        await loadOrder(orders[0]);
    } catch (e) {
        status.textContent = e.message;
    }
});

$("#orderPicker").addEventListener("change", async e => {
    await loadOrder(orders[Number(e.target.value)]);
});

$("#prevPage").addEventListener("click", () => {
    activePiece = Math.max(0, activePiece - 1);
    drawPageView();
});

$("#nextPage").addEventListener("click", () => {
    activePiece = Math.min(pieces.length - 1, activePiece + 1);
    drawPageView();
});

$("#tabPage").addEventListener("click", () => setView("page"));
$("#tabSheets").addEventListener("click", () => setView("sheets"));

[...SAVED_INPUTS, ...SAVED_CHECKS, "cardW", "cardH"].forEach(id => {
    $("#" + id).addEventListener("input", onSettingsChange);
    $("#" + id).addEventListener("change", onSettingsChange);
});

$("#printButton").addEventListener("click", () => {
    if (!pieces.length) return;
    renderSheets();
    window.print();
});

$("#copyWording").addEventListener("click", e => {
    if (order) copyText(JSON.stringify(sources[0].wording), e.currentTarget);
});

$("#copyAddOns").addEventListener("click", e => {
    if (order) copyText(JSON.stringify(correctedAddOns()), e.currentTarget);
});

$("#copyStyles").addEventListener("click", e => {
    if (order) copyText(JSON.stringify(sources[0].styles), e.currentTarget);
});

window.addEventListener("resize", debounce(() => {
    if (order) updatePreviewScale(getSettings());
}, 150));

// Start up
loadSavedSettings();
$$custom();

try {
    store = await getStoreData();

    try {
        addOnCatalog = await loadAddOnData();
    } catch (e) {
        console.warn("Add-on catalog unavailable:", e);
    }

    $("#loadOrder").disabled = false;
    $("#loadStatus").textContent = addOnCatalog
        ? "Ready. Paste an order row."
        : "Ready, but the add-on catalog could not be loaded, so add-on pages won't preview.";
} catch (e) {
    $("#loadStatus").textContent = "Could not load the catalog: " + e.message;
}
