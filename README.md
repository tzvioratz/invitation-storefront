# Invitation Studio — Static Storefront Starter

A static HTML/CSS/vanilla-JavaScript invitation catalog and editor, with a private Google Apps Script order receiver.

- No Node server or build step.
- No online payment processing.
- Invitation designs are built from individual HTML and SVG pages.
- Invitation information, available options, and pricing are managed through Google Sheets.

---

## Important Status and Security Notes

The project ships in sample mode so it can be previewed without credentials. Set `sampleMode: false` only after publishing the two public catalog tabs as CSV.

The private order endpoint is a starter implementation. Configure and test it before accepting real orders.

**Editable fields are discovered automatically.** The HTML/SVG templates define editable fields using `data-field` attributes. There is no separate field registry or manually maintained allowlist.

The customer submits wording as JSON. The backend validates field IDs for acceptable characters and length, and validates the submitted text. It does not require field IDs to be registered in advance.

When regenerating an invitation, always use the original trusted HTML/SVG template files. Apply submitted wording only to matching `data-field` elements in those templates. Submitted field IDs that do not exist in the original template should simply be ignored.

Never allow customer-submitted HTML or SVG to replace your original template files. Insert customer wording as text, not as HTML.

Do not place patient, health, or other sensitive data in this storefront. Do not put the private Orders sheet online or publish its CSV.

Google Apps Script web apps have browser/CORS limitations. The included client sends `text/plain` to avoid a preflight request. Test from the deployed static-site origin. If the browser blocks reading the response, use a same-origin proxy or an approved hosting function; do not expose a backend secret in frontend JavaScript.

This package has not been deployed against your Google account. The backend is not live-tested, and the sample catalog is local demo data.

---

## Run Locally

A static server is required because ES modules and `fetch()` do not work reliably from `file://`. Any simple static hosting works (GitHub Pages, for example). No build step is required.

Open `index.html` through your static host. Sample data is enabled by default.

---

## Google Sheets Setup

Create a public catalog spreadsheet with these tabs:

### Invitations

Use these exact headers:

`id,title,description,active,occasion,style,pages,formats,papers,fonts,colors,designOptions,basePrice,formatAdjustments,paperAdjustments,customizationFees,quantityMinimum`

- `id`: Unique design ID. Use lowercase letters and hyphens.
- `title`: Customer-facing design name.
- `description`: Short description shown on the design page.
- `active`: TRUE/FALSE.
- `occasion`: Semicolon-separated values, e.g. `Wedding;Kiddush`.
- `style`: Semicolon-separated values, e.g. `Traditional;Elegant`.
- `pages`: JSON array describing the design's pages, in order.
- `formats`, `papers`, `fonts`, `colors`, `designOptions`: JSON arrays of available choices.
- `basePrice`: Starting price per invitation.
- `formatAdjustments`, `paperAdjustments`, `customizationFees`: JSON objects containing price adjustments.
- `quantityMinimum`: Minimum order quantity.

Quote the entire CSV cell if it contains commas.

Page file paths are relative to the project root.

Example `pages`:

```json
[
  {"label":"Front","file":"templates/my-design/front.svg","type":"svg"},
  {"label":"Inside Left","file":"templates/my-design/inside-left.svg","type":"svg"},
  {"label":"Inside Right","file":"templates/my-design/inside-right.html","type":"html"},
  {"label":"Back","file":"templates/my-design/back.svg","type":"svg"}
]
```

### Options

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

### Publish CSV Tabs

In Google Sheets:

1. Select File → Share → Publish to web.
2. Select the `Invitations` tab and CSV format.
3. Publish it.
4. Repeat for the `Options` tab.
5. Paste the resulting URLs into `assets/js/config.js`.
6. Set `sampleMode: false`.

The catalog spreadsheet is public by design. Do not store customer contact details there.

---

## Private Order Backend

Create a separate private Google spreadsheet with an `Orders` tab. The script can create the header row automatically.

Create a standalone Apps Script project and paste `backend/Code.gs`.

In Apps Script → Project Settings → Script Properties, add:

- `ORDERS_SPREADSHEET_ID`: Private Orders spreadsheet ID.
- `CATALOG_SPREADSHEET_ID`: Catalog spreadsheet ID.

Review authorization scopes and deploy as Web app:

- Execute as: Me
- Access: Anyone (or the narrowest audience your business supports)

Copy the `/exec` deployment URL into `backendUrl` in `assets/js/config.js`.

Test a successful submission and deliberately invalid invitation, option, email, quantity, and wording values. Verify rows appear only in the private Orders spreadsheet.

Keep the deployment URL public only if the endpoint is protected with validation and abuse controls appropriate to your use. Apps Script web apps do not provide robust anonymous rate limiting; consider CAPTCHA and/or a proxy if abuse is a concern.

### Backend Validation

The included script validates:

- Invitation ID and active status against the catalog.
- Selected format, paper, font, color, and design option against the invitation's available choices.
- Quantity and minimum quantity.
- Customer name and email.
- Wording field IDs for allowed characters and maximum ID length.
- Wording values as strings with a maximum length of 2,000 characters.
- Template page definitions and template file paths.
- The order estimate using catalog pricing values.

There is no `FieldRegistry` tab. New editable fields can be introduced directly in HTML/SVG templates without changing the backend.

The backend currently stores the submitted wording JSON with the order. It does not generate the final invitation itself.

The response is a JSON ContentService response; test CORS behavior in your target browser and hosting environment.

---

## Adding an Invitation

1. Create a folder under `templates/<design-id>/`.
2. Add one HTML or SVG file per page/surface.
3. Add a row to `Invitations`, including its ordered `pages` JSON and supported option JSON.
4. Add `data-field` attributes to any text elements customers should be able to edit.
5. Make sure the page paths and page types in the `pages` JSON match the actual files.

No catalog or editor JavaScript changes are required.

No field registry or separate field registration is required.

See `DESIGN-CHEAT-SHEET.md` for detailed examples and pricing instructions.

---

## Editable Fields

Editable fields are discovered automatically from the `data-field` attributes in your HTML and SVG templates.

### HTML Example

```html
<h1 data-field="names" data-label="Names">Names go here</h1>

<p data-field="date" data-label="Date" data-required="true">
  Date
</p>

<p data-field="address" data-label="Address" data-multiline="true">
  Address
</p>
```

### SVG Example

```xml
<text data-field="names"
      data-label="Names"
      x="300"
      y="350"
      text-anchor="middle"
      font-family="serif">
  Names go here
</text>
```

### Field Attributes

- `data-field`: Unique field ID. Reuse the same ID across pages if one input should update multiple occurrences.
- `data-label`: Controls the editor label. If omitted, a readable label is generated.
- `data-required="true"`: Marks the input required in the editor UI.
- `data-multiline="true"`: Creates a textarea.
- `data-maxlength="120"`: Controls the editor's maximum length.
- `data-placeholder`: Sets the editor input's placeholder.

Existing element text becomes the initial default wording.

There is no separate field registry. Simply add a new `data-field` ID to your HTML/SVG whenever you create a new editable text