// line-manager.js
//
// Add / remove lines in an SVG invitation, and reflow the page to fit.
//
// A "line" is a data-field. An added line is stored as plain data:
//     { id: "card2_extra1", ref: "card2_date", position: "below" }
// Its text lives in `wording[id]` and its color/font/size in `fieldStyles[id]`,
// exactly like any template field. The editor and the print page both call
// applyExtraLines() + reflowPages() through renderInvitation(), so they
// produce the same layout from the same saved data.
//
// Layout rules
//  - Lines are grouped into rows by their template y. Added lines get their own row.
//  - The top of the first row stays put. Every row below is pushed down.
//  - If the content would run past the bottom limit, spacing AND text are
//    scaled down together (never below MIN_SCALE). Removing lines scales back
//    up, but never past the template's original size (k <= 1).
//  - Nothing is rewritten: reflow only sets a `transform` on each <text>.
//  - Template lines can be removed too. They are only hidden (display="none")
//    and listed in `removedFields`, so the customer can restore them. The rows
//    below close up; any added line anchored to a removed line re-attaches to
//    the nearest remaining line.

import { getLineStep } from "./field-discovery.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const MIN_SCALE = 0.55;
const BOTTOM_MARGIN = 36; // default safe bottom = viewBox height - this
const ROW_TOLERANCE = 0.75; // y values this close are the same row
const EPS = 1e-6;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export const NEW_LINE_TEXT = "New line";

// ---------------------------------------------------------------------------
// Saved-state helpers (pure, no DOM)
// ---------------------------------------------------------------------------

export function sanitizeExtraLines(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();

    for (const e of raw.slice(0, 60)) {
        if (!e || typeof e !== "object") continue;
        if (!ID_RE.test(e.id) || !ID_RE.test(e.ref) || seen.has(e.id)) continue;
        if (e.position !== "above" && e.position !== "below") continue;
        seen.add(e.id);
        out.push({ id: e.id, ref: e.ref, position: e.position });
    }
    return out;
}

export function sanitizeRemovedFields(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((id) => typeof id === "string" && ID_RE.test(id)))].slice(0, 200);
}

export function createExtraLine(extraLines, refId, position) {
    const prefix = String(refId).split("_")[0] || "line";
    const re = new RegExp("^" + prefix + "_extra(\\d+)$");
    let max = 0;

    extraLines.forEach((e) => {
        const m = re.exec(e.id);
        if (m) max = Math.max(max, Number(m[1]));
    });

    return {
        id: `${prefix}_extra${max + 1}`,
        ref: refId,
        position: position === "above" ? "above" : "below"
    };
}

// Removes an added line. Any line that was placed relative to it is
// re-attached to the removed line's own anchor so it stays in place.
export function removeExtraLine(extraLines, id) {
    const target = extraLines.find((e) => e.id === id);
    if (!target) return extraLines;

    return extraLines
        .filter((e) => e.id !== id)
        .map((e) => (e.ref === id ? { ...e, ref: target.ref, position: target.position } : e));
}

// ---------------------------------------------------------------------------
// Which fields can host an added line?
// ---------------------------------------------------------------------------

// Returns the <text> element a field lives in, or null if the field can't be
// reflowed (HTML field, text on a path, no y attribute, template's own transform).
export function getLineHost(node) {
    if (!node || node.namespaceURI !== SVG_NS) return null;

    const text = node.localName === "text" ? node : node.closest("text");
    if (!text) return null;
    if (node.closest("textPath") || text.querySelector("textPath")) return null;
    if (!isFinite(parseFloat(text.getAttribute("y")))) return null;
    if (text.hasAttribute("transform") && !text.hasAttribute("data-flow-managed")) return null;

    return text;
}

// ---------------------------------------------------------------------------
// Insert the added lines into freshly loaded page elements.
// Call BEFORE discoverFields() so the new lines are discovered like any field.
// ---------------------------------------------------------------------------

const COPY_ATTRS = [
    ["font-family", "font-family"],
    ["font-size", "font-size"],
    ["font-weight", "font-weight"],
    ["font-style", "font-style"],
    ["fill", "fill"],
    ["text-anchor", "text-anchor"],
    ["letter-spacing", "letter-spacing"],
    ["direction", "direction"]
];

// Walks up the ancestors for an attribute or inline style value.
function inherited(node, attr, cssProp) {
    for (let el = node; el && el.nodeType === 1; el = el.parentNode) {
        const inline = el.style?.getPropertyValue(cssProp);
        if (inline) return inline;
        const v = el.getAttribute(attr);
        if (v) return v;
    }
    return "";
}

export function applyExtraLines(pages, extraLines = []) {
    if (!extraLines.length) return;

    const nodeById = new Map();
    pages.forEach(({ element }) => {
        element.querySelectorAll("[data-field]").forEach((n) => {
            const id = n.getAttribute("data-field");
            if (id && !nodeById.has(id)) nodeById.set(id, n);
        });
    });

    for (const line of extraLines) {
        if (nodeById.has(line.id)) continue;

        const src = nodeById.get(line.ref);
        const host = getLineHost(src);
        if (!host) continue;

        const text = document.createElementNS(SVG_NS, "text");

        // Same anchor point as the line it was added from.
        const x = host.getAttribute("data-orig-x") ?? host.getAttribute("x");
        if (x !== null) text.setAttribute("x", x);
        text.setAttribute("y", host.getAttribute("y"));

        // Inherit the source's font, color and size (from the field itself,
        // not the whole <text>, so a name tspan passes on the name's look).
        COPY_ATTRS.forEach(([attr, css]) => {
            const v = inherited(src, attr, css);
            if (v) text.setAttribute(attr, v);
        });
        if (!text.hasAttribute("text-anchor")) {
            const a = inherited(host, "text-anchor", "text-anchor");
            if (a) text.setAttribute("text-anchor", a);
        }

        const srcLabel = src.getAttribute("data-label") || line.ref;
        text.setAttribute("data-field", line.id);
        text.setAttribute("data-label", `Added line · ${srcLabel}`);
        text.setAttribute("data-placeholder", "Type your text");
        text.setAttribute("data-maxlength", "200");
        text.setAttribute("data-extra-line", "true");
        text.textContent = NEW_LINE_TEXT;

        // Placed next to the source so the editor's field list follows the page order.
        if (line.position === "above") host.before(text);
        else host.after(text);

        nodeById.set(line.id, text);
    }
}

// Hides the removed fields. They stay in the DOM (so the editor can list them
// for restoring) but are skipped by the reflow. Call before discoverFields().
export function applyRemovedFields(pages, removedFields = []) {
    if (!removedFields.length) return;

    pages.forEach(({ element }) => {
        removedFields.forEach((id) => {
            element.querySelectorAll(`[data-field="${CSS.escape(id)}"]`).forEach((n) => {
                n.setAttribute("display", "none");
                n.setAttribute("data-line-removed", "true");
            });
        });
    });
}

// ---------------------------------------------------------------------------
// Pure layout (no DOM) -- exported so it can be unit tested
// ---------------------------------------------------------------------------

// Baseline-to-baseline distance for a new line placed next to seq[idx].
function linePitch(seq, idx, position, size) {
    const here = seq[idx];
    const order = position === "above" ? [idx - 1, idx + 1] : [idx + 1, idx - 1];

    for (const j of order) {
        const other = seq[j];
        if (!other || here.origTop == null || other.origTop == null) continue;
        const d = Math.abs(other.origTop - here.origTop);
        const ratio = d / size;
        if (ratio >= 1.15 && ratio <= 2.6) return d; // looks like normal line spacing
    }
    return size * 1.8;
}

// rows: [{ recs, top, hOrig, hNow }]  (template rows, top to bottom)
// extraLines: saved list; findRec(fieldId) -> rec | undefined
// Each rec needs { size }.
export function layoutPage(rows, extraLines, findRec, limitBottom) {
    // Removed rows drop out. The row after them closes up using the gap that
    // sat before the first removed row.
    const seq = [];
    let pending = null;

    rows.forEach((r, i) => {
        const gap = i ? Math.max(0, r.top - (rows[i - 1].top + rows[i - 1].hOrig)) : 0;

        if (r.removed) {
            if (pending === null) pending = gap;
            return;
        }

        seq.push({
            recs: r.recs,
            origTop: r.top,
            h: r.hNow,
            gapBefore: seq.length ? (pending ?? gap) : 0
        });
        pending = null;
    });

    if (!seq.length) return null;

    const T0 = seq[0].origTop;
    const lastRow = rows[rows.length - 1];
    const origBottom = lastRow.top + lastRow.hOrig;

    for (const extra of extraLines) {
        const rec = findRec(extra.id);
        const refRec = findRec(extra.ref);
        if (!rec || !refRec) continue;

        let idx = seq.findIndex((e) => e.recs.includes(refRec));
        let position = extra.position;

        if (idx < 0) {
            // Anchored to a removed row: attach to the nearest remaining row.
            const ri = rows.findIndex((r) => r.recs.includes(refRec));
            if (ri < 0) continue;

            let target = -1;
            position = "below";
            for (let j = ri - 1; j >= 0 && target < 0; j--) if (!rows[j].removed) target = j;

            if (target < 0) {
                position = "above";
                for (let j = ri + 1; j < rows.length && target < 0; j++) if (!rows[j].removed) target = j;
            }
            if (target < 0) continue;

            idx = seq.findIndex((e) => e.recs === rows[target].recs);
            if (idx < 0) continue;
        }

        const p = linePitch(seq, idx, position, rec.size);
        const entry = { recs: [rec], origTop: undefined, h: 0, gapBefore: 0 };

        if (position === "above") {
            entry.gapBefore = seq[idx].gapBefore;
            seq[idx].gapBefore = p;
            seq.splice(idx, 0, entry);
        } else {
            entry.gapBefore = p;
            seq.splice(idx + 1, 0, entry);
        }
    }

    const limit = Math.max(limitBottom, origBottom);
    const room = limit - T0;

    let span = 0;
    seq.forEach((e, i) => {
        span += e.h + (i ? e.gapBefore : 0);
    });

    const k = span > room && span > 0 ? Math.max(MIN_SCALE, room / span) : 1;

    const tops = [];
    let bottom = T0;
    seq.forEach((e, i) => {
        const top = i ? bottom + k * e.gapBefore : T0;
        tops.push(top);
        bottom = top + k * e.h;
    });

    return { seq, tops, k, bottom };
}

// ---------------------------------------------------------------------------
// Reflow (DOM)
// ---------------------------------------------------------------------------

function effectiveSize(field, styles) {
    return Number(styles?.[field.id]?.fontSize) || Number(field.styleDefaults?.fontSize) || 10;
}

function stepToNumber(step, size) {
    const s = String(step ?? "").trim();
    const n = parseFloat(s);
    if (!isFinite(n)) return size * 1.2;
    return /em$/i.test(s) ? n * size : n;
}

const round = (n) => Math.round(n * 1000) / 1000;

function setTransform(rec, dy, k) {
    const el = rec.el;
    const unchanged = Math.abs(dy) < EPS && Math.abs(k - 1) < EPS;

    if (unchanged) {
        if (el.hasAttribute("data-flow-managed")) {
            el.removeAttribute("transform");
            el.removeAttribute("data-flow-managed");
        }
        return;
    }

    el.setAttribute("data-flow-managed", "1");

    if (Math.abs(k - 1) < EPS) {
        el.setAttribute("transform", `translate(0 ${round(dy)})`);
        return;
    }

    // Scale around the line's own anchor so it stays centered / aligned.
    const { x, y } = rec;
    el.setAttribute(
        "transform",
        `translate(${round(x)} ${round(y + dy)}) scale(${round(k)}) translate(${round(-x)} ${round(-y)})`
    );
}

function reflowPage(pageElement, pageIndex, fields, extraLines, styles) {
    const svg = pageElement.querySelector?.("svg");
    if (!svg) return null;

    const extraIds = new Set(extraLines.map((e) => e.id));

    // One record per <text> element that holds at least one field.
    const recs = new Map();

    fields.forEach((field) =>
        field.occurrences.forEach((o) => {
            if (o.pageIndex !== pageIndex) return;

            const host = getLineHost(o.node);
            if (!host || !pageElement.contains(host)) return;

            let rec = recs.get(host);
            if (!rec) {
                rec = {
                    el: host,
                    fields: [],
                    size: 0,
                    x: parseFloat(host.getAttribute("data-orig-x") ?? host.getAttribute("x")) || 0,
                    y: parseFloat(host.getAttribute("y")),
                    hOrig: 0,
                    hNow: 0,
                    total: 0,
                    gone: 0
                };
                recs.set(host, rec);
            }

            rec.fields.push(field);
            rec.total++;
            if (o.node.closest("[data-line-removed]")) rec.gone++;

            const size = effectiveSize(field, styles);
            rec.size = Math.max(rec.size, size);

            // A multiline <text> is taller than one baseline.
            if (o.node === host && host.getAttribute("data-multiline") === "true") {
                const step = stepToNumber(getLineStep(host), size);
                const nOrig = Math.max(1, String(field.defaultValue ?? "").split("\n").length);
                const nNow = Math.max(1, [...host.children].filter((c) => c.localName === "tspan").length);
                rec.hOrig = (nOrig - 1) * step;
                rec.hNow = (nNow - 1) * step;
            }
        })
    );

    const recByFieldId = new Map();
    recs.forEach((rec) => rec.fields.forEach((f) => recByFieldId.set(f.id, rec)));

    // Template rows (everything except the added lines), grouped by y.
    const templateRecs = [...recs.values()]
        .filter((rec) => !rec.fields.some((f) => extraIds.has(f.id)))
        .sort((a, b) => a.y - b.y);

    const rows = [];
    templateRecs.forEach((rec) => {
        const row = rows[rows.length - 1];
        const removed = rec.total > 0 && rec.gone === rec.total;

        if (row && Math.abs(rec.y - row.top) <= ROW_TOLERANCE) {
            row.recs.push(rec);
            row.hOrig = Math.max(row.hOrig, rec.hOrig);
            row.hNow = Math.max(row.hNow, rec.hNow);
            row.removed = row.removed && removed;
        } else {
            rows.push({ recs: [rec], top: rec.y, hOrig: rec.hOrig, hNow: rec.hNow, removed });
        }
    });

    const vb = svg.viewBox?.baseVal;
    const vbHeight = vb && vb.height ? vb.height : parseFloat(svg.getAttribute("height")) || 612;
    const flowBottom = parseFloat(svg.getAttribute("data-flow-bottom")) || vbHeight - BOTTOM_MARGIN;

    const layout = layoutPage(rows, extraLines, (id) => recByFieldId.get(id), flowBottom);
    if (!layout) return null;

    layout.seq.forEach((entry, i) => {
        entry.recs.forEach((rec) => {
            const rowTop = entry.origTop ?? rec.y;
            setTransform(rec, layout.tops[i] - rowTop, layout.k);
        });
    });

    if (layout.k < 1 - EPS) svg.dataset.flowScale = String(round(layout.k));
    else delete svg.dataset.flowScale;

    return { pageIndex, k: layout.k };
}

// Call after applyWording(). Safe to call repeatedly (idempotent).
export function reflowPages(pages, fields, extraLines = [], styles = {}) {
    return pages.map(({ element }, i) => reflowPage(element, i, fields, extraLines, styles));
}