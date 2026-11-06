#!/usr/bin/env python3
"""Builds dist/ from public/ for a hosted environment (no build step otherwise).

Reads the environment, writes only public (non-secret) values into the copied config.js and the CSP
connect-src in _headers, so the repo never carries per-environment URLs:
  SUPABASE_URL, SUPABASE_ANON_KEY (publishable key only), BACKEND_URL, PREDICTIVE_SERVICE_URL (optional)
Refuses secret-looking keys. Usage: python3 scripts/make_release.py [--out dist]
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
    return f"https://{u.netloc}"


def build(env, out: Path, src: Path = ROOT / "public") -> None:
    supa = _https_origin("SUPABASE_URL", env.get("SUPABASE_URL", ""))
    backend = _https_origin("BACKEND_URL", env.get("BACKEND_URL", ""))
    predictive = _https_origin("PREDICTIVE_SERVICE_URL", env.get("PREDICTIVE_SERVICE_URL", ""), required=False)
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
    if predictive:
        cfg = setv(cfg, "PREDICTIVE_SERVICE_URL", predictive)
    (out / "config.js").write_text(cfg, encoding="utf-8")

    headers = (out / "_headers").read_text(encoding="utf-8")
    host = urlparse(supa).netloc
    connect = f"connect-src 'self' {supa} wss://{host} {backend}" + (f" {predictive}" if predictive else "")
    headers, n = re.subn(r"connect-src [^;]*", connect, headers, count=1)
    if n != 1:
        raise SystemExit("_headers: connect-src not found")
    (out / "_headers").write_text(headers, encoding="utf-8")


if __name__ == "__main__":
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else ROOT / "dist"
    build(os.environ, out)
    print(f"built {out}")
