"""Extract PDF text and table cells without discarding row/column structure.

The Node server owns electrical-spec interpretation. This helper only returns
source evidence: page text plus tables with their original cell boundaries.
"""
import json
import sys


def clean(value):
    if value is None:
        return ""
    return " ".join(str(value).split())


def main(pdf_path):
    import pdfplumber

    pages = []
    tables = []
    with pdfplumber.open(pdf_path) as document:
        for page_number, page in enumerate(document.pages, start=1):
            pages.append(page.extract_text(layout=True) or "")
            for table_number, table in enumerate(page.extract_tables(), start=1):
                rows = [[clean(cell) for cell in row] for row in table if row]
                if rows:
                    tables.append({"page": page_number, "table": table_number, "rows": rows})
    print(json.dumps({"text": "\n".join(pages), "tables": tables}, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: datasheet_pdf_extract.py input.pdf")
    main(sys.argv[1])
