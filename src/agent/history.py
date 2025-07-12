import json
from pathlib import Path
from datetime import datetime

HISTORY_PATH = Path.home() / ".ai_agent_history.md"

def save_history_entry(user_input: str, assistant_reply: str):
    entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "user": user_input,
        "assistant": assistant_reply,
    }
    with open(HISTORY_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

def read_history(limit=10):
    if not HISTORY_PATH.exists():
        return []
    with open(HISTORY_PATH, encoding="utf-8") as f:
        lines = f.readlines()[-limit:]
        return [json.loads(line) for line in lines]
