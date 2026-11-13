\# Invitation Studio — Owner Cheat Sheet



A quick reference for adding invitation designs, pages, editable text, options, and prices.



\## 1. Add a New Design



\### Step 1: Create a folder



Create a folder under:



```text

templates/

```



Use a lowercase, hyphenated design ID.



Example:



```text

templates/

&#x20; my-new-design/

&#x20;   front.svg

&#x20;   inside-left.svg

&#x20;   inside-right.svg

&#x20;   back.svg

```



The folder name should match the invitation's `id` in Google Sheets.



\### Step 2: Create the page artwork



Each page can be either:



\- `.svg` — Best for invitations with carefully positioned text, decorative artwork, and precise layouts.

\- `.html` — Useful for layouts that are easier to create with HTML and CSS.



You can mix HTML and SVG pages within one invitation.



Recommended page labels:



| Page | Label |

|---|---|

| Outside front | `Front` |

| Interior left | `Inside Left` |

| Interior right | `Inside Right` |

| Outside back | `Back` |



The labels matter because the catalog uses them to decide which pages to show.



For a multi-page design, pages labeled `Inside...` are displayed in the catalog. If there are no interior pages, the catalog uses `Front`.



\### Step 3: Add the invitation to Google Sheets



Add one row to the `Invitations` tab.



Example:



| Column | Example |

|---|---|

| id | `my-new-design` |

| title | `My New Design` |

| description | `A refined invitation for a special occasion.` |

| active | `TRUE` |

| occasion | `Wedding;Kiddush` |

| style | `Classic;Elegant` |

| pages | See JSON below |

| formats | `\["Flat 5x7"]` |

| papers | `\["Smooth Matte","Cotton"]` |

| fonts | `\["Cormorant","Garamond"]` |

| colors | `\["Navy","Sage"]` |

| designOptions | `\["Gold accent","No accent"]` |

| basePrice | `2.00` |

| formatAdjustments | `{"Flat 5x7":0}` |

| paperAdjustments | `{"Smooth Matte":0,"Cotton":0.35}` |

| customizationFees | `{"Gold accent":0.35,"No accent":0}` |

| quantityMinimum | `25` |



Example `pages` JSON:



```json

\[

&#x20; {"label":"Front","file":"templates/my-new-design/front.svg","type":"svg"},

&#x20; {"label":"Inside Left","file":"templates/my-new-design/inside-left.svg","type":"svg"},

&#x20; {"label":"Inside Right","file":"templates/my-new-design/inside-right.svg","type":"svg"},

&#x20; {"label":"Back","file":"templates/my-new-design/back.svg","type":"svg"}

]

```



Important:



\- `file` paths start at the project root.

\- The `type` must be `svg` or `html`.

\- The pages array controls the order in which pages appear.

\- JSON must be valid. Use double quotes around property names and string values.

\- In Google Sheets, quote the entire CSV cell when it contains commas.



\### Step 4: Register editable fields



For every unique `data-field` used by the design, add a row to the protected `FieldRegistry` tab:



| InvitationID | FieldID |

|---|---|

| my-new-design | names |

| my-new-design | date |

| my-new-design | address |



Do not add labels or wording to the registry. The actual templates define those.



\### Step 5: Test the design



Check:



\- Catalog thumbnail.

\- Detail page.

\- Every page in the editor.

\- Editable text fields.

\- Repeated fields that appear on multiple pages.

\- Different font, color, paper, and design options.

\- Price calculation.



\---



\## 2. Add Editable Text



The editor automatically discovers elements containing `data-field`.



\### HTML



```html

<h1 data-field="names" data-label="Names">

&#x20; Names go here

</h1>



<p data-field="date" data-label="Date">

&#x20; Date goes here

</p>



<p data-field="address"

&#x20;  data-label="Address"

&#x20;  data-multiline="true">

&#x20; Address goes here

</p>

```



\### SVG



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



\### Available Attributes



| Attribute | Purpose |

|---|---|

| `data-field` | Unique ID for the editable text |

| `data-label` | Label displayed beside the input |

| `data-required="true"` | Makes the field required |

| `data-multiline="true"` | Uses a textarea instead of a single-line input |

| `data-maxlength="120"` | Sets the maximum number of characters |



\### Important Field Rules



\*\*Use the same field ID for repeated text.\*\*



For example, if the names appear on both the front and inside page, use `data-field="names"` on both elements.



The editor will create one input and update both occurrences.



\*\*Use unique IDs for different wording.\*\*



For example:



```text

names

date

time

address

rsvp

```



\*\*The existing text becomes the default.\*\*



If your SVG contains:



```xml

<text data-field="names">The Smith Family</text>

```



The editor initially displays `The Smith Family` as the default wording.



\*\*Register every field ID.\*\*



If a field is added or renamed, update the protected `FieldRegistry` tab as well.



\---



\## 3. Add a New Occasion or Style



Occasions and styles are stored as semicolon-separated values in the `Invitations` tab.



Example:



```text

Wedding;Kiddush;Anniversary

```



To make a new occasion or style available, add it to an invitation's corresponding cell.



The catalog filters are populated from the active invitations.



The `Options` tab can also contain shared option values:



| optionType | optionValue |

|---|---|

| occasion | Wedding |

| occasion | Kiddush |

| style | Classic |

| style | Modern |



\---



\## 4. Add Formats and Format Prices



The `formats` column controls the choices available for that invitation.



Example:



```json

\["Flat 5x7","Flat 4x6","Folded 5x7"]

```



The `formatAdjustments` column controls the extra price per invitation.



Example:



```json

{

&#x20; "Flat 5x7": 0,

&#x20; "Flat 4x6": -0.15,

&#x20; "Folded 5x7": 0.75

}

```



This means:



| Format | Extra price |

|---|---:|

| Flat 5x7 | $0.00 |

| Flat 4x6 | -$0.15 |

| Folded 5x7 | +$0.75 |



A negative adjustment makes the option cheaper.



Every format offered in the `formats` array should have a matching price entry.



\---



\## 5. Add Paper Options and Prices



The `papers` column controls available paper choices.



Example:



```json

\["Smooth Matte","Cotton","Linen"]

```



The `paperAdjustments` column controls the extra price per invitation.



Example:



```json

{

&#x20; "Smooth Matte": 0,

&#x20; "Cotton": 0.40,

&#x20; "Linen": 0.25

}

```



| Paper | Extra price |

|---|---:|

| Smooth Matte | $0.00 |

| Cotton | +$0.40 |

| Linen | +$0.25 |



\---



\## 6. Add Fonts and Colors



Fonts:



```json

\["Cormorant","Garamond","DM Sans"]

```



Colors:



```json

\["Navy","Sage","Terracotta","Burgundy"]

```



The available choices are stored in the invitation row.



The renderer currently recognizes these named colors:



\- Navy

\- Sage

\- Terracotta

\- Burgundy



It also recognizes these font names:



\- Cormorant

\- Garamond

\- DM Sans



The renderer maps these names to CSS values. If you introduce a completely new font or named color, check `template-renderer.js` to ensure it has a corresponding mapping.



\---



\## 7. Add Design Options and Extra Prices



Design options are choices that change the appearance of a particular invitation.



Examples:



```json

\["Gold accent","No accent","Botanical border"]

```



The `customizationFees` column controls the extra price per invitation for these choices.



Example:



```json

{

&#x20; "Gold accent": 0.35,

&#x20; "No accent": 0,

&#x20; "Botanical border": 0.50

}

```



| Design option | Extra price |

|---|---:|

| Gold accent | +$0.35 |

| No accent | $0.00 |

| Botanical border | +$0.50 |



\*\*Important:\*\* The option must be supported by the invitation/template implementation. Adding a choice to Google Sheets alone does not automatically create a new artwork effect. The template must use the relevant option, or the renderer must be updated to apply it.



For example, a template can use an option-controlled element:



```html

<div data-option="design">

&#x20; Botanical border

</div>

```



The renderer applies the selected value to elements with `data-option`.



\---



\## 8. Calculate the Invitation Price



The current estimate is calculated per invitation:



```text

Base price

\+ format adjustment

\+ paper adjustment

\+ design option fee

= price per invitation

```



Then:



```text

Price per invitation × quantity = estimated total

```



Example:



| Item | Price |

|---|---:|

| Base price | $2.00 |

| Folded 5x7 | +$0.75 |

| Cotton paper | +$0.40 |

| Gold accent | +$0.35 |

| \*\*Price per invitation\*\* | \*\*$3.50\*\* |



For 100 invitations:



```text

$3.50 × 100 = $350.00

```



The backend recalculates the estimate using the catalog values. Never rely on a price submitted by the customer's browser.



\---



\## 9. Temporarily Hide a Design



To remove a design from the catalog without deleting it, change:



```text

active = FALSE

```



To show it again:



```text

active = TRUE

```



The design files and spreadsheet row remain available.



\---



\## 10. Final Checklist for Every New Design



\- \[ ] Created a folder under `templates/`.

\- \[ ] Added all page files.

\- \[ ] Used the correct `svg` or `html` page type.

\- \[ ] Added the invitation row to `Invitations`.

\- \[ ] Checked the page JSON and page order.

\- \[ ] Used `Front`, `Inside Left`, `Inside Right`, and `Back` labels consistently.

\- \[ ] Checked all default wording.

\- \[ ] Checked repeated fields across pages.

\- \[ ] Added valid option arrays.

\- \[ ] Added price adjustments for every priced choice.

\- \[ ] Tested the catalog thumbnail.

\- \[ ] Tested the detail page.

\- \[ ] Tested the editor.

\- \[ ] Checked the estimate at multiple quantities.

\- \[ ] Confirmed the design is marked `TRUE` when ready to publish.



\---



\## Quick Reference: Where to Make Changes



| What you want to change | Where |

|---|---|

| Add a new invitation | `templates/` and `Invitations` sheet |

| Change invitation name | `Invitations` → `title` |

| Change description | `Invitations` → `description` |

| Hide/show a design | `Invitations` → `active` |

| Change occasions | `Invitations` → `occasion` |

| Change styles | `Invitations` → `style` |

| Add or reorder pages | `Invitations` → `pages` |

| Change editable wording fields | HTML/SVG template files |

| Register editable fields | Protected `FieldRegistry` tab |

| Change formats | `Invitations` → `formats` |

| Change paper options | `Invitations` → `papers` |

| Change fonts | `Invitations` → `fonts` |

| Change colors | `Invitations` → `colors` |

| Change design options | `Invitations` → `designOptions` |

| Change starting price | `Invitations` → `basePrice` |

| Change format price | `Invitations` → `formatAdjustments` |

| Change paper price | `Invitations` → `paperAdjustments` |

| Change design option price | `Invitations` → `customizationFees` |

| Change minimum order | `Invitations` → `quantityMinimum` |

| Change recognized font/color mappings | `assets/js/template-renderer.js` |

| Change catalog preview behavior | `assets/js/template-renderer.js` |

| Change catalog appearance | `assets/css/catalog.css` |



