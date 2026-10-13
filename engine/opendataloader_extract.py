"""Normalize OpenDataLoader PDF output for the FUSION datasheet pipeline.

The upstream project deliberately owns layout/OCR/vision work.  This adapter
does not interpret electrical values: it retains page, bounding-box, heading,
table, caption and image provenance so Node can build a verifiable spec ledger.
"""
import json
import os
import sys


def text_of(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split())
    if isinstance(value, list):
        return " ".join(filter(None, (text_of(item) for item in value)))
    if isinstance(value, dict):
        for key in ("text", "content", "value", "label", "description"):
            if key in value:
                return text_of(value[key])
    return ""


def page_of(node, inherited=None):
    for key in ("page", "page_number", "pageNumber", "page_index", "pageIndex"):
        value = node.get(key)
        if isinstance(value, (int, float)):
            return int(value)
    return inherited


def bbox_of(node):
    for key in ("bbox", "bounding_box", "boundingBox", "bounds"):
        value = node.get(key)
        if isinstance(value, (list, tuple)) and len(value) >= 4:
            return list(value[:4])
    return None


def rows_of(node):
    rows = node.get("rows") or node.get("table_rows") or node.get("tableRows")
    if not isinstance(rows, list):
        return []
    result = []
    for row in rows:
        cells = row.get("cells") if isinstance(row, dict) else row
        if isinstance(cells, list):
            result.append([text_of(cell) for cell in cells])
    return [row for row in result if any(row)]


def walk(node, blocks, tables, visuals, inherited_page=None, inherited_heading=""):
    if isinstance(node, list):
        for item in node:
            walk(item, blocks, tables, visuals, inherited_page, inherited_heading)
        return
    if not isinstance(node, dict):
        return
    page = page_of(node, inherited_page)
    node_type = str(node.get("type") or node.get("kind") or node.get("node_type") or "").lower()
    text = text_of(node)
    heading = inherited_heading
    if any(marker in node_type for marker in ("heading", "title", "section")) and text:
        heading = text
    common = {"page": page, "bbox": bbox_of(node), "heading": heading}
    rows = rows_of(node)
    if "table" in node_type or rows:
        tables.append({**common, "rows": rows, "caption": text if text and not rows else ""})
    elif text and node_type not in ("document", "root", "metadata"):
        blocks.append({**common, "type": node_type or "text", "text": text})
    if any(marker in node_type for marker in ("image", "figure", "chart", "picture")):
        visuals.append({**common, "type": node_type, "description": text})
    for key in ("kids", "children", "elements", "content", "blocks", "items", "pages"):
        child = node.get(key)
        if isinstance(child, (list, dict)) and child is not node:
            walk(child, blocks, tables, visuals, page, heading)


def newest(path, suffix):
    found = []
    for root, _, files in os.walk(path):
        for name in files:
            if name.lower().endswith(suffix):
                found.append(os.path.join(root, name))
    return max(found, key=os.path.getmtime) if found else None


def main(source, output_dir):
    import opendataloader_pdf

    os.makedirs(output_dir, exist_ok=True)
    # The Python API is intentionally used so Docker and local installs share
    # one contract. Hybrid routing is configured upstream when requested.
    opendataloader_pdf.convert(input_path=source, output_dir=output_dir, format="json,markdown")
    json_file = newest(output_dir, ".json")
    markdown_file = newest(output_dir, ".md")
    if not json_file:
        raise RuntimeError("OpenDataLoader produced no JSON output")
    with open(json_file, "r", encoding="utf-8") as handle:
        document = json.load(handle)
    blocks, tables, visuals = [], [], []
    walk(document, blocks, tables, visuals)
    markdown = ""
    if markdown_file:
        with open(markdown_file, "r", encoding="utf-8", errors="replace") as handle:
            markdown = handle.read()
    text = "\n".join(block["text"] for block in blocks if block.get("text")) or markdown
    print(json.dumps({
        "text": text,
        "blocks": blocks[:4000],
        "tables": tables[:400],
        "visuals": visuals[:1000],
        "engine": "opendataloader"
    }, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: opendataloader_extract.py input.pdf output-dir")
    main(sys.argv[1], sys.argv[2])
