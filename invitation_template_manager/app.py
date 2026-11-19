from __future__ import annotations

import csv
import io
import json
import re
import uuid
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="Invitation Template Manager", page_icon="✉️", layout="wide")

DEFAULT_OPTIONS = {
    "occasions": ["Wedding", "Bar Mitzvah", "Birthday", "Anniversary", "Bris", "Kiddush"],
    "styles": ["Modern", "Traditional", "Classic", "Elegant", "Minimalist", "Floral"],
    "formats": ["Flat 5x7", "Flat 4x6", "Folded 5x7"],
    "papers": ["Smooth Matte", "Cotton", "Linen"],
    "fonts": ["Cormorant", "Garamond", "DM Sans"],
    "colors": ["Navy", "Sage", "Terracotta", "Burgundy"],
}

# Column orders must match the sheet headers (see the setup functions in Code.gs).
CSV_HEADERS = [
    "id", "title", "active", "description", "occasion", "style", "pages",
    "formats", "papers", "fonts", "colors", "designOptions",
    "formatAdjustments", "paperAdjustments", "customizationFees",
    "baseCharge", "unitPrice", "intermediatePremium",
    "standardQuantities", "intermediateQuantities",
]

ADDON_HEADERS = [
    "id", "title", "description", "active", "availableInvitationIds",
    "quantityMinimum", "quantityMaximum", "quantityStep", "defaultQuantity",
    "baseCharge", "quantityPricing", "sortOrder", "customFields",
]

ADDON_DESIGN_HEADERS = [
    "id", "addOnId", "title", "active", "pages",
    "priceAdjustmentType", "priceAdjustment", "sortOrder",
]

# Fonts and colors the storefront (template-renderer.js) already knows how to display.
KNOWN_FONTS = {"Cormorant", "Garamond", "DM Sans"}
KNOWN_COLORS = {"Navy", "Sage", "Terracotta", "Burgundy"}

SUGGESTED_LABELS = ["Front", "Inside Left", "Inside Right", "Back"]

ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
# The backend only accepts templates/<folder>/<file>.svg|html with these characters.
FILENAME_PATTERN = re.compile(r"[A-Za-z0-9_.-]+\.(svg|html)", re.IGNORECASE)
FIELD_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,80}")
FORMAT_SIZE_PATTERN = re.compile(r"\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?", re.IGNORECASE)

ADJUSTMENT_TYPES = {"perOrder": "Once per order", "perUnit": "Per unit (× quantity)"}
MAX_QUANTITY_SCAN = 20000


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

def slugify(value: str, fallback: str = "new-invitation") -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or fallback


def json_cell(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def delimited_line(values: list[Any], delimiter: str = ",") -> str:
    buf = io.StringIO()
    csv.writer(buf, delimiter=delimiter, lineterminator="").writerow(values)
    return buf.getvalue()


def parse_values(raw: str) -> list[str]:
    return list(dict.fromkeys(x.strip() for x in raw.split(",") if x.strip()))


def parse_quantities(raw: str, label: str) -> tuple[list[int], list[str]]:
    values: list[int] = []
    errors: list[str] = []
    for token in parse_values(raw):
        if re.fullmatch(r"\d+", token) and int(token) > 0:
            values.append(int(token))
        else:
            errors.append(f'{label} quantity "{token}" must be a positive whole number.')
    if len(set(values)) != len(values):
        errors.append(f"{label} quantities contain duplicates.")
    return sorted(set(values)), errors


def page_kind(filename: str) -> str:
    return "svg" if filename.lower().endswith(".svg") else "html"


def clean_str(value: Any) -> str:
    return "" if value is None or pd.isna(value) else str(value).strip()


def clean_number(value: Any) -> float | None:
    return None if value is None or pd.isna(value) else float(value)


def field_record(attrs: dict[str, str]) -> dict[str, Any] | None:
    field_id = attrs.get("data-field")
    if not field_id:
        return None
    return {
        "id": field_id,
        "label": attrs.get("data-label", ""),
        "required": attrs.get("data-required", "").lower() == "true",
        "multiline": attrs.get("data-multiline", "").lower() == "true",
        "maxlength": attrs.get("data-maxlength", ""),
    }


class _FieldCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.fields: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        record = field_record({k: (v or "") for k, v in attrs})
        if record:
            self.fields.append(record)


def parse_fields(data: bytes, kind: str) -> tuple[list[dict[str, Any]], str | None]:
    """Returns (fields, error). Works for both SVG and HTML templates."""
    if kind == "svg":
        try:
            root = ET.fromstring(data)
        except ET.ParseError as exc:
            return [], f"The SVG could not be parsed ({exc})."
        return [rec for el in root.iter() if (rec := field_record(el.attrib))], None

    collector = _FieldCollector()
    collector.feed(data.decode("utf-8", errors="replace"))
    return collector.fields, None


def preview(data: bytes, kind: str) -> None:
    # Uploaded templates are treated as trusted design files and previewed locally.
    text = data.decode("utf-8", errors="replace")
    try:
        components.html(text, height=500, scrolling=True)
    except Exception:
        if kind == "svg":
            st.image(text)
        else:
            st.warning("Preview is not available in this version of Streamlit.")


def adjustment_inputs(values: list[str], prefix: str, caption: str) -> dict[str, float]:
    result: dict[str, float] = {}
    if not values:
        return result
    columns = st.columns(min(3, len(values)))
    for i, value in enumerate(values):
        with columns[i % len(columns)]:
            amount = st.number_input(
                f"{value} ({caption})",
                key=f"{prefix}_{i}_{slugify(value)}",
                value=0.0,
                step=0.05,
                format="%.2f",
            )
        result[value] = round(float(amount), 2)
    return result


def pricing_problems(
    unit_price: float,
    premium: float,
    standard: list[int],
    intermediate: list[int],
    format_adj: dict[str, float],
    paper_adj: dict[str, float],
    fees: dict[str, float],
    designs: list[str],
) -> list[str]:
    """Mirrors the storefront (validatePricing) and backend (validateOrder_) pricing checks."""
    problems: list[str] = []

    if not standard:
        problems.append("Add at least one standard quantity.")
        return problems

    # The cheapest combination of options is the strictest case for the intermediate check.
    lowest = (
        unit_price
        + min(format_adj.values(), default=0.0)
        + min(paper_adj.values(), default=0.0)
        + min([fees.get(d, 0.0) for d in designs] or [0.0])
    )

    if lowest < 0:
        problems.append(
            f"The cheapest combination of options gives a negative unit price (${lowest:.2f}). "
            "Reduce the discounts or raise the unit price."
        )

    checks = [("the unit price", unit_price)]
    if abs(lowest - unit_price) > 1e-9:
        checks.append(("the cheapest combination of options", lowest))

    for q in intermediate:
        higher = [s for s in standard if s > q]
        if not higher:
            problems.append(f"Intermediate quantity {q} needs a higher standard quantity.")
            continue
        nxt = higher[0]
        for name, price in checks:
            limit = (nxt - q) * price
            if premium >= limit:
                problems.append(
                    f"Intermediate quantity {q}: the premium (${premium:.2f}) must be less than "
                    f"{nxt - q} × ${price:.2f} = ${limit:.2f} (the extra cost of reaching {nxt}), "
                    f"using {name}."
                )
    return problems


def detect_invitation_folders(root_text: str) -> list[str]:
    if not root_text.strip():
        return []
    try:
        templates = Path(root_text).expanduser() / "templates"
        return sorted(p.name for p in templates.iterdir() if p.is_dir())
    except OSError:
        return []


# ------------------------------------------------------------
# Shared page editing, validation, and copying
# ------------------------------------------------------------

def new_page(index: int, auto_name: bool = False) -> dict[str, Any]:
    label = SUGGESTED_LABELS[index] if index < len(SUGGESTED_LABELS) else f"Page {index + 1}"
    return {
        "uid": uuid.uuid4().hex[:8],
        "label": label,
        "filename": "" if auto_name else f"{slugify(label)}.svg",
        "upload": None,
        "fields": [],
        "parse_error": None,
    }


def render_pages_editor(pages: list[dict[str, Any]], scope: str, auto_name: bool = False) -> None:
    action: tuple[str, int] | None = None

    for i, page in enumerate(pages):
        uid = page["uid"]
        with st.container(border=True):
            c1, c2 = st.columns([2, 3])
            page["label"] = c1.text_input(f"Page {i + 1} label", value=page["label"], key=f"label_{uid}")
            page["filename"] = c2.text_input(
                "Filename (leave blank to name automatically)" if auto_name else "Filename in template folder",
                value=page["filename"],
                key=f"filename_{uid}",
            )

            upload = st.file_uploader("Template file", type=["svg", "html"], key=f"upload_{uid}")
            page["upload"] = upload
            page["fields"], page["parse_error"] = [], None

            if upload is not None:
                data = upload.getvalue()
                kind = page_kind(upload.name)
                fields, error = parse_fields(data, kind)
                page["fields"], page["parse_error"] = fields, error

                if error:
                    st.error(error)
                else:
                    st.caption(f"{len(fields)} editable field occurrence(s) detected in {upload.name}.")
                    if fields:
                        st.dataframe(fields, hide_index=True)
                    else:
                        st.warning("No data-field attributes found. This is fine if the page has no editable text.")
                with st.expander("Preview"):
                    preview(data, kind)

            b1, b2, b3, _ = st.columns([1, 1, 1, 5])
            if b1.button("↑ Up", key=f"up_{uid}", disabled=i == 0):
                action = ("up", i)
            if b2.button("↓ Down", key=f"down_{uid}", disabled=i == len(pages) - 1):
                action = ("down", i)
            if b3.button("✕ Remove", key=f"remove_{uid}", disabled=len(pages) == 1):
                action = ("remove", i)

    if action:
        kind_, index = action
        if kind_ == "up" and index > 0:
            pages[index - 1], pages[index] = pages[index], pages[index - 1]
        elif kind_ == "down" and index < len(pages) - 1:
            pages[index + 1], pages[index] = pages[index], pages[index + 1]
        elif kind_ == "remove" and len(pages) > 1:
            pages.pop(index)
        st.rerun()

    if st.button("＋ Add another page", key=f"{scope}_add_page"):
        pages.append(new_page(len(pages), auto_name))
        st.rerun()


def check_pages(
    pages: list[dict[str, Any]],
    folder_id: str,
    prefix: str,
    errors: list[str],
    seen_names: set[str],
    filename_for: Callable[[int, dict[str, Any]], str],
) -> list[dict[str, str]]:
    """Validates pages and returns their page-definition records."""
    records: list[dict[str, str]] = []

    for i, page in enumerate(pages):
        n = f"{prefix}page {i + 1}"
        filename = filename_for(i, page)
        upload = page["upload"]

        if not page["label"].strip():
            errors.append(f"{n}: enter a page label.")
        if not FILENAME_PATTERN.fullmatch(filename):
            errors.append(
                f"{n}: the filename must use only letters, numbers, underscores, hyphens, and dots, "
                "end in .svg or .html, and contain no spaces or folders."
            )
        if filename.lower() in seen_names:
            errors.append(f"{n}: the filename {filename} is used more than once.")
        seen_names.add(filename.lower())

        if upload is None:
            errors.append(f"{n}: upload a template file.")
        else:
            if filename.lower().rsplit(".", 1)[-1] != upload.name.lower().rsplit(".", 1)[-1]:
                errors.append(f"{n}: the uploaded file is {upload.name}, but the filename ends in a different extension.")
            if page["parse_error"]:
                errors.append(f"{n}: {page['parse_error']}")

        records.append({
            "label": page["label"].strip(),
            "file": f"templates/{folder_id}/{filename}",
            "type": page_kind(filename),
        })

    return records


def summarize_fields(pages: list[dict[str, Any]], warnings: list[str]) -> dict[str, dict[str, Any]]:
    summary: dict[str, dict[str, Any]] = {}
    for page in pages:
        for f in page.get("fields", []):
            if not FIELD_ID_PATTERN.fullmatch(f["id"]):
                warnings.append(
                    f'Field ID "{f["id"]}" on page "{page["label"]}" is not valid (letters, numbers, '
                    "underscores, hyphens, up to 80 characters) and will be ignored by the storefront."
                )
                continue
            entry = summary.setdefault(f["id"], {**f, "pages": []})
            if page["label"] not in entry["pages"]:
                entry["pages"].append(page["label"])
    return summary


def show_field_summary(summary: dict[str, dict[str, Any]]) -> None:
    if not summary:
        return
    st.markdown("**Editable fields across all pages**")
    st.dataframe(
        [
            {
                "Field": fid,
                "Label": e["label"],
                "Required": e["required"],
                "Multiline": e["multiline"],
                "Max length": e["maxlength"],
                "Pages": ", ".join(e["pages"]),
            }
            for fid, e in summary.items()
        ],
        hide_index=True,
    )


def copy_files_ui(project_root_text: str, folder_id: str, files: list[tuple[str, bytes]], scope: str) -> None:
    st.markdown("**Copy template files into your storefront**")

    root = Path(project_root_text).expanduser() if project_root_text.strip() else None
    if root is None:
        st.warning("Enter your storefront project folder in the sidebar to enable file copying.")
        return

    target = root / "templates" / folder_id
    st.write(f"Destination: `{target}`")

    if root.is_dir() and not ((root / "index.html").exists() and (root / "assets").is_dir()):
        st.warning("This folder has no index.html and assets/ folder. Check that it is the storefront project.")

    existing = [name for name, _ in files if (target / name).exists()]
    overwrite_ok = True
    if existing:
        st.warning("These files already exist: " + ", ".join(f"`{name}`" for name in existing))
        overwrite_ok = st.checkbox(f"Overwrite {len(existing)} existing file(s)", key=f"{scope}_overwrite")

    if st.button("📁 Copy files into storefront folder", type="primary", disabled=not overwrite_ok, key=f"{scope}_copy"):
        try:
            if not root.is_dir():
                raise FileNotFoundError("The storefront folder does not exist. Check the path.")
            target.mkdir(parents=True, exist_ok=True)
            for name, data in files:
                (target / name).write_bytes(data)
            st.success(f"Copied {len(files)} file(s) to {target}")
            for name, _ in files:
                st.write(f"- `{name}`")
        except Exception as exc:
            st.error(f"Could not copy files: {exc}")


# ------------------------------------------------------------
# Session state
# ------------------------------------------------------------

def new_design(index: int) -> dict[str, Any]:
    return {
        "uid": uuid.uuid4().hex[:8],
        "title": f"Style {index + 1}",
        "id": "",
        "active": True,
        "adj_type": "perOrder",
        "adj": 0.0,
        "pages": [new_page(0, auto_name=True)],
    }


if "pages" not in st.session_state:
    st.session_state.pages = [new_page(0)]
if "addon_designs" not in st.session_state:
    st.session_state.addon_designs = [new_design(0)]


# ------------------------------------------------------------
# INVITATION MODE
# ------------------------------------------------------------

def invitation_ui(project_root_text: str) -> None:
    pages: list[dict[str, Any]] = st.session_state.pages

    st.caption(
        "Prepare SVG or HTML templates, organize their files, configure storefront options and pricing, "
        "and generate a row for your Invitations sheet."
    )

    tabs = st.tabs(["1 · Details", "2 · Pages", "3 · Options", "4 · Pricing", "5 · Export"])

    # 1 · Details
    with tabs[0]:
        st.subheader("Invitation details")
        c1, c2 = st.columns(2)
        with c1:
            title = st.text_input("Invitation title", placeholder="The Classic Arch")
            generated_id = slugify(title)
            invitation_id = st.text_input(
                "Invitation ID",
                value=generated_id,
                help="Lowercase letters, numbers, and hyphens. This becomes the folder name.",
            )
            description = st.text_area("Description", placeholder="A timeless formal invitation with...")
        with c2:
            active = st.toggle("Active in storefront", value=True)
            occasions_raw = st.text_input("Occasions (comma-separated)", value=", ".join(DEFAULT_OPTIONS["occasions"]))
            styles_raw = st.text_input("Styles (comma-separated)", value=", ".join(DEFAULT_OPTIONS["styles"]))
        occasions = parse_values(occasions_raw)
        styles = parse_values(styles_raw)
        if invitation_id and not ID_PATTERN.fullmatch(invitation_id):
            st.error("Use only lowercase letters, numbers, and single hyphens in the ID.")

    # 2 · Pages
    with tabs[1]:
        st.subheader("Pages")
        st.write(
            "Add the template files in the order customers should see them. "
            "Files are copied into `templates/<invitation-id>/`. SVG and HTML pages are both supported."
        )
        st.caption(
            'Labels matter: on the catalog, pages whose label starts with "Inside" make up the thumbnail. '
            'Otherwise the page labeled "Front" (or the first page) is used.'
        )
        render_pages_editor(pages, "inv")

    # 3 · Options
    with tabs[2]:
        st.subheader("Customer choices")
        st.caption(
            "Enter comma-separated choices. These values are stored in the invitation row, "
            "so they do not need to exist in the Options tab first. Every list needs at least one value."
        )
        a, b = st.columns(2)
        with a:
            formats_raw = st.text_input("Card formats", value=", ".join(DEFAULT_OPTIONS["formats"]))
            papers_raw = st.text_input("Paper types", value=", ".join(DEFAULT_OPTIONS["papers"]))
            fonts_raw = st.text_input("Fonts", value=", ".join(DEFAULT_OPTIONS["fonts"]))
        with b:
            colors_raw = st.text_input("Colors", value=", ".join(DEFAULT_OPTIONS["colors"]))
            designs_raw = st.text_input("Design options", value="Gold accent, No accent")
        formats = parse_values(formats_raw)
        papers = parse_values(papers_raw)
        fonts = parse_values(fonts_raw)
        colors = parse_values(colors_raw)
        designs = parse_values(designs_raw)

        option_warnings: list[str] = []
        for f in formats:
            if not FORMAT_SIZE_PATTERN.search(f):
                option_warnings.append(
                    f'Format "{f}" has no size like 5x7. The print page sets the card size from the format name.'
                )
        for f in fonts:
            if f not in KNOWN_FONTS:
                option_warnings.append(
                    f'Font "{f}" is not mapped in template-renderer.js, so the storefront will show it as a generic serif.'
                )
        for c in colors:
            if c not in KNOWN_COLORS and not re.fullmatch(r"#[0-9a-fA-F]{3,8}", c):
                option_warnings.append(
                    f'Color "{c}" is not a built-in color. The storefront will use it as a CSS color value, such as #336699.'
                )
        for w in option_warnings:
            st.warning(w)

    # 4 · Pricing
    with tabs[3]:
        st.subheader("Pricing")
        st.caption(
            "Invitation price = base charge + quantity × adjusted unit price (+ premium for intermediate quantities). "
            "The adjusted unit price includes the format, paper, and design option adjustments below."
        )
        p1, p2 = st.columns(2)
        with p1:
            base_charge = st.number_input(
                "Base charge per order ($)", min_value=0.0, value=50.0, step=5.0, format="%.2f",
                help="A fixed charge added once to every order.",
            )
            unit_price = st.number_input(
                "Unit price per invitation ($)", min_value=0.0, value=1.50, step=0.05, format="%.2f"
            )
            intermediate_premium = st.number_input(
                "Intermediate quantity premium ($)", min_value=0.0, value=5.0, step=1.0, format="%.2f",
                help="Added once for quantities listed as intermediate.",
            )
        with p2:
            standard_raw = st.text_input("Standard quantities (comma-separated)", value="50, 100, 150")
            intermediate_raw = st.text_input("Intermediate quantities (comma-separated)", value="75, 125")

        standard_quantities, standard_errors = parse_quantities(standard_raw, "Standard")
        intermediate_quantities, intermediate_errors = parse_quantities(intermediate_raw, "Intermediate")
        quantity_errors = standard_errors + intermediate_errors
        overlap = sorted(set(standard_quantities) & set(intermediate_quantities))
        if overlap:
            quantity_errors.append(
                "Quantities cannot be both standard and intermediate: " + ", ".join(map(str, overlap)) + "."
            )
        for err in quantity_errors:
            st.error(err)

        st.markdown("**Format price adjustments** (per invitation)")
        format_adjustments = adjustment_inputs(formats, "format_adj", "$")
        st.markdown("**Paper price adjustments** (per invitation)")
        paper_adjustments = adjustment_inputs(papers, "paper_adj", "$")
        st.markdown("**Design option fees** (per invitation)")
        fee_inputs = adjustment_inputs(designs, "design_fee", "$")
        customization_fees = {name: amount for name, amount in fee_inputs.items() if amount != 0}

        problems = pricing_problems(
            unit_price, intermediate_premium, standard_quantities, intermediate_quantities,
            format_adjustments, paper_adjustments, customization_fees, designs,
        )
        for p in problems:
            st.error(p)

        if standard_quantities:
            st.markdown("**Price preview** (before format, paper, and design adjustments)")
            rows = []
            for q in sorted(set(standard_quantities) | set(intermediate_quantities)):
                is_intermediate = q in intermediate_quantities
                total = base_charge + q * unit_price + (intermediate_premium if is_intermediate else 0.0)
                rows.append({
                    "Quantity": q,
                    "Type": "Intermediate" if is_intermediate else "Standard",
                    "Invitation total": f"${total:,.2f}",
                    "Per invitation": f"${total / q:,.2f}",
                })
            st.dataframe(rows, hide_index=True)

    # 5 · Export
    with tabs[4]:
        st.subheader("Validate and export")

        errors: list[str] = []
        warnings: list[str] = list(option_warnings)
        seen_names: set[str] = set()

        page_records = check_pages(
            pages, invitation_id, "", errors, seen_names, lambda i, p: p["filename"].strip()
        )

        if not title.strip():
            errors.append("Enter an invitation title.")
        if not invitation_id or not ID_PATTERN.fullmatch(invitation_id):
            errors.append("Invitation ID must use lowercase letters, numbers, and hyphens.")
        if not occasions:
            errors.append("Add at least one occasion.")
        if not styles:
            errors.append("Add at least one style.")
        for name, values in [
            ("card format", formats), ("paper type", papers), ("font", fonts),
            ("color", colors), ("design option", designs),
        ]:
            if not values:
                errors.append(f"Add at least one {name}. The backend rejects orders when any of these lists is empty.")
        errors.extend(quantity_errors)
        errors.extend(problems)

        field_summary = summarize_fields(pages, warnings)

        if errors:
            st.error("A few things need attention:")
            for err in errors:
                st.write(f"- {err}")
        else:
            st.success("Required fields look good.")

        if warnings:
            st.warning("Worth a look (these do not block export):")
            for w in warnings:
                st.write(f"- {w}")

        if not errors:
            show_field_summary(field_summary)

            row_values = [
                invitation_id,
                title.strip(),
                "TRUE" if active else "FALSE",
                description.strip().replace("\t", " "),
                ";".join(occasions),
                ";".join(styles),
                json_cell(page_records),
                json_cell(formats),
                json_cell(papers),
                json_cell(fonts),
                json_cell(colors),
                json_cell(designs),
                json_cell(format_adjustments),
                json_cell(paper_adjustments),
                json_cell(customization_fees),
                f"{base_charge:.2f}",
                f"{unit_price:.2f}",
                f"{intermediate_premium:.2f}",
                json_cell(standard_quantities),
                json_cell(intermediate_quantities),
            ]
            assert len(row_values) == len(CSV_HEADERS)

            st.markdown("**Copy this row into the next empty row of your `Invitations` sheet**")
            st.caption(
                "It is tab-separated, so pasting into the first cell fills every column. "
                "Your sheet's header row must be in this order:"
            )
            st.code(", ".join(CSV_HEADERS), language="text")
            st.code(delimited_line(row_values, "\t"), language="text")

            st.download_button(
                "Download this row as CSV (with headers)",
                data=delimited_line(CSV_HEADERS) + "\n" + delimited_line(row_values) + "\n",
                file_name=f"{invitation_id}.csv",
                mime="text/csv",
                key="inv_download",
            )

            with st.expander("Page definitions (JSON)"):
                st.code(json.dumps(page_records, indent=2), language="json")

            st.divider()
            copy_files_ui(
                project_root_text,
                invitation_id,
                [(p["filename"].strip(), p["upload"].getvalue()) for p in pages],
                "inv",
            )


# ------------------------------------------------------------
# ADD-ON MODE
# ------------------------------------------------------------

def default_tiers_df() -> pd.DataFrame:
    return pd.DataFrame({
        "min": pd.array([1, 101, 251], dtype="Int64"),
        "max": pd.array([100, 250, None], dtype="Int64"),
        "unitPrice": [0.75, 0.60, 0.50],
    })


def empty_custom_fields_df() -> pd.DataFrame:
    return pd.DataFrame({
        "id": pd.Series(dtype="object"),
        "label": pd.Series(dtype="object"),
        "required": pd.Series(dtype="bool"),
        "placeholder": pd.Series(dtype="object"),
        "type": pd.Series(dtype="object"),
    })


def parse_tiers(df: pd.DataFrame) -> tuple[list[dict[str, Any]], list[str]]:
    tiers: list[dict[str, Any]] = []
    errors: list[str] = []

    for i, row in enumerate(df.to_dict("records"), start=1):
        lo = clean_number(row.get("min"))
        hi = clean_number(row.get("max"))
        price = clean_number(row.get("unitPrice"))
        if lo is None and hi is None and price is None:
            continue
        if lo is None or price is None:
            errors.append(f"Tier {i}: enter a minimum quantity and a unit price.")
            continue
        if lo < 1 or lo != int(lo):
            errors.append(f"Tier {i}: the minimum must be a whole number of at least 1.")
            continue
        if hi is not None and (hi < lo or hi != int(hi)):
            errors.append(f"Tier {i}: the maximum must be a whole number that is not below the minimum.")
            continue
        if price < 0:
            errors.append(f"Tier {i}: the unit price cannot be negative.")
            continue
        tiers.append({"min": int(lo), "max": None if hi is None else int(hi), "unitPrice": round(price, 4)})

    tiers.sort(key=lambda t: t["min"])
    for prev, nxt in zip(tiers, tiers[1:]):
        if prev["max"] is None:
            errors.append("Only the last tier can have no maximum.")
        elif nxt["min"] <= prev["max"]:
            errors.append(f"Tiers overlap: {prev['min']}–{prev['max']} and {nxt['min']}+.")
    return tiers, errors


def tier_for(quantity: int, tiers: list[dict[str, Any]]) -> dict[str, Any] | None:
    for t in tiers:
        if quantity >= t["min"] and (t["max"] is None or quantity <= t["max"]):
            return t
    return None


def parse_custom_fields(df: pd.DataFrame) -> tuple[list[dict[str, Any]], list[str]]:
    fields: list[dict[str, Any]] = []
    errors: list[str] = []
    seen: set[str] = set()

    for i, row in enumerate(df.to_dict("records"), start=1):
        fid = clean_str(row.get("id"))
        label = clean_str(row.get("label"))
        placeholder = clean_str(row.get("placeholder"))
        kind = clean_str(row.get("type")) or "text"
        required_raw = row.get("required")
        required = False if required_raw is None or pd.isna(required_raw) else bool(required_raw)

        if not fid and not label and not placeholder:
            continue
        if not FIELD_ID_PATTERN.fullmatch(fid):
            errors.append(f"Custom field {i}: the ID must use letters, numbers, underscores, or hyphens (up to 80 characters).")
            continue
        if fid in seen:
            errors.append(f'Custom field ID "{fid}" is used more than once.')
            continue
        if not label:
            errors.append(f'Custom field "{fid}": enter a label.')
            continue
        seen.add(fid)

        field: dict[str, Any] = {"id": fid, "label": label, "required": required}
        if placeholder:
            field["placeholder"] = placeholder
        if kind == "textarea":
            field["type"] = "textarea"
        fields.append(field)
    return fields, errors


def addon_filename(page: dict[str, Any], design_id: str, count: int) -> str:
    name = page["filename"].strip()
    if name:
        return name
    upload = page["upload"]
    ext = upload.name.rsplit(".", 1)[-1].lower() if upload is not None and "." in upload.name else "svg"
    base = design_id if count == 1 else f"{design_id}-{slugify(page['label'], 'page')}"
    return f"{base}.{ext}"


def addon_ui(project_root_text: str) -> None:
    designs_state: list[dict[str, Any]] = st.session_state.addon_designs

    st.caption(
        "Prepare an add-on, such as response cards or envelopes. This produces one row for the `AddOns` sheet "
        "and one row per design for the `AddOnDesigns` sheet."
    )

    tabs = st.tabs(["1 · Details", "2 · Quantities & pricing", "3 · Custom fields", "4 · Designs", "5 · Export"])

    # 1 · Details
    with tabs[0]:
        st.subheader("Add-on details")
        c1, c2 = st.columns(2)
        with c1:
            ao_title = st.text_input("Add-on title", placeholder="Response Cards", key="ao_title")
            ao_id_override = st.text_input(
                "Add-on ID (leave blank to generate from the title)",
                key="ao_id",
                help="Lowercase letters, numbers, and hyphens. Design files go in templates/<add-on-id>/.",
            )
            ao_id = ao_id_override.strip() or slugify(ao_title, "new-add-on")
            st.caption(f"ID: `{ao_id}`")
            ao_description = st.text_area("Description", placeholder="Matching response cards and envelopes.", key="ao_desc")
        with c2:
            ao_active = st.toggle("Active in storefront", value=True, key="ao_active")
            ao_sort = st.number_input("Sort order", min_value=0, value=1, step=1, key="ao_sort")
            availability = st.radio(
                "Available for",
                ["All invitations", "Only specific invitations"],
                key="ao_availability",
            )
            ao_invitation_ids: list[str] = []
            if availability == "Only specific invitations":
                detected = detect_invitation_folders(project_root_text)
                raw_ids = st.text_input("Invitation IDs (comma-separated)", key="ao_invitation_ids")
                ao_invitation_ids = list(dict.fromkeys(
                    x.strip() for x in re.split(r"[;,]", raw_ids) if x.strip()
                ))
                if detected:
                    st.caption("Template folders in your storefront: " + ", ".join(detected))
        if ao_id and not ID_PATTERN.fullmatch(ao_id):
            st.error("Use only lowercase letters, numbers, and single hyphens in the ID.")

    # 2 · Quantities & pricing
    with tabs[1]:
        st.subheader("Quantities")
        q1, q2, q3, q4 = st.columns(4)
        qty_min = int(q1.number_input("Minimum quantity", min_value=1, value=25, step=1, key="ao_qmin"))
        qty_max = int(q2.number_input("Maximum quantity", min_value=1, value=500, step=1, key="ao_qmax"))
        qty_step = int(q3.number_input(
            "Quantity step", min_value=1, value=25, step=1, key="ao_qstep",
            help="Customers choose the minimum plus multiples of this step.",
        ))
        qty_default = int(q4.number_input("Default quantity", min_value=1, value=100, step=1, key="ao_qdefault"))

        quantity_errors: list[str] = []
        allowed: list[int] = []
        if qty_max < qty_min:
            quantity_errors.append("The maximum quantity cannot be below the minimum.")
        else:
            if (qty_max - qty_min) // qty_step > MAX_QUANTITY_SCAN:
                quantity_errors.append("That range has too many allowed quantities. Raise the step.")
            else:
                allowed = list(range(qty_min, qty_max + 1, qty_step))
            if qty_default < qty_min or qty_default > qty_max or (qty_default - qty_min) % qty_step != 0:
                quantity_errors.append(
                    "The default quantity must be an allowed quantity: the minimum plus a multiple of the step, "
                    "within the maximum."
                )
        for err in quantity_errors:
            st.error(err)
        if len(allowed) > 500:
            st.warning(f"The storefront will build a dropdown with {len(allowed)} quantities. Consider a larger step.")
        allowed_set = set(allowed)

        st.subheader("Pricing")
        ao_base_charge = st.number_input(
            "Base charge ($)", min_value=0.0, value=0.0, step=1.0, format="%.2f", key="ao_base",
            help="A fixed charge added once when the add-on is selected.",
        )
        st.markdown("**Quantity pricing tiers**")
        st.caption(
            "Each tier sets the unit price for a quantity range. Leave the last tier's maximum blank for no upper limit. "
            "Tiers must cover every allowed quantity."
        )
        tiers_df = st.data_editor(
            default_tiers_df(),
            key="ao_tiers",
            num_rows="dynamic",
            hide_index=True,
            column_config={
                "min": st.column_config.NumberColumn("Min quantity", min_value=1, step=1),
                "max": st.column_config.NumberColumn("Max quantity (blank = no limit)", min_value=1, step=1),
                "unitPrice": st.column_config.NumberColumn("Unit price ($)", min_value=0.0, step=0.01, format="%.2f"),
            },
        )
        tiers, tier_errors = parse_tiers(tiers_df)
        if not tiers and not tier_errors:
            tier_errors.append("Add at least one pricing tier.")

        if not tier_errors and allowed:
            uncovered = next((q for q in allowed if tier_for(q, tiers) is None), None)
            if uncovered is not None:
                tier_errors.append(f"No pricing tier covers quantity {uncovered}. Extend or add a tier.")
        for err in tier_errors:
            st.error(err)

        # Price preview across designs
        if allowed and not tier_errors:
            candidates = {qty_min, qty_max, qty_default}
            for t in tiers:
                candidates.add(t["min"])
                if t["max"] is not None:
                    candidates.add(t["max"])
            preview_qty = sorted(q for q in candidates if q in allowed_set)

            st.markdown("**Price preview**")
            rows = []
            for q in preview_qty:
                unit = tier_for(q, tiers)["unitPrice"]
                row = {
                    "Quantity": q,
                    "Unit price": f"${unit:,.2f}",
                    "Before design adjustment": f"${ao_base_charge + unit * q:,.2f}",
                }
                for di, d in enumerate(designs_state):
                    adj = d["adj"] * (q if d["adj_type"] == "perUnit" else 1)
                    row[f"{d['title'] or 'Design'} (#{di + 1})"] = f"${ao_base_charge + unit * q + adj:,.2f}"
                rows.append(row)
            st.dataframe(rows, hide_index=True)

    # 3 · Custom fields
    with tabs[2]:
        st.subheader("Custom fields")
        st.caption(
            "Extra information the customer types in when ordering, such as a return address. "
            "It is saved with the order but not printed on the card. Leave empty if the add-on needs none."
        )
        fields_df = st.data_editor(
            empty_custom_fields_df(),
            key="ao_custom_fields",
            num_rows="dynamic",
            hide_index=True,
            column_config={
                "id": st.column_config.TextColumn("Field ID", help="Letters, numbers, underscores, hyphens. Example: returnAddress"),
                "label": st.column_config.TextColumn("Label"),
                "required": st.column_config.CheckboxColumn("Required"),
                "placeholder": st.column_config.TextColumn("Placeholder"),
                "type": st.column_config.SelectboxColumn("Input type", options=["text", "textarea"]),
            },
        )
        custom_fields, custom_field_errors = parse_custom_fields(fields_df)
        for err in custom_field_errors:
            st.error(err)

    # 4 · Designs
    with tabs[3]:
        st.subheader("Designs")
        st.caption(
            "Each design is a choice the customer can pick. A design can have one or more pages. "
            "Files are copied into `templates/<add-on-id>/`."
        )

        design_action: tuple[str, int] | None = None

        for di, d in enumerate(designs_state):
            duid = d["uid"]
            with st.container(border=True):
                st.markdown(f"#### Design {di + 1}")
                r1, r2, r3 = st.columns([2, 2, 1])
                d["title"] = r1.text_input("Design title", value=d["title"], key=f"dtitle_{duid}")
                d["id"] = r2.text_input(
                    "Design ID (blank = generate)",
                    value=d["id"],
                    placeholder=f"{ao_id}-{slugify(d['title'], 'design')}",
                    key=f"did_{duid}",
                )
                d["active"] = r3.toggle("Active", value=d["active"], key=f"dactive_{duid}")

                s1, s2 = st.columns(2)
                type_keys = list(ADJUSTMENT_TYPES)
                d["adj_type"] = s1.selectbox(
                    "Design price adjustment",
                    type_keys,
                    index=type_keys.index(d["adj_type"]),
                    format_func=lambda k: ADJUSTMENT_TYPES[k],
                    key=f"dtype_{duid}",
                )
                d["adj"] = float(s2.number_input(
                    "Adjustment ($)", value=float(d["adj"]), step=0.05, format="%.2f", key=f"dadj_{duid}",
                    help="Added to the add-on total. Use a negative number for a discount.",
                ))

                st.markdown("**Pages**")
                render_pages_editor(d["pages"], f"design_{duid}", auto_name=True)

                m1, m2, m3, _ = st.columns([1, 1, 1, 5])
                if m1.button("↑ Move design up", key=f"dup_{duid}", disabled=di == 0):
                    design_action = ("up", di)
                if m2.button("↓ Move design down", key=f"ddown_{duid}", disabled=di == len(designs_state) - 1):
                    design_action = ("down", di)
                if m3.button("✕ Remove design", key=f"dremove_{duid}", disabled=len(designs_state) == 1):
                    design_action = ("remove", di)

        if design_action:
            kind_, index = design_action
            if kind_ == "up" and index > 0:
                designs_state[index - 1], designs_state[index] = designs_state[index], designs_state[index - 1]
            elif kind_ == "down" and index < len(designs_state) - 1:
                designs_state[index + 1], designs_state[index] = designs_state[index], designs_state[index + 1]
            elif kind_ == "remove" and len(designs_state) > 1:
                designs_state.pop(index)
            st.rerun()

        if st.button("＋ Add another design", key="ao_add_design"):
            designs_state.append(new_design(len(designs_state)))
            st.rerun()

    # 5 · Export
    with tabs[4]:
        st.subheader("Validate and export")

        errors: list[str] = []
        warnings: list[str] = []

        if not ao_title.strip():
            errors.append("Enter an add-on title.")
        if not ao_id or not ID_PATTERN.fullmatch(ao_id):
            errors.append("Add-on ID must use lowercase letters, numbers, and hyphens.")
        if availability == "Only specific invitations":
            if not ao_invitation_ids:
                errors.append("Enter at least one invitation ID, or choose All invitations.")
            for inv_id in ao_invitation_ids:
                if not ID_PATTERN.fullmatch(inv_id):
                    errors.append(f'Invitation ID "{inv_id}" must use lowercase letters, numbers, and hyphens.')
            if ao_invitation_ids:
                warnings.append(
                    "Restricted add-ons are written as a semicolon-separated list. Make sure Code.gs reads "
                    "availableInvitationIds that way, otherwise orders including this add-on will fail."
                )
        errors.extend(quantity_errors)
        errors.extend(tier_errors)
        errors.extend(custom_field_errors)

        design_records: list[dict[str, Any]] = []
        seen_design_ids: set[str] = set()
        seen_files: set[str] = set()
        all_pages: list[dict[str, Any]] = []
        files_to_copy: list[tuple[str, bytes]] = []

        for di, d in enumerate(designs_state):
            prefix = f"Design {di + 1} ({d['title'] or 'untitled'}), "
            design_id = d["id"].strip() or f"{ao_id}-{slugify(d['title'], 'design')}"

            if not d["title"].strip():
                errors.append(f"Design {di + 1}: enter a title.")
            if not ID_PATTERN.fullmatch(design_id):
                errors.append(f"{prefix}ID `{design_id}` must use lowercase letters, numbers, and hyphens.")
            if design_id in seen_design_ids:
                errors.append(f"{prefix}ID `{design_id}` is used by another design.")
            seen_design_ids.add(design_id)

            count = len(d["pages"])
            records = check_pages(
                d["pages"], ao_id, prefix, errors, seen_files,
                lambda i, p, did=design_id, n=count: addon_filename(p, did, n),
            )
            all_pages.extend(d["pages"])

            for page in d["pages"]:
                if page["upload"] is not None:
                    files_to_copy.append((addon_filename(page, design_id, count), page["upload"].getvalue()))

            # Negative totals at any allowed quantity
            if allowed and not tier_errors:
                for q in allowed:
                    unit = tier_for(q, tiers)["unitPrice"]
                    adj = d["adj"] * (q if d["adj_type"] == "perUnit" else 1)
                    if ao_base_charge + unit * q + adj < 0:
                        errors.append(f"{prefix}the total would be negative at quantity {q}. Reduce the discount.")
                        break

            design_records.append({
                "id": design_id,
                "title": d["title"].strip(),
                "active": d["active"],
                "pages": records,
                "type": d["adj_type"],
                "adj": d["adj"],
            })

        if not design_records:
            errors.append("Add at least one design.")
        elif not any(r["active"] for r in design_records):
            warnings.append("No design is active, so the storefront will hide this add-on.")

        field_summary = summarize_fields(all_pages, warnings)

        if errors:
            st.error("A few things need attention:")
            for err in errors:
                st.write(f"- {err}")
        else:
            st.success("Required fields look good.")

        if warnings:
            st.warning("Worth a look (these do not block export):")
            for w in warnings:
                st.write(f"- {w}")

        if not errors:
            show_field_summary(field_summary)

            available = ";".join(ao_invitation_ids) if availability == "Only specific invitations" else "*"
            addon_row = [
                ao_id,
                ao_title.strip(),
                ao_description.strip().replace("\t", " "),
                "TRUE" if ao_active else "FALSE",
                available,
                qty_min,
                qty_max,
                qty_step,
                qty_default,
                f"{ao_base_charge:.2f}",
                json_cell(tiers),
                int(ao_sort),
                json_cell(custom_fields),
            ]
            assert len(addon_row) == len(ADDON_HEADERS)

            design_rows = [
                [
                    r["id"],
                    ao_id,
                    r["title"],
                    "TRUE" if r["active"] else "FALSE",
                    json_cell(r["pages"]),
                    r["type"],
                    f"{r['adj']:.2f}",
                    index + 1,
                ]
                for index, r in enumerate(design_records)
            ]
            assert all(len(row) == len(ADDON_DESIGN_HEADERS) for row in design_rows)

            st.markdown("**1. Copy this row into the next empty row of your `AddOns` sheet**")
            st.caption("Your sheet's header row must be in this order:")
            st.code(", ".join(ADDON_HEADERS), language="text")
            st.code(delimited_line(addon_row, "\t"), language="text")
            st.download_button(
                "Download AddOns row as CSV (with headers)",
                data=delimited_line(ADDON_HEADERS) + "\n" + delimited_line(addon_row) + "\n",
                file_name=f"addon-{ao_id}.csv",
                mime="text/csv",
                key="ao_download_addon",
            )

            st.markdown("**2. Copy these rows into the next empty rows of your `AddOnDesigns` sheet**")
            st.caption(f"One row per design ({len(design_rows)}). Header order:")
            st.code(", ".join(ADDON_DESIGN_HEADERS), language="text")
            st.code("\n".join(delimited_line(row, "\t") for row in design_rows), language="text")
            st.download_button(
                "Download AddOnDesigns rows as CSV (with headers)",
                data=delimited_line(ADDON_DESIGN_HEADERS) + "\n"
                + "\n".join(delimited_line(row) for row in design_rows) + "\n",
                file_name=f"addon-designs-{ao_id}.csv",
                mime="text/csv",
                key="ao_download_designs",
            )

            st.divider()
            st.markdown("**3. Copy template files**")
            copy_files_ui(project_root_text, ao_id, files_to_copy, "addon")


# ------------------------------------------------------------
# Layout
# ------------------------------------------------------------

st.title("✉️ Invitation Template Manager")

with st.sidebar:
    st.header("Storefront folder")
    project_root_text = st.text_input(
        "Path to your storefront project",
        placeholder=r"C:\Users\You\Projects\invitation-storefront",
        help="The folder containing index.html, assets/, and templates/. The app will create template folders here.",
    )
    st.info("This tool runs locally. Uploaded files are copied only to the folder you specify.")

mode_tabs = st.tabs(["✉️ Invitation", "➕ Add-on"])

with mode_tabs[0]:
    invitation_ui(project_root_text)

with mode_tabs[1]:
    addon_ui(project_root_text)

st.divider()
st.caption(
    "The manager does not connect to Google Sheets. It only generates rows and, when you choose, "
    "copies uploaded template files into your local storefront project."
)
