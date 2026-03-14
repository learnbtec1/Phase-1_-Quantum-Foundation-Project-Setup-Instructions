import requests, json

payload = {
    "assignment_text": "Unit 9 Marketing Research and Planning\nP1: Describe the principles of marketing and their applications.\nP2: Describe primary and secondary research methods.\nM1: Analyze the factors that influence marketing in a specific organisation.\nD1: Evaluate the effectiveness of marketing in meeting business objectives.",
    "student_text": "Marketing is the process of identifying customer needs. The four principles of marketing: product, price, place, promotion. In Apple company strategy relies on differentiation. Primary research methods include surveys and interviews, secondary include reports and books. Marketing is influenced by external factors such as economy and technology. Achieving objectives requires continuous measurement of campaign effectiveness and return on investment. Deep analysis reveals gaps in strategy and opens development opportunities. When comparing with competitors Apple superiority in digital marketing is clear. Market segmentation is critical for targeting the right customers with the right message."
}

try:
    resp = requests.post("http://localhost:3011/api/evaluate", json=payload, timeout=300)
    print("Status:", resp.status_code)
    data = resp.json()
    print("Keys:", list(data.keys()))
    print("final_grade:", data.get("data", {}).get("final_grade"))
    print("report:", str(data.get("report", ""))[:300])
    criteria = data.get("data", {}).get("criteria", [])
    print("criteria count:", len(criteria))
    if criteria:
        print("First criterion:", json.dumps(criteria[0], ensure_ascii=False, indent=2)[:500])
except Exception as e:
    print("ERROR:", e)
