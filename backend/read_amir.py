import docx
path = r"D:\OneDrive\Desktop\Marj Alhamam secondary..ID 96294 -L3-Y2\ALL\AMIR ALHERBAWI\خدمه عملاء تعديل2.docx"
doc = docx.Document(path)
text = '\n'.join([p.text for p in doc.paragraphs if p.text.strip()])
print(repr(text[:12000]))
