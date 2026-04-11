# Shared Memory — GPT + Sonnet

This folder is the persistent collaboration memory between GPT and Sonnet.

Structure:
- gpt/      : GPT notes and execution summaries
- sonnet/   : Sonnet notes and execution summaries
- shared/   : common plans, handoff docs, lock files
- scripts/  : automation scripts (read/write/index/archive)
- archive/  : compressed archived sessions

Rules:
1) Always read latest files before writing.
2) Append only, do not overwrite unless explicitly requested.
3) Keep one summary file per day in each agent folder.
4) Use scripts/memory-manage.ps1 after heavy updates.
5) Hard cap: 10 GB for this memory folder.
