"""JWT verification. Identity is derived ONLY from the verified token."""
from __future__ import annotations

from typing import Callable, Protocol

import jwt

from .errors import forbidden, unauthorized
from .models import Identity


class TokenVerifier(Protocol):
    def verify(self, token: str) -> dict: ...


class HS256Verifier:
    def __init__(self, secret: str, audience: str = "authenticated"):
        self._secret, self._aud = secret, audience

    def verify(self, token: str) -> dict:
        if not self._secret:
            raise unauthorized("שרת לא מוגדר לאימות")
        try:
            return jwt.decode(
                token, self._secret, algorithms=["HS256"], audience=self._aud,
                options={"require": ["exp", "sub"]},
            )
        except jwt.PyJWTError:
            raise unauthorized("אסימון לא תקין או שפג תוקפו")


class JWKSVerifier:
    """Verifies asymmetric Supabase tokens (ES256/RS256) against the project's public JWKS.

    Only asymmetric algorithms are accepted here, so an attacker cannot downgrade to HS256
    by presenting the public key as an HMAC secret (algorithm confusion).
    `key_resolver(token) -> key` is injectable for tests; by default PyJWKClient fetches
    `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (cached).
    """
    ALGORITHMS = ["ES256", "RS256"]

    def __init__(self, jwks_url: str = "", audience: str = "authenticated",
                 key_resolver: Callable[[str], object] | None = None):
        self._aud = audience
        if key_resolver is not None:
            self._resolve = key_resolver
        elif jwks_url:
            client = jwt.PyJWKClient(jwks_url, cache_keys=True, timeout=5)
            self._resolve = lambda token: client.get_signing_key_from_jwt(token).key
        else:
            self._resolve = None

    def verify(self, token: str) -> dict:
        if self._resolve is None:
            raise unauthorized("שרת לא מוגדר לאימות")
        try:
            key = self._resolve(token)
            return jwt.decode(token, key, algorithms=self.ALGORITHMS, audience=self._aud,
                              options={"require": ["exp", "sub"]})
        except jwt.PyJWTError:
            raise unauthorized("אסימון לא תקין או שפג תוקפו")
        except Exception:
            # JWKS fetch failure etc.: fail closed
            raise unauthorized("אסימון לא תקין או שפג תוקפו")


class SupabaseTokenVerifier:
    """Dispatch on the token's declared algorithm: HS256 -> shared secret, ES256/RS256 -> JWKS."""

    def __init__(self, hs256: TokenVerifier | None, jwks: TokenVerifier | None):
        self._hs, self._jwks = hs256, jwks

    def verify(self, token: str) -> dict:
        try:
            alg = jwt.get_unverified_header(token).get("alg", "")
        except jwt.PyJWTError:
            raise unauthorized("אסימון לא תקין או שפג תוקפו")
        if alg == "HS256" and self._hs is not None:
            return self._hs.verify(token)
        if alg in JWKSVerifier.ALGORITHMS and self._jwks is not None:
            return self._jwks.verify(token)
        raise unauthorized("אסימון לא תקין או שפג תוקפו")


def extract_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthorized()
    token = authorization[7:].strip()
    if not token:
        raise unauthorized()
    return token


def identity_from_claims(claims: dict) -> Identity:
    sub = claims.get("sub")
    if not sub:
        raise unauthorized()
    meta = claims.get("app_metadata") or {}
    return Identity(
        user_id=str(sub),
        is_admin=meta.get("is_admin") is True,
        is_anonymous=bool(claims.get("is_anonymous", False)),
    )


def require_admin(identity: Identity) -> None:
    if not identity.is_admin:
        raise forbidden("נדרשת הרשאת מנהל")
