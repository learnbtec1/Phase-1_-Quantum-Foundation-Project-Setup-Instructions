import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.services.file_extractor import extract_text_from_file

aab_path = r'd:\OneDrive\Desktop\Marj Alhamam secondary..ID 96294 -L3-Y2\Official Assessment  BUS - L3 - Y2 U14 - Part 1\Official Assessment  BUS - L3 - Y2 U14 - Part 1\L3 BUS U14 AAB Learning Aim AB V02 Jun-24 (Arabic).docx'
with open(aab_path, 'rb') as f:
    data = f.read()
text = extract_text_from_file(os.path.basename(aab_path), data)
with open('tmp_aab.txt', 'w', encoding='utf-8') as f:
    f.write(text)
print(f"AAB: {len(text):,} chars")
print(text)
