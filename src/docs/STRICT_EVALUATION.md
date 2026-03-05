# Strict Evaluation (التقييم الصارم)

## Overview

The strict evaluation screen is available at `/strict-evaluation`.
It performs rubric-based evaluation on the client with optional strict enforcement.

## How to Enable Strict Mode

- Open `/strict-evaluation`.
- Toggle **وضع صارم** to `ON`.
- In strict mode, a criterion is achieved only when all required keywords are matched.
- If a criterion has `allowPartialCredit: false`, partial keyword matching is not accepted.

## Rubric Format
Import a JSON file with this shape:

```json
{
  "rubricId": "BTEC_STRICT_U1",
  "version": "1.0",
  "title": "BTEC Strict Evaluation Rubric",
  "criteria": [
    {
      "code": "P1",
      "level": "Pass",
      "description": "Explain core concepts",
      "keywords": ["business", "analysis"],
      "allowPartialCredit": true
    }
  ]
}
```

## Evaluation Rules

- **Strict ON**: all keywords must be present for each criterion.
- **Strict OFF**: criterion passes when at least 60% of keywords are matched.
- **No partial credit criteria**: if `allowPartialCredit` is `false`, score is either `0` or `100`.

## Examples

- If the answer includes all keywords for `M1`, then `M1` is achieved.
- If strict mode is ON and one keyword is missing, criterion result is `Not Achieved`.

## Notes

- This flow does not change existing API contracts.
- It is safe to use without backend availability.
