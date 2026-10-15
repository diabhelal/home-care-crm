"""JWT verification. Identity is derived ONLY from the verified token."""
from __future__ import annotations

from typing import Protocol

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
