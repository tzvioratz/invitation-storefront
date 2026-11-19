/**
 * Private order receiver. Deploy as Web App executing as the owner.
 * Script Properties required:
 *   ORDERS_SPREADSHEET_ID = ID of PRIVATE spreadsheet
 *   CATALOG_SPREADSHEET_ID = spreadsheet containing trusted Invitations + Options tabs
 *   CATALOG_INVITATIONS_GID is not needed; use tab name "Invitations"
 * Never publish the Orders spreadsheet.
 */
const ORDERS_TAB = "Orders";
const INVITATIONS_TAB = "Invitations";

const ORDER_HEADERS = [
  "Reference",
  "Created",
  "Invitation ID",
  "Invitation",
  "Customer",
  "Email",
  "Phone",
  "Quantity",
  "Format",
  "Paper",
  "Font",
  "Color",
  "Design",
  "Wording JSON",
  "Notes",
  "Estimated Order Total",
  "Base Charge",
  "Unit Price",
  "Format Adjustment",
  "Paper Adjustment",
  "Customization Fee",
  "Intermediate Premium",
  "Adjusted Unit Price",
  "Effective Price Per Invitation",  
  "Add-ons JSON",
  "Add-on Total",
  "customFields",
  "Add-ons JSON",
  "Add-on Total",
  "customFields",
  "Field Styles JSON"
];


const ADDONS_TAB = "AddOns";
const ADDON_DESIGNS_TAB = "AddOnDesigns";

const ADDON_HEADERS = [
  "id",
  "title",
  "description",
  "active",
  "availableInvitationIds",
  "quantityMinimum",
  "quantityMaximum",
  "quantityStep",
  "defaultQuantity",
  "baseCharge",
  "quantityPricing",
  "sortOrder",
  "customFields"
];

const ADDON_DESIGN_HEADERS = [
  "id",
  "addOnId",
  "title",
  "active",
  "pages",
  "priceAdjustmentType",
  "priceAdjustment",
  "sortOrder"
];

function doPost(e) {
  try {
    const order = JSON.parse(
      (e && e.postData && e.postData.contents) || "{}"
    );

    const validated = validateOrder_(order);

    const ss = SpreadsheetApp.openById(
      requiredProp_("ORDERS_SPREADSHEET_ID")
    );

    const sheet =
      ss.getSheetByName(ORDERS_TAB) ||
      ss.insertSheet(ORDERS_TAB);

    ensureOrderHeaders_(sheet);

    const reference =
      "INV-" +
      Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "yyyyMMdd"
      ) +
      "-" +
      Utilities.getUuid().slice(0, 8).toUpperCase();

    const p = validated.pricing;

    sheet.appendRow([
      reference,
      new Date(),
      validated.invitation.id,
      validated.invitation.title,
      validated.customer.name,
      validated.customer.email,
      validated.customer.phone,
      validated.quantity,
      validated.selection.format,
      validated.selection.paper,
      validated.selection.font,
      validated.selection.color,
      validated.selection.design,
      JSON.stringify(validated.wording),
      validated.customer.notes,

      // Pricing
      p.orderTotal,
      p.baseCharge,
      p.unitPrice,
      p.formatAdjustment,
      p.paperAdjustment,
      p.customizationFee,
      p.intermediatePremium,
      p.adjustedUnitPrice,
      p.effectiveUnitPrice,
      JSON.stringify(validated.addOns),
      p.addOnTotal,
      JSON.stringify(validated.addOns),
      p.addOnTotal,
      "",                                       // customFields (not used yet)
      JSON.stringify(validated.fieldStyles) 
    ]);

    SpreadsheetApp.flush();

    const savedRow = sheet.getLastRow();

    if (sheet.getRange(savedRow, 1).getValue() !== reference) {
      throw new Error("Save verification failed.");
    }

    return json_({
      success: true,
      reference: reference,
      pricing: {
  invitationTotal: p.invitationTotal,
  addOnTotal: p.addOnTotal,
  orderTotal: p.orderTotal,
  effectiveUnitPrice: p.effectiveUnitPrice
}
    });

  } catch (err) {
  console.error("ORDER ERROR:", err.stack || err);

  return json_({
    success: false,
    error: err.message,
    details: err.stack || String(err)
  });
}
}


function validateOrder_(o) {
  if (!o || typeof o !== "object") {
    throw new Error("Invalid order.");
  }

  // Load private catalog
  const catalog = SpreadsheetApp.openById(
    requiredProp_("CATALOG_SPREADSHEET_ID")
  );

  const sheet = catalog.getSheetByName(INVITATIONS_TAB);

  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error("Invitation catalog is unavailable.");
  }

  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(String);

  const records = values.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]]))
  );

  const inv = records.find(r =>
    String(r.id) === String(o.invitationId) &&
    /^(true|1|yes)$/i.test(String(r.active))
  );

  if (!inv) {
    throw new Error("Invitation is unavailable.");
  }

  // Parse catalog JSON fields
  const pages = parseCatalog_(inv.pages, []);
  const formats = parseCatalog_(inv.formats, []);
  const papers = parseCatalog_(inv.papers, []);
  const fonts = parseCatalog_(inv.fonts, []);
  const colors = parseCatalog_(inv.colors, []);
  const designs = parseCatalog_(inv.designOptions, []);

  const formatAdjustments = parseCatalog_(inv.formatAdjustments, {});
  const paperAdjustments = parseCatalog_(inv.paperAdjustments, {});
  const customizationFees = parseCatalog_(inv.customizationFees, {});

  const standardQuantities = parseCatalog_(
    inv.standardQuantities,
    []
  ).map(Number);

  const intermediateQuantities = parseCatalog_(
    inv.intermediateQuantities,
    []
  ).map(Number);

  const selection = o.selection || {};

  // Validate selected options
  [
    ["format", formats],
    ["paper", papers],
    ["font", fonts],
    ["color", colors],
    ["design", designs]
  ].forEach(([key, allowed]) => {
    if (!allowed.length || !allowed.includes(selection[key])) {
      throw new Error("Unsupported " + key + ".");
    }
  });

  // Validate configured quantities
  if (!standardQuantities.length) {
    throw new Error("Invitation has no standard quantities configured.");
  }

  const allQuantities = [
    ...standardQuantities,
    ...intermediateQuantities
  ];

  if (
    allQuantities.some(q => !Number.isInteger(q) || q <= 0) ||
    new Set(allQuantities).size !== allQuantities.length
  ) {
    throw new Error("Invalid quantity configuration in catalog.");
  }

  // Validate the selected quantity
  const quantity = Number(o.quantity);

  if (
    !Number.isInteger(quantity) ||
    !allQuantities.includes(quantity)
  ) {
    throw new Error("Please select one of the available quantities.");
  }

  // Get pricing values from the PRIVATE catalog
  const baseCharge = catalogNumber_(inv.baseCharge, "Base Charge");
  const unitPrice = catalogNumber_(inv.unitPrice, "Unit Price");
  const intermediatePremium = catalogNumber_(
    inv.intermediatePremium,
    "Intermediate Premium"
  );

  if (
    baseCharge < 0 ||
    unitPrice < 0 ||
    intermediatePremium < 0
  ) {
    throw new Error("Invalid pricing configuration in catalog.");
  }

  const formatAdjustment = catalogNumber_(
    formatAdjustments[selection.format] ?? 0,
    "Format Adjustment"
  );

  const paperAdjustment = catalogNumber_(
    paperAdjustments[selection.paper] ?? 0,
    "Paper Adjustment"
  );

  const customizationFee = catalogNumber_(
    customizationFees[selection.design] ?? 0,
    "Customization Fee"
  );

  const adjustedUnitPrice =
    unitPrice +
    formatAdjustment +
    paperAdjustment +
    customizationFee;

  if (adjustedUnitPrice < 0) {
    throw new Error("The selected options produce an invalid unit price.");
  }

  // Validate intermediate quantity pricing against the next
  // higher standard quantity using the selected options.
  let appliedIntermediatePremium = 0;

  if (intermediateQuantities.includes(quantity)) {
    const nextStandard = standardQuantities
      .filter(q => q > quantity)
      .sort((a, b) => a - b)[0];

    if (!nextStandard) {
      throw new Error(
        "Intermediate quantity " + quantity +
        " needs a higher standard quantity."
      );
    }

    if (
      intermediatePremium >=
      (nextStandard - quantity) * adjustedUnitPrice
    ) {
      throw new Error(
        "The price for " + quantity +
        " invitations must be less than the price for " +
        nextStandard + " invitations."
      );
    }

    appliedIntermediatePremium = intermediatePremium;
  }

// Calculate invitation total.
const invitationTotal = Math.max(
  0,
  baseCharge +
  quantity * adjustedUnitPrice +
  appliedIntermediatePremium
);

// Validate and calculate add-ons using the private catalog.
const addOnPricing = validateAddOns_(
  o.addOns,
  inv.id,
  catalog
);

const addOnTotal = addOnPricing.total;

// Combined order total.
const orderTotal = invitationTotal + addOnTotal;

const effectiveUnitPrice = orderTotal / quantity;

  // Validate customer
  const customer = o.customer || {};

  const name = String(customer.name || "").trim();
  const email = String(customer.email || "").trim();

  if (
    !name ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Valid customer name and email are required.");
  }

  // Validate wording
  const wording = o.wording || {};

  if (!Array.isArray(pages) || !pages.length) {
    throw new Error("Invitation has no page definitions.");
  }

  pages.forEach(page => {
    const file = String(page.file || "");

    if (
      !/^templates\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(html|svg)$/i.test(file)
    ) {
      throw new Error("Invalid template path.");
    }

    if (!["html", "svg"].includes(String(page.type))) {
      throw new Error("Invalid page type.");
    }
  });

  Object.keys(wording).forEach(key => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) {
      throw new Error("Invalid wording field ID.");
    }

    if (
      typeof wording[key] !== "string" ||
      wording[key].length > 2000
    ) {
      throw new Error("Invalid wording value.");
    }
  });
  const fieldStyles = validateFieldStyles_(o.fieldStyles);
  return {
    invitation: {
      id: inv.id,
      title: inv.title
    },

    selection: selection,
    wording: wording,
    fieldStyles: fieldStyles,
    quantity: quantity,

    customer: {
      name: name,
      email: email,
      phone: String(customer.phone || "").slice(0, 80),
      notes: String(customer.notes || "").slice(0, 3000)
    },

    addOns: addOnPricing.items,

    pricing: {
  baseCharge: baseCharge,
  unitPrice: unitPrice,
  formatAdjustment: formatAdjustment,
  paperAdjustment: paperAdjustment,
  customizationFee: customizationFee,
  intermediatePremium: appliedIntermediatePremium,
  adjustedUnitPrice: adjustedUnitPrice,
  invitationTotal: invitationTotal,
  addOnTotal: addOnTotal,
  orderTotal: orderTotal,
  effectiveUnitPrice: effectiveUnitPrice
}
  };
}


// Ensures the Orders sheet has the current headers.
// Existing order rows are preserved.
function ensureOrderHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(ORDER_HEADERS);
  } else {
    sheet.getRange(1, 1, 1, ORDER_HEADERS.length)
      .setValues([ORDER_HEADERS]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange("B:B")
  .setNumberFormat("MM/dd/yyyy hh:mm AM/PM");

sheet.getRange("P:X")
  .setNumberFormat("$#,##0.00");
}


// Parse a JSON catalog field.
function parseCatalog_(value, fallback, fieldName = "Unknown field") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value !== "string") {
    return value;
  }

  const text = value.trim();

  if (!text) return fallback;

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Invalid JSON in AddOns column "${fieldName}". ` +
      `Value: "${text.substring(0, 200)}". ` +
      `JSON error: ${err.message}`
    );
  }
}


// Read a numeric catalog price safely.
function catalogNumber_(value, label) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error("Invalid " + label + " in catalog.");
  }

  return number;
}

// Validates per-field color / font / size overrides from the editor.
// Shape: { fieldId: { color: "#rrggbb", fontFamily: "Heebo", fontSize: 36 } }
// Anything invalid is rejected; unknown properties are dropped.
function validateFieldStyles_(raw) {
  if (raw == null) return {};

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid field styles.");
  }

  const ids = Object.keys(raw);

  if (ids.length > 100) {
    throw new Error("Too many styled fields.");
  }

  const clean = {};

  ids.forEach(id => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
      throw new Error("Invalid styled field ID.");
    }

    const s = raw[id];

    if (!s || typeof s !== "object" || Array.isArray(s)) {
      throw new Error("Invalid style for field " + id + ".");
    }

    const out = {};

    if (s.color != null && s.color !== "") {
      if (
        typeof s.color !== "string" ||
        !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.color)
      ) {
        throw new Error("Invalid color for field " + id + ".");
      }
      out.color = s.color.toLowerCase();
    }

    if (s.fontFamily != null && s.fontFamily !== "") {
      if (
        typeof s.fontFamily !== "string" ||
        !/^[A-Za-z0-9 _-]{1,60}$/.test(s.fontFamily)
      ) {
        throw new Error("Invalid font for field " + id + ".");
      }
      out.fontFamily = s.fontFamily;
    }

    if (s.fontSize != null && s.fontSize !== "") {
      const size = Number(s.fontSize);

      if (!Number.isFinite(size) || size < 6 || size > 200) {
        throw new Error("Invalid font size for field " + id + ".");
      }
      out.fontSize = Math.round(size * 10) / 10;
    }

    if (Object.keys(out).length) clean[id] = out;
  });

  return clean;
}


/*******************************************************
 * INVITATION STUDIO - BACKEND INITIALIZATION
 *
 * Run setupInvitationStudioBackend() once.
 *
 * Matches the existing backend Code.gs exactly.
 *******************************************************/


function setupInvitationStudioBackend() {
  const props = PropertiesService.getScriptProperties();

  // Prevent accidentally creating duplicate spreadsheets.
  const existingOrders = props.getProperty("ORDERS_SPREADSHEET_ID");
  const existingCatalog = props.getProperty("CATALOG_SPREADSHEET_ID");

  if (existingOrders || existingCatalog) {
    throw new Error(
      "Backend spreadsheet properties already exist. " +
      "Check Script Properties before running setup again."
    );
  }

  // ==========================================
  // 1. CREATE CATALOG SPREADSHEET
  // ==========================================

  const catalog = SpreadsheetApp.create(
    "Invitation Studio - Catalog"
  );

  const invitationsSheet = catalog.getSheets()[0];
  invitationsSheet.setName("Invitations");

  const invitationHeaders = [
    "id",
    "title",
    "active",
    "description",
    "occasion",
    "style",
    "pages",
    "formats",
    "papers",
    "fonts",
    "colors",
    "designOptions",
    "formatAdjustments",
    "paperAdjustments",
    "customizationFees",
    "baseCharge",
    "unitPrice",
    "intermediatePremium",
    "standardQuantities",
    "intermediateQuantities"
  ];

  invitationsSheet
    .getRange(1, 1, 1, invitationHeaders.length)
    .setValues([invitationHeaders]);

  formatHeader_(invitationsSheet, invitationHeaders.length);

  invitationsSheet.setFrozenRows(1);

  invitationsSheet.setColumnWidths(1, invitationHeaders.length, 160);
  invitationsSheet.setColumnWidth(4, 300);
  invitationsSheet.setColumnWidth(7, 350);
  invitationsSheet.setColumnWidth(12, 250);
  invitationsSheet.setColumnWidth(13, 220);
  invitationsSheet.setColumnWidth(14, 220);
  invitationsSheet.setColumnWidth(15, 220);

  // Currency columns
  ["P:P", "Q:Q", "R:R"].forEach(range => {
    invitationsSheet.getRange(range).setNumberFormat("$#,##0.00");
  });

  // ==========================================
  // 2. CREATE OPTIONS TAB
  // ==========================================

  const optionsSheet = catalog.insertSheet("Options");

  const optionHeaders = [
    "type",
    "name",
    "adjustment",
    "active",
    "sortOrder"
  ];

  optionsSheet
    .getRange(1, 1, 1, optionHeaders.length)
    .setValues([optionHeaders]);

  formatHeader_(optionsSheet, optionHeaders.length);

  optionsSheet.setFrozenRows(1);
  optionsSheet.setColumnWidths(1, optionHeaders.length, 160);
  optionsSheet.getRange("C:C").setNumberFormat("$#,##0.00");

  // ==========================================
  // 3. CREATE PRIVATE ORDERS SPREADSHEET
  // ==========================================

  const orders = SpreadsheetApp.create(
    "Invitation Studio - Private Orders"
  );

  const ordersSheet = orders.getSheets()[0];
  ordersSheet.setName("Orders");

  ordersSheet
    .getRange(1, 1, 1, ORDER_HEADERS.length)
    .setValues([ORDER_HEADERS]);

  formatHeader_(ordersSheet, ORDER_HEADERS.length);

  ordersSheet.setFrozenRows(1);

  const widths = [
    220, 160, 130, 180, 180, 220, 130, 90,
    130, 130, 130, 130, 150, 350, 250, 160,
    120, 120, 140, 140, 150, 150, 150, 170
  ];

  widths.forEach((width, index) => {
    ordersSheet.setColumnWidth(index + 1, width);
  });

  ordersSheet.getRange("B:B")
    .setNumberFormat("MM/dd/yyyy hh:mm AM/PM");

  ordersSheet.getRange("P:X")
    .setNumberFormat("$#,##0.00");

  // ==========================================
  // 4. SAVE SPREADSHEET IDS
  // ==========================================

  props.setProperties({
    CATALOG_SPREADSHEET_ID: catalog.getId(),
    ORDERS_SPREADSHEET_ID: orders.getId()
  });

  // ==========================================
  // 5. LOG RESULTS
  // ==========================================

  Logger.log("INVITATION STUDIO BACKEND CREATED");

  Logger.log("CATALOG:");
  Logger.log(catalog.getUrl());

  Logger.log("PRIVATE ORDERS:");
  Logger.log(orders.getUrl());

Logger.log("Backend setup completed successfully!");

Logger.log("CATALOG SPREADSHEET:");
Logger.log(catalog.getUrl());

Logger.log("PRIVATE ORDERS SPREADSHEET:");
Logger.log(orders.getUrl());

Logger.log("Both spreadsheet IDs saved in Script Properties.");
}


// ==========================================
// SHARED HEADER FORMATTING
// ==========================================

function formatHeader_(sheet, columnCount) {
  sheet.getRange(1, 1, 1, columnCount)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#1e293b")
    .setWrap(true);

  sheet.setRowHeight(1, 40);
}


function populateInvitationCatalog() {
  const catalogId = requiredProp_("CATALOG_SPREADSHEET_ID");
  const ss = SpreadsheetApp.openById(catalogId);

  const invitationsSheet = ss.getSheetByName("Invitations");
  const optionsSheet = ss.getSheetByName("Options");

  if (!invitationsSheet || !optionsSheet) {
    throw new Error("Catalog tabs are missing. Run backend setup first.");
  }

  // Do not accidentally overwrite existing invitation records.
  if (invitationsSheet.getLastRow() > 1) {
    throw new Error(
      "The Invitations tab already contains records. " +
      "Import cancelled to protect existing data."
    );
  }

  if (optionsSheet.getLastRow() > 1) {
    throw new Error(
      "The Options tab already contains records. " +
      "Import cancelled to protect existing data."
    );
  }

  const standardQuantities = [50, 100, 150];
  const intermediateQuantities = [75, 125];

  const pricing = {
    baseCharge: 50,
    unitPrice: 1.50,
    intermediatePremium: 5
  };

  // Helper for constructing invitation records.
  function invitation(data) {
    return {
      id: data.id,
      title: data.title,
      active: true,
      description: data.description,
      occasion: data.occasion.join(";"),
      style: data.style.join(";"),
      pages: JSON.stringify(data.pages),
      formats: JSON.stringify(data.formats),
      papers: JSON.stringify(data.papers),
      fonts: JSON.stringify(data.fonts),
      colors: JSON.stringify(data.colors),
      designOptions: JSON.stringify(data.designOptions),
      formatAdjustments: JSON.stringify(data.formatAdjustments),
      paperAdjustments: JSON.stringify(data.paperAdjustments),
      customizationFees: JSON.stringify(data.customizationFees),

      baseCharge: pricing.baseCharge,
      unitPrice: pricing.unitPrice,
      intermediatePremium: pricing.intermediatePremium,
      standardQuantities: JSON.stringify(standardQuantities),
      intermediateQuantities: JSON.stringify(intermediateQuantities)
    };
  }

  // ==========================================
  // INVITATION DEFINITIONS
  // ==========================================

  const invitations = [

    invitation({
      id: "classic-arch",
      title: "The Classic Arch",
      description:
        "A timeless formal invitation with a softly arched frame and restrained botanical details.",

      occasion: ["Wedding", "Anniversary"],
      style: ["Classic", "Elegant"],

      pages: [
        {
          label: "Front",
          file: "templates/classic-arch/front.svg",
          type: "svg"
        }
      ],

      formats: ["Flat 5x7"],
      papers: ["Smooth Matte", "Cotton"],
      fonts: ["Cormorant", "Garamond"],
      colors: ["Navy", "Sage"],
      designOptions: ["Gold accent", "No accent"],

      formatAdjustments: {
        "Flat 5x7": 0
      },

      paperAdjustments: {
        "Smooth Matte": 0,
        "Cotton": 0.35
      },

      customizationFees: {}
    }),

    invitation({
      id: "garden-celebration",
      title: "Garden Celebration",
      description:
        "A romantic garden-inspired folded invitation with a coordinating interior.",

      occasion: ["Wedding", "Bris", "Kiddush"],
      style: ["Floral", "Elegant"],

      pages: [
        {
          label: "Front",
          file: "templates/garden-celebration/front.svg",
          type: "svg"
        },
        {
          label: "Inside Left",
          file: "templates/garden-celebration/inside-left.html",
          type: "html"
        },
        {
          label: "Inside Right",
          file: "templates/garden-celebration/inside-right.svg",
          type: "svg"
        },
        {
          label: "Back",
          file: "templates/garden-celebration/back.svg",
          type: "svg"
        }
      ],

      formats: ["Folded 5x7"],
      papers: ["Smooth Matte", "Linen"],
      fonts: ["Cormorant", "DM Sans"],
      colors: ["Sage", "Navy"],
      designOptions: ["Botanical border", "Simple border"],

      formatAdjustments: {
        "Folded 5x7": 0
      },

      paperAdjustments: {
        "Smooth Matte": 0,
        "Linen": 0.45
      },

      customizationFees: {}
    }),

    invitation({
      id: "modern-moment",
      title: "Modern Moment",
      description:
        "Crisp typography and generous space for a contemporary celebration.",

      occasion: ["Bar Mitzvah", "Birthday", "Kiddush"],
      style: ["Modern", "Minimalist"],

      pages: [
        {
          label: "Front",
          file: "templates/modern-moment/front.html",
          type: "html"
        },
        {
          label: "Back",
          file: "templates/modern-moment/back.html",
          type: "html"
        }
      ],

      formats: ["Flat 5x7", "Flat 4x6"],
      papers: ["Smooth Matte"],
      fonts: ["DM Sans", "Cormorant"],
      colors: ["Navy", "Terracotta"],
      designOptions: ["Rule line", "No rule line"],

      formatAdjustments: {
        "Flat 5x7": 0,
        "Flat 4x6": -0.15
      },

      paperAdjustments: {
        "Smooth Matte": 0
      },

      customizationFees: {}
    }),

    invitation({
      id: "heritage-fold",
      title: "Heritage Fold",
      description:
        "A formal four-panel folded design inspired by traditional engraved stationery.",

      occasion: ["Bar Mitzvah", "Bris", "Kiddush"],
      style: ["Traditional", "Classic"],

      pages: [
        {
          label: "Front",
          file: "templates/heritage-fold/front.svg",
          type: "svg"
        },
        {
          label: "Inside Left",
          file: "templates/heritage-fold/inside-left.svg",
          type: "svg"
        },
        {
          label: "Inside Right",
          file: "templates/heritage-fold/inside-right.svg",
          type: "svg"
        },
        {
          label: "Back",
          file: "templates/heritage-fold/back.svg",
          type: "svg"
        }
      ],

      formats: ["Folded 5x7"],
      papers: ["Cotton", "Linen"],
      fonts: ["Cormorant"],
      colors: ["Navy", "Burgundy"],
      designOptions: ["Ornament", "No ornament"],

      formatAdjustments: {
        "Folded 5x7": 0
      },

      paperAdjustments: {
        "Cotton": 0.50,
        "Linen": 0.30
      },

      customizationFees: {}
    }),

    invitation({
      id: "test-invite",
      title: "test invite",
      description: "testing testing 123",

      occasion: ["Wedding"],
      style: ["Traditional", "Classic", "Minimalist"],

      pages: [
        {
          label: "Side 1",
          file: "templates/test-invite/Side-1.svg",
          type: "svg"
        },
        {
          label: "Side 2",
          file: "templates/test-invite/Side-2.svg",
          type: "svg"
        }
      ],

      formats: ["Flat 5x7", "Flat 4x6"],
      papers: ["Smooth Matte", "Cotton", "Linen"],
      fonts: ["Cormorant", "Garamond", "DM Sans"],
      colors: ["Navy", "Sage", "Terracotta", "Burgundy"],
      designOptions: ["Gold accent", "No accent"],

      formatAdjustments: {
        "Flat 5x7": 0,
        "Flat 4x6": 0
      },

      paperAdjustments: {
        "Smooth Matte": 0,
        "Cotton": 0,
        "Linen": 0
      },

      customizationFees: {}
    })

  ];

  // ==========================================
  // WRITE INVITATIONS TAB
  // ==========================================

  const invitationHeaders = [
    "id",
    "title",
    "active",
    "description",
    "occasion",
    "style",
    "pages",
    "formats",
    "papers",
    "fonts",
    "colors",
    "designOptions",
    "formatAdjustments",
    "paperAdjustments",
    "customizationFees",
    "baseCharge",
    "unitPrice",
    "intermediatePremium",
    "standardQuantities",
    "intermediateQuantities"
  ];

  invitationsSheet.clearContents();

  invitationsSheet
    .getRange(1, 1, 1, invitationHeaders.length)
    .setValues([invitationHeaders]);

  const invitationRows = invitations.map(record =>
    invitationHeaders.map(header => record[header] ?? "")
  );

  invitationsSheet
    .getRange(2, 1, invitationRows.length, invitationHeaders.length)
    .setValues(invitationRows);

  // ==========================================
  // WRITE OPTIONS TAB
  // ==========================================

  const optionHeaders = ["optionType", "optionValue"];

  const optionGroups = {
    occasions: [
      "Wedding",
      "Bar Mitzvah",
      "Birthday",
      "Anniversary",
      "Bris",
      "Kiddush"
    ],

    styles: [
      "Modern",
      "Traditional",
      "Classic",
      "Elegant",
      "Minimalist",
      "Floral"
    ],

    formats: [
      "Flat 5x7",
      "Flat 4x6",
      "Folded 5x7"
    ],

    papers: [
      "Smooth Matte",
      "Cotton",
      "Linen"
    ],

    fonts: [
      "Cormorant",
      "Garamond",
      "DM Sans"
    ],

    colors: [
      "Navy",
      "Sage",
      "Terracotta",
      "Burgundy"
    ]
  };

  const optionRows = [];

  Object.entries(optionGroups).forEach(([type, values]) => {
    values.forEach(value => {
      optionRows.push([type, value]);
    });
  });

  optionsSheet.clearContents();

  optionsSheet
    .getRange(1, 1, 1, optionHeaders.length)
    .setValues([optionHeaders]);

  optionsSheet
    .getRange(2, 1, optionRows.length, optionHeaders.length)
    .setValues(optionRows);

  // ==========================================
  // FORMATTING
  // ==========================================

  formatHeader_(invitationsSheet, invitationHeaders.length);
  formatHeader_(optionsSheet, optionHeaders.length);

  invitationsSheet.setFrozenRows(1);
  optionsSheet.setFrozenRows(1);

  invitationsSheet.setColumnWidths(1, invitationHeaders.length, 160);
  invitationsSheet.setColumnWidth(4, 350);
  invitationsSheet.setColumnWidth(7, 450);
  invitationsSheet.setColumnWidth(12, 250);
  invitationsSheet.setColumnWidth(13, 220);
  invitationsSheet.setColumnWidth(14, 220);
  invitationsSheet.setColumnWidth(15, 220);

  invitationsSheet.getRange("P:R")
    .setNumberFormat("$#,##0.00");

  optionsSheet.setColumnWidth(1, 150);
  optionsSheet.setColumnWidth(2, 200);

  SpreadsheetApp.flush();

  Logger.log("CATALOG POPULATED SUCCESSFULLY");
  Logger.log("Catalog URL: " + ss.getUrl());
  Logger.log("Invitations imported: " + invitations.length);
  Logger.log("Options imported: " + optionRows.length);
}

function requiredProp_(key) {
  const value = PropertiesService
    .getScriptProperties()
    .getProperty(key);

  if (!value) {
    throw new Error("Missing Script Property: " + key);
  }

  return value;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * Creates the add-on catalog tabs if they don't exist.
 *
 * Safe to run multiple times.
 * Does not overwrite existing catalog records.
 */
function setupAddOnCatalogTabs() {

  const catalogId = requiredProp_("CATALOG_SPREADSHEET_ID");

  const ss = SpreadsheetApp.openById(catalogId);

  // ==========================================
  // ADDONS TAB
  // ==========================================

  let addonsSheet = ss.getSheetByName(ADDONS_TAB);

  if (!addonsSheet) {
    addonsSheet = ss.insertSheet(ADDONS_TAB);
  }

  initializeCatalogTab_(
    addonsSheet,
    ADDON_HEADERS
  );

  addonsSheet.setColumnWidths(
    1,
    ADDON_HEADERS.length,
    160
  );

  addonsSheet.setColumnWidth(3, 300);
  addonsSheet.setColumnWidth(11, 450);

  addonsSheet.getRange("J:J")
    .setNumberFormat("$#,##0.00");

  addonsSheet.getRange("K:K")
    .setWrap(true);


  // ==========================================
  // ADDON DESIGNS TAB
  // ==========================================

  let designsSheet = ss.getSheetByName(ADDON_DESIGNS_TAB);

  if (!designsSheet) {
    designsSheet = ss.insertSheet(ADDON_DESIGNS_TAB);
  }

  initializeCatalogTab_(
    designsSheet,
    ADDON_DESIGN_HEADERS
  );

  designsSheet.setColumnWidths(
    1,
    ADDON_DESIGN_HEADERS.length,
    160
  );

  designsSheet.setColumnWidth(5, 450);

  designsSheet.getRange("E:E")
    .setWrap(true);

  designsSheet.getRange("G:G")
    .setNumberFormat("$#,##0.00");


  SpreadsheetApp.flush();

  Logger.log("Add-on catalog tabs initialized.");
  Logger.log("Catalog: " + ss.getUrl());

}


/**
 * Initialize a catalog tab without overwriting existing records.
 */
function initializeCatalogTab_(sheet, headers) {

  if (sheet.getLastRow() === 0) {

    sheet.getRange(
      1,
      1,
      1,
      headers.length
    ).setValues([headers]);

    formatHeader_(sheet, headers.length);

    sheet.setFrozenRows(1);

    return;
  }

  // Verify existing headers rather than silently replacing them.
  const existing = sheet.getRange(
    1,
    1,
    1,
    headers.length
  ).getValues()[0].map(String);

  const matches = headers.every(
    (header, index) => existing[index] === header
  );

  if (!matches) {
    throw new Error(
      "Unexpected headers in tab '" +
      sheet.getName() +
      "'. Existing data was not changed."
    );
  }

  sheet.setFrozenRows(1);

}


function getCatalogRecords_(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);

  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(h => String(h).trim());

  return values
    .filter(row => row.some(value => value !== ""))
    .map(row =>
      Object.fromEntries(
        headers.map((header, i) => [header, row[i]])
      )
    );
}


function isActive_(value) {
  return /^(true|1|yes)$/i.test(String(value));
}


function validateAddOns_(submittedAddOns, invitationId, catalog) {
  if (submittedAddOns == null) submittedAddOns = [];

  if (!Array.isArray(submittedAddOns)) {
    throw new Error("Invalid add-on selection.");
  }

  if (submittedAddOns.length > 20) {
    throw new Error("Too many add-ons selected.");
  }

  const addonRecords = getCatalogRecords_(catalog, ADDONS_TAB);
  const designRecords = getCatalogRecords_(catalog, ADDON_DESIGNS_TAB);

  const validatedAddOns = [];
  const seenIds = new Set();

  let total = 0;

  for (const submitted of submittedAddOns) {
    const addOnId = String(submitted.addOnId || "").trim();

    if (!addOnId || seenIds.has(addOnId)) {
      throw new Error("Invalid or duplicate add-on.");
    }

    seenIds.add(addOnId);

    const addOn = addonRecords.find(a =>
      String(a.id) === addOnId && isActive_(a.active)
    );

    if (!addOn) {
      throw new Error("An unavailable add-on was selected.");
    }

    // Check whether this add-on is available for the invitation.
const rawAvailableIds = String(
  addOn.availableInvitationIds || ""
).trim();

const availableIds = !rawAvailableIds || rawAvailableIds === "*"
  ? []
  : rawAvailableIds.split(";").map(s => s.trim()).filter(Boolean);

    if (
      Array.isArray(availableIds) &&
      availableIds.length &&
      !availableIds.map(String).includes(String(invitationId))
    ) {
      throw new Error(
        addOn.title + " is not available for this invitation."
      );
    }

    // Validate add-on quantity.
    const quantity = Number(submitted.quantity);

    const min = Number(addOn.quantityMinimum || 1);
    const max = addOn.quantityMaximum === "" ||
                addOn.quantityMaximum == null
      ? Infinity
      : Number(addOn.quantityMaximum);

    const step = Number(addOn.quantityStep || 1);

    if (
      !Number.isInteger(quantity) ||
      !Number.isInteger(min) ||
      !Number.isInteger(step) ||
      step <= 0 ||
      quantity < min ||
      quantity > max ||
      (quantity - min) % step !== 0
    ) {
      throw new Error(
        "Invalid quantity for " + addOn.title + "."
      );
    }

    // Find an active design belonging to this add-on.
    const designId = String(submitted.designId || "").trim();

    const design = designRecords.find(d =>
      String(d.id) === designId &&
      String(d.addOnId) === addOnId &&
      isActive_(d.active)
    );

    if (!design) {
      throw new Error(
        "An unavailable design was selected for " + addOn.title + "."
      );
    }

    // Validate quantity pricing tiers.
const tiers = parseCatalog_(
  addOn.quantityPricing,
  [],
  "quantityPricing"
);
    if (!Array.isArray(tiers) || !tiers.length) {
      throw new Error(
        "Pricing is not configured for " + addOn.title + "."
      );
    }

    const tier = tiers.find(t => {
      const tierMin = Number(t.min);
      const tierMax = t.max === "" || t.max == null
        ? Infinity
        : Number(t.max);

      return quantity >= tierMin && quantity <= tierMax;
    });

    if (!tier) {
      throw new Error(
        "No pricing tier covers the selected quantity for " +
        addOn.title + "."
      );
    }

    const baseCharge = catalogNumber_(
      addOn.baseCharge,
      "Add-on Base Charge"
    );

    const unitPrice = catalogNumber_(
      tier.unitPrice,
      "Add-on Unit Price"
    );

    const adjustment = catalogNumber_(
      design.priceAdjustment || 0,
      "Add-on Design Adjustment"
    );

    if (baseCharge < 0 || unitPrice < 0) {
      throw new Error("Invalid add-on pricing configuration.");
    }

    let designTotal = 0;

    if (design.priceAdjustmentType === "perOrder") {
      designTotal = adjustment;
    } else if (design.priceAdjustmentType === "perUnit") {
      designTotal = adjustment * quantity;
    } else {
      throw new Error(
        "Invalid design pricing configuration for " +
        addOn.title + "."
      );
    }

    const addOnTotal = baseCharge +
      (unitPrice * quantity) +
      designTotal;

    if (!Number.isFinite(addOnTotal) || addOnTotal < 0) {
      throw new Error("Invalid calculated add-on price.");
    }

    // Validate custom information against catalog definitions.
    const customFields = parseCatalog_(
      addOn.customFields,
      [],
      "customFields"
    );

    const customInfo = submitted.customInfo || {};

    if (
      typeof customInfo !== "object" ||
      Array.isArray(customInfo)
    ) {
      throw new Error("Invalid custom information.");
    }

    const validatedCustomInfo = {};

    if (!Array.isArray(customFields)) {
      throw new Error("Invalid custom field configuration.");
    }

    customFields.forEach(field => {
      const fieldId = String(field.id || "");
      const value = String(customInfo[fieldId] || "").trim();

      if (!/^[A-Za-z0-9_-]{1,80}$/.test(fieldId)) {
        throw new Error("Invalid custom field configuration.");
      }

      if (field.required && !value) {
        throw new Error(
          "Please provide " + field.label + " for " + addOn.title + "."
        );
      }

      if (value.length > 2000) {
        throw new Error("Custom information is too long.");
      }

      validatedCustomInfo[fieldId] = value;
    });

    // Validate add-on wording structure and values.
    const wording = submitted.wording || {};

    if (
      typeof wording !== "object" ||
      Array.isArray(wording)
    ) {
      throw new Error("Invalid add-on wording.");
    }

    const validatedWording = {};

    Object.entries(wording).forEach(([key, value]) => {
      if (
        !/^[A-Za-z0-9_-]{1,80}$/.test(key) ||
        typeof value !== "string" ||
        value.length > 2000
      ) {
        throw new Error("Invalid add-on wording.");
      }

      validatedWording[key] = value;
    });

    validatedAddOns.push({
      addOnId: addOnId,
      title: String(addOn.title),
      designId: designId,
      designTitle: String(design.title),
      quantity: quantity,
      wording: validatedWording,
      customInfo: validatedCustomInfo,
      baseCharge: baseCharge,
      unitPrice: unitPrice,
      quantityTotal: unitPrice * quantity,
      designAdjustmentType: String(design.priceAdjustmentType),
      designAdjustment: adjustment,
      designTotal: designTotal,
      total: addOnTotal
    });

    total += addOnTotal;
  }

  return {
    items: validatedAddOns,
    total: total
  };
}

