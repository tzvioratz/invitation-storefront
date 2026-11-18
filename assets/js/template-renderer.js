
import { discoverFields, applyWording } from "./field-discovery.js";

const cache = new Map();
const fontLoadCache = new Map();
const fontStylesheetCache = new Map();

// --------------------------------------------------
// LOAD TEMPLATE PAGE
// --------------------------------------------------

export async function loadPage(page) {
    const url = new URL("../../" + page.file, import.meta.url).href;

    if (!cache.has(url)) {
        cache.set(
            url,
            fetch(url).then((r) => {
                if (!r.ok) {
                    throw new Error(`Could not load template page: ${page.file}`);
                }
                return r.text();
            })
        );
    }

    const source = await cache.get(url);

    const wrapper = document.createElement("div");

    wrapper.className =
        "invitation-page " +
        (page.type === "svg" ? "svg-page" : "html-page");

    if (page.type === "svg") {
        const doc = new DOMParser().parseFromString(
            source,
            "image/svg+xml"
        );

        if (doc.querySelector("parsererror")) {
            throw new Error(`Invalid SVG: ${page.file}`);
        }

        const svg = doc.documentElement;

        if (svg.tagName.toLowerCase() !== "svg") {
            throw new Error(`Template is not an SVG: ${page.file}`);
        }

        // Load declared fonts before inserting the SVG.
        await loadSvgFonts(svg, url);

        wrapper.appendChild(document.importNode(svg, true));

    } else {
        const doc = new DOMParser().parseFromString(
            source,
            "text/html"
        );

        const body = doc.body;

        [...body.childNodes].forEach((n) =>
            wrapper.appendChild(document.importNode(n, true))
        );

        const styles = [...doc.querySelectorAll("style")];

        styles.forEach((s) =>
            wrapper.prepend(document.importNode(s, true))
        );
    }

    return wrapper;
}



async function loadSvgFonts(svg, templateUrl) {

    const declarations = [
        ...svg.querySelectorAll(
            "[data-font-family][data-font-provider][data-font-source]"
        )
    ];

    const fonts = new Map();

    declarations.forEach(el => {

        const family = el.getAttribute("data-font-family")?.trim();
        const provider = el.getAttribute("data-font-provider")?.trim().toLowerCase();
        const source = el.getAttribute("data-font-source")?.trim();
        const weight = el.getAttribute("data-font-weight")?.trim() || "400";
        const style = el.getAttribute("data-font-style")?.trim() || "normal";

        if (!family || !provider || !source) {
            console.warn("Incomplete SVG font declaration:", el);
            return;
        }

        const key = [
            provider,
            family,
            source,
            weight,
            style
        ].join("|");

        fonts.set(key, { family, provider, source, weight, style });
    });

    const results = await Promise.allSettled(
        [...fonts.values()].map(font => loadFont(font, templateUrl))
    );

    results.forEach((result, index) => {
        if (result.status === "rejected") {
            console.warn(
                "Could not load SVG font:",
                [...fonts.values()][index],
                result.reason
            );
        }
    });

    await document.fonts.ready;
}


async function loadFont(font, templateUrl) {

    const key = [
        font.provider,
        font.family,
        font.source,
        font.weight,
        font.style
    ].join("|");

    if (!fontLoadCache.has(key)) {

        const promise = (async () => {

            if (font.provider === "google") {

                await loadGoogleStylesheet(font.source);

            } else if (
                font.provider === "url" ||
                font.provider === "local"
            ) {

                await loadDirectFont(font, templateUrl);

            } else {

                throw new Error(
                    `Unsupported font provider: ${font.provider}`
                );
            }

            const descriptor =
                `${font.style} ${font.weight} 16px "${font.family.replace(/["\\]/g, "\\$&")}"`;

            await document.fonts.load(descriptor, "אבג ABC");

        })();

        fontLoadCache.set(key, promise);

        promise.catch(() => {
            fontLoadCache.delete(key);
        });
    }

    return fontLoadCache.get(key);
}


// --------------------------------------------------
// GOOGLE FONTS
// --------------------------------------------------

async function loadGoogleStylesheet(source) {

    const url = new URL(source);

    if (
        url.protocol !== "https:" ||
        url.hostname !== "fonts.googleapis.com"
    ) {
        throw new Error("Invalid Google Fonts stylesheet URL.");
    }

    if (!fontStylesheetCache.has(source)) {

        const promise = new Promise((resolve, reject) => {

            const link = document.createElement("link");

            link.rel = "stylesheet";
            link.href = source;

            link.onload = resolve;

            link.onerror = () => {
                link.remove();
                reject(new Error("Google Fonts stylesheet failed to load."));
            };

            document.head.appendChild(link);
        });

        fontStylesheetCache.set(source, promise);

        promise.catch(() => {
            fontStylesheetCache.delete(source);
        });
    }

    return fontStylesheetCache.get(source);
}


// --------------------------------------------------
// DIRECT / LOCALLY HOSTED FONTS
// --------------------------------------------------

async function loadDirectFont(font, templateUrl) {

    const url = new URL(font.source, templateUrl);

    if (font.provider === "local" && url.origin !== location.origin) {
        throw new Error("Local fonts must be hosted on this website.");
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Invalid font URL protocol.");
    }

    if (font.provider === "url" && url.protocol !== "https:") {
        throw new Error("External font URLs must use HTTPS.");
    }

    // Check whether this exact font face is already registered.
    const existing = [...document.fonts].find(face =>
        face.family === font.family &&
        face.weight === font.weight &&
        face.style === font.style
    );

    if (existing) {
        await existing.load();
        return;
    }

    const face = new FontFace(
        font.family,
        `url("${url.href}")`,
        {
            weight: font.weight,
            style: font.style
        }
    );

    await face.load();

    document.fonts.add(face);
}

// --------------------------------------------------
// RENDER INVITATION
// --------------------------------------------------

export async function renderInvitation({
    invitation,
    wording = {},
    options = {},
    target,
    size = "large"
}) {

    target.replaceChildren();

    const pages = [];

    for (let i = 0; i < invitation.pages.length; i++) {

        const page = invitation.pages[i];

        try {

            const el = await loadPage(page);

            el.dataset.pageIndex = i;
            el.dataset.pageLabel = page.label;

            applyOptions(el, options);

            pages.push({ page, element: el });

        } catch (err) {

            const fallback = document.createElement("div");

            fallback.className = "invitation-page template-error";
            fallback.textContent = err.message;

            pages.push({ page, element: fallback });
        }
    }

    const fields = discoverFields(pages);

    applyWording(fields, wording);

    const pagesToDisplay =
        size === "thumb"
            ? getCatalogPreviewPages(pages)
            : pages;

    pagesToDisplay.forEach(p => {

        if (size === "thumb") {
            p.element.style.width = "100%";
            p.element.style.height = "auto";
        }

        target.appendChild(p.element);
    });

    return { pages, fields };
}


// --------------------------------------------------
// CATALOG PREVIEW
// --------------------------------------------------

function getCatalogPreviewPages(pages) {

    if (pages.length <= 1) return pages;

    const insidePages = pages.filter(p =>
        /^inside\b/i.test((p.page.label || "").trim())
    );

    if (insidePages.length) return insidePages;

    const frontPage = pages.find(p =>
        /^front$/i.test((p.page.label || "").trim())
    );

    return [frontPage || pages[0]];
}


// --------------------------------------------------
// OPTIONS
// --------------------------------------------------

function applyOptions(root, options) {

    if (options.color) {
        root.style.setProperty(
            "--invite-color",
            colorValue(options.color)
        );
    }

    if (options.font) {
        root.style.setProperty(
            "--invite-font",
            fontValue(options.font)
        );
    }

    root.querySelectorAll("[data-option]").forEach(el => {

        const key = el.getAttribute("data-option");

        if (options[key] != null) {
            el.textContent = String(options[key]);
        }
    });

    root.dataset.paper = options.paper || "";
    root.dataset.design = options.design || "";
}


function colorValue(v) {

    return {
        Navy: "#26384d",
        Sage: "#788b78",
        Terracotta: "#b76d54",
        Burgundy: "#713b4c"
    }[v] || v;
}


function fontValue(v) {

    return (
        {
            Cormorant: '"Cormorant Garamond",serif',
            Garamond: "Garamond,serif",
            "DM Sans": '"DM Sans",sans-serif'
        }[v] || "serif"
    );
}


// --------------------------------------------------
// UPDATE WORDING
// --------------------------------------------------

export function updateRenderedWording(rendered, values) {
    applyWording(rendered.fields, values);
}
