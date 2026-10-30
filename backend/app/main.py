from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Callable, Optional

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from .auth import (HS256Verifier, JWKSVerifier, SupabaseTokenVerifier, TokenVerifier, extract_bearer,
                   identity_from_claims, require_admin)
from .config import Settings
from .errors import DomainError, bad_request, forbidden
from .geo import Geocoder, NoopGeocoder
from .llm_provider import AnthropicProvider, SummaryProvider
from .models import (Booking, BookingRequestIn, ClinicalOutcomeIn, Identity, ReassignIn, Staff,
                     VisitReportIn, booking_to_dict)
from .repo import Repository
from .risk import HttpPredictiveClient, PredictiveClient, RiskService
from .service import BookingService
from .state import display_state
from .summary import (SummaryDraftIn, SummaryLimiter, build_source, generate_draft, normalize_notes, source_fingerprint,
                      verify_generation)


def _view(b: Booking) -> dict:
    return booking_to_dict(b, display_state(
        b.approval_status, b.status, b.workflow_status, b.checked_in_at is not None))


def create_app(settings: Settings | None = None,
               verifier: TokenVerifier | None = None,
               repo_factory: Callable[[str], Repository] | None = None,
               geocoder: Geocoder | None = None,
               clock: Callable[[], datetime] | None = None,
               predictive_client: PredictiveClient | None = None,
               summary_provider: SummaryProvider | None = None,
               summary_limiter: SummaryLimiter | None = None) -> FastAPI:
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

    summary_ready = bool(cfg.summary_enabled and len(cfg.summary_signing_secret) >= 32
                         and (summary_provider is not None or cfg.llm_api_key))
    if summary_provider is None and summary_ready:
        summary_provider = AnthropicProvider(cfg.llm_api_key, cfg.llm_model, cfg.llm_timeout_seconds,
                                             cfg.llm_max_output_tokens, cfg.llm_temperature)
    limiter = summary_limiter or SummaryLimiter(cfg.summary_rate_per_minute)

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

    def _ai_provenance(body: VisitReportIn, who: Identity, booking_id: int) -> Optional[dict]:
        """Columns to store when the nurse completes the visit with an approved AI draft. Any mismatch is rejected (422/409);
        a visit without `ai` is completed exactly as before - AI can never block manual completion."""
        if body.ai is None:
            return None
        if not cfg.summary_enabled:
            raise DomainError(409, "summary_disabled", "תיעוד בסיוע AI כבוי; יש להשלים את הביקור בתיעוד ידני.")
        if not cfg.summary_db_provenance_ready:
            raise DomainError(409, "summary_db_not_ready", "תיעוד מקור ה-AI דורש עדכון מסד נתונים שטרם בוצע; יש להשלים את הביקור בתיעוד ידני.")
        if len(cfg.summary_signing_secret) < 32:
            raise DomainError(503, "summary_not_configured", "שירות ה-AI אינו מוגדר כראוי. אפשר להמשיך בתיעוד ידני.")
        if not body.ai.approved or not (body.source_notes or "").strip():
            raise bad_request("ai_not_approved", "הטיוטה לא אושרה או שהערות המקור חסרות.")
        vitals = {k: getattr(body, k) for k in ("systolic_bp", "diastolic_bp", "blood_sugar", "pulse", "temperature", "oxygen_saturation")}
        procs = [k for k in ("performed_blood_draw", "performed_injection", "performed_infusion",
                             "performed_dressing_change", "performed_catheter_change") if getattr(body, k)]
        claims = verify_generation(cfg.summary_signing_secret, body.ai.generation_token, user_id=who.user_id,
                                   booking_id=booking_id, fingerprint=source_fingerprint(vitals, procs, body.source_notes),
                                   now=clock().timestamp(), final_text=body.treatment_summary)
        return {"source_notes": normalize_notes(body.source_notes), "ai_assisted": True, "ai_edited": claims["ai_edited"],
                "ai_model": claims["m"], "ai_prompt_version": claims["pv"], "ai_generation_id": claims["gid"]}

    @app.post("/staff/visits/{booking_id}/complete")
    def complete(booking_id: int, body: VisitReportIn, c: Ctx = Depends(ctx)):
        extra = _ai_provenance(body, c.identity, booking_id)
        if c.identity.is_admin:  # identity from the verified JWT only
            report = c.svc.complete_admin(booking_id, body, extra)
        else:
            report = c.svc.complete(c.staff(), booking_id, body, extra)
        out = {"report": report}
        if extra and not (isinstance(report, dict) and report.get("ai_assisted") is True):
            out["ai_provenance_saved"] = False   # the DB function predates migration 014: the visit is saved, provenance is not
        return out

    @app.post("/staff/visits/{booking_id}/summary-draft")
    async def summary_draft(booking_id: int, body: SummaryDraftIn, c: Ctx = Depends(ctx)):
        """Opt-in AI DRAFT of the visit summary. Saves nothing and changes no booking; the nurse reviews, edits and approves it in the
        form, then completes the visit through /complete."""
        if not cfg.summary_enabled:
            raise DomainError(503, "summary_disabled", "יצירת טיוטת AI כבויה. אפשר להמשיך בתיעוד ידני.")
        if not cfg.summary_db_provenance_ready:
            raise DomainError(503, "summary_db_not_ready", "תיעוד מקור ה-AI דורש עדכון מסד נתונים שטרם בוצע, ולכן יצירת טיוטה כבויה. אפשר להמשיך בתיעוד ידני.")
        if not summary_ready or summary_provider is None:
            raise DomainError(503, "summary_not_configured", "שירות ה-AI אינו מוגדר. אפשר להמשיך בתיעוד ידני.")
        staff = None if c.identity.is_admin else await run_in_threadpool(c.staff)
        booking = await run_in_threadpool(c.svc.booking_for_summary, staff, booking_id)
        src = build_source(body, booking.scheduled_at, cfg.timezone)
        limiter.acquire(c.identity.user_id)
        try:
            return await generate_draft(provider=summary_provider, src=src, user_id=c.identity.user_id, booking_id=booking_id,
                                        model_hint=cfg.llm_model, secret=cfg.summary_signing_secret,
                                        max_chars=cfg.summary_max_draft_chars, token_ttl=cfg.summary_token_ttl_seconds, now=clock)
        finally:
            limiter.release(c.identity.user_id)

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
