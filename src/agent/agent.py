#!/usr/bin/env python3
import os
import sys
import json
import subprocess
import textwrap
import re
from pathlib import Path
from fnmatch import fnmatch
from typing import Dict, List
from dataclasses import dataclass
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from history import save_history_entry, read_history
from crypto_config import encrypt_api_key, decrypt_api_key
import requests

console = Console()

CONFIG_PATH = Path.home() / ".ai_agent_config.json"

SYSTEM_PROMPT = textwrap.dedent("""
    Ты локальный coding-agent.

    Если запрос содержит перечисление действий (например, "1. создай файл ... 2. добавь ...", "Сделай", "Выполни", "Измени файлы", или несколько команд подряд), отвечай строго JSON-массивом объектов с действиями без markdown:

    [
    {"tool":"create_file","path":"rel/path","content":"text"},
    {"tool":"append_file","path":"rel/path","content":"text"},
    {"tool":"replace_file","path":"rel/path","content":"text"},
    {"tool":"run_shell","cmd":"bash command"},
    {"tool":"finish","result":"message"}
    ]

    После каждого действия я верну stdout/статус как SYSTEM-сообщение.

    Если запрос — простой вопрос (например, рассказать сказку), или какой-то общий вопрос, без просьбы что-то сделать с файлами, отвечай простым текстом без JSON и без markdown.

    Обязательно не смешивай JSON с текстом, либо JSON с действиями, либо простой ответ текстом.
""")

@dataclass
class Provider:
    name: str
    api_key: str
    base: str
    model: str
    kind: str  # "openai" or "anthropic"

    def headers(self):
        if self.kind == "openai":
            return {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
        return {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def chat(self, messages: List[Dict[str, str]]):
        if self.kind == "openai":
            url = f"{self.base}/chat/completions"
            body = {"model": self.model, "messages": messages, "temperature": 0}
        else:
            url = f"{self.base}/v1/messages"
            body = {"model": self.model, "messages": messages, "max_tokens": 1024, "temperature": 0}
        with Progress(SpinnerColumn(), TextColumn("[green]LLM думает…"), transient=True):
            r = requests.post(url, json=body, headers=self.headers(), timeout=180)
        r.raise_for_status()
        return (
            r.json()["choices"][0]["message"]["content"].strip()
            if self.kind == "openai"
            else r.json()["content"][0]["text"].strip()
        )

def prompt_for_credentials():
    console.print("[bold blue]Введите данные для подключения к AI провайдеру.[/bold blue]")
    provider = input("Провайдер (openai/openrouter/anthropic): ").strip()
    model = input("Модель: ").strip()
    api_key = input("API ключ: ").strip()
    api_base = input("API base URL (оставьте пустым для дефолта): ").strip()
    return {
        "provider": provider,
        "model": model,
        "api_key": encrypt_api_key(api_key),
        "api_base": api_base,
    }

def save_config(config: dict):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
    except Exception as e:
        console.print(f"[red]Ошибка при сохранении конфигурации: {e}[/red]")

def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            console.print(f"[red]Ошибка при загрузке конфигурации: {e}[/red]")
    return {}

def is_config_valid(config: dict) -> bool:
    required_keys = ["provider", "model", "api_key"]
    if not all(k in config for k in required_keys):
        return False
    try:
        _ = decrypt_api_key(config["api_key"])
    except Exception:
        return False
    return True

def build_provider_from_config(config):
    name = config.get("provider", "")
    try:
        key = decrypt_api_key(config.get("api_key", ""))
    except Exception as e:
        console.print(f"[red]Ошибка расшифровки API ключа: {e}[/red]")
        sys.exit(1)
    model = config.get("model", "")
    api_base = config.get("api_base", "")

    if not api_base:
        if name == "openai":
            api_base = "https://api.openai.com/v1"
        elif name == "openrouter":
            api_base = "https://openrouter.ai/api/v1"
        elif name == "anthropic":
            api_base = "https://api.anthropic.com"
        else:
            api_base = ""

    kind = "openai" if name in ("openai", "openrouter") else "anthropic"

    return Provider(name, key, api_base, model, kind)

def get_project_context(project_path: Path, max_chars=6000) -> str:
    ignore_patterns = []
    ig = project_path / ".agentignore"
    if ig.exists():
        ignore_patterns = ig.read_text().splitlines()

    def skip(p: Path):
        rel = str(p.relative_to(project_path))
        return any(fnmatch(rel, pat) for pat in ignore_patterns)

    buf, total = [], 0
    for f in project_path.rglob("*"):
        if f.is_file() and not skip(f):
            try:
                txt = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            total += len(txt)
            if total > max_chars:
                break
            buf.append(f"\n\n# {f.relative_to(project_path)}\n{txt}")
    return "".join(buf)

def run_shell(cmd: str, cwd: Path = None) -> str:
    try:
        out = subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT, text=True, timeout=300, cwd=str(cwd) if cwd else None)
        return out.strip()
    except subprocess.CalledProcessError as e:
        return e.output.strip()

def parse_multiple_json_objects(text: str):
    parts = [p.strip() for p in text.split('---') if p.strip()]
    objs = []
    for part in parts:
        try:
            objs.append(json.loads(part))
        except json.JSONDecodeError:
            # Если парсинг не удался — можно вернуть None или игнорировать
            return None
    return objs

def apply(action: Dict[str, str], project: Path, ask_confirm: List[bool]) -> str:
    tool = action.get("tool")
    content = json.dumps(action.get("content"), indent=2) if isinstance(action.get("content"), dict) else action.get("content", "")

    if tool in {"create_file", "append_file", "replace_file", "run_shell"}:
        preview = ""

        if tool == "run_shell":
            preview = f"[bold yellow]{tool}[/bold yellow] [green]Command:[/green] {action.get('cmd', '')}"
        else:
            p = project / action["path"]
            preview = f"[bold yellow]{tool}[/bold yellow] [green]{p}[/green]\n[white]{content}[/white]"

        if ask_confirm[0]:  # список как mutable-флаг
            console.print(preview)
            confirm = input("Выполнить? ([y]es / [a]ll / [n]o): ").strip().lower()
            if confirm == "n":
                return "[отменено пользователем]"
            if confirm == "a":
                ask_confirm[0] = False

        if tool == "run_shell":
            return run_shell(action.get("cmd", ""), project)
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            if tool == "append_file":
                with p.open("a", encoding="utf-8") as f:
                    f.write(content)
            else:
                p.write_text(content, encoding="utf-8")
            return f"{tool} {p}"

    if tool == "finish":
        return f"FINISH: {action.get('result')}"
    return f"unknown tool {tool}"

def parse_actions(reply: str) -> List[Dict]:
    reply = reply.strip()
    # Попытка распарсить как JSON массив
    try:
        actions = json.loads(reply)
        
        if isinstance(actions, list):
            return actions

        # Если это одиночный объект — возвращаем список из одного
        elif isinstance(actions, dict):
            return [actions]
    except json.JSONDecodeError:
        return []

    # Парсим несколько JSON-объектов через '---'
    parts = re.split(r'\n?---\n?', reply)
    actions = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        try:
            action = json.loads(part)
            actions.append(action)
        except json.JSONDecodeError as e:
            raise ValueError(f"Не удалось распарсить JSON:\n{part}") from e
    return actions

def main():
    # Попытка загрузить конфиг, если нет — запросить и сохранить
    config = load_config()
    # Проверяем валидность конфигурации
    # Если конфиг не найден или невалиден, запрашиваем данные у пользователя
    if not config or not is_config_valid(config):
        config = prompt_for_credentials()
        save_config(config)

    provider = build_provider_from_config(config)

    # Парсим аргумент проекта, или используем текущую директорию
    project_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    if not project_path.exists() or not project_path.is_dir():
        console.print(f"[red]Ошибка: папка проекта не найдена: {project_path}[/red]")
        sys.exit(1)

    messages: List[Dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]

    console.print("[bold blue]Agent готов. Пиши задачи. /logout для сброса конфигурации. exit/quit/Ctrl+D для выхода.[/bold blue]")

    try:
        while True:
            try:
                user_input = input("» ").strip()
            except EOFError:
                break

            if user_input.lower() in {"exit", "quit"}:
                break

            if user_input == "/logout":
                # Сброс данных
                if CONFIG_PATH.exists():
                    CONFIG_PATH.unlink()
                console.print("[yellow]Данные конфигурации сброшены. Перезапустите агент для ввода новых данных.[/yellow]")
                break

            if user_input == "/history":
                entries = read_history(10)
                for entry in entries:
                    console.print(f"[blue]{entry['timestamp']}[/blue]\n[bold]» {entry['user']}[/bold]\n[green]{entry['assistant']}[/green]\n")
                continue

            if not user_input:
                continue

            # Добавляем контекст проекта
            context = get_project_context(project_path)
            full_message = user_input + "\n\nКонтекст проекта:\n" + context
            messages.append({"role": "user", "content": full_message})

            reply = provider.chat(messages)
            log_path = Path.home() / "agent_response.log"

            try:
                with open(log_path, "a", encoding="utf-8") as log_file:
                    log_file.write("\n\n---\n")
                    log_file.write(reply)
            except Exception as e:
                console.print(f"[red]Ошибка записи лога: {e}[/red]")

            console.print(f"[cyan]LLM ↴[/cyan] {reply}")
            save_history_entry(user_input, reply)

            try:
                actions = parse_actions(reply)

                if not actions:
                    # Значит, ответ — просто текст без JSON, показываем его
                    messages.append({"role": "assistant", "content": reply})
                    continue

            except ValueError as e:
                # Ошибка JSON в многообъектном ответе
                console.print(f"[red]↳ Ошибка парсинга ответа модели: {e}[/red]")
                messages.append({"role": "assistant", "content": reply})
                continue

            ask_confirm = [True]
            results = []

            for action in actions:
                result = apply(action, project_path, ask_confirm)
                console.print(f"[yellow]→ {result}[/yellow]")
                results.append(result)

            messages.append({"role": "assistant", "content": json.dumps(actions)})
            messages.append({"role": "system", "content": f"RESULT: {results}"})

    except KeyboardInterrupt:
        console.print("\n[bold red]Прервано пользователем.[/bold red]")

if __name__ == "__main__":
    main()
