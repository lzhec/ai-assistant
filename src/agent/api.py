# HTTP-интерфейс для подключения к локальному агенту из VS Code

from flask import Flask, request, jsonify
from pathlib import Path
import threading

from agent import (
    load_config,
    is_config_valid,
    build_provider_from_config,
    get_project_context,
    SYSTEM_PROMPT,
)

app = Flask(__name__)
lock = threading.Lock()

@app.route("/ask", methods=["POST"])
def ask():
    data = request.get_json()
    query = data.get("query", "").strip()
    project_path = Path(data.get("projectPath", "."))

    if not query:
        return jsonify({"error": "Empty query"}), 400

    config = load_config()
    if not is_config_valid(config):
        return jsonify({"error": "Invalid config"}), 500

    provider = build_provider_from_config(config)
    context = get_project_context(project_path)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"{query}\n\nКонтекст проекта:\n{context}"},
    ]

    with lock:
        try:
            reply = provider.chat(messages)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return jsonify({"answer": reply})

if __name__ == "__main__":
    app.run(port=11434, debug=False)
