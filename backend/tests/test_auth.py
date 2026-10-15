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


# ---- asymmetric (ES256) tokens: what current Supabase projects actually issue ----
import time as _time

import jwt as _jwt
import pytest as _pytest
from cryptography.hazmat.primitives.asymmetric import ec as _ec

from app.auth import JWKSVerifier, SupabaseTokenVerifier
from app.errors import DomainError as _DomainError

_KEY = _ec.generate_private_key(_ec.SECP256R1())
_OTHER = _ec.generate_private_key(_ec.SECP256R1())


def _es256(key=_KEY, **over):
    c = {"sub": "u-1", "aud": "authenticated", "exp": int(_time.time()) + 60}
    c.update(over)
    return _jwt.encode(c, key, algorithm="ES256", headers={"kid": "k1"})


def _jwks():
    return JWKSVerifier(key_resolver=lambda tok: _KEY.public_key())


def test_es256_token_is_accepted():
    assert _jwks().verify(_es256())["sub"] == "u-1"


def test_es256_signed_by_another_key_is_rejected():
    with _pytest.raises(_DomainError):
        _jwks().verify(_es256(key=_OTHER))


def test_es256_expired_and_wrong_audience_rejected():
    with _pytest.raises(_DomainError):
        _jwks().verify(_es256(exp=int(_time.time()) - 5))
    with _pytest.raises(_DomainError):
        _jwks().verify(_es256(aud="other"))


def test_hs256_token_cannot_pass_the_jwks_verifier():
    forged = _jwt.encode({"sub": "x", "aud": "authenticated", "exp": int(_time.time()) + 60},
                         "-".join(["any", "shared", "value", "0123456789abcdef"]), algorithm="HS256")
    with _pytest.raises(_DomainError):
        _jwks().verify(forged)


def test_dispatcher_routes_by_algorithm_and_fails_closed():
    d = SupabaseTokenVerifier(hs256=None, jwks=_jwks())
    assert d.verify(_es256())["sub"] == "u-1"
    hs = _jwt.encode({"sub": "x", "aud": "authenticated", "exp": int(_time.time()) + 60},
                     "-".join(["a", "b", "c", "0123456789abcdef"]), algorithm="HS256")
    with _pytest.raises(_DomainError):
        d.verify(hs)            # no HS256 verifier configured -> rejected
    with _pytest.raises(_DomainError):
        d.verify("not-a-jwt")
