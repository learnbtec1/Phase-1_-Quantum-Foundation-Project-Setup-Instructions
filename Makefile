# TTS / backend load testing helpers (Unix: bash + Python).
# Windows: use Git Bash, WSL, or run the Python commands directly.

.PHONY: test test-light test-heavy loadtest-install monitor

PYTHON ?= python

loadtest-install:
	$(PYTHON) -m pip install -r scripts/requirements-loadtest.txt

test:
	bash scripts/run_tests.sh

test-light:
	$(PYTHON) scripts/load_test_tts.py --concurrency 10 --requests 50

test-heavy:
	$(PYTHON) -m locust -f scripts/locustfile.py --headless -u 50 -r 10 --run-time 2m --host http://localhost:8000

monitor:
	bash scripts/monitor.sh
