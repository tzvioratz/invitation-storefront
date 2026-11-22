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
// Font
const fontControls = document.createElement("div");
fontControls.className = "field-advanced-font-controls";

const fontInput = document.createElement("input");
fontInput.type = "text";
fontInput.placeholder = "Enter Google Font name";
fontInput.autocomplete = "off";
fontInput.spellcheck = false;
fontInput.value = styles[field.id]?.fontFamily || "";

const applyFontButton = document.createElement("button");
applyFontButton.type = "button";
applyFontButton.textContent = "Apply";
applyFontButton.className = "field-advanced-font-apply";

const fontStatus = document.createElement("span");
fontStatus.className = "field-advanced-font-status";

const fontLink = document.createElement("a");
fontLink.href = "https://fonts.google.com/";
fontLink.target = "_blank";
fontLink.rel = "noopener noreferrer";
fontLink.textContent = "Browse Google Fonts";
fontLink.className = "field-advanced-font-link";

async function applyFont() {
    const family = fontInput.value.trim();

    if (!family) {
        fontStatus.textContent = "Enter a font name first.";
        return;
    }

    applyFontButton.disabled = true;
    fontStatus.textContent = "Loading font...";

    try {
        await ensureGoogleFont(family);

        update({ fontFamily: family });

        fontStatus.textContent = "Font applied!";
    } catch (error) {
        console.warn("Could not load Google Font:", family, error);
        fontStatus.textContent = "Could not load this font. Check its name.";
    } finally {
        applyFontButton.disabled = false;
    }
}

applyFontButton.addEventListener("click", applyFont);

fontInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        applyFont();
    }
});

fontControls.append(
    fontInput,
    applyFontButton,
    fontLink,
    fontStatus
);

row("Font", fontControls);

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
    fontInput.value = saved.fontFamily;
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
        fontStatus.textContent = "";
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