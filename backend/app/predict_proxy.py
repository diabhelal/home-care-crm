"""Authenticated pass-through from the browser to the predictive service.

In the hosted deployment the predictive service listens on 127.0.0.1 inside the backend
container, so the browser cannot reach it directly. These routes forward the browser's JSON
UNCHANGED to the existing predictive endpoints: no formula, threshold or response is
computed or altered here. What they add is access control:

* a valid Supabase user JWT (same verifier as every other backend route);
* role: admin only for service-wide planning (capacity, plan/generate-visits); active staff
  or admin for the patient-scoped clinical views;
* patient: the patient-scoped routes require `X-Patient-Id`, and the patient must be visible
  to the caller under RLS with the caller's own JWT (assigned staff or admin). No elevated key.

Training endpoints are never routed. Request bodies are capped and never logged.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Callable, Optional, Union

from fastapi import Body, Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse

from .auth import require_admin
from .errors import DomainError, forbidden
from .risk import UNAVAILABLE_MSG, PredictiveClient, PredictiveUnavailable

log = logging.getLogger("app.predict_proxy")

MAX_BODY_BYTES = 64 * 1024
ADMIN_ONLY = {"/predict/capacity", "/plan/generate-visits"}
PATIENT_SCOPED = {"/predict/risk-assessment", "/predict/medical-warning",
                  "/predict/vitals-forecast", "/predict/baseline"}
ROUTES = ADMIN_ONLY | PATIENT_SCOPED
_PATIENT_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def _limited(path: str) -> bool:
    return path in ROUTES


def install_body_limit(app: FastAPI) -> None:
    """Reject oversized bodies on the proxy routes before they are read."""
    @app.middleware("http")
    async def _cap(request: Request, call_next):
        if request.method == "POST" and _limited(request.url.path):
            length = request.headers.get("content-length")
            if length is None:
                return JSONResponse({"code": "length_required", "detail": "נדרש אורך בקשה"}, status_code=411)
            try:
                too_big = int(length) > MAX_BODY_BYTES
            except ValueError:
                too_big = True
            if too_big:
                return JSONResponse({"code": "payload_too_large", "detail": "הבקשה גדולה מדי"}, status_code=413)
        return await call_next(request)


def register(app: FastAPI, ctx_dep, predictive: PredictiveClient) -> None:
    def _authorize(c, path: str, patient_id: Optional[str]) -> None:
        if path in ADMIN_ONLY:
            require_admin(c.identity)
            return
        if not c.identity.is_admin:
            c.staff()                       # 403 for patients / inactive staff
        if not patient_id or not _PATIENT_ID.match(patient_id):
            raise DomainError(400, "patient_required", "חסר מזהה מטופל")
        if c.svc.repo.get_patient_risk_context(patient_id) is None:   # RLS: not assigned / not visible
            raise forbidden("אין הרשאה למטופל זה")

    def _forward(path: str, body: object) -> JSONResponse:
        try:
            status, data = predictive.forward(path, body)
        except PredictiveUnavailable as e:
            log.warning("predictive proxy unavailable path=%s reason=%s", path, e)
            return JSONResponse({"code": "predictive_unavailable", "detail": UNAVAILABLE_MSG}, status_code=503)
        if status >= 400:
            # 422 from the service lists field errors only (it never echoes the input); others are opaque
            if status == 422:
                return JSONResponse(data, status_code=422)
            return JSONResponse({"code": "predictive_rejected", "detail": "הבקשה לשירות התחזית נדחתה"},
                                status_code=400)
        return JSONResponse(data, status_code=200)

    def _make(path: str) -> Callable:
        def endpoint(body: Union[dict, list] = Body(...), c: Any = Depends(ctx_dep),
                     x_patient_id: Optional[str] = Header(default=None, max_length=64)):
            _authorize(c, path, x_patient_id)
            return _forward(path, body)
        endpoint.__name__ = "proxy_" + path.strip("/").replace("/", "_").replace("-", "_")
        return endpoint

    for p in sorted(ROUTES):
        app.post(p)(_make(p))

    @app.get("/predict/health")
    def predict_health():
        """Is the internal predictive process answering? Status only, no details."""
        ok = False
        try:
            ok = bool(predictive.health())
        except Exception:
            ok = False
        return JSONResponse({"status": "ok" if ok else "unavailable"}, status_code=200 if ok else 503)
