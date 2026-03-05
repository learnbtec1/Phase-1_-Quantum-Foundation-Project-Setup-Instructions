import json
import time
import urllib.error
import urllib.request

URL = "http://localhost:8000/api/v1/assessment/grade"
RETRY_SECONDS = 5

payload = {
    "unit_id": "1",
    "assignment_text": "ASSIGNMENT BRIEF: Explain at least two business factors and reference P1 and M1 criteria.",
    "student_text": "The business analysis explains market and customer factors with evidence for P1 and M1."
}


def is_valid_ai_response(data: dict) -> bool:
    if not isinstance(data, dict):
        return False
    if data.get("final_grade"):
        return True
    criteria = data.get("criteria")
    return isinstance(criteria, dict) and len(criteria) > 0


attempt = 1
print("Starting verification loop for 422 fix...")
print(f"Target: {URL}")
print(f"Retry interval: {RETRY_SECONDS}s")

while True:
    try:
        req = urllib.request.Request(
            URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            status = resp.getcode()
            body = resp.read().decode("utf-8", errors="replace")

        parsed = {}
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            pass

        if status == 200 or is_valid_ai_response(parsed):
            print(f"[Attempt {attempt}] SUCCESS")
            print(f"HTTP {status}")
            print("Response:")
            print(body)
            break

        print(f"[Attempt {attempt}] Received HTTP {status} without valid AI response. Retrying in {RETRY_SECONDS}s...")

    except urllib.error.HTTPError as err:
        details = err.read().decode("utf-8", errors="replace") if err.fp else ""
        print(f"[Attempt {attempt}] HTTPError {err.code}: {details}")
    except Exception as err:
        print(f"[Attempt {attempt}] Error: {err}")

    attempt += 1
    time.sleep(RETRY_SECONDS)
