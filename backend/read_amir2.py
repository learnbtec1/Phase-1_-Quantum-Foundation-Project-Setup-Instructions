import docx

# Read assignment brief
brief_path = r"D:\OneDrive\Desktop\Marj Alhamam secondary..ID 96294 -L3-Y2\ALL\L3 BUS U14 AAB Learning Aim AB V02 Jun-24 (Arabic).docx"
doc_brief = docx.Document(brief_path)
brief_text = '\n'.join([p.text for p in doc_brief.paragraphs if p.text.strip()])
print("=== ASSIGNMENT BRIEF ===")
print(brief_text[:8000])

# Read Amir's answer
amir_path = r"D:\OneDrive\Desktop\Marj Alhamam secondary..ID 96294 -L3-Y2\ALL\AMIR ALHERBAWI\خدمه عملاء تعديل2.docx"
doc_amir = docx.Document(amir_path)
amir_text = '\n'.join([p.text for p in doc_amir.paragraphs if p.text.strip()])
print("\n=== AMIR P2 SECTION ===")
# Find P2 section
p2_start = amir_text.find('P2')
if p2_start >= 0:
    print(amir_text[p2_start:p2_start+6000])
else:
    print("P2 not found - showing full text")
    print(amir_text[:6000])
