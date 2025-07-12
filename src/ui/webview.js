"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWebviewContent = getWebviewContent;
function getWebviewContent() {
    return `
    <html>
    <body>
      <style>
        body { font-family: sans-serif; padding: 10px; }
        textarea { width: 100%; height: 100px; font-family: monospace; }
        pre { white-space: pre-wrap; background: #f0f0f0; padding: 10px; }
      </style>
      <h3>🧠 AI Agent</h3>
      <textarea id="input" placeholder="Задай вопрос..."></textarea><br><br>
      <button onclick="send()">▶️ Отправить</button>
      <pre id="output">Ответ появится здесь...</pre>
      <script>
        const vscode = acquireVsCodeApi();
        function send() {
          const text = document.getElementById('input').value;
          vscode.postMessage({ text });
        }
        window.addEventListener('message', event => {
          const msg = event.data;
          if (msg.type === 'response') {
            document.getElementById('output').textContent = msg.text;
          }
        });
      </script>
    </body>
    </html>
  `;
}
