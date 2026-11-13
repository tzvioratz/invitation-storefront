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
function doPost(e) {
  try {
    const order = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const validated = validateOrder_(order);
    const props = PropertiesService.getScriptProperties();
    const ss = SpreadsheetApp.openById(requiredProp_("ORDERS_SPREADSHEET_ID"));
    const sheet = ss.getSheetByName(ORDERS_TAB) || ss.insertSheet(ORDERS_TAB);
    if (sheet.getLastRow() === 0) sheet.appendRow(["Reference","Created","Invitation ID","Invitation","Customer","Email","Phone","Quantity","Format","Paper","Font","Color","Design","Wording JSON","Notes","Estimated Subtotal"]);
    const reference = "INV-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd") + "-" + Utilities.getUuid().slice(0,8).toUpperCase();
    sheet.appendRow([reference,new Date(),validated.invitation.id,validated.invitation.title,validated.customer.name,validated.customer.email,validated.customer.phone,validated.quantity,validated.selection.format,validated.selection.paper,validated.selection.font,validated.selection.color,validated.selection.design,JSON.stringify(validated.wording),validated.customer.notes,validated.estimate]);
    SpreadsheetApp.flush();
    const savedRow = sheet.getLastRow();
    if (sheet.getRange(savedRow,1).getValue() !== reference) throw new Error("Save verification failed.");
    return json_({success:true,reference});
  } catch(err) { return json_({success:false,error:String(err.message || err)}); }
}
function validateOrder_(o) {
  if (!o || typeof o !== "object") throw new Error("Invalid order.");
  const catalogId = requiredProp_("CATALOG_SPREADSHEET_ID");
  const catalog = SpreadsheetApp.openById(catalogId);
  const sheet = catalog.getSheetByName(INVITATIONS_TAB);
  if (!sheet || sheet.getLastRow()<2) throw new Error("Invitation catalog is unavailable.");
  const values = sheet.getDataRange().getValues(), headers = values.shift().map(String);
  const records = values.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
  const inv = records.find(r=>String(r.id)===String(o.invitationId) && /^(true|1|yes)$/i.test(String(r.active)));
  if (!inv) throw new Error("Invitation is unavailable.");
  const parse = (v, fallback) => {try{return typeof v==="string"?JSON.parse(v):v||fallback;}catch(_){throw new Error("Invalid catalog configuration.");}};
  const pages=parse(inv.pages,[]), formats=parse(inv.formats,[]), papers=parse(inv.papers,[]), fonts=parse(inv.fonts,[]), colors=parse(inv.colors,[]), designs=parse(inv.designOptions,[]);
  const s=o.selection||{};
  [["format",formats],["paper",papers],["font",fonts],["color",colors],["design",designs]].forEach(([k,allowed])=>{
    if(!allowed.length || !allowed.includes(s[k])) throw new Error("Unsupported "+k+".");
  });
  const qty=Number(o.quantity);if(!Number.isInteger(qty)||qty<Math.max(1,Number(inv.quantityMinimum)||1)||qty>1000)throw new Error("Invalid quantity.");
  const customer=o.customer||{};const name=String(customer.name||"").trim(),email=String(customer.email||"").trim();
  if(!name||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Valid customer name and email are required.");
  const wording=o.wording||{};const allowed=new Set();
  if (!Array.isArray(pages) || !pages.length) throw new Error("Invitation has no page definitions.");
  pages.forEach(p=>{
    const file=String(p.file||"");
    if(!/^templates\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(html|svg)$/i.test(file)) throw new Error("Invalid template path.");
    if(!["html","svg"].includes(String(p.type))) throw new Error("Invalid page type.");
  });
  // Trusted field IDs are declared by the owner in a protected field registry sheet.
  // The registry is required because Apps Script cannot safely parse browser-submitted template files.
  const registry=catalog.getSheetByName("FieldRegistry");
  if(!registry)throw new Error("Create a protected FieldRegistry tab with columns InvitationID, FieldID.");
  registry.getDataRange().getValues().slice(1).forEach(r=>{if(String(r[0])===String(inv.id))allowed.add(String(r[1]));});
  Object.keys(wording).forEach(k=>{if(!allowed.has(k))throw new Error("Unknown wording field: "+k);if(typeof wording[k]!=="string"||wording[k].length>2000)throw new Error("Invalid wording value.");});
  const fmt=parse(inv.formatAdjustments,{}),pap=parse(inv.paperAdjustments,{}),fee=parse(inv.customizationFees,{});
  const estimate=Math.max(0,Number(inv.basePrice||0)+Number(fmt[s.format]||0)+Number(pap[s.paper]||0)+Number(fee[s.design]||0))*qty;
  return {invitation:{id:inv.id,title:inv.title},selection:s,wording,quantity:qty,customer:{name,email,phone:String(customer.phone||"").slice(0,80),notes:String(customer.notes||"").slice(0,3000)},estimate};
}
function requiredProp_(k){const v=PropertiesService.getScriptProperties().getProperty(k);if(!v)throw new Error("Missing Script Property: "+k);return v;}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
