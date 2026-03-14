import requests, json

payload = {
    "assignment_text": "Unit 9 Marketing Research and Planning\nP1: Describe the principles of marketing and their applications.\nP2: Describe primary and secondary research methods.\nM1: Analyze the factors that influence marketing in a specific organisation.\nD1: Evaluate the effectiveness of marketing in meeting business objectives.",
    "student_text": "Marketing is the process of identifying customer needs. The four principles of marketing: product, price, place, promotion. In Apple company strategy relies on differentiation. Primary research methods include surveys and interviews, secondary include reports and books. Marketing is influenced by external factors such as economy and technology. Achieving objectives requires continuous measurement of campaign effectiveness and return on investment. Deep analysis reveals gaps in strategy and opens development opportunities. When comparing with competitors Apple superiority in digital marketing is clear. Market segmentation is critical for targeting the right customers with the right message."
}

try:
    resp = requests.post("http://127.0.0.1:8000/api/v1/assessment/forensic-grade-v3", json=payload, timeout=120)
    print("Backend Status:", resp.status_code)
    print("Content-Type:", resp.headers.get("content-type"))
    raw = resp.text
    print("Raw response (first 1000 chars):", raw[:1000])
    try:
        data = json.loads(raw)
        print("\nParsed OK!")
        print("Keys:", list(data.keys()))
        print("final_grade:", data.get("final_grade"))
        print("summary:", str(data.get("summary",""))[:200])
    except Exception as pe:
        print("JSON Parse Error:", pe)
except Exception as e:
    print("ERROR:", e)
