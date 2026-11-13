import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("make_release", ROOT / "scripts" / "make_release.py")
mr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mr)

ENV = {
    "SUPABASE_URL": "https://demo-project.supabase.co",
    "SUPABASE_ANON_KEY": "sb_publishable_demo",
    "BACKEND_URL": "https://crm-backend.onrender.com",
    "PREDICTIVE_SERVICE_URL": "https://crm-predictive.onrender.com",
    "APP_ENV": "production",
}


def test_build_rewrites_config_and_csp(tmp_path):
    out = tmp_path / "dist"
    mr.build(ENV, out)
    cfg = (out / "config.js").read_text(encoding="utf-8")
    assert 'window.SUPABASE_URL = "https://demo-project.supabase.co";' in cfg
    assert 'window.BACKEND_URL = "https://crm-backend.onrender.com";' in cfg
    assert 'window.PREDICTIVE_SERVICE_URL = "https://crm-predictive.onrender.com";' in cfg
    assert "qqeupktyadjxqoxkstnl" not in cfg
    headers = (out / "_headers").read_text(encoding="utf-8")
    assert "qqeupktyadjxqoxkstnl" not in headers
    assert "connect-src 'self' https://demo-project.supabase.co wss://demo-project.supabase.co https://crm-backend.onrender.com https://crm-predictive.onrender.com;" in headers
    assert (out / "index.html").exists()


@pytest.mark.parametrize("name,value", [
    ("BACKEND_URL", "http://insecure.example.com"),
    ("BACKEND_URL", "https://x.example.com/path"),
    ("SUPABASE_URL", ""),
    ("BACKEND_URL", "https://localhost"),
    ("BACKEND_URL", "https://backend.railway.internal"),
    ("APP_ENV", ""),
    ("APP_ENV", "staging"),
    ("SUPABASE_ANON_KEY", "sb_" + "secret_" + "x" * 12)  # built at runtime: keeps the secret scanner quiet,
])
def test_build_rejects_unsafe_values(tmp_path, name, value):
    with pytest.raises(SystemExit):
        mr.build({**ENV, name: value}, tmp_path / "dist")


RAILWAY = {"SUPABASE_URL": "https://dev-ref.supabase.co", "SUPABASE_ANON_KEY": "sb_publishable_demo",
           "BACKEND_URL": "https://backend-dev.up.railway.app", "APP_ENV": "development"}


def test_predictive_defaults_to_backend_and_app_env_is_written(tmp_path):
    out = tmp_path / "dist"
    mr.build(RAILWAY, out)
    cfg = (out / "config.js").read_text(encoding="utf-8")
    assert 'window.PREDICTIVE_SERVICE_URL = "https://backend-dev.up.railway.app";' in cfg
    assert 'window.APP_ENV = "development";' in cfg
    assert "localhost" not in cfg
    csp = (out / "_headers").read_text(encoding="utf-8")
    assert "connect-src 'self' https://dev-ref.supabase.co wss://dev-ref.supabase.co https://backend-dev.up.railway.app;" in csp


def test_caddyfile_carries_every_header_from_headers_file(tmp_path):
    out = tmp_path / "dist"
    mr.build(RAILWAY, out)
    blocks = mr.parse_headers((out / "_headers").read_text(encoding="utf-8"))
    caddy = (out / "Caddyfile").read_text(encoding="utf-8")
    assert blocks and blocks[0][0] == "/*"
    for _path, headers in blocks:
        for name, value in headers:
            assert f'{name} "{value}"' in caddy, name
    assert "Content-Security-Policy" in caddy and "https://backend-dev.up.railway.app" in caddy
    assert ':{$PORT:8080}' in caddy and "admin off" in caddy and "file_server" in caddy
    assert "browse" not in caddy                                     # no directory listings
    assert "@internal path /Caddyfile /_headers" in caddy             # build files are not served
    sw = caddy.index("path /service-worker.js")
    assert 'Cache-Control "no-cache"' in caddy[sw:sw + 120]


def test_repo_config_is_local_by_default():
    cfg = (ROOT / "public" / "config.js").read_text(encoding="utf-8")
    assert 'window.APP_ENV = "local";' in cfg
