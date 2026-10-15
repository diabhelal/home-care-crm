"""Isolated local Postgres (pixeltable-pgserver, in the venv) with the project's REAL
migrations + the PROPOSED SQL applied. Never connects to the live Supabase project."""
import json
import pathlib
import re
import tempfile
import uuid

import psycopg
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOTSTRAP = pathlib.Path(__file__).with_name("bootstrap.sql")


def _sql_files():
    mig = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
    prop = sorted((ROOT / "supabase" / "proposed").glob("*.sql"))
    return mig + prop


@pytest.fixture(scope="session")
def pg_uri():
    import pixeltable_pgserver as pgserver
    tmp = pathlib.Path(tempfile.mkdtemp()) / "pg"
    srv = pgserver.get_server(tmp, cleanup_mode="stop")
    uri = srv.get_uri()
    with psycopg.connect(uri, autocommit=True) as c:
        c.execute(BOOTSTRAP.read_text(encoding="utf-8"))
        for f in _sql_files():
            try:
                c.execute(f.read_text(encoding="utf-8"))
            except Exception as e:  # surface which file broke
                raise RuntimeError(f"applying {f.name}: {e}") from e
    yield uri
    srv.cleanup()


@pytest.fixture()
def db(pg_uri):
    """A superuser connection inside a transaction that is rolled back after each test."""
    with psycopg.connect(pg_uri, autocommit=False) as c:
        yield c
        c.rollback()


def as_user(conn, sub, *, admin=False, role="authenticated"):
    claims = {"sub": sub, "role": "authenticated", "app_metadata": {"is_admin": admin}}
    conn.execute("reset role")
    conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
    conn.execute(f"set local role {role}")


def as_postgres(conn):
    conn.execute("reset role")


def new_uuid():
    return str(uuid.uuid4())
