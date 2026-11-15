from __future__ import annotations

import csv
import io
import json
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import streamlit as st

st.set_page_config(page_title="Invitation Template Manager", page_icon="✉️", layout="wide")

DEFAULT_OPTIONS = {
    "occasions": ["Wedding", "Bar Mitzvah", "Birthday", "Anniversary", "Bris", "Kiddush"],
    "styles": ["Modern", "Traditional", "Classic", "Elegant", "Minimalist", "Floral"],
    "formats": ["Flat 5x7", "Flat 4x6", "Folded 5x7"],
    "papers": ["Smooth Matte", "Cotton", "Linen"],
    "fonts": ["Cormorant", "Garamond", "DM Sans"],
    "colors": ["Navy", "Sage", "Terracotta", "Burgundy"],
}

CSV_HEADERS = [
    "id", "title", "description", "active", "occasion", "style", "pages",
    "formats", "papers", "fonts", "colors", "designOptions", "basePrice",
    "formatAdjustments", "paperAdjustments", "customizationFees", "quantityMinimum",
]

def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "new-invitation"

def json_cell(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

def csv_line(values: list[Any]) -> str:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="").writerow(values)
    return buf.getvalue()

def parse_svg_fields(data: bytes) -> list[dict[str, str]]:
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return []
    found = []
    for el in root.iter():
        field_id = el.attrib.get("data-field")
        if field_id:
            found.append({
                "id": field_id,
                "label": el.attrib.get("data-label", ""),
                "required": el.attrib.get("data-required", "").lower() == "true",
                "multiline": el.attrib.get("data-multiline", "").lower() == "true",
                "maxlength": el.attrib.get("data-maxlength", ""),
            })
    return found

def parse_values(raw: str) -> list[str]:
    return list(dict.fromkeys(x.strip() for x in raw.split(",") if x.strip()))

def parse_adjustments(raw: str, values: list[str], label: str) -> dict[str, float]:
    result = {}
    for value in values:
        key = f"{label}_{slugify(value)}"
        amount = st.number_input(
            f"{value} adjustment ($)",
            key=key,
            value=0.0,
            step=0.05,
            format="%.2f",
        )
        result[value] = round(float(amount), 2)
    return result

if "page_count" not in st.session_state:
    st.session_state.page_count = 1
if "pages" not in st.session_state:
    st.session_state.pages = [{"label": "Front", "filename": "front.svg", "upload": None}]

st.title("✉️ Invitation Template Manager")
st.caption("Prepare SVG templates, organize their files, configure storefront options, and generate a CSV row for your Invitations sheet.")

with st.sidebar:
    st.header("Storefront folder")
    project_root_text = st.text_input(
        "Path to your storefront project",
        placeholder=r"C:\Users\You\Projects\invitation-storefront",
        help="The folder containing index.html, assets/, and templates/. The app will create templates/<invitation-id>/ here.",
    )
    st.info("This tool runs locally. Uploaded SVGs are copied only to the folder you specify.")

tabs = st.tabs(["1 · Details", "2 · SVG pages", "3 · Options", "4 · Pricing", "5 · Export"])

with tabs[0]:
    st.subheader("Invitation details")
    c1, c2 = st.columns(2)
    with c1:
        title = st.text_input("Invitation title", placeholder="The Classic Arch")
        generated_id = slugify(title)
        invitation_id = st.text_input("Invitation ID", value=generated_id, help="Lowercase letters, numbers, and hyphens. This becomes the folder name.")
        description = st.text_area("Description", placeholder="A timeless formal invitation with...")
    with c2:
        active = st.toggle("Active in storefront", value=True)
        st.markdown("**Occasions**")
        occasions_raw = st.text_input("Occasions (comma-separated)", value=", ".join(DEFAULT_OPTIONS["occasions"]))
        st.markdown("**Styles**")
        styles_raw = st.text_input("Styles (comma-separated)", value=", ".join(DEFAULT_OPTIONS["styles"]))
    occasions = parse_values(occasions_raw)
    styles = parse_values(styles_raw)
    if invitation_id and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", invitation_id):
        st.error("Use only lowercase letters, numbers, and single hyphens in the ID.")

with tabs[1]:
    st.subheader("SVG pages")
    st.write("Add the SVG files in the order customers should see them. Files will be copied into `templates/<invitation-id>/`.")
    for i in range(st.session_state.page_count):
        if i >= len(st.session_state.pages):
            st.session_state.pages.append({"label": f"Page {i+1}", "filename": f"page-{i+1}.svg", "upload": None})
        page = st.session_state.pages[i]
        with st.container(border=True):
            h1, h2, h3 = st.columns([1, 2, 3])
            h1.markdown(f"**Page {i+1}**")
            page["label"] = h2.text_input("Page label", value=page.get("label", ""), key=f"label_{i}")
            page["filename"] = h3.text_input("Filename in template folder", value=page.get("filename", f"page-{i+1}.svg"), key=f"filename_{i}")
            page["upload"] = st.file_uploader("Choose SVG file", type=["svg"], key=f"upload_{i}")
            if page["upload"] is not None:
                data = page["upload"].getvalue()
                fields = parse_svg_fields(data)
                st.caption(f"{len(fields)} editable field occurrence(s) detected.")
                if fields:
                    st.dataframe(fields, use_container_width=True, hide_index=True)
                else:
                    st.warning("No data-field attributes found (or the SVG could not be parsed). This is okay if the page has no editable text.")
                with st.expander("Preview SVG"):
                    # SVG uploads are treated as trusted design files and previewed locally.
                    svg_text = data.decode("utf-8", errors="replace")
                    st.components.v1.html(svg_text, height=500, scrolling=True)
    b1, b2 = st.columns(2)
    if b1.button("＋ Add another page", use_container_width=True):
        st.session_state.page_count += 1
        st.session_state.pages.append({"label": f"Page {st.session_state.page_count}", "filename": f"page-{st.session_state.page_count}.svg", "upload": None})
        st.rerun()
    if st.session_state.page_count > 1 and b2.button("− Remove last page", use_container_width=True):
        st.session_state.page_count -= 1
        st.session_state.pages = st.session_state.pages[:st.session_state.page_count]
        st.rerun()

with tabs[2]:
    st.subheader("Customer choices")
    st.caption("Enter comma-separated choices. These values are stored in the invitation row, so they do not need to exist in the Options tab first.")
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

with tabs[3]:
    st.subheader("Pricing")
    p1, p2 = st.columns(2)
    with p1:
        base_price = st.number_input("Base price per invitation ($)", min_value=0.0, value=1.85, step=0.05, format="%.2f")
        min_quantity = st.number_input("Minimum order quantity", min_value=1, value=25, step=1)
    with p2:
        st.markdown("**Format price adjustments**")
        format_adjustments = parse_adjustments(formats_raw, formats, "format_adj")
    st.markdown("**Paper price adjustments**")
    paper_adjustments = parse_adjustments(papers_raw, papers, "paper_adj")
    st.markdown("**Additional customization fees**")
    fee_keys_raw = st.text_input("Fee names (comma-separated)", value="")
    fee_names = parse_values(fee_keys_raw)
    customization_fees = {}
    if fee_names:
        fee_cols = st.columns(min(3, len(fee_names)))
        for i, fee in enumerate(fee_names):
            with fee_cols[i % len(fee_cols)]:
                customization_fees[fee] = round(float(st.number_input(f"{fee} fee ($)", min_value=0.0, value=0.0, step=0.05, format="%.2f", key=f"fee_{slugify(fee)}")), 2)

with tabs[4]:
    st.subheader("Validate and export")
    page_errors = []
    page_records = []
    for i, page in enumerate(st.session_state.pages):
        filename = (page.get("filename") or "").strip()
        upload = page.get("upload")
        if not page.get("label", "").strip():
            page_errors.append(f"Page {i+1}: enter a page label.")
        if not filename.lower().endswith(".svg"):
            page_errors.append(f"Page {i+1}: filename must end in .svg.")
        if "/" in filename or "\\" in filename or filename in ("", ".", ".."):
            page_errors.append(f"Page {i+1}: use a filename only, not a path.")
        if upload is None:
            page_errors.append(f"Page {i+1}: upload an SVG file.")
        page_records.append({
            "label": page.get("label", "").strip(),
            "file": f"templates/{invitation_id}/{filename}",
            "type": "svg",
        })

    if not title.strip():
        page_errors.append("Enter an invitation title.")
    if not invitation_id or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", invitation_id):
        page_errors.append("Invitation ID must use lowercase letters, numbers, and hyphens.")
    if not occasions:
        page_errors.append("Add at least one occasion.")
    if not styles:
        page_errors.append("Add at least one style.")
    if not page_records:
        page_errors.append("Add at least one page.")
    if not formats or not papers:
        page_errors.append("Add at least one format and one paper type.")

    if page_errors:
        st.error("A few things need attention:")
        for err in page_errors:
            st.write(f"- {err}")
    else:
        st.success("Required fields look good.")
        row_values = [
            invitation_id,
            title.strip(),
            description.strip(),
            "TRUE" if active else "FALSE",
            ";".join(occasions),
            ";".join(styles),
            json_cell(page_records),
            json_cell(formats),
            json_cell(papers),
            json_cell(fonts),
            json_cell(colors),
            json_cell(designs),
            f"{base_price:.2f}",
            json_cell(format_adjustments),
            json_cell(paper_adjustments),
            json_cell(customization_fees),
            str(int(min_quantity)),
        ]
        output_line = csv_line(row_values)
        st.markdown("**Copy this complete row into the next empty row of your `Invitations` sheet:**")
        st.code(output_line, language="text")
        st.download_button(
            "Download this row as CSV",
            data=csv_line(CSV_HEADERS) + "\n" + output_line + "\n",
            file_name=f"{invitation_id}.csv",
            mime="text/csv",
            use_container_width=True,
        )

        st.divider()
        st.markdown("**Copy SVGs into your storefront**")
        root = Path(project_root_text).expanduser() if project_root_text.strip() else None
        if root is None:
            st.warning("Enter your storefront project folder in the sidebar to enable file copying.")
        else:
            st.write(f"Destination: `{root / 'templates' / invitation_id}`")
            if st.button("📁 Copy SVGs into storefront folder", type="primary", use_container_width=True):
                try:
                    if not root.exists() or not root.is_dir():
                        raise FileNotFoundError("The storefront folder does not exist. Check the path.")
                    target = root / "templates" / invitation_id
                    target.mkdir(parents=True, exist_ok=True)
                    copied = []
                    for page in st.session_state.pages:
                        upload = page["upload"]
                        filename = page["filename"].strip()
                        destination = target / filename
                        destination.write_bytes(upload.getvalue())
                        copied.append(filename)
                    st.success(f"Copied {len(copied)} SVG file(s) to {target}")
                    st.write("Files copied:")
                    for name in copied:
                        st.write(f"- `{name}`")
                except Exception as exc:
                    st.error(f"Could not copy files: {exc}")

st.divider()
st.caption("The manager does not connect to Google Sheets. It only generates a CSV row and, when you choose, copies uploaded SVG files into your local storefront project.")
