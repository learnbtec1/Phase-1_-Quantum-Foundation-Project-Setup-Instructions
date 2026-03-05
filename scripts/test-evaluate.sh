#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${1:-http://localhost:3000}

echo "== Valid request =="
curl -s -X POST "$BASE_URL/api/evaluate" -H "content-type: application/json" -d '{
  "assignmentId":"A-1","studentId":"S-1",
  "studentAnswer":"الطالب صنّف العملاء إلى شرائح بحسب العمر والدخل وقدم أمثلة.",
  "assignmentContext":"BTEC L3 Unit 1",
  "rubric":{"rubricId":"R-1","version":"v1","unit":"U1","criteria":[
    {"code":"P1","title":"تعريف الشرائح","description":"تعريف واضح"},
    {"code":"M1","title":"تحليل معمق","description":"تحليل يشرح الأسباب"},
    {"code":"D1","title":"تقييم","description":"تقييم نقدي ومقارنة"}
  ]}}
' | tee /tmp/eval_valid.json

echo -e "\n== Missing field (expect 422) =="
curl -s -o /tmp/eval_422.json -w "%{http_code}\n" -X POST "$BASE_URL/api/evaluate" -H "content-type: application/json" -d '{
  "assignmentId":"A-1","studentId":"S-1",
  "assignmentContext":"BTEC L3 Unit 1",
  "rubric":{"rubricId":"R-1","version":"v1","unit":"U1","criteria":[
    {"code":"P1","title":"تعريف الشرائح","description":"تعريف واضح"}
  ]}
}'

echo -e "\n== Oversized answer (expect 422) =="
BIG=$(python - <<'PY'
print("A"*60000)
PY
)
curl -s -o /tmp/eval_big.json -w "%{http_code}\n" -X POST "$BASE_URL/api/evaluate" -H "content-type: application/json" -d "{
  \"assignmentId\":\"A-1\",\"studentId\":\"S-1\",
  \"studentAnswer\":\"$BIG\",
  \"rubric\":{\"rubricId\":\"R-1\",\"version\":\"v1\",\"unit\":\"U1\",\"criteria\":[
    {\"code\":\"P1\",\"title\":\"تعريف الشرائح\",\"description\":\"تعريف واضح\"}
  ]}
}"
echo -e "\nArtifacts: /tmp/eval_valid.json /tmp/eval_422.json /tmp/eval_big.json"