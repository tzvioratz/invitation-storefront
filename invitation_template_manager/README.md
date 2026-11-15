# Invitation Template Manager

A small local Python/Streamlit utility for preparing invitation templates for the static invitation storefront.

## What it does

- Collects the same fields used by your existing `Invitations` CSV schema.
- Supports one or many SVG pages per invitation.
- Lets you label and name each page.
- Detects SVG elements that use `data-field` and displays their editable-field metadata.
- Configures occasions, styles, formats, papers, fonts, colors, design options, and pricing.
- Generates a properly CSV-escaped row ready to copy into the `Invitations` Google Sheet.
- Optionally copies uploaded SVG files into `templates/<invitation-id>/` inside your storefront project.
- Can download a one-row CSV file (including headers).

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

1. Enter the invitation title, ID, description, occasions, and styles.
2. Open **SVG pages**. Upload the SVG for each page, set its customer-facing label, and set the filename that should be used in the template folder.
3. Open **Options** and configure the choices customers can select.
4. Open **Pricing** and enter the base price and adjustments.
5. Open **Export** and review validation.
6. Copy the generated CSV row into the next empty row of the `Invitations` sheet.
7. If desired, click **Copy SVGs into storefront folder**. The app creates:

   ```text
   your-storefront/
   └── templates/
       └── your-invitation-id/
           ├── front.svg
           ├── inside-left.svg
           └── ...
   ```

8. Publish/update the Invitations CSV feed as you normally do.

## SVG editable fields

The manager looks for the same attributes used by the storefront's field discovery:

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

Supported attributes shown in the detected-field list:

- `data-field` (required for discovery)
- `data-label`
- `data-required="true"`
- `data-multiline="true"`
- `data-maxlength`

If the same `data-field` ID appears on multiple pages, your storefront can treat those occurrences as one customer input, as it already does.

## Important notes

- Page paths in the generated row are relative to the storefront project root and match the current schema: `templates/<id>/<filename>`.
- This version is SVG-only, matching your current plan to use SVG templates.
- Use unique filenames within an invitation.
- If you change the invitation ID after uploading pages, review the generated destination paths before copying.
- The SVG preview displays the uploaded SVG as local HTML. Only upload SVGs you created or trust.
- The tool does not modify the `Options` sheet. The choices are saved directly in each invitation row, consistent with your current editor's per-invitation option arrays.
