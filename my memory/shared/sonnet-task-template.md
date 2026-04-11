# Sonnet Task Prompt Template

Use this exact protocol:

1) Read latest memory files first:
- my memory/shared/index.md
- my memory/shared/handoff.md
- my memory/gpt/GPT-0001.md
- my memory/sonnet/SONNET-0001.md

2) Execute requested coding task with minimal safe diffs.

3) Write execution report to:
- my memory/sonnet/SONNET-0001.md (append only)

4) Report must include:
- Files changed
- Validation outputs (tsc/lint/runtime)
- Risks
- Next recommended step

5) After writing report run:
- powershell -ExecutionPolicy Bypass -File "my memory/scripts/memory-manage.ps1" -MaxGB 10
