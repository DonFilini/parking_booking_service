import os
import signal
import subprocess
import sys
import time

processes: list[subprocess.Popen] = []
stopping = False


def stop_processes(*_: object) -> None:
    global stopping
    stopping = True
    for process in processes:
        if process.poll() is None:
            process.terminate()
    deadline = time.monotonic() + 10
    for process in processes:
        while process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.2)
        if process.poll() is None:
            process.kill()


def main() -> int:
    signal.signal(signal.SIGTERM, stop_processes)
    signal.signal(signal.SIGINT, stop_processes)

    nginx = subprocess.Popen(["nginx", "-g", "daemon off;"])
    backend = subprocess.Popen(
        [
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
            "--proxy-headers",
            "--forwarded-allow-ips",
            "*",
        ],
        cwd="/app/backend",
        env=os.environ.copy(),
    )
    processes.extend([nginx, backend])

    while not stopping:
        for process in processes:
            code = process.poll()
            if code is not None:
                stop_processes()
                return code
        time.sleep(1)

    return 0


if __name__ == "__main__":
    sys.exit(main())
