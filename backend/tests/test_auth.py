import time
import jwt
import pytest
from app.auth import HS256Verifier, identity_from_claims
from app.errors import DomainError

SIGNING_KEY = "-".join(["throwaway", "test", "value", "0123456789abcdef"])  # not a real credential


def tok(**over):
    c = {"sub": "u1", "aud": "authenticated", "exp": int(time.time()) + 60,
         "app_metadata": {"is_admin": True}}
    c.update(over)
    return jwt.encode(c, SIGNING_KEY, algorithm="HS256")


def test_valid_token():
    c = HS256Verifier(SIGNING_KEY).verify(tok())
    assert identity_from_claims(c).is_admin


def test_expired_rejected():
    with pytest.raises(DomainError) as e:
        HS256Verifier(SIGNING_KEY).verify(tok(exp=int(time.time()) - 10))
    assert e.value.status == 401


def test_bad_signature_rejected():
    bad = jwt.encode({"sub": "u", "aud": "authenticated", "exp": int(time.time()) + 60},
                     "other-secret-0123456789abcdef0123", algorithm="HS256")
    with pytest.raises(DomainError):
        HS256Verifier(SIGNING_KEY).verify(bad)


def test_wrong_audience_rejected():
    with pytest.raises(DomainError):
        HS256Verifier(SIGNING_KEY).verify(tok(aud="anon"))


def test_unconfigured_secret_rejects():
    with pytest.raises(DomainError):
        HS256Verifier("").verify(tok())


def test_is_admin_must_be_true_boolean():
    assert not identity_from_claims({"sub": "u", "app_metadata": {"is_admin": "true"}}).is_admin
    assert not identity_from_claims({"sub": "u", "user_metadata": {"is_admin": True}}).is_admin
