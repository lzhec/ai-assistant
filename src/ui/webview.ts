/**
 * Webview HTML with support for:
 * - Theme changes (light/dark)
 * - Markdown highlighting (with copy button)
 * - Error messages
 * - Smooth UX
 */
export function getWebviewContent() {
  return `
  <html>
  <head>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        padding: 0;
        font-family: var(--vscode-font-family);
        display: flex;
        flex-direction: column;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
      }

      #chat {
        flex: 1;
        padding: 10px;
        overflow-y: auto;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .message {
        margin: 10px 0;
        padding: 10px;
        border-radius: 6px;
        white-space: pre-wrap;
        max-width: 90%;
      }

      .message time {
        display: block;
        font-size: 10px;
        opacity: 0.6;
        margin-top: 5px;
      }

      .user {
        background-color: var(--vscode-editor-selectionBackground);
        align-self: flex-end;
      }

      .agent {
        background-color: var(--vscode-input-background);
        align-self: flex-start;
      }

      #input-area {
        padding: 10px;
        background: var(--vscode-editor-background);
        border-top: 1px solid var(--vscode-panel-border);
        display: flex;
        flex-direction: column;
      }

      #input-controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 8px;
      }

      #input {
        resize: none;
        overflow-y: auto;
        max-height: 33vh;
        min-height: 100px;
        padding: 8px;
        font-family: var(--vscode-editor-font-family, monospace);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        line-height: 1.4em;
      }

      button {
        padding: 6px 12px;
        border-radius: 4px;
        border: none;
        font-size: 13px;
        cursor: pointer;
      }

      #send-button {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      #send-button:disabled {
        background-color: var(--vscode-button-secondaryBackground);
        cursor: not-allowed;
      }

      #clear-button {
        background-color: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        margin-right: 8px;
      }

      #typing {
        font-style: italic;
        color: var(--vscode-descriptionForeground);
        margin: 5px 0 0 10px;
      }

      pre code {
        background: var(--vscode-editorHoverWidget-background);
        color: var(--vscode-editorHoverWidget-foreground);
        padding: 8px;
        display: block;
        overflow-x: auto;
        border-radius: 4px;
        font-size: 13px;
        position: relative;
      }

      .copy-btn {
        position: absolute;
        top: 6px;
        right: 8px;
        font-size: 12px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        padding: 2px 6px;
        opacity: 0.7;
      }

      .copy-btn:hover {
        opacity: 1;
      }

      .error {
        color: var(--vscode-editorError-foreground);
        font-weight: bold;
        margin-top: 8px;
      }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  </head>
  <body>
    <div id="chat"></div>

    <div id="input-area">
      <textarea id="input" rows="5" placeholder="Задай вопрос..."></textarea>
      <div id="input-controls">
        <span id="typing" style="display:none;">AI печатает...</span>
        <div>
          <button id="clear-button">🗑 Очистить</button>
          <button id="send-button">▶️ Отправить</button>
        </div>
      </div>
      <div id="error" class="error" style="display:none;"></div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script>
      const vscode = acquireVsCodeApi();
      const input = document.getElementById('input');
      const sendButton = document.getElementById('send-button');
      const clearButton = document.getElementById('clear-button');
      const chat = document.getElementById('chat');
      const typing = document.getElementById('typing');
      const errorBox = document.getElementById('error');

      input.focus();

      let history = vscode.getState() || [];

      marked.setOptions({
        highlight: function(code, lang) {
          return hljs.highlightAuto(code, [lang]).value;
        }
      });

      function nowTime() {
        const d = new Date();
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      function escapeHtml(str) {
        return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }

      function createCopyButton(text) {
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = '⧉';
        btn.onclick = () => {
          navigator.clipboard.writeText(text).then(() => {
            btn.textContent = '✔';
            setTimeout(() => (btn.textContent = '⧉'), 1000);
          });
        };
        return btn;
      }

      function appendMessage(text, sender, save = true, time = nowTime()) {
        const msg = document.createElement('div');
        msg.className = 'message ' + sender;

        if (sender === 'agent') {
          const html = marked.parse(text);
          msg.innerHTML = html + \`< time > \${ time } </time>\`;

          const codeBlocks = msg.querySelectorAll('pre code');
          codeBlocks.forEach(block => {
            const btn = createCopyButton(block.innerText);
            block.parentNode.appendChild(btn);
          });
        } else {
          msg.innerHTML = escapeHtml(text) + \`<time>\${time}</time>\`;
        }

        chat.appendChild(msg);
        msg.scrollIntoView({ behavior: 'smooth', block: 'end' });

        if (save) {
          history.push({ text, sender, time });
          vscode.setState(history);
        }
      }

      function restoreHistory() {
        for (const entry of history) {
          appendMessage(entry.text, entry.sender, false, entry.time);
        }
      }

      sendButton.addEventListener('click', send);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });

      function autoResizeTextarea() {
        input.style.height = 'auto';
        const maxHeight = window.innerHeight * 0.33;
        input.style.height = Math.min(input.scrollHeight, maxHeight) + 'px';
      }

      function send() {
        const text = input.value.trim();
        if (!text) return;
        errorBox.style.display = 'none';
        appendMessage(text, 'user');
        input.value = '';
        autoResizeTextarea();
        typing.style.display = 'block';
        vscode.postMessage({ text });
      }

      input.addEventListener('input', autoResizeTextarea);

      window.addEventListener('message', event => {
        const msg = event.data;
        typing.style.display = 'none';

        if (msg.type === 'response') {
          appendMessage(msg.text, 'agent');
        } else if (msg.type === 'error') {
          errorBox.style.display = 'block';
          errorBox.textContent = msg.text;
        }
      });

      clearButton.addEventListener('click', () => {
        chat.innerHTML = '';
        history = [];
        vscode.setState([]);
        input.focus();
        errorBox.style.display = 'none';
      });

      restoreHistory();
      autoResizeTextarea();
    </script>
  </body>
  </html>
    `;
}
