\# Invitation Studio — Static Storefront Starter



A static HTML/CSS/vanilla-JavaScript invitation catalog and editor, with a private Google Apps Script order receiver.



\- No Node server or build step.

\- No online payment processing.

\- Invitation designs are built from individual HTML and SVG pages.

\- Invitation information, available options, and pricing are managed through Google Sheets.



\---



\## Important Status and Security Notes



The project ships in sample mode so it can be previewed without credentials. Set `sampleMode: false` only after publishing the two public catalog tabs as CSV.



The private order endpoint is a starter implementation. Configure and test it before accepting real orders.



`FieldRegistry` is intentionally a protected owner-maintained backend allowlist, not a customer wording schema. The actual editable controls and labels are discovered from `data-field` in the page files. The registry duplicates only field IDs for server-side validation, which is necessary because the backend must not trust arbitrary field names from a browser.



For a production order backend, the server should retrieve template files from a trusted private source and parse/validate each `data-field` ID itself. The included registry approach is simpler and explicit but requires adding the field IDs to the protected tab when a template changes.



Do not place patient, health, or other sensitive data in this storefront. Do not put the private Orders sheet online or publish its CSV.



Google Apps Script web apps have browser/CORS limitations. The included client sends `text/plain` to avoid a preflight request. Test from the deployed static-site origin. If the browser blocks reading the response, use a same-origin proxy or an approved hosting function; do not expose a backend secret in frontend JavaScript.



This package has not been deployed against your Google account. The backend is not live-tested, and the sample catalog is local demo data.



\---



\## Run Locally



A static server is required because ES modules and `fetch()` do not work reliably from `file://`. Any simple static hosting works (GitHub Pages, for example). No build step is required.



Open `index.html` through your static host. Sample data is enabled by default.



\---



\## Google Sheets Setup



Create a public catalog spreadsheet with these tabs:



\### Invitations



Use these exact headers:



`id,title,description,active,occasion,style,pages,formats,papers,fonts,colors,designOptions,basePrice,formatAdjustments,paperAdjustments,customizationFees,quantityMinimum`



\- `id`: Unique design ID. Use lowercase letters and hyphens.

\- `title`: Customer-facing design name.

\- `description`: Short description shown on the design page.

\- `active`: TRUE/FALSE.

\- `occasion`: Semicolon-separated values, e.g. `Wedding;Kiddush`.

\- `style`: Semicolon-separated values, e.g. `Traditional;Elegant`.

\- `pages`: JSON array describing the design's pages, in order.

\- `formats`, `papers`, `fonts`, `colors`, `designOptions`: JSON arrays of available choices.

\- `basePrice`: Starting price per invitation.

\- `formatAdjustments`, `paperAdjustments`, `customizationFees`: JSON objects containing price adjustments.

\- `quantityMinimum`: Minimum order quantity.



Quote the entire CSV cell if it contains commas.



Page file paths are relative to the project root.



Example `pages`:



```json

\[

&#x20; {"label":"Front","file":"templates/my-design/front.svg","type":"svg"},

&#x20; {"label":"Inside Left","file":"templates/my-design/inside-left.svg","type":"svg"},

&#x20; {"label":"Inside Right","file":"templates/my-design/inside-right.html","type":"html"},

&#x20; {"label":"Back","file":"templates/my-design/back.svg","type":"svg"}

]

```



\### Options



Headers:



`optionType,optionValue`



Use rows such as:



```text

occasion,Wedding

occasion,Kiddush

style,Traditional

style,Modern

format,Flat 5x7

format,Folded 5x7

paper,Cotton

font,Cormorant

color,Navy

```



The homepage currently derives displayed browse links from active invitations. The Options tab is loaded for shared option data and can be used to drive future global option management.



\### Publish CSV Tabs



In Google Sheets:



1\. Select File → Share → Publish to web.

2\. Select the `Invitations` tab and CSV format.

3\. Publish it.

4\. Repeat for the `Options` tab.

5\. Paste the resulting URLs into `assets/js/config.js`.

6\. Set `sampleMode: false`.



The catalog spreadsheet is public by design. Do not store customer contact details there.



\---



\## Private Order Backend



Create a separate private Google spreadsheet with an `Orders` tab. The script can create the header row automatically.



In the public catalog spreadsheet, add a protected `FieldRegistry` tab with columns:



`InvitationID,FieldID`



Add one row for each editable `data-field` ID used by each invitation. Protect the tab so only the owner can edit it.



Create a standalone Apps Script project and paste `backend/Code.gs`.



In Apps Script → Project Settings → Script Properties, add:



\- `ORDERS\_SPREADSHEET\_ID`: Private Orders spreadsheet ID.

\- `CATALOG\_SPREADSHEET\_ID`: Catalog spreadsheet ID.



Review authorization scopes and deploy as Web app:



\- Execute as: Me

\- Access: Anyone (or the narrowest audience your business supports)



Copy the `/exec` deployment URL into `backendUrl` in `assets/js/config.js`.



Test a successful submission and deliberately invalid invitation, option, field ID, email, and quantity. Verify rows appear only in the private Orders spreadsheet.



Keep the deployment URL public only if the endpoint is protected with validation and abuse controls appropriate to your use. Apps Script web apps do not provide robust anonymous rate limiting; consider CAPTCHA and/or a proxy if abuse is a concern.



\### Backend Limitations to Resolve Before Production



The included script validates invitation, supported selections, quantity, email, field IDs, and server-side estimate. The field registry is the backend's trusted allowlist.



Review `validateOrder\_()` carefully. The response is a JSON ContentService response; test CORS behavior in your target browser and hosting environment.



\---



\## Adding an Invitation



1\. Create a folder under `templates/<design-id>/`.

2\. Add one HTML or SVG file per page/surface.

3\. Add a row to `Invitations`, including its ordered `pages` JSON and supported option JSON.

4\. Add each `data-field` ID to the protected `FieldRegistry` for backend validation.



No catalog or editor JavaScript changes are required.



See `DESIGN-CHEAT-SHEET.md` for detailed examples and pricing instructions.



\---



\## Editable Fields



Editable fields are discovered automatically from the `data-field` attributes in your HTML and SVG templates.



\### HTML Example



```html

<h1 data-field="names" data-label="Names">Names go here</h1>



<p data-field="date" data-label="Date" data-required="true">

&#x20; Date

</p>



<p data-field="address" data-label="Address" data-multiline="true">

&#x20; Address

</p>

```



\### SVG Example



```xml

<text data-field="names"

&#x20;     data-label="Names"

&#x20;     x="300"

&#x20;     y="350"

&#x20;     text-anchor="middle"

&#x20;     font-family="serif">

&#x20; Names go here

</text>

```



\### Field Attributes



\- `data-field`: Unique field ID. Reuse the same ID across pages if one input should update multiple occurrences.

\- `data-label`: Controls the editor label. If omitted, a readable label is generated.

\- `data-required="true"`: Marks the input required in the editor UI.

\- `data-multiline="true"`: Creates a textarea.

\- `data-maxlength="120"`: Controls the editor's maximum length.



Existing element text becomes the initial default wording.



The field registry is only for backend validation; do not define wording labels or page layout there.



The renderer inserts wording as text, never as HTML. SVG attributes and positioning remain intact; the text node is replaced with safe text/tspan children.



For SVG multiline layout, each line uses a `tspan` with `dy="1.2em"`; templates should reserve enough room.



\---



\## Multi-Page Preview Behavior



Page order comes from the `pages` JSON.



Each page is loaded separately and may be HTML or SVG. HTML and SVG pages can be mixed within one invitation.



\### Catalog



The catalog uses a special thumbnail preview:



\- A single-page invitation displays its only page.

\- A multi-page invitation displays pages whose labels begin with `Inside` (for example, `Inside Left` and `Inside Right`).

\- If a multi-page invitation has no interior pages, the catalog displays its `Front` page.

\- Catalog previews are thumbnails only; they do not remove pages from the actual invitation.



\### Detail Page



The detail page displays all pages.



\### Editor



The editor shows page thumbnails, a selected larger page, previous/next controls, and a compact all-pages strip.



The same `renderInvitation()` function is used in the catalog, detail page, and editor. The `size` argument controls the catalog-specific preview behavior.



Final proof can call the same renderer with saved order data; an owner-facing proof UI is not included.



\---



\## Pricing



The browser estimate and backend estimate use the catalog's pricing values.



The current pricing structure is:



```text

Base price

\+ selected format adjustment

\+ selected paper adjustment

\+ selected design option fee

= price per invitation



Price per invitation × quantity = estimated order total

```



Example:



```json

{

&#x20; "basePrice": 2.00,

&#x20; "formatAdjustments": {

&#x20;   "Flat 5x7": 0,

&#x20;   "Folded 5x7": 0.75

&#x20; },

&#x20; "paperAdjustments": {

&#x20;   "Smooth Matte": 0,

&#x20;   "Cotton": 0.40,

&#x20;   "Linen": 0.25

&#x20; },

&#x20; "customizationFees": {

&#x20;   "Gold accent": 0.35,

&#x20;   "Foil detail": 0.60,

&#x20;   "No accent": 0

&#x20; }

}

```



For this example, a folded invitation on Cotton paper with a Gold accent costs:



```text

$2.00 base

\+ $0.75 folded format

\+ $0.40 Cotton paper

\+ $0.35 Gold accent

= $3.50 per invitation

```



At 100 invitations, the estimated total is $350.



Use zero for choices that do not add a charge.



The backend recalculates the estimate using catalog values. This is an estimate only; no payment fields or payment processor are included.



\---



\## Included Sample Designs



\- \*\*Classic Arch:\*\* One-page SVG.

\- \*\*Garden Celebration:\*\* Four pages, mixed SVG and HTML.

\- \*\*Modern Moment:\*\* Two-page HTML.

\- \*\*Heritage Fold:\*\* Four-page SVG.



These are demonstration templates, not press-ready artwork.



Physical print imposition, bleed, trim marks, embedded font packaging, PDF generation, and proof-approval portal are not included.



\---



\## Testing Checklist / Known Omissions



\- \[x] CSV parser handles quoted commas, escaped quotes, and newlines.

\- \[x] Metadata controls page count and order.

\- \[x] HTML and SVG page files are supported, including mixed formats.

\- \[x] Field discovery comes from `data-field`; repeated IDs are updated across pages.

\- \[x] Text is inserted via `textContent` / SVG text nodes, not interpreted as markup.

\- \[x] Catalog filtering combines occasion and style and stores state in URL.

\- \[x] Catalog thumbnails display interior pages for multi-page designs when available.

\- \[x] Estimate recalculates from selected options and quantity.

\- \[x] Backend has server-side validation and calculates its own estimate.

\- \[ ] Live Google Sheets URLs and Apps Script deployment configured (owner task).

\- \[ ] Backend CORS behavior tested on the actual published domain.

\- \[ ] Automated tests in a real browser / hosted environment.

\- \[ ] Owner proof-generation interface and final PDF export.

\- \[ ] Customer proof approval portal.

\- \[ ] CAPTCHA / abuse throttling.

\- \[ ] Production server-side parsing of template field definitions (registry is the current trusted allowlist).

\- \[ ] Print-ready prepress output: bleed, crop marks, imposition, color management.

\- \[ ] Real paper texture simulation; screen preview cannot accurately reproduce physical paper or printed color.



