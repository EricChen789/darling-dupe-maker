"""
Split NAR1 27-page template into 8 separate files for cloud R2 upload.
Run: python _split_nar1_template.py
"""
import fitz
from pathlib import Path

TEMPLATE = Path("public/templates/NAR1-template-new.pdf")
OUTPUT = Path(".")

# Page ranges for each template (0-indexed)
PARTS = {
    "NAR1_part1_pages1-8.pdf": (0, 8),   # Pages 1-8
    "NAR1_p9_v2.pdf": (8, 9),             # Page 9
    "NAR1_p10_v2.pdf": (9, 10),           # Page 10
    "NAR1_p11_v2.pdf": (10, 11),          # Page 11
    "NAR1_p12_v2.pdf": (11, 12),          # Page 12
    "NAR1_p13_v2.pdf": (12, 13),          # Page 13
    "NAR1_p14_v2.pdf": (13, 14),          # Page 14
    "NAR1_p15_v2.pdf": (14, 15),          # Page 15
}

def main():
    doc = fitz.open(str(TEMPLATE))
    print(f"Opened: {TEMPLATE} ({len(doc)} pages)")

    for filename, (start, end) in PARTS.items():
        new_doc = fitz.open()
        for i in range(start, min(end, len(doc))):
            new_doc.insert_pdf(doc, from_page=i, to_page=i)

        path = OUTPUT / filename
        new_doc.save(str(path), deflate=True)
        new_doc.close()
        print(f"  {filename}: pages {start+1}-{end} ({path.stat().st_size} bytes)")

    doc.close()
    print("\nDone! Upload with:")
    for filename in PARTS:
        print(f"  npx wrangler r2 object put pdf-templates/{filename} --file={filename}")

if __name__ == "__main__":
    main()
