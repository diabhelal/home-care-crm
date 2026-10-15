"""Settings read from environment only. No secrets in code."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


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
        )
