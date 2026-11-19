const SVG_NS = "http://www.w3.org/2000/svg";

export function discoverFields(pageElements) {
    const registry = new Map();

    pageElements.forEach(({ page, element }, index) => {
        element.querySelectorAll("[data-field]").forEach(node => {
            const id = node.getAttribute("data-field");
            if (!id || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return;

            const existing = registry.get(id);
            if (existing) {
                existing.occurrences.push({ pageIndex: index, node });
                return;
            }

            registry.set(id, {
                id,
                label: node.getAttribute("data-label") || humanize(id),
                defaultValue: node.textContent || "",
                required: node.getAttribute("data-required") === "true",
                placeholder: node.getAttribute("data-placeholder") || "",
                maxLength: Number(node.getAttribute("data-maxlength")) || 500,
                multiline: node.getAttribute("data-multiline") === "true",
                advanced: node.getAttribute("data-advanced") !== "false",
                styleDefaults: readStyleDefaults(node),
                pageIndex: index,
                pageLabel: page.label,
                occurrences: [{ pageIndex: index, node }]
            });
        });
    });

    return [...registry.values()];
}

function humanize(s) {
    return s.replace(/[_-]/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, c => c.toUpperCase());
}

// Read the template's own color/font/size by walking up the ancestors.
// (Elements are detached at this point, so computed styles aren't available.)
function readStyleDefaults(node) {
    const isSvg = node.namespaceURI === SVG_NS;
    const find = (attr, cssProp) => {
        for (let el = node; el && el.nodeType === 1; el = el.parentNode) {
            const inline = el.style?.getPropertyValue(cssProp);
            if (inline) return inline;
            const v = el.getAttribute(attr);
            if (v) return v;
        }
        return "";
    };
    return {
        color: find(isSvg ? "fill" : "color", isSvg ? "fill" : "color"),
        fontFamily: find("font-family", "font-family"),
        fontSize: parseFloat(find("font-size", "font-size")) || ""
    };
}

export function setFieldValue(node, value) {
    const safe = String(value ?? "");

    if (node.namespaceURI !== SVG_NS) {
        node.textContent = safe;
        return;
    }

    // Inline field inside a larger <text> line: just replace the text.
    if (node.localName === "tspan") {
        node.textContent = safe.replace(/\n/g, " ");
        return;
    }

    // Whole <text> element: supports multi-line values.
    while (node.firstChild) node.removeChild(node.firstChild);

    const x = node.getAttribute("x");
    safe.split(/\n/).forEach((line, i) => {
        const t = document.createElementNS(SVG_NS, "tspan");
        if (x !== null) t.setAttribute("x", x);
        if (i) t.setAttribute("dy", "1.2em");
        t.textContent = line;
        node.appendChild(t);
    });
}

// ---- Per-field style overrides ----------------------------------------
// styles shape: { fieldId: { color, fontFamily, fontSize } }

const originalInline = new WeakMap();

// Sets or clears one inline CSS property, restoring any inline value the
// template had originally instead of wiping it.
function setProp(node, prop, value) {
    let saved = originalInline.get(node);
    if (!saved) originalInline.set(node, (saved = {}));

    if (!(prop in saved)) {
        if (!value) return;
        saved[prop] = node.style.getPropertyValue(prop);
    }

    if (value) node.style.setProperty(prop, value);
    else if (saved[prop]) node.style.setProperty(prop, saved[prop]);
    else node.style.removeProperty(prop);
}

export function setFieldStyle(node, style = {}) {
    const isSvg = node.namespaceURI === SVG_NS;

    setProp(node, isSvg ? "fill" : "color", style.color || "");
    setProp(node, "font-family",
        style.fontFamily ? `"${style.fontFamily}", serif` : "");
    // In SVG, px means user units, same as the font-size="36" attribute.
    setProp(node, "font-size",
        style.fontSize ? `${style.fontSize}px` : "");
}

export function applyWording(fields, values, styles = {}) {
    fields.forEach(f =>
        f.occurrences.forEach(o => {
            setFieldValue(o.node, values[f.id] ?? f.defaultValue ?? "");
            setFieldStyle(o.node, styles[f.id]);
        })
    );
}