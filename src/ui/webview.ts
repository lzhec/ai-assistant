export function getWebviewContent() {
  return `
    <html>
    <body>
      <style>
        body {
          font-family: sans-serif;
          padding: 16px;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
        }

        h3 {
          margin-bottom: 16px;
        }

        textarea {
          width: 100%;
          height: 100px;
          font-family: monospace;
          font-size: 14px;
          padding: 10px;
          border: 1px solid var(--vscode-editorWidget-border);
          border-radius: 6px;
          background-color: var(--vscode-editorWidget-background);
          color: var(--vscode-editorWidget-foreground);
          box-sizing: border-box;
          resize: vertical;
        }

        button {
          margin-top: 12px;
          padding: 8px 14px;
          font-size: 14px;
          border: none;
          border-radius: 6px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          cursor: pointer;
        }

        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }

        #loading {
          margin-top: 10px;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          display: none;
        }

        pre {
          white-space: pre-wrap;
          background-color: var(--vscode-editorWidget-background);
          border: 1px solid var(--vscode-editorWidget-border);
          padding: 12px;
          margin-top: 16px;
          border-radius: 6px;
          font-size: 13px;
          line-height: 1.4;
          max-height: 300px;
          overflow-y: auto;
        }
      </style>

      <h3>🧠 AI Agent</h3>
      <textarea id="input" placeholder="Задай вопрос..."></textarea><br>
      <button onclick="send()">▶️ Отправить</button>
      <div id="loading">AI думает...</div>
      <pre id="output">Ответ появится здесь...</pre>

      <script>
        const vscode = acquireVsCodeApi();

        function send() {
          const input = document.getElementById('input');
          const text = input.value.trim();
          if (!text) return;

          document.getElementById('output').textContent = '';
          document.getElementById('loading').style.display = 'block';
          vscode.postMessage({ text });
          input.value = '';
          input.focus();
        }

        // Обработка нажатий клавиш
        document.getElementById('input').addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        });

        window.addEventListener('message', event => {
          const msg = event.data;
          if (msg.type === 'response') {
            const output = document.getElementById('output');
            document.getElementById('loading').style.display = 'none';
            output.textContent = msg.text;

            // Прокрутка вниз
            output.scrollTop = output.scrollHeight;
          }
        });
      </script>
    </body>
    </html>
  `;
}
