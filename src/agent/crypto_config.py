import os
from pathlib import Path

try:
    from cryptography.fernet import Fernet
except ImportError:
    import subprocess
    import sys
    print("Устанавливаю библиотеку cryptography...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "cryptography"])
    from cryptography.fernet import Fernet

KEY_PATH = Path.home() / ".ai_agent_secret_key"

def _load_or_create_key() -> bytes:
    if KEY_PATH.exists():
        return KEY_PATH.read_bytes()
    key = Fernet.generate_key()
    KEY_PATH.write_bytes(key)
    os.chmod(KEY_PATH, 0o600)  # Ограничиваем права доступа к ключу
    return key

def encrypt_api_key(plaintext: str) -> str:
    key = _load_or_create_key()
    f = Fernet(key)
    return f.encrypt(plaintext.encode()).decode()

def decrypt_api_key(ciphertext: str) -> str:
    key = _load_or_create_key()
    f = Fernet(key)
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except Exception as e:
        raise ValueError("Ошибка расшифровки ключа API. Возможно, ключ повреждён или неправильный.") from e
