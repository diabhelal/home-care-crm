"""Settings read from environment only. No secrets in code."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional


def _csv(value: str) -> tuple[str, ...]:
    return tuple(v.strip() for v in value.split(",") if v.strip())


@dataclass(frozen=True)
class Settings:
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_jwt_secret: str = ""
    allowed_origins: tuple[str, ...] = ()
    travel_buffer_minutes: int = 30
    offered_purposes: tuple[str, ...] = (
        "checkup", "wound_care", "blood_test", "medication", "other",
    )
    eligible_roles: tuple[str, ...] = ("nurse",)
    timezone: str = "Asia/Jerusalem"
    max_availability_days: int = 31
    predictive_service_url: str = "http://localhost:8000"
    predictive_timeout_seconds: float = 5.0
    risk_attestation_secret: str = ""
    # --- AI visit-summary DRAFT (opt-in, disabled by default; synthetic data only in this phase) ---
    summary_enabled: bool = False
    llm_api_key: str = ""
    # Current model ids: https://platform.claude.com/docs/en/about-claude/models/overview (verified 2026-10-30). Override with LLM_MODEL.
    llm_model: str = "claude-sonnet-5-5"
    llm_timeout_seconds: float = 25.0
    llm_max_output_tokens: int = 2000
    llm_temperature: Optional[float] = None      # unset by default: not every model accepts it
    summary_signing_secret: str = ""            # HMAC key (>=32 chars) for the provenance token; independent of the risk secret
    summary_max_draft_chars: int = 1500
    summary_rate_per_minute: int = 6
    summary_token_ttl_seconds: int = 7 * 24 * 3600   # long enough for an offline-queued completion

    @classmethod
    def from_env(cls, env: dict | None = None) -> "Settings":
        e = os.environ if env is None else env
        d = cls()
        return cls(
            supabase_url=e.get("SUPABASE_URL", ""),
            supabase_anon_key=e.get("SUPABASE_ANON_KEY", ""),
            supabase_jwt_secret=e.get("SUPABASE_JWT_SECRET", ""),
            allowed_origins=_csv(e.get("ALLOWED_ORIGINS", "")),
            travel_buffer_minutes=int(e.get("TRAVEL_BUFFER_MINUTES", d.travel_buffer_minutes)),
            offered_purposes=_csv(e.get("OFFERED_PURPOSES", "")) or d.offered_purposes,
            eligible_roles=_csv(e.get("ELIGIBLE_ROLES", "")) or d.eligible_roles,
            timezone=e.get("BUSINESS_TIMEZONE", d.timezone),
            predictive_service_url=e.get("PREDICTIVE_SERVICE_URL", d.predictive_service_url),
            predictive_timeout_seconds=float(e.get("PREDICTIVE_TIMEOUT_SECONDS", d.predictive_timeout_seconds)),
            risk_attestation_secret=e.get("RISK_ATTESTATION_SECRET", ""),
            summary_enabled=e.get("SUMMARY_ENABLED", "").strip().lower() in ("1", "true", "yes"),
            llm_api_key=e.get("LLM_API_KEY", ""),
            llm_model=e.get("LLM_MODEL", "") or d.llm_model,
            llm_timeout_seconds=float(e.get("LLM_TIMEOUT_SECONDS", d.llm_timeout_seconds)),
            llm_max_output_tokens=int(e.get("LLM_MAX_OUTPUT_TOKENS", d.llm_max_output_tokens)),
            llm_temperature=float(e["LLM_TEMPERATURE"]) if e.get("LLM_TEMPERATURE", "").strip() else None,
            summary_signing_secret=e.get("SUMMARY_SIGNING_SECRET", ""),
            summary_max_draft_chars=int(e.get("SUMMARY_MAX_DRAFT_CHARS", d.summary_max_draft_chars)),
            summary_rate_per_minute=int(e.get("SUMMARY_RATE_PER_MINUTE", d.summary_rate_per_minute)),
            summary_token_ttl_seconds=int(e.get("SUMMARY_TOKEN_TTL_SECONDS", d.summary_token_ttl_seconds)),
        )
