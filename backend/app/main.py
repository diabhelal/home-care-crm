from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Callable, Optional

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import (HS256Verifier, JWKSVerifier, SupabaseTokenVerifier, TokenVerifier, extract_bearer,
                   identity_from_claims, require_admin)
from .config import Settings
from .errors import DomainError, forbidden
from .geo import Geocoder, NoopGeocoder
from .models import (Booking, BookingRequestIn, ClinicalOutcomeIn, Identity, ReassignIn, Staff,
                     VisitReportIn, booking_to_dict)
from .repo import Repository
from .risk import HttpPredictiveClient, PredictiveClient, RiskService
from .service import BookingService
from .state import display_state


def _view(b: Booking) -> dict:
    return booking_to_dict(b, display_state(
        b.approval_status, b.status, b.workflow_status, b.checked_in_at is not None))


def create_app(settings: Settings | None = None,
               verifier: TokenVerifier | None = None,
               repo_factory: Callable[[str], Repository] | None = None,
               geocoder: Geocoder | None = None,
               clock: Callable[[], datetime] | None = None,
               predictive_client: PredictiveClient | None = None) -> FastAPI:
    cfg = settings or Settings.from_env()
    if verifier is None:
        jwks_url = f"{cfg.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json" if cfg.supabase_url else ""
        verifier = SupabaseTokenVerifier(
            HS256Verifier(cfg.supabase_jwt_secret) if cfg.supabase_jwt_secret else None,
            JWKSVerifier(jwks_url) if jwks_url else None,
        )
    geocoder = geocoder or NoopGeocoder()
    clock = clock or (lambda: datetime.now(timezone.utc))
    if repo_factory is None:
        from .supabase_repo import SupabaseRepo
        repo_factory = lambda jwt: SupabaseRepo(cfg.supabase_url, cfg.supabase_anon_key, jwt)

    predictive = predictive_client or HttpPredictiveClient(
        cfg.predictive_service_url, cfg.predictive_timeout_seconds)

    app = FastAPI(title="home-care-crm backend")
    if cfg.allowed_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(cfg.allowed_origins),
                           allow_methods=["GET", "POST", "PATCH"],
                           allow_headers=["Authorization", "Content-Type", "Idempotency-Key"])

    @app.exception_handler(DomainError)
    async def _domain(_: Request, e: DomainError):
        return JSONResponse({"code": e.code, "detail": e.message}, status_code=e.status)

    class Ctx:
        def __init__(self, identity: Identity, svc: BookingService):
            self.identity, self.svc = identity, svc

        @property
        def risk(self) -> RiskService:
            return RiskService(self.svc.repo, predictive, cfg.risk_attestation_secret, clock)

        def staff(self) -> Staff:
            s = self.svc.repo.get_staff_by_auth_user(self.identity.user_id)
            if s is None or not s.is_active:
                raise forbidden("נדרשת הרשאת צוות")
            return s

    def ctx(authorization: Optional[str] = Header(default=None)) -> Ctx:
        token = extract_bearer(authorization)
        identity = identity_from_claims(verifier.verify(token))
        return Ctx(identity, BookingService(repo_factory(token), cfg, geocoder, clock))

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/availability")
    def availability(start: date, end: date, staff_id: Optional[int] = None,
                     address: Optional[str] = Query(default=None), c: Ctx = Depends(ctx)):
        return {"slots": c.svc.availability(start, end, staff_id, address),
                "travel_buffer_minutes": cfg.travel_buffer_minutes}

    @app.post("/bookings/request", status_code=201)
    def request_booking(body: BookingRequestIn, request: Request,
                        idempotency_key: Optional[str] = Header(default=None),
                        c: Ctx = Depends(ctx)):
        b, created = c.svc.request_booking(c.identity, body, idempotency_key)
        return JSONResponse(_view(b), status_code=201 if created else 200)

    @app.post("/bookings/{booking_id}/cancel")
    def cancel_own(booking_id: int, c: Ctx = Depends(ctx)):
        return _view(c.svc.cancel_own(c.identity, booking_id))

    @app.post("/admin/bookings/{booking_id}/cancel")
    def cancel_admin(booking_id: int, c: Ctx = Depends(ctx)):
        require_admin(c.identity)
        return _view(c.svc.cancel_admin(booking_id))

    @app.post("/admin/bookings/{booking_id}/approve")
    def approve(booking_id: int, c: Ctx = Depends(ctx)):
        require_admin(c.identity)
        return _view(c.svc.approve(booking_id))

    @app.post("/admin/bookings/{booking_id}/reject")
    def reject(booking_id: int, c: Ctx = Depends(ctx)):
        require_admin(c.identity)
        return _view(c.svc.reject(booking_id))

    @app.post("/admin/bookings/{booking_id}/reassign")
    def reassign(booking_id: int, body: ReassignIn, c: Ctx = Depends(ctx)):
        require_admin(c.identity)
        return _view(c.svc.reassign(booking_id, body.staff_id))

    @app.post("/staff/bookings/{booking_id}/check-in")
    def check_in(booking_id: int, c: Ctx = Depends(ctx)):
        if c.identity.is_admin:  # identity from the verified JWT only
            return _view(c.svc.check_in_admin(booking_id))
        return _view(c.svc.check_in(c.staff(), booking_id))

    @app.post("/staff/visits/{booking_id}/complete")
    def complete(booking_id: int, body: VisitReportIn, c: Ctx = Depends(ctx)):
        if c.identity.is_admin:  # identity from the verified JWT only
            return {"report": c.svc.complete_admin(booking_id, body)}
        return {"report": c.svc.complete(c.staff(), booking_id, body)}

    @app.patch("/visits/{report_id}/clinical-outcome")
    def clinical_outcome(report_id: int, body: ClinicalOutcomeIn, c: Ctx = Depends(ctx)):
        staff = None if c.identity.is_admin else c.staff()
        return {"report": c.svc.set_clinical_outcome(
            c.identity, staff, report_id, body.clinical_outcome_8h)}

    @app.post("/visits/{report_id}/risk-assessment")
    def risk_assessment(report_id: int, c: Ctx = Depends(ctx)):
        staff = None if c.identity.is_admin else c.staff()
        return c.risk.assess_visit(c.identity, staff, report_id)

    @app.post("/patients/{patient_id}/auto-alert")
    def auto_alert(patient_id: str, c: Ctx = Depends(ctx)):
        if not c.identity.is_admin:
            c.staff()   # staff only (RLS further limits to assigned patients)
        return c.risk.auto_alert(c.identity, patient_id)

    return app


def _default_app() -> FastAPI:
    return create_app()


app = _default_app()
