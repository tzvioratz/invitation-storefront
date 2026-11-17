
import { CONFIG } from "./config.js";
import { loadCSV } from "./csv-loader.js";

// Cache the catalog after its first successful load.
let addOnDataPromise = null;


// ==========================================
// GENERAL HELPERS
// ==========================================

function isActive(value) {
  return /^(true|1|yes)$/i.test(String(value).trim());
}


function numberValue(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }

  const number = Number(
    String(value).replace(/[$,]/g, "").trim()
  );

  return Number.isFinite(number) ? number : fallback;
}


function parseJSONField(value, fallback) {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.error("Invalid add-on catalog JSON:", value);
    return fallback;
  }
}


function parseInvitationIds(value) {
  const text = String(value || "*").trim();

  if (text === "*") {
    return ["*"];
  }

  return text
    .split(";")
    .map(id => id.trim())
    .filter(Boolean);
}


// ==========================================
// NORMALIZE ADD-ONS
// ==========================================

function normalizeAddOn(row) {

  const quantityPricing = parseJSONField(
    row.quantityPricing,
    []
  );

  const addOn = {
    id: String(row.id || "").trim(),

    title: String(row.title || "").trim(),

    description: String(row.description || "").trim(),

    active: isActive(row.active),

    availableInvitationIds: parseInvitationIds(
      row.availableInvitationIds
    ),

    quantityMinimum: numberValue(row.quantityMinimum, 1),

    quantityMaximum: numberValue(row.quantityMaximum, 1000),

    quantityStep: numberValue(row.quantityStep, 1),

    defaultQuantity: numberValue(row.defaultQuantity, 100),

    baseCharge: numberValue(row.baseCharge, 0),

    quantityPricing: Array.isArray(quantityPricing)
      ? quantityPricing.map(tier => ({
          min: numberValue(tier.min, 0),
          max: numberValue(tier.max, 0),
          unitPrice: numberValue(tier.unitPrice, 0)
        }))
      : [],

    sortOrder: numberValue(row.sortOrder, 0),

    designs: [],
      
    customFields: parseJSONField(row.customFields, [])
  };

  return addOn;
}


// ==========================================
// NORMALIZE ADD-ON DESIGNS
// ==========================================

function normalizeAddOnDesign(row) {

  const pages = parseJSONField(row.pages, []);

  return {
    id: String(row.id || "").trim(),

    addOnId: String(row.addOnId || "").trim(),

    title: String(row.title || "").trim(),

    active: isActive(row.active),

    pages: Array.isArray(pages) ? pages : [],

    priceAdjustmentType:
      String(row.priceAdjustmentType || "perOrder")
        .trim()
        .toLowerCase(),

    priceAdjustment: numberValue(
      row.priceAdjustment,
      0
    ),

    sortOrder: numberValue(row.sortOrder, 0)
  };
}


// ==========================================
// LOAD CATALOG
// ==========================================

export async function loadAddOnData() {

  if (addOnDataPromise) {
    return addOnDataPromise;
  }

  addOnDataPromise = (async () => {

const addonsUrl = CONFIG.sheets.addonsCsvUrl;
const designsUrl = CONFIG.sheets.addonDesignsCsvUrl;

if (!addonsUrl || !designsUrl) {
  throw new Error(
    "Add-on catalog URLs are missing from CONFIG.sheets."
  );
}

const [addOnRows, designRows] = await Promise.all([
  loadCSV(addonsUrl),
  loadCSV(designsUrl)
]);

    const addOns = addOnRows
      .map(normalizeAddOn)
      .filter(addOn => addOn.id);

    const designs = designRows
      .map(normalizeAddOnDesign)
      .filter(design => design.id && design.addOnId);

    // Attach designs to their parent products.
    const addOnMap = new Map(
      addOns.map(addOn => [addOn.id, addOn])
    );

    designs.forEach(design => {

      const parent = addOnMap.get(design.addOnId);

      if (parent && design.active) {
        parent.designs.push(design);
      }

    });

    // Sort products and their designs.
    addOns.forEach(addOn => {
      addOn.designs.sort(
        (a, b) => a.sortOrder - b.sortOrder
      );
    });

    addOns.sort(
      (a, b) => a.sortOrder - b.sortOrder
    );

    return {
      addOns,
      designs
    };

  })();

  try {
    return await addOnDataPromise;

  } catch (error) {
    // Allow another attempt if loading failed.
    addOnDataPromise = null;
    throw error;
  }
}


// ==========================================
// PUBLIC GETTERS
// ==========================================

export async function getActiveAddOns() {

  const data = await loadAddOnData();

  return data.addOns.filter(addOn =>
    addOn.active && addOn.designs.length > 0
  );
}


export async function getAddOn(id) {

  const data = await loadAddOnData();

  return data.addOns.find(addOn =>
    addOn.id === String(id)
  ) || null;
}


export async function getAddOnDesigns(addOnId) {

  const addOn = await getAddOn(addOnId);

  return addOn ? addOn.designs : [];
}


// ==========================================
// INVITATION COMPATIBILITY
// ==========================================

export function isAddOnAvailableForInvitation(
  addOn,
  invitationId
) {

  if (!addOn || !invitationId) {
    return false;
  }

  return (
    addOn.availableInvitationIds.includes("*") ||
    addOn.availableInvitationIds.includes(
      String(invitationId)
    )
  );
}
