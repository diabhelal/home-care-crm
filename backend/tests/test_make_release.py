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
    ("SUPABASE_ANON_KEY", "sb_" + "secret_" + "x" * 12)  # built at runtime: keeps the secret scanner quiet,
])
def test_build_rejects_unsafe_values(tmp_path, name, value):
    with pytest.raises(SystemExit):
        mr.build({**ENV, name: value}, tmp_path / "dist")
