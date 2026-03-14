"""Quick WS connectivity test."""
import asyncio
import sys

async def test_ws():
    try:
        import websockets
        print("Testing ws://127.0.0.1:8000/ws/agent ...")
        async with websockets.connect("ws://127.0.0.1:8000/ws/agent", open_timeout=5) as ws:
            print("Connected!")
            msg = await asyncio.wait_for(ws.recv(), timeout=5)
            print("First frame:", msg[:200])
    except ImportError:
        print("websockets not installed, trying requests upgrade check...")
        import urllib.request
        try:
            req = urllib.request.Request(
                "http://127.0.0.1:8000/ws/agent",
                headers={"Upgrade": "websocket", "Connection": "Upgrade",
                         "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==",
                         "Sec-WebSocket-Version": "13"},
            )
            r = urllib.request.urlopen(req, timeout=5)
            print("HTTP status:", r.status)
        except Exception as e:
            print("HTTP WS upgrade error:", type(e).__name__, e)
    except Exception as e:
        print("WS ERROR:", type(e).__name__, e)

asyncio.run(test_ws())
