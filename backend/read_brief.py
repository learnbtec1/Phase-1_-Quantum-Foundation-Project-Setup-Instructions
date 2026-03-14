import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.services.file_extractor import extract_text_from_file

brief_path = r'd:\OneDrive\Desktop\Marj Alhamam secondary..ID 96294 -L3-Y2\Official Assessment  BUS - L3 - Y2 U14 - Part 1\Official Assessment  BUS - L3 - Y2 U14 - Part 1\ARABIC_BTEC_IV_of_Assignment-Brief_ BUS - L3-UNIT 14 - PART 1.docx'
with open(brief_path, 'rb') as f:
    data = f.read()
text = extract_text_from_file(os.path.basename(brief_path), data)
with open('tmp_brief.txt', 'w', encoding='utf-8') as f:
    f.write(text)
print(f"Brief: {len(text):,} chars")
print(text[:3000])
