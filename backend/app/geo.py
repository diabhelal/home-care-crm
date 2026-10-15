from __future__ import annotations

import math
from typing import Optional, Protocol


class Geocoder(Protocol):
    def geocode(self, address: str) -> Optional[tuple[float, float]]:
        """Return (lat, lng) or None. Implementations must not block long."""


class NoopGeocoder:
    """Default: no external calls; proximity ranking is skipped.

    HOOK: to add a provider, implement `Geocoder` (e.g. a class calling your
    chosen geocoding API with a configured key from env) and pass it to
    `create_app(geocoder=...)`. Keep results cached; never call from the
    request path without a timeout.
    """

    def geocode(self, address: str) -> Optional[tuple[float, float]]:
        return None


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dphi, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))
