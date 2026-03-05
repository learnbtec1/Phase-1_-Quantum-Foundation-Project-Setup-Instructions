# app/services/plagiarism_guard.py
import os
import json
import asyncio
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

class PlagiarismGuard:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.client = AsyncOpenAI(api_key=self.api_key) if self.api_key else None

    async def evaluate(self, text: str) -> dict:
        if not text or len(text.strip()) < 20: 
            return {"score": 0.0, "detail": "النص قصير جداً", "findings": {}}
        
        if not self.client:
            return {"score": 0.0, "detail": "تم التجاوز لعدم وجود مفتاح API", "findings": {}}
        
        system_prompt = """
        أنت خبير في كشف الاستلال. افحص النص وأخرج JSON:
        {"score": 0.0 to 1.0, "detail": "سبب الاشتباه", "findings": {"ai_probability": 0.0}}
        """
        try:
            async def _fetch():
                resp = await self.client.chat.completions.create(
                    model="gpt-4o-mini", temperature=0.0, response_format={"type": "json_object"},
                    messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": text[:3000]}],
                    timeout=10
                )
                return json.loads(resp.choices[0].message.content)
            
            return await asyncio.wait_for(_fetch(), timeout=12)
        except Exception:
            return {"score": 0.0, "detail": "تم التجاوز للحفاظ على سرعة النظام", "findings": {}}