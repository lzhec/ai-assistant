import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { getWebviewContent } from './ui/webview';

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension activated!!!');
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'ai-agent-panel',
      new AgentPanelProvider(context)
    )
  );
}

class AgentPanelProvider implements vscode.WebviewViewProvider {
  constructor(private context: vscode.ExtensionContext) {}

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