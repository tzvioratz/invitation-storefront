
import { discoverFields, applyWording } from "./field-discovery.js";

const cache = new Map();
const SVG_CACHE_NAME = "invitation-templates-v1";
const refreshing = new Map();

const DISABLE_SVG_CACHE = false;
const fontLoadCache = new Map();
const fontStylesheetCache = new Map();

// --------------------------------------------------
// LOAD TEMPLATE PAGE
// --------------------------------------------------

export async function loadPage(page) {
    const url = new URL("../../" + page.file, import.meta.url).href;

const source = await getTemplateSource(url, page);

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
    styles = {}, 
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

    applyWording(fields, wording, styles);

    if (size === "thumb") {

        // Create one stack containing every invitation page.
        const stack = document.createElement("div");
        stack.className = "catalog-page-stack";

        pages.forEach((p, index) => {

            p.element.classList.add("catalog-preview-page");

            p.element.style.setProperty("--page-index", index);
            p.element.style.setProperty("--page-count", pages.length);
            p.element.style.setProperty("--page-offset", `${index * 100}px`);

            stack.appendChild(p.element);
        });

        target.appendChild(stack);

    } else {

        // Normal full-size rendering.
        pages.forEach(p => {
            target.appendChild(p.element);
        });
    }

    return { pages, fields };
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

export function updateRenderedWording(rendered, values, styles = {}) {
    applyWording(rendered.fields, values, styles);
}
// google fonts
export async function ensureGoogleFont(family) {
    const url = "https://fonts.googleapis.com/css2?family=" +
        encodeURIComponent(family).replace(/%20/g, "+") + "&display=swap";
    await loadGoogleStylesheet(url);
    await document.fonts.load(`16px "${family}"`, "אבג ABC");
}

//cache



async function getTemplateSource(url, page) {

    // Development mode: always fetch fresh.
    if (DISABLE_SVG_CACHE) {
        const response = await fetch(url, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`Could not load template page: ${page.file}`);
        }

        return response.text();
    }

    // Reuse an existing in-memory result.
    if (cache.has(url)) {
        return cache.get(url);
    }

    const promise = (async () => {

        let cacheStorage = null;

        try {
            if ("caches" in window) {
                cacheStorage = await caches.open(SVG_CACHE_NAME);
            }
        } catch (error) {
            console.warn("SVG cache unavailable:", error);
        }

        // Try persistent cache first.
        if (cacheStorage) {
            try {
                const cached = await cacheStorage.match(url);

                if (cached) {
                    const cachedText = await cached.text();

                    // Return cached SVG immediately.
                    // Update the cache in the background.
                    refreshTemplate(url, page, cacheStorage);

                    return cachedText;
                }
            } catch (error) {
                console.warn("Could not read SVG cache:", error);
            }
        }

        // No cached version: download it now.
        return await downloadTemplate(url, page, cacheStorage);

    })();

    cache.set(url, promise);

    promise.catch(() => {
        cache.delete(url);
    });

    return promise;
}


// --------------------------------------------------
// BACKGROUND TEMPLATE UPDATE
// --------------------------------------------------

function refreshTemplate(url, page, cacheStorage) {

    // Don't start duplicate background requests.
    if (refreshing.has(url)) {
        return refreshing.get(url);
    }

    const promise = downloadTemplate(url, page, cacheStorage)
        .then(freshText => {

            // Update the in-memory copy too.
            cache.set(url, Promise.resolve(freshText));

            return freshText;

        })
        .catch(error => {
            console.warn(`Background update failed: ${page.file}`, error);
        })
        .finally(() => {
            refreshing.delete(url);
        });

    refreshing.set(url, promise);

    return promise;
}


// --------------------------------------------------
// DOWNLOAD TEMPLATE
// --------------------------------------------------

async function downloadTemplate(url, page, cacheStorage) {

    const response = await fetch(url, {
        cache: "no-cache"
    });

    if (!response.ok) {
        throw new Error(`Could not load template page: ${page.file}`);
    }

    const freshText = await response.text();

    // Save the latest version for the next visit.
    if (cacheStorage) {
        try {
            await cacheStorage.put(
                url,
                new Response(freshText, {
                    headers: {
                        "Content-Type": response.headers.get("Content-Type") || "image/svg+xml"
                    }
                })
            );
        } catch (error) {
            console.warn("Could not update SVG cache:", error);
        }
    }

    return freshText;
}




export async function preloadInvitation(invitation) {

    // Load all pages concurrently instead of one at a time.
    const pages = await Promise.all(
        invitation.pages.map(async (page, index) => {

            const element = await loadPage(page);

            element.dataset.pageIndex = index;
            element.dataset.pageLabel = page.label;

            return {
                page,
                element
            };
        })
    );

    // Discover editable fields while the templates are loaded.
    const fields = discoverFields(pages);

    return {
        pages,
        fields
    };
}
// --------------------------------------------------
// PRELOAD INVITATION TEMPLATES
// --------------------------------------------------

export async function preloadInvitationTemplates(invitations) {

    const pages = invitations.flatMap(invitation =>
        invitation.pages.map(page => ({
            page,
            url: new URL("../../" + page.file, import.meta.url).href
        }))
    );

    // Deduplicate URLs in case templates share pages.
    const uniquePages = [
        ...new Map(pages.map(item => [item.url, item])).values()
    ];

    await Promise.all(
        uniquePages.map(({ page, url }) =>
            getTemplateSource(url, page).catch(error => {
                console.warn(`Could not preload ${page.file}:`, error);
            })
        )
    );

    console.log(`Preloaded ${uniquePages.length} invitation pages.`);
}