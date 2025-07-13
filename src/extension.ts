import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { getWebviewContent } from './ui/webview';

const agentDir = path.join(__dirname, 'agent');
const pythonScript = path.join(agentDir, 'api.py');
const venvPath = path.join(agentDir, 'venv');
const requirementsPath = path.join(agentDir, 'requirements.txt');
let agentProcess: child_process.ChildProcess | null = null;

function getPythonBin(): string {
  const bin = process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');
  return bin;
}

function createVenvIfNeeded(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(getPythonBin())) {
      return resolve(); // venv уже есть
    }

    vscode.window.showInformationMessage('Создаётся виртуальное окружение для AI Agent...');

    const python = process.env.PYTHON_PATH || 'python3';
    const venvCmd = `${python} -m venv "${venvPath}"`;

    child_process.exec(venvCmd, (err) => {
      if (err) {
        return reject(new Error(`Ошибка создания venv: ${err.message}`));
      }

      installRequirements().then(resolve).catch(reject);
    });
  });
}

function installRequirements(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(requirementsPath)) {
      return resolve(); // ничего устанавливать
    }

    const pip = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'pip.exe')
      : path.join(venvPath, 'bin', 'pip');

    const cmd = `"${pip}" install -r "${requirementsPath}"`;

    child_process.exec(cmd, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`Ошибка установки зависимостей: ${stderr || err.message}`));
      }
      resolve();
    });
  });
}

function startPythonAgent(): Promise<child_process.ChildProcess | null> {
  return new Promise(async (resolve) => {
    if (!fs.existsSync(pythonScript)) {
      vscode.window.showErrorMessage(`Python агент не найден: ${pythonScript}`);
      return resolve(null);
    }

    try {
      await createVenvIfNeeded();

      const pythonBin = getPythonBin();
      const proc = child_process.spawn(pythonBin, [pythonScript], {
        cwd: agentDir,
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

      resolve(proc);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Не удалось запустить AI Agent: ${err.message}`);
      resolve(null);
    }
  });
}

export async function activate(context: vscode.ExtensionContext) {
  agentProcess = await startPythonAgent();

  if (!agentProcess) {
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
