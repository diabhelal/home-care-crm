#!/usr/bin/env python3
"""Builds dist/ from public/ for a hosted environment (no build step otherwise).

Reads the environment, writes only public (non-secret) values into the copied config.js and the CSP
connect-src in _headers, so the repo never carries per-environment URLs:
  SUPABASE_URL, SUPABASE_ANON_KEY (publishable key only), BACKEND_URL,
  PREDICTIVE_SERVICE_URL (optional; defaults to BACKEND_URL, whose authenticated /predict/* routes reach the
  predictive service running privately inside the backend container), APP_ENV (development | production).
Also writes dist/Caddyfile for the Railway web image (Dockerfile.web): its response headers are GENERATED from
_headers, so _headers stays the single source of truth for every host.
Refuses secret-looking keys and local addresses. Usage: python3 scripts/make_release.py [--out dist]
"""
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


def _https_origin(name: str, value: str, required: bool = True) -> str:
    if not value:
        if required:
            raise SystemExit(f"{name} is required")
        return ""
    u = urlparse(value)
    if u.scheme != "https" or not u.netloc or u.path not in ("", "/") or u.query or u.fragment:
        raise SystemExit(f"{name} must be a bare https origin (https://host)")
    if (u.hostname or "") in ("localhost", "127.0.0.1", "::1", "0.0.0.0") or (u.hostname or "").endswith(".railway.internal"):
        raise SystemExit(f"{name} must be a public address (no localhost / private network)")
    return f"https://{u.netloc}"


APP_ENVS = ("development", "production")
STATIC_CACHE = "public, max-age=86400"   # images/icons only; HTML/JS/CSS revalidate (no content hashes; the service worker versions them)


def parse_headers(text: str) -> list[tuple[str, list[tuple[str, str]]]]:
    """Netlify/Cloudflare `_headers` -> [(path, [(name, value), ...]), ...]."""
    blocks: list[tuple[str, list[tuple[str, str]]]] = []
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if not raw[0].isspace():
            blocks.append((raw.strip(), []))
            continue
        if not blocks or ":" not in raw:
            raise SystemExit(f"_headers: unexpected line: {raw.strip()[:60]}")
        name, value = raw.strip().split(":", 1)
        blocks[-1][1].append((name.strip(), value.strip()))
    return blocks


def _q(value: str) -> str:
    if '"' in value or "\n" in value:
        raise SystemExit("_headers: header values must not contain quotes or newlines")
    return f'"{value}"'


def caddyfile(blocks) -> str:
    """Caddy config serving /srv on Railway's $PORT with the _headers headers applied."""
    lines = ["{", "\tadmin off", "\tauto_https off", "\tpersist_config off", "}", "", ":{$PORT:8080} {",
             "\troot * /srv", "\tencode zstd gzip",
             "\t# internal build files are never served", "\t@internal path /Caddyfile /_headers",
             "\trespond @internal 404", ""]
    for i, (path, headers) in enumerate(blocks):
        if path == "/*":
            lines.append("\theader {")
            lines += [f"\t\t{n} {_q(v)}" for n, v in headers]
            lines += ["\t\t-Server", "\t}"]
        else:
            if not path.startswith("/") or any(c in path for c in ' "{}'):
                raise SystemExit(f"_headers: unsupported path {path!r}")
            lines.append(f"\t@h{i} path {path}")
            lines += [f"\theader @h{i} {n} {_q(v)}" for n, v in headers]
    lines += ["", "\t@static path *.png *.svg *.jpg *.jpeg *.webp *.ico *.woff2",
              f"\theader @static Cache-Control {_q(STATIC_CACHE)}",
              "\t@revalidate not path *.png *.svg *.jpg *.jpeg *.webp *.ico *.woff2",
              "\theader @revalidate ?Cache-Control \"no-cache\"",
              "\tfile_server", "}", ""]
    return "\n".join(lines)


def build(env, out: Path, src: Path = ROOT / "public") -> None:
    supa = _https_origin("SUPABASE_URL", env.get("SUPABASE_URL", ""))
    backend = _https_origin("BACKEND_URL", env.get("BACKEND_URL", ""))
    predictive = _https_origin("PREDICTIVE_SERVICE_URL", env.get("PREDICTIVE_SERVICE_URL", ""), required=False) or backend
    app_env = env.get("APP_ENV", "")
    if app_env not in APP_ENVS:
        raise SystemExit("APP_ENV must be 'development' or 'production'")
    key = env.get("SUPABASE_ANON_KEY", "")
    if not key.startswith("sb_publishable_") and not re.fullmatch(r"eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+", key or ""):
        raise SystemExit("SUPABASE_ANON_KEY must be the publishable/anon key")
    if key.startswith("eyJ"):
        import base64, json
        body = key.split(".")[1]
        if json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))).get("role") != "anon":
            raise SystemExit("SUPABASE_ANON_KEY is not an anon key")
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(src, out)

    cfg = (out / "config.js").read_text(encoding="utf-8")
    def setv(text, name, value):
        new, n = re.subn(rf'^window\.{name} = .*$', lambda m: f'window.{name} = "{value}";', text, flags=re.M)
        if n != 1:
            raise SystemExit(f"config.js: expected exactly one {name}")
        return new
    cfg = setv(cfg, "SUPABASE_URL", supa)
    cfg = setv(cfg, "SUPABASE_ANON_KEY", key)
    cfg = setv(cfg, "BACKEND_URL", backend)
    cfg = setv(cfg, "PREDICTIVE_SERVICE_URL", predictive)
    cfg = setv(cfg, "APP_ENV", app_env)
    (out / "config.js").write_text(cfg, encoding="utf-8")

    headers = (out / "_headers").read_text(encoding="utf-8")
    host = urlparse(supa).netloc
    connect = f"connect-src 'self' {supa} wss://{host} {backend}" + (f" {predictive}" if predictive != backend else "")
    headers, n = re.subn(r"connect-src [^;]*", connect, headers, count=1)
    if n != 1:
        raise SystemExit("_headers: connect-src not found")
    (out / "_headers").write_text(headers, encoding="utf-8")
    (out / "Caddyfile").write_text(caddyfile(parse_headers(headers)), encoding="utf-8")
    if re.search(r"localhost|127\.0\.0\.1", cfg):
        raise SystemExit("config.js still points at a local address")


if __name__ == "__main__":
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else ROOT / "dist"
    build(os.environ, out)
    print(f"built {out}")
