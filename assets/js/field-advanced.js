import { ensureGoogleFont } from "./template-renderer.js";

// Edit this list once; every page that uses the controls picks it up.
export const ADVANCED_FONTS = [
    "Frank Ruhl Libre", "David Libre", "Miriam Libre", "Heebo", "Assistant",
    "Rubik", "Alef", "Secular One", "Suez One", "Noto Serif Hebrew",
    "Cormorant Garamond", "DM Sans"
];

function toHex(color) {
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    if (/^#[0-9a-f]{3}$/i.test(color))
        return "#" + [...color.slice(1)].map(c => c + c).join("");
    return "#000000";
}

export function createAdvancedControls(field, styles, onChange) {
    const defaults = field.styleDefaults || {};

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "field-advanced-link";
    toggle.textContent = "Advanced ▾";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", `Advanced styling for ${field.label}`);

    const panel = document.createElement("div");
    panel.className = "field-advanced";
    panel.hidden = true;

    function row(text, control) {
        const wrap = document.createElement("label");
        wrap.className = "field-advanced-row";
        const span = document.createElement("span");
        span.textContent = text;
        wrap.append(span, control);
        panel.appendChild(wrap);
    }

    function update(patch) {
        const next = { ...(styles[field.id] || {}), ...patch };
        Object.keys(next).forEach(k => {
            if (next[k] === "" || next[k] == null) delete next[k];
        });

        if (Object.keys(next).length) styles[field.id] = next;
        else delete styles[field.id];

        toggle.classList.toggle("has-overrides", field.id in styles);
        onChange();
    }

    // Color
    const color = document.createElement("input");
    color.type = "color";
    color.value = toHex(defaults.color);
    color.addEventListener("input", () => update({ color: color.value }));
    row("Color", color);

    // Font
    const font = document.createElement("select");
    font.add(new Option("Template default", ""));
    ADVANCED_FONTS.forEach(f => font.add(new Option(f, f)));
    font.addEventListener("change", async () => {
        const family = font.value;
        if (family) {
            try { await ensureGoogleFont(family); }
            catch (e) { console.warn("Could not load font:", family, e); }
        }
        update({ fontFamily: family });
    });
    row("Font", font);

    // Size
    const size = document.createElement("input");
    size.type = "number";
    size.min = "6";
    size.max = "200";
    size.step = "1";
    size.placeholder = defaults.fontSize ? `Default (${defaults.fontSize})` : "Default";
    size.addEventListener("input", () =>
        update({ fontSize: size.value ? Number(size.value) : "" })
    );
    row("Size", size);
    
    // Styles
    const saved = styles[field.id] || {};
if (saved.color) color.value = toHex(saved.color);
if (saved.fontFamily) {
    if (![...font.options].some(o => o.value === saved.fontFamily))
        font.add(new Option(saved.fontFamily, saved.fontFamily));
    font.value = saved.fontFamily;
}
if (saved.fontSize) size.value = saved.fontSize;
toggle.classList.toggle("has-overrides", field.id in styles);

    // Reset
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "field-advanced-reset";
    reset.textContent = "Reset to template";
    reset.addEventListener("click", () => {
        color.value = toHex(defaults.color);
        font.value = "";
        size.value = "";
        delete styles[field.id];
        toggle.classList.remove("has-overrides");
        onChange();
    });
    panel.appendChild(reset);

    toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    toggle.textContent = panel.hidden ? "advanced ▾" : "advanced ▴";
});

    return { toggle, panel };
}