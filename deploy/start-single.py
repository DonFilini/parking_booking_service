import os
import platform
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ProcessEntry = tuple[str, subprocess.Popen]

processes: list[ProcessEntry] = []
stopping = False

REQUIRED_ENV = (
    "DATABASE_URL",
    "SECRET_KEY",
    "INITIAL_ADMIN_USERNAMES",
)
OPTIONAL_ENV = (
    "APP_TIME_ZONE",
    "ACCESS_TOKEN_EXPIRE_HOURS",
    "CORS_ORIGINS",
    "LDAP_URL",
    "LDAP_BIND_DN",
    "LDAP_BIND_PASSWORD",
    "LDAP_USER_SEARCH_BASE",
    "LDAP_USER_FILTER",
    "LDAP_USER_FULL_NAME_ATTRIBUTE",
    "LDAP_TLS_VALIDATE",
    "LDAP_CA_CERT_FILE",
    "LDAP_CONNECT_TIMEOUT",
)
SECRET_ENV_PARTS = ("PASSWORD", "SECRET", "TOKEN", "KEY")


def log(level: str, message: str) -> None:
    print(f"[single-app] [{level}] {message}", flush=True)


def mask_database_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value)
        if not parsed.password:
            return value
        username = urllib.parse.quote(parsed.username or "", safe="")
        hostname = parsed.hostname or ""
        port = f":{parsed.port}" if parsed.port else ""
        netloc = f"{username}:***@{hostname}{port}"
        return urllib.parse.urlunsplit(
            (parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment)
        )
    except Exception:
        return "***masked***"


def mask_value(name: str, value: str) -> str:
    if name == "DATABASE_URL":
        return mask_database_url(value)
    if any(part in name.upper() for part in SECRET_ENV_PARTS):
        return "***masked***"
    return value


def log_runtime_context() -> None:
    log("INFO", f"python={sys.version.split()[0]} platform={platform.platform()}")
    log("INFO", f"hostname={socket.gethostname()} cwd={os.getcwd()} pid={os.getpid()}")
    log("INFO", f"uid={os.getuid()} gid={os.getgid()}")
    log("INFO", f"backend_dir_exists={os.path.isdir('/app/backend')}")
    log("INFO", f"frontend_index_exists={os.path.exists('/usr/share/nginx/html/index.html')}")


def log_environment() -> None:
    for name in REQUIRED_ENV:
        value = os.environ.get(name, "")
        if value:
            log("INFO", f"env {name}={mask_value(name, value)}")
        else:
            log("ERROR", f"env {name} is missing")
    for name in OPTIONAL_ENV:
        value = os.environ.get(name)
        if value is None or value == "":
            log("WARN", f"env {name} is empty")
        else:
            log("INFO", f"env {name}={mask_value(name, value)}")


def run_checked(command: list[str]) -> None:
    log("INFO", f"running check: {' '.join(command)}")
    subprocess.run(command, check=True)


def start_process(name: str, command: list[str], cwd: str | None = None) -> ProcessEntry:
    log("INFO", f"starting {name}: {' '.join(command)} cwd={cwd or os.getcwd()}")
    process = subprocess.Popen(command, cwd=cwd, env=os.environ.copy())
    log("INFO", f"{name} started pid={process.pid}")
    return name, process


def stop_processes(*_: object) -> None:
    global stopping
    stopping = True
    for name, process in processes:
        if process.poll() is None:
            log("INFO", f"terminating {name} pid={process.pid}")
            process.terminate()
    deadline = time.monotonic() + 10
    for name, process in processes:
        while process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.2)
        if process.poll() is None:
            log("ERROR", f"killing {name} pid={process.pid}")
            process.kill()
        log("INFO", f"{name} final_exit_code={process.poll()}")


def wait_for_url(name: str, url: str, timeout_seconds: int) -> bool:
    deadline = time.monotonic() + timeout_seconds
    attempt = 1
    while time.monotonic() < deadline and not stopping:
        for process_name, process in processes:
            code = process.poll()
            if code is not None:
                log("ERROR", f"{process_name} exited during {name} readiness check code={code}")
                return False
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                body = response.read(300).decode("utf-8", errors="replace").strip()
                log("INFO", f"{name} ready status={response.status} body={body!r}")
                return 200 <= response.status < 500
        except urllib.error.HTTPError as exc:
            body = exc.read(300).decode("utf-8", errors="replace").strip()
            log("WARN", f"{name} HTTP error attempt={attempt} status={exc.code} body={body!r}")
        except Exception as exc:
            log("WARN", f"{name} not ready attempt={attempt} error={type(exc).__name__}: {exc}")
        attempt += 1
        time.sleep(2)
    log("ERROR", f"{name} readiness timeout after {timeout_seconds}s url={url}")
    return False


def main() -> int:
    signal.signal(signal.SIGTERM, stop_processes)
    signal.signal(signal.SIGINT, stop_processes)

    log("INFO", "single image startup begins")
    log_runtime_context()
    log_environment()

    missing_required = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing_required:
        log("ERROR", f"missing required environment variables: {', '.join(missing_required)}")
        return 1

    run_checked(["nginx", "-t"])

    backend_command = [
        "uvicorn",
        "main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
        "--proxy-headers",
        "--forwarded-allow-ips",
        "*",
        "--log-level",
        "debug",
        "--access-log",
    ]
    nginx_command = ["nginx", "-g", "daemon off;"]

    processes.append(start_process("backend", backend_command, cwd="/app/backend"))

    if not wait_for_url("backend", "http://127.0.0.1:8000/health", 60):
        stop_processes()
        return 1

    processes.append(start_process("nginx", nginx_command))

    if not wait_for_url("nginx", "http://127.0.0.1/health", 30):
        stop_processes()
        return 1
    if not wait_for_url("api-through-nginx", "http://127.0.0.1/api/health", 30):
        stop_processes()
        return 1

    log("INFO", "single image startup completed")

    while not stopping:
        for name, process in processes:
            code = process.poll()
            if code is not None:
                log("ERROR", f"{name} exited code={code}")
                stop_processes()
                return code
        time.sleep(1)

    return 0


if __name__ == "__main__":
    sys.exit(main())
