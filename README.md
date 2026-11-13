# Invitation Studio — static storefront starter

A static HTML/CSS/vanilla-JavaScript invitation catalog and editor, with a private Google Apps Script order receiver. No Node server and no online payment processing.

## Important status and security notes

- The project ships in **sample mode** so it can be previewed without credentials. Set `sampleMode: false` only after publishing the two public catalog tabs as CSV.
- The private order endpoint is a starter implementation. Configure and test it before accepting real orders.
- **FieldRegistry is intentionally a protected owner-maintained backend allowlist**, not a customer wording schema. The actual editable controls and labels are discovered from `data-field` in the page files. The registry duplicates only field IDs for server-side validation, which is necessary because the backend must not trust arbitrary field names from a browser.
- For a production order backend, the server should retrieve template files from a trusted private source and parse/validate each `data-field` ID itself. The included registry approach is simpler and explicit but requires adding the field IDs to the protected tab when a template changes.
- Do not place patient, health, or other sensitive data in this storefront. Do not put the private Orders sheet online or publish its CSV.
- Google Apps Script web apps have browser/CORS limitations. The included client sends `text/plain` to avoid a preflight request. Test from the deployed static-site origin. If the browser blocks reading the response, use a same-origin proxy or an approved hosting function; do not expose a backend secret in frontend JavaScript.
- This package has not been deployed against your Google account. The backend is not live-tested, and the sample catalog is local demo data.

## Run locally

A static server is required because ES modules and `fetch()` do not work reliably from `file://`. Any simple static hosting works (GitHub Pages, for example). No build step is required.

Open `index.html` through your static host. Sample data is enabled by default.

## Google Sheets setup

Create a public catalog spreadsheet with these tabs:

### Invitations

Use these exact headers:

`id,title,description,active,occasion,style,pages,formats,papers,fonts,colors,designOptions,basePrice,formatAdjustments,paperAdjustments,customizationFees,quantityMinimum`

- `occasion` and `style`: semicolon-separated values, e.g. `Wedding;Kiddush`.
- `pages`: JSON array in page order. Each object has `label`, `file`, and `type` (`html` or `svg`).
- Option and pricing columns: valid JSON objects/arrays. Quote the entire CSV cell if it contains commas.
- `active`: TRUE/FALSE.
- `file` paths are relative to project root.

Example `pages`:
`[{"label":"Front","file":"templates/my-design/front.svg","type":"svg"},{"label":"Back","file":"templates/my-design/back.html","type":"html"}]`

### Options

Headers: `optionType,optionValue`

Use rows such as `occasion,Wedding`, `style,Traditional`, `format,Flat 5x7`, `paper,Cotton`, `font,Cormorant`, `color,Navy`. The homepage currently derives displayed browse links from active invitations; this tab is loaded for shared option data and can be used to drive future global option management.

### Publish CSV tabs

In Google Sheets: File → Share → Publish to web. Select the tab and CSV format. Publish Invitations and Options separately. Paste the resulting URLs into `assets/js/config.js`; set `sampleMode: false`.

The catalog spreadsheet is public by design. Do not store customer contact details there.

## Private order backend

1. Create a **separate private** Google spreadsheet with an `Orders` tab (the script can create the header row automatically).
2. In the public catalog spreadsheet, add a protected `FieldRegistry` tab with columns `InvitationID` and `FieldID`. Add one row for each editable `data-field` ID used by each invitation. Protect the tab so only the owner can edit it.
3. Create a standalone Apps Script project and paste `backend/Code.gs`.
4. In Apps Script → Project Settings → Script Properties, add:
   - `ORDERS_SPREADSHEET_ID`: private Orders spreadsheet ID.
   - `CATALOG_SPREADSHEET_ID`: catalog spreadsheet ID.
5. Review authorization scopes and deploy as Web app, execute as **Me**, access **Anyone** (or the narrowest audience your business supports).
6. Copy the `/exec` deployment URL into `backendUrl` in `assets/js/config.js`.
7. Test a successful submission and deliberately invalid invitation, option, field ID, email, and quantity. Verify rows appear only in the private Orders spreadsheet.
8. Keep the deployment URL public only if the endpoint is protected with validation and abuse controls appropriate to your use. Apps Script web apps do not provide robust anonymous rate limiting; consider CAPTCHA and/or a proxy if abuse is a concern.

### Backend limitations to resolve before production

The included script validates invitation, supported selections, quantity, email, field IDs, and server-side estimate. The field registry is the backend's trusted allowlist. Review `validateOrder_()` carefully. The response is a JSON ContentService response; test CORS behavior in your target browser and hosting environment.

## Adding an invitation

1. Create a folder under `templates/<design-id>/`.
2. Add one HTML or SVG file per page/surface.
3. Add a row to `Invitations`, including its ordered `pages` JSON and supported option JSON.
4. Add each `data-field` ID to the protected `FieldRegistry` for backend validation.
5. No catalog or editor JavaScript changes are required.

### Editable fields

HTML:
```html
<h1 data-field="names" data-label="Names">Names go here</h1>
<p data-field="date" data-label="Date" data-required="true">Date</p>
<p data-field="address" data-label="Address" data-multiline="true">Address</p>
```

SVG:
```xml
<text data-field="names" data-label="Names" x="300" y="350"
      text-anchor="middle" font-family="serif">Names go here</text>
```

- `data-field` is the unique field ID shared across pages if you want one input to update multiple occurrences. Existing element text becomes the initial default wording.
- `data-label` controls the editor label; if omitted, a readable label is generated.
- `data-required="true"` marks the input required in the editor UI.
- `data-multiline="true"` creates a textarea.
- `data-maxlength="120"` controls the editor's maximum length.
- The field registry is only for backend validation; do not define wording labels or page layout there.

The renderer inserts wording as text, never as HTML. SVG attributes and positioning remain intact; the text node is replaced with safe text/tspan children. For SVG multiline layout, each line uses a `tspan` with `dy="1.2em"`; templates should reserve enough room.

## Multi-page preview behavior

- Page order comes from the `pages` JSON.
- Each page is loaded separately and may be HTML or SVG.
- Editor shows page thumbnails, a selected larger page, previous/next controls, and a compact all-pages strip.
- Catalog preview uses the first page only.
- Detail page displays all pages.
- The same `renderInvitation()` function is used in catalog, detail, and editor. Final proof can call the same renderer with saved order data; an owner-facing proof UI is not included.

## Pricing

Browser estimate = base price + selected format adjustment + paper adjustment + selected design fee, multiplied by quantity. The backend recalculates using catalog values. This is an estimate only; no payment fields or payment processor are included.

## Included sample designs

- Classic Arch: one-page SVG.
- Garden Celebration: four pages, mixed SVG and HTML.
- Modern Moment: two-page HTML.
- Heritage Fold: four-page SVG.

These are demonstration templates, not press-ready artwork. Physical print imposition, bleed, trim marks, embedded font packaging, PDF generation, and proof-approval portal are not included.

## Testing checklist / known omissions

- [x] CSV parser handles quoted commas, escaped quotes, and newlines.
- [x] Metadata controls page count and order.
- [x] HTML and SVG page files are supported, including mixed formats.
- [x] Field discovery comes from `data-field`; repeated IDs are updated across pages.
- [x] Text is inserted via `textContent` / SVG text nodes, not interpreted as markup.
- [x] Catalog filtering combines occasion and style and stores state in URL.
- [x] Estimate recalculates from selected options and quantity.
- [x] Backend has server-side validation and calculates its own estimate.
- [ ] Live Google Sheets URLs and Apps Script deployment configured (owner task).
- [ ] Backend CORS behavior tested on the actual published domain.
- [ ] Automated tests in a real browser / hosted environment.
- [ ] Owner proof-generation interface and final PDF export.
- [ ] Customer proof approval portal.
- [ ] CAPTCHA / abuse throttling.
- [ ] Production server-side parsing of template field definitions (registry is the current trusted allowlist).
- [ ] Print-ready prepress output: bleed, crop marks, imposition, color management.
- [ ] Real paper texture simulation; screen preview cannot accurately reproduce physical paper or printed color.
