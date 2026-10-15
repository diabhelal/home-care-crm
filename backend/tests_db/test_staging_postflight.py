"""The post-flight SQL assertions and ROLLBACK blocks of docs/STAGING_PLAN.md, on the local throwaway DB."""
import importlib.util
import pathlib

V = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "verify_proposed_sql.py"
spec = importlib.util.spec_from_file_location("verify_proposed_sql", V)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_postflight_assertions(db):
    assert mod.postflight_failures(db) == []


def test_rollback_blocks_work_in_reverse_order(db):
    assert mod.rollback_failures(db, mod.PLAN.read_text(encoding="utf-8")) == []
