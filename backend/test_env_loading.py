from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

# Print the OPENAI_API_KEY
print(f"OPENAI_API_KEY={os.getenv('OPENAI_API_KEY')}")