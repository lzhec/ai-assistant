import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as path from 'path';
import * as child_process from 'child_process';
import { getWebviewContent } from './ui/webview';

const pythonScript = path.join(__dirname, 'agent', 'api.py');
const pythonExecutable = process.env.PYTHON_PATH || 'python3';
let agentProcess: child_process.ChildProcess | null = null;

function startPythonAgent() {
  if (!require('fs').existsSync(pythonScript)) {
    vscode.window.showErrorMessage(`Python agent not found at ${pythonScript}`);
    return null;
  }

  // Запуск python скрипта (можно добавить args, environment и т.п.)
  try {
    const proc = child_process.spawn(pythonExecutable, [pythonScript], {
      cwd: path.dirname(pythonScript),
      stdio: 'pipe'
    });

    proc.stdout.on('data', (data) => {
      console.log(`[Python Agent]: ${data.toString()}`);
    });
    proc.stderr.on('data', (data) => {
      console.error(`[Python Agent error]: ${data.toString()}`);
    });
    proc.on('exit', (code) => {
      console.log(`[Python Agent] exited with code ${code}`);
    });

    return proc;
  } catch (err: any) {
    vscode.window.showErrorMessage(`Ошибка запуска Python-агента: ${err.message}`);
    return null;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const agentProcess = startPythonAgent();

  if (!agentProcess) {
    vscode.window.showErrorMessage('AI Agent не запущен: не найден Python или файл api.py');
    return;
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'ai-agent-panel',
      new AgentPanelProvider(context)
    )
  );
}

export function deactivate() {
  if (agentProcess) {
    console.log('Stopping Python agent...');
    agentProcess.kill();
    agentProcess = null;
  }
}

class AgentPanelProvider implements vscode.WebviewViewProvider {
  constructor(private context: vscode.ExtensionContext) { }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    console.log('resolveWebviewView called!!!');
    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = getWebviewContent();

    webviewView.webview.onDidReceiveMessage(async message => {
      const response = await sendToAgent(message.text);
      webviewView.webview.postMessage({ type: 'response', text: response });
    });
  }
}

async function sendToAgent(query: string): Promise<string> {
  try {
    const res = await fetch('http://localhost:11434/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json() as { answer?: string, [key: string]: any };
    return data.answer || JSON.stringify(data);
  } catch (e: any) {
    return 'Ошибка соединения с локальным агентом: ' + e.message;
  }
}