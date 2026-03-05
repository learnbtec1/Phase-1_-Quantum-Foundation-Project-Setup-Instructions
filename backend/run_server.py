import sys
import subprocess
import os

# Change to backend directory
backend_dir = r"e:\Phase 1_ Quantum Foundation Project Setup Instructions\backend"
os.chdir(backend_dir)

# Install dependencies
print("[*] Installing dependencies...")
subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", 
                "fastapi", "uvicorn", "pydantic", "python-multipart", 
                "python-dotenv", "anthropic", "httpx", "rapidfuzz"], check=False)

# Run the server
print("[*] Starting FastAPI server on http://127.0.0.1:8000")
print("[*] API Documentation: http://127.0.0.1:8000/docs")
print("[*] Press Ctrl+C to stop the server\n")

subprocess.run([sys.executable, "-m", "uvicorn", "app.main:app", 
                "--host", "127.0.0.1", "--port", "8000", "--reload"])
