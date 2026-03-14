import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.services.file_extractor import extract_text_from_file

paths = [
    r'd:\OneDrive\Desktop\Marj Alhamam secondary..ID 96294 -L3-Y2\ALL\YOUSEF DIGHAISH-D\yousef customer service (1) albank (1).docx',
    r'd:\OneDrive\Desktop\Marj Alhamam secondary..ID 96294 -L3-Y2\ALL\YOUSEF DIGHAISH-D\Customer Service (1) alhkma (1).docx',
]
outputs = ['tmp_albank.txt', 'tmp_alhkma.txt']

for path, out in zip(paths, outputs):
    try:
        with open(path, 'rb') as f:
            data = f.read()
        fname = os.path.basename(path)
        text = extract_text_from_file(fname, data)
        with open(out, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f"OK: {out} ({len(text):,} chars)")
        print("FIRST500:", text[:500])
        print("---")
    except Exception as e:
        import traceback
        print(f"ERROR reading {path}: {e}")
        traceback.print_exc()
