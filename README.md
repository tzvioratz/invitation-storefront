# The Invitation Studio

A static invitation storefront built with HTML, CSS, and vanilla JavaScript. Customers can browse invitation designs, customize their wording and options, select add-ons, review an estimated price, and submit an order request.

The site does not process online payments. Orders are submitted for review, and payment is arranged separately.

## 1. Project Overview

The project uses:

- HTML for the storefront pages.
- CSS for layout and styling.
- Vanilla JavaScript with ES modules for application logic.
- SVG and HTML files for invitation and add-on templates.
- Google Sheets as the catalog data source.
- Google Apps Script as the private order receiver.
- A private Google spreadsheet to store submitted orders.

There is no React, Vue, Node.js server, build process, or database server required.

The storefront can be hosted as a static website, such as GitHub Pages.

## 2. How the Application Works

### Browsing invitations

Customers can browse invitations by occasion and style, open an invitation's detail page, and view its available pages.

The catalog is loaded from published Google Sheets CSV feeds.

### Customizing an invitation

The customization page loads the selected invitation and allows the customer to choose from its configured:

- Format
- Paper
- Font
- Color
- Design options
- Quantity

The editor loads the invitation's HTML or SVG templates and discovers editable fields automatically.

### Editable template fields

Templates define editable text using `data-field` attributes.

For example:

```html
<text data-field="eventTitle">Your Event</text>
```

The editor discovers these fields and creates the corresponding input controls.

Field attributes can provide additional information, such as labels, default values, required status, placeholders, maximum length, and multiline input behavior.

The same field-discovery system is used for invitation and add-on templates.

### Multiple-page invitations

An invitation can contain multiple pages. Each page is defined separately in the catalog and points to its own HTML or SVG template.

For example:

```json
[
  {
    "label": "Front",
    "file": "templates/example/front.svg",
    "type": "svg"
  },
  {
    "label": "Back",
    "file": "templates/example/back.svg",
    "type": "svg"
  }
]
```

The editor loads and previews each page separately.

### Add-ons

Add-ons are optional products that customers can include with an invitation order.

Each add-on can have:

- Its own description.
- Invitation compatibility restrictions.
- Quantity limits and increments.
- A default quantity.
- A base charge.
- Quantity-based unit pricing.
- Multiple design choices.
- Design-specific price adjustments.
- Custom information fields.
- Separate editable wording fields in its templates.

An add-on can be available for every invitation or restricted to specific invitation IDs.

The storefront loads add-ons and their designs from two separate CSV feeds. Active designs are attached to their parent add-ons.

The backend independently validates selected add-ons and calculates their prices using the private catalog.

### Order submission

When the customer submits an order:

1. The storefront collects the invitation selection and wording.
2. It collects selected add-ons, their designs, quantities, wording, and custom information.
3. It sends the order to the Apps Script backend.
4. The backend checks the submitted information against the private catalog.
5. The backend calculates the invitation and add-on prices.
6. The backend saves the validated order in the private Orders spreadsheet.
7. The backend returns an order reference and pricing information.

The backend does not trust the price calculated by the browser. It calculates the order price using the private catalog.

## 3. Project Structure

The project is organized into pages, assets, templates, and backend code.

A representative structure is:

```text
/
├── index.html
├── catalog/
│   └── index.html
├── invitation/
│   └── index.html
├── customize/
│   └── index.html
├── assets/
│   ├── css/
│   │   ├── site.css
│   │   ├── catalog.css
│   │   └── editor.css
│   └── js/
│       ├── config.js
│       ├── csv-loader.js
│       ├── data.js
│       ├── addons.js
│       ├── editor.js
│       ├── pricing.js
│       ├── field-discovery.js
│       └── template-renderer.js
├── templates/
│   ├── example-invitation/
│   │   ├── front.svg
│   │   └── back.svg
│   └── example-addon/
│       └── front.svg
└── backend/
    └── Code.gs
```

The filenames above illustrate the intended organization. Keep the actual import paths and filenames consistent with the files in the project.

## 4. Google Sheets Catalog

The catalog spreadsheet is private to the site administrator and Apps Script backend.

It contains four tabs:

| Tab | Purpose |
|---|---|
| `Invitations` | Invitation definitions, options, templates, and pricing |
| `Options` | Shared catalog options used by the storefront |
| `AddOns` | Add-on products, compatibility, pricing, and custom fields |
| `AddOnDesigns` | Individual designs belonging to add-ons |

The storefront reads published CSV versions of these tabs. The backend reads the private spreadsheet directly.

**Never publish the Orders spreadsheet.**

### Invitations tab

The invitation catalog uses these columns:

| Column | Description |
|---|---|
| `id` | Unique invitation identifier |
| `title` | Display name |
| `active` | Whether the invitation is available |
| `description` | Invitation description |
| `occasion` | Supported occasions |
| `style` | Design styles |
| `pages` | JSON array describing template pages |
| `formats` | JSON array of available formats |
| `papers` | JSON array of available papers |
| `fonts` | JSON array of available fonts |
| `colors` | JSON array of available colors |
| `designOptions` | JSON array of available design choices |
| `formatAdjustments` | JSON object mapping formats to price adjustments |
| `paperAdjustments` | JSON object mapping papers to price adjustments |
| `customizationFees` | JSON object mapping designs to customization fees |
| `baseCharge` | Fixed invitation order charge |
| `unitPrice` | Base price per invitation |
| `intermediatePremium` | Additional charge for intermediate quantities |
| `standardQuantities` | JSON array of standard quantities |
| `intermediateQuantities` | JSON array of intermediate quantities |

Example pricing configuration:

```text
baseCharge: 50
unitPrice: 1.50
intermediatePremium: 5
standardQuantities: [50, 100, 150]
intermediateQuantities: [75, 125]
```

These are example values, not required prices.

The invitation price is calculated as:

```text
Base Charge
+ (Quantity × Adjusted Unit Price)
+ Applicable Intermediate Premium
```

The adjusted unit price includes the selected format, paper, and customization adjustments.

### Options tab

The published options feed uses two columns:

| Column | Description |
|---|---|
| `optionType` | Option category |
| `optionValue` | Available option |

Example:

```text
optionType,optionValue
occasions,Wedding
occasions,Bar Mitzvah
styles,Classic
formats,Flat 5x7
papers,Cotton
fonts,Cormorant
colors,Navy
```

The option categories currently include:

- `occasions`
- `styles`
- `formats`
- `papers`
- `fonts`
- `colors`

### AddOns tab

The add-on catalog uses these columns:

| Column | Description |
|---|---|
| `id` | Unique add-on identifier |
| `title` | Add-on display name |
| `description` | Description |
| `active` | Whether the add-on is available |
| `availableInvitationIds` | `*` or semicolon-separated invitation IDs |
| `quantityMinimum` | Minimum allowed quantity |
| `quantityMaximum` | Maximum allowed quantity |
| `quantityStep` | Required quantity increment |
| `defaultQuantity` | Initial quantity |
| `baseCharge` | Fixed add-on charge |
| `quantityPricing` | JSON array of quantity-based pricing tiers |
| `sortOrder` | Display order |
| `customFields` | JSON array defining additional customer inputs |

Example compatibility values:

```text
*
```

Makes the add-on available for every invitation.

```text
classic-arch;garden-celebration
```

Makes it available only for those invitation IDs.

Example quantity pricing:

```json
[
  {
    "min": 1,
    "max": 100,
    "unitPrice": 0.75
  },
  {
    "min": 101,
    "max": 250,
    "unitPrice": 0.60
  },
  {
    "min": 251,
    "max": null,
    "unitPrice": 0.50
  }
]
```

Each tier defines a minimum quantity, maximum quantity, and unit price. A `null` maximum represents no upper limit.

Example custom fields:

```json
[
  {
    "id": "returnAddress",
    "label": "Return Address",
    "required": true,
    "placeholder": "Enter the return address"
  },
  {
    "id": "specialInstructions",
    "label": "Special Instructions",
    "required": false,
    "placeholder": "Optional instructions"
  }
]
```

Custom field IDs must be unique within the add-on and use letters, numbers, underscores, or hyphens.

### AddOnDesigns tab

The add-on design catalog uses these columns:

| Column | Description |
|---|---|
| `id` | Unique design identifier |
| `addOnId` | ID of the parent add-on |
| `title` | Design name |
| `active` | Whether the design is available |
| `pages` | JSON array describing the design's template pages |
| `priceAdjustmentType` | `perOrder` or `perUnit` |
| `priceAdjustment` | Additional price |
| `sortOrder` | Display order |

Each design must reference an existing add-on through `addOnId`.

Design adjustments work as follows:

- `perOrder`: Adds the adjustment once to the add-on order.
- `perUnit`: Multiplies the adjustment by the add-on quantity.

The add-on total is calculated as:

```text
Base Charge
+ (Quantity × Tier Unit Price)
+ Design Adjustment
```

## 5. Google Apps Script Backend

The backend is located in `backend/Code.gs`.

It receives order submissions through a deployed Apps Script Web App.

### Spreadsheet setup

The backend uses two spreadsheets:

1. **Catalog spreadsheet:** Contains the four catalog tabs.
2. **Private Orders spreadsheet:** Stores customer orders.

The backend uses Script Properties:

| Property | Purpose |
|---|---|
| `CATALOG_SPREADSHEET_ID` | ID of the catalog spreadsheet |
| `ORDERS_SPREADSHEET_ID` | ID of the private Orders spreadsheet |

### Initial setup

Run these functions from the Apps Script editor:

1. `setupInvitationStudioBackend()`
   - Creates the catalog spreadsheet.
   - Creates the private Orders spreadsheet.
   - Creates the initial `Invitations` and `Options` tabs.
   - Saves both spreadsheet IDs in Script Properties.

2. `populateInvitationCatalog()`
   - Imports the sample invitation records and options.
   - Refuses to run if those tabs already contain records.

3. `setupAddOnCatalogTabs()`
   - Creates the `AddOns` and `AddOnDesigns` tabs.
   - Checks existing headers rather than overwriting existing catalog data.

After setup, enter your actual invitation and add-on catalog records.

**Important:** `setupInvitationStudioBackend()` is intended for initial setup. It deliberately stops if the spreadsheet ID properties already exist. Do not run it again as a routine update.

### Deploying the backend

Deploy the Apps Script project as a Web App:

- Execute as: the script owner.
- Access: configure the access required for your public storefront to submit orders.
- Use the deployed Web App URL in the frontend configuration.

The Orders spreadsheet should remain private. The storefront should never receive its spreadsheet ID or direct access to its contents.

## 6. Frontend Configuration

The frontend configuration is in `config.js`.

It contains the published CSV URLs, Apps Script endpoint, currency, and sample mode setting.

Example structure:

```js
export const CONFIG = {
  sheets: {
    invitations: "PUBLISHED_INVITATIONS_CSV_URL",
    options: "PUBLISHED_OPTIONS_CSV_URL",
    addonsCsvUrl: "PUBLISHED_ADDONS_CSV_URL",
    addonDesignsCsvUrl: "PUBLISHED_ADDON_DESIGNS_CSV_URL"
  },

  backendUrl: "YOUR_APPS_SCRIPT_WEB_APP_URL",

  currency: "USD",

  sampleMode: false
};
```

Replace the placeholder URLs with the corresponding published CSV URLs.

The four feeds are:

1. Invitations
2. Options
3. AddOns
4. AddOnDesigns

Publish each catalog tab as CSV and make sure the frontend can read it.

Set `sampleMode` to `false` when using the live catalog.

## 7. Adding an Invitation

To add an invitation:

1. Create a folder under `templates/` using the invitation ID.
2. Add one HTML or SVG file for each page.
3. Add editable text elements using `data-field` attributes.
4. Add a row to the `Invitations` tab.
5. Configure its available formats, papers, fonts, colors, and design options.
6. Configure its page definitions and pricing.
7. Make sure the invitation is marked active.
8. Republish the Invitations CSV feed.

The `id` must be unique and should match the template folder name.

Example:

```text
templates/
└── my-new-invitation/
    ├── front.svg
    └── back.svg
```

The page definitions in the catalog must point to the correct files.

## 8. Adding an Add-on

To add an add-on:

1. Create a folder under `templates/` for the add-on's templates.
2. Add its HTML or SVG page files.
3. Add a row to `AddOns`.
4. Configure its availability, quantity rules, base charge, and quantity pricing.
5. Add one or more rows to `AddOnDesigns`.
6. Make sure each design's `addOnId` matches the parent add-on's ID.
7. Configure the design's pages and price adjustment.
8. Add any required custom fields to the add-on's `customFields` JSON.
9. Mark the add-on and its designs active.
10. Republish both the AddOns and AddOnDesigns CSV feeds.

An add-on must have at least one active design to appear in the storefront.

The backend independently checks the add-on and design records before accepting the order.

## 9. Order Data

The backend saves each accepted order in the private `Orders` spreadsheet.

The order record includes:

- Unique order reference.
- Submission date and time.
- Invitation ID and title.
- Customer name, email, and phone.
- Invitation quantity.
- Selected invitation options.
- Invitation wording JSON.
- Customer notes.
- Invitation pricing breakdown.
- Add-ons JSON.
- Combined add-on total.

The add-ons JSON contains the validated add-on selections, including:

- Add-on ID and title.
- Design ID and title.
- Quantity.
- Wording.
- Custom information.
- Base charge.
- Unit price.
- Quantity total.
- Design adjustment type and amount.
- Design total.
- Add-on total.

The backend returns the order reference and pricing totals to the storefront after saving.

The order is a request for fulfillment, not a payment transaction.

## 10. Pricing and Validation

The browser displays an estimate to the customer, but the backend recalculates the order using the private catalog.

The backend validates:

- The invitation exists and is active.
- Selected invitation options are allowed.
- The selected quantity is configured.
- Invitation pricing is valid.
- Intermediate quantity pricing is valid relative to the next higher standard quantity.
- Each selected add-on exists and is active.
- Each add-on is available for the selected invitation.
- Add-on quantities satisfy the configured limits and increments.
- The selected add-on design belongs to the selected add-on and is active.
- An applicable quantity pricing tier exists.
- Add-on design pricing is configured correctly.
- Required custom information is provided.
- Wording and custom information values meet length and format restrictions.
- Customer name and email are valid.

If validation fails, the backend returns an unsuccessful response and does not save the order.

## 11. Important Operational Notes

- Keep the Orders spreadsheet private.
- Only publish the catalog tabs needed by the storefront.
- Do not put private spreadsheet IDs or credentials in frontend code.
- The Apps Script endpoint is accessible according to its deployment access setting. Server-side validation does not replace abuse protection.
- The backend currently does not implement CAPTCHA or request rate limiting. Consider adding protections before relying on the public endpoint at scale.
- Keep the frontend catalog and private backend catalog synchronized. The browser uses published CSV feeds, while the backend uses the private spreadsheet.
- After changing catalog data, republish the affected CSV feeds.
- Test a complete order submission after changing pricing, templates, or catalog structures.
- The backend stores wording and selections; it does not generate a final print-ready proof or process payments.

## 12. Testing Checklist

Before making the storefront available to customers, test:

- [ ] Invitation catalog loads correctly.
- [ ] Invitation detail pages display the correct information.
- [ ] All invitation pages preview correctly.
- [ ] Editable fields are discovered and update the preview.
- [ ] Invitation options and quantity choices are correct.
- [ ] Invitation price estimates are correct.
- [ ] Add-ons load from the published feeds.
- [ ] Add-on availability restrictions work.
- [ ] Add-on designs preview correctly.
- [ ] Add-on wording and custom fields work.
- [ ] Add-on quantity tiers calculate correctly.
- [ ] Design adjustments calculate correctly.
- [ ] Combined invitation and add-on totals are correct.
- [ ] A complete order reaches the Apps Script backend.
- [ ] The backend rejects invalid or unavailable selections.
- [ ] The order is saved in the private Orders spreadsheet.
- [ ] The customer receives a successful submission response and order reference.