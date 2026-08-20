import sys
import urllib.error
import urllib.request


CHECKS = (
    ("nginx", "http://127.0.0.1/health"),
    ("api-through-nginx", "http://127.0.0.1/api/health"),
)


def check_url(name: str, url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            body = response.read(300).decode("utf-8", errors="replace").strip()
            print(f"[healthcheck] {name} ok status={response.status} body={body!r}", flush=True)
            return 200 <= response.status < 300
    except urllib.error.HTTPError as exc:
        body = exc.read(300).decode("utf-8", errors="replace").strip()
        print(
            f"[healthcheck] {name} failed status={exc.code} body={body!r}",
            flush=True,
        )
        return False
    except Exception as exc:
        print(
            f"[healthcheck] {name} failed error={type(exc).__name__}: {exc}",
            flush=True,
        )
        return False


def main() -> int:
    results = [check_url(name, url) for name, url in CHECKS]
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
