# Invitation Template Manager

A small local Python/Streamlit utility for preparing invitations and add-ons for the Invitation Studio storefront. It produces the rows for the `Invitations`, `AddOns`, and `AddOnDesigns` Google Sheets and copies the template files into the storefront project.

Use the **✉️ Invitation** and **➕ Add-on** tabs at the top of the page to switch between the two. Each keeps its own entries while you switch.

## What it does

- Collects every column of the current `Invitations` sheet, in the sheet's column order.
- Supports one or many pages per invitation, as SVG or HTML files.
- Lets you label, name, and reorder pages, and remove any page.
- Detects elements that use `data-field` (in SVG and HTML) and shows their editable-field settings, per page and combined across all pages.
- Configures occasions, styles, formats, papers, fonts, colors, and design options.
- Configures pricing: base charge, unit price, intermediate premium, standard and intermediate quantities, and the format, paper, and design option adjustments.
- Checks the same rules the storefront and the order backend enforce, so a bad row is caught before orders start failing.
- Generates a tab-separated row to paste into the sheet, and a one-row CSV download with headers.
- Optionally copies the template files into `templates/<invitation-id>/` in your storefront project, asking before it overwrites anything.

It does **not** connect to Google Sheets or change your spreadsheet.

## Requirements

- Python 3.10 or newer
- The storefront project folder on the same computer where this app runs

## Install and run

Open a terminal in this folder:

```bash
python -m venv .venv
```

Windows:

```powershell
.venv\Scripts\activate
```

macOS/Linux:

```bash
source .venv/bin/activate
```

Install dependencies and start the app:

```bash
pip install -r requirements.txt
streamlit run app.py
```

Streamlit opens the manager in your browser, usually at `http://localhost:8501`.

## Typical workflow

1. **Details:** enter the title, ID, description, occasions, and styles.
2. **Pages:** upload each page's template, set its label and filename, and put the pages in order.
3. **Options:** set the formats, papers, fonts, colors, and design options customers can choose from.
4. **Pricing:** set the base charge, unit price, quantities, and adjustments. A price preview shows the totals.
5. **Export:** fix anything listed under "A few things need attention".
6. Copy the generated row into the next empty row of the `Invitations` sheet. It is tab-separated, so pasting into the first cell fills every column.
7. Click **Copy files into storefront folder**. The app creates:

   ```text
   your-storefront/
   └── templates/
       └── your-invitation-id/
           ├── front.svg
           ├── inside-left.svg
           └── ...
   ```

8. Republish the Invitations CSV feed.

## Sheet columns

The row follows the header order created by `setupInvitationStudioBackend()`:

```text
id, title, active, description, occasion, style, pages,
formats, papers, fonts, colors, designOptions,
formatAdjustments, paperAdjustments, customizationFees,
baseCharge, unitPrice, intermediatePremium,
standardQuantities, intermediateQuantities
```

If your sheet's columns are in a different order, reorder the sheet's columns to match before pasting. The storefront reads columns by header name, but pasting fills them by position.

## Pricing

The invitation price is:

```text
baseCharge + quantity × adjusted unit price + intermediate premium (intermediate quantities only)
```

The adjusted unit price is the unit price plus the selected format adjustment, paper adjustment, and design option fee. All three are per invitation and can be negative (a smaller format can cost less).

Quantities:

- **Standard quantities** are the main price points, such as 50, 100, 150.
- **Intermediate quantities** sit between standard ones, such as 75 and 125, and add the intermediate premium.
- A quantity cannot appear in both lists.

Checks the app runs, matching the storefront and backend:

- At least one standard quantity.
- Every intermediate quantity has a higher standard quantity.
- The premium is less than the price of the extra invitations needed to reach the next standard quantity. This is checked with the base unit price and with the cheapest combination of options, since the backend uses the customer's chosen options.
- No combination of options produces a negative unit price.

## Pages and files

- Filenames may use only letters, numbers, underscores, hyphens, and dots, and must end in `.svg` or `.html`. Spaces and folders are rejected, because the backend refuses every order for an invitation whose page path does not match `templates/<folder>/<file>.svg|html`.
- The filename extension must match the uploaded file.
- Use unique filenames within an invitation.
- Generated paths are relative to the storefront root: `templates/<id>/<filename>`.
- On the catalog, pages labeled starting with "Inside" make up the thumbnail. Otherwise the page labeled "Front", or the first page, is used.

## Editable fields

The manager looks for the same attributes the storefront's field discovery uses:

```xml
<text
  data-field="names"
  data-label="Names"
  data-required="true"
  x="300"
  y="350"
  text-anchor="middle">
  Names go here
</text>
```

Detected attributes:

- `data-field` (required for discovery)
- `data-label`
- `data-required="true"`
- `data-multiline="true"`
- `data-maxlength`

Field IDs may use letters, numbers, underscores, and hyphens, up to 80 characters. Other IDs are ignored by the storefront, and the app warns about them.

If the same `data-field` ID appears on several pages, the storefront treats them as one customer input. The first occurrence supplies the label and limits, and the combined field table shows what the customer will see.

For pages you may later edit in another program (through the print page), use SVG and make each field element a `<text>` element.

## Options

- Every list (formats, papers, fonts, colors, design options) needs at least one value. The backend rejects orders when any list is empty. If an invitation has no real design choice, add a single option such as "Standard".
- Include the card size in each format name, such as `Flat 5x7`. The print page reads the card size from it. The app warns when a name has no size.
- The storefront knows how to display the fonts Cormorant, Garamond, and DM Sans. Other fonts show as a generic serif until they are added to `template-renderer.js`.
- Colors Navy, Sage, Terracotta, and Burgundy are built in. Any other value is used as a CSS color, so a hex code such as `#336699` works.
- Choices are saved in each invitation row. The tool does not modify the `Options` sheet.

## Add-ons

Switch to the **➕ Add-on** tab to prepare an add-on such as response cards. It has five steps: Details, Quantities & pricing, Custom fields, Designs, and Export.

**Output.** The Export step gives you:

1. One row for the `AddOns` sheet.
2. One row per design for the `AddOnDesigns` sheet. Paste them all at once and they fill consecutive rows.
3. The template files, copied into `templates/<add-on-id>/`.

Both rows are tab-separated, so pasting into the first cell fills every column. Header orders:

```text
AddOns:
id, title, description, active, availableInvitationIds,
quantityMinimum, quantityMaximum, quantityStep, defaultQuantity,
baseCharge, quantityPricing, sortOrder, customFields

AddOnDesigns:
id, addOnId, title, active, pages,
priceAdjustmentType, priceAdjustment, sortOrder
```

Your `AddOns` sheet needs the `customFields` header as its 13th column. `setupAddOnCatalogTabs()` in `Code.gs` does not create it.

**Availability.** Choose All invitations (written as `*`) or list specific invitation IDs (written as `id1;id2`). If you have set your storefront folder in the sidebar, the app lists the template folders it finds there as a reminder of the invitation IDs. Restricted add-ons need the `availableInvitationIds` fix in `Code.gs`, which reads that column as a semicolon-separated list.

**Quantities.** Set the minimum, maximum, step, and default. Customers can choose the minimum plus any multiple of the step, up to the maximum. The maximum is required. The default must be one of the allowed quantities.

**Pricing.** The add-on total is:

```text
base charge + quantity × tier unit price + design adjustment
```

Quantity pricing is a table of tiers, each with a minimum, a maximum, and a unit price. Leave the last tier's maximum blank for no upper limit. The app checks that:

- Tiers do not overlap, and only the last one is open-ended.
- Every allowed quantity falls in a tier. The backend rejects orders for a quantity no tier covers.
- No design makes the total negative at any allowed quantity.

A price preview shows the total for each design at the key quantities.

**Custom fields.** Extra information the customer types in, such as a return address. Each field has an ID, label, required flag, optional placeholder, and a text or text-area input type. Values are saved with the order but are not printed on the card. The backend keeps only fields defined here, so a field missing from this table is dropped.

**Designs.** Each design is a choice for the customer, with its own title, pages, and price adjustment:

- The design ID can be left blank. It is then built from the add-on ID and the design title, for example `response-cards-style-1`. IDs must be unique across all designs.
- The adjustment is either once per order or per unit (multiplied by quantity). Negative numbers are discounts.
- Pages work like invitation pages: SVG or HTML, reorderable, with detected `data-field` settings.
- Leave a page's filename blank to have it named from the design ID, such as `response-cards-style-1.svg`. Designs with several pages get the page label added, such as `response-cards-style-1-back.svg`.
- Sort order follows the design's position in the list.
- An add-on needs at least one active design to appear in the storefront.

## Important notes

- Uploaded files are previewed as local HTML. Only upload files you created or trust.
- If you change the invitation ID after uploading pages, review the destination path before copying.
