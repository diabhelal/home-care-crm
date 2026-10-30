"""Focused LLM provider integration for the visit-summary draft (Anthropic Messages API over httpx).

Design constraints (see docs/AI_SUMMARY.md):
- the API key lives only in server settings and is never logged or returned;
- async client with a bounded timeout, NO automatic retries (a retry would duplicate provider charges);
- structured output via `output_config.format` (JSON schema), validated again by app/summary.py;
- provider error bodies are never surfaced: every failure maps to a small error code.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional, Protocol

import httpx

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


class ProviderError(Exception):
    """code: timeout | rate_limited | unavailable | auth | bad_output (never carries the provider's message)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ProviderResult:
    text: str                      # the JSON text produced under the schema
    model: str
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None


class SummaryProvider(Protocol):
    async def generate(self, system: str, user: str, schema: dict) -> ProviderResult: ...


class AnthropicProvider:
    def __init__(self, api_key: str, model: str, timeout_seconds: float, max_output_tokens: int,
                 temperature: Optional[float] = None, transport: httpx.AsyncBaseTransport | None = None,
                 url: str = ANTHROPIC_URL):
        self._key, self._model = api_key, model
        self._timeout, self._max_tokens, self._temperature = timeout_seconds, max_output_tokens, temperature
        self._transport, self._url = transport, url

    async def generate(self, system: str, user: str, schema: dict) -> ProviderResult:
        body: dict = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_config": {"format": {"type": "json_schema", "schema": schema}},
        }
        if self._temperature is not None:        # not sent by default: some models reject it
            body["temperature"] = self._temperature
        headers = {"content-type": "application/json", "x-api-key": self._key,
                   "anthropic-version": ANTHROPIC_VERSION}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self._timeout), transport=self._transport) as client:
                r = await client.post(self._url, headers=headers, content=json.dumps(body, ensure_ascii=False).encode())
        except httpx.TimeoutException as e:
            raise ProviderError("timeout") from None
        except httpx.HTTPError:
            raise ProviderError("unavailable") from None
        if r.status_code in (401, 403):
            raise ProviderError("auth")
        if r.status_code == 429:
            raise ProviderError("rate_limited")
        if r.status_code >= 400:
            raise ProviderError("unavailable")
        try:
            data = r.json()
        except ValueError:
            raise ProviderError("bad_output") from None
        if not isinstance(data, dict) or data.get("stop_reason") in ("max_tokens", "refusal"):
            raise ProviderError("bad_output")
        text = next((b.get("text") for b in data.get("content", []) if isinstance(b, dict) and b.get("type") == "text"), None)
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("bad_output")
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        return ProviderResult(text=text, model=str(data.get("model") or self._model),
                              input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"))


class FakeSummaryProvider:
    """Scripted provider for tests: records every prompt, never touches the network."""

    def __init__(self, responder=None, delay: float = 0.0):
        self.calls: list[dict] = []
        self.responder = responder
        self.delay = delay

    async def generate(self, system: str, user: str, schema: dict) -> ProviderResult:
        import asyncio
        self.calls.append({"system": system, "user": user, "schema": schema})
        if self.delay:
            await asyncio.sleep(self.delay)
        out = self.responder(system, user) if self.responder else {"draft_text": "סיכום בדיקה.", "warnings": []}
        if isinstance(out, Exception):
            raise out
        text = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
        return ProviderResult(text=text, model="fake-model", input_tokens=10, output_tokens=5)
