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
  "Effective Price Per Invitation"
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
      p.effectiveUnitPrice
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
        orderTotal: p.orderTotal,
        effectiveUnitPrice: p.effectiveUnitPrice
      }
    });

  } catch (err) {
    return json_({
      success: false,
      error: String(err.message || err)
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

  // Calculate the order total
  const orderTotal = Math.max(
    0,
    baseCharge +
    quantity * adjustedUnitPrice +
    appliedIntermediatePremium
  );

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

  return {
    invitation: {
      id: inv.id,
      title: inv.title
    },

    selection: selection,
    wording: wording,
    quantity: quantity,

    customer: {
      name: name,
      email: email,
      phone: String(customer.phone || "").slice(0, 80),
      notes: String(customer.notes || "").slice(0, 3000)
    },

    pricing: {
      baseCharge: baseCharge,
      unitPrice: unitPrice,
      formatAdjustment: formatAdjustment,
      paperAdjustment: paperAdjustment,
      customizationFee: customizationFee,
      intermediatePremium: appliedIntermediatePremium,
      adjustedUnitPrice: adjustedUnitPrice,
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
function parseCatalog_(value, fallback) {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_) {
    throw new Error("Invalid catalog configuration.");
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
