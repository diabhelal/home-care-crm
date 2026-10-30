"""Anthropic provider adapter against a mocked transport: request shape, error mapping, and that the key never leaks."""
import asyncio
import json

import httpx
import pytest

from app.llm_provider import AnthropicProvider, ProviderError

KEY = "sk-test-not-a-real-key-123456"
SCHEMA = {"type": "object", "properties": {"draft_text": {"type": "string"}}, "required": ["draft_text"], "additionalProperties": False}


def provider(handler, **kw):
    return AnthropicProvider(KEY, kw.pop("model", "claude-sonnet-5-5"), 5.0, 2000, transport=httpx.MockTransport(handler), **kw)


def run(coro):
    return asyncio.run(coro)


def ok(req):
    return httpx.Response(200, json={"model": "claude-sonnet-5-5", "stop_reason": "end_turn",
                                     "content": [{"type": "thinking", "thinking": "hidden"}, {"type": "text", "text": '{"draft_text":"שלום"}'}],
                                     "usage": {"input_tokens": 120, "output_tokens": 30}})


def test_request_shape_headers_and_structured_output():
    seen = {}
    def h(req):
        seen["req"], seen["body"] = req, json.loads(req.content)
        return ok(req)
    res = run(provider(h).generate("SYS", "USER", SCHEMA))
    assert str(seen["req"].url) == "https://api.anthropic.com/v1/messages"
    assert seen["req"].headers["x-api-key"] == KEY and seen["req"].headers["anthropic-version"] == "2023-06-01"
    b = seen["body"]
    assert b["model"] == "claude-sonnet-5-5" and b["max_tokens"] == 2000 and b["system"] == "SYS"
    assert b["messages"] == [{"role": "user", "content": "USER"}]
    assert b["output_config"] == {"format": {"type": "json_schema", "schema": SCHEMA}}
    assert "temperature" not in b                                      # not sent unless configured
    assert res.text == '{"draft_text":"שלום"}' and res.input_tokens == 120 and res.output_tokens == 30   # thinking block is ignored


def test_temperature_only_when_configured():
    seen = {}
    def h(req):
        seen["b"] = json.loads(req.content); return ok(req)
    run(provider(h, temperature=0.0).generate("s", "u", SCHEMA))
    assert seen["b"]["temperature"] == 0.0


@pytest.mark.parametrize("status,code", [(401, "auth"), (403, "auth"), (429, "rate_limited"), (500, "unavailable"), (529, "unavailable"), (400, "unavailable")])
def test_http_errors_map_to_codes_without_the_provider_message(status, code):
    p = provider(lambda r: httpx.Response(status, json={"error": {"message": f"secret detail {KEY}"}}))
    with pytest.raises(ProviderError) as e:
        run(p.generate("s", "u", SCHEMA))
    assert e.value.code == code and KEY not in str(e.value) and "secret detail" not in str(e.value)


def test_timeout_and_connection_errors_have_no_retry():
    calls = []
    def boom(req):
        calls.append(1); raise httpx.ReadTimeout("slow", request=req)
    with pytest.raises(ProviderError) as e:
        run(provider(boom).generate("s", "u", SCHEMA))
    assert e.value.code == "timeout" and len(calls) == 1               # exactly one provider call: no duplicate charges
    def down(req):
        raise httpx.ConnectError("no route", request=req)
    with pytest.raises(ProviderError) as e2:
        run(provider(down).generate("s", "u", SCHEMA))
    assert e2.value.code == "unavailable"


@pytest.mark.parametrize("resp", [
    httpx.Response(200, text="not json"), httpx.Response(200, json=[1]),
    httpx.Response(200, json={"stop_reason": "max_tokens", "content": [{"type": "text", "text": "{}"}]}),
    httpx.Response(200, json={"stop_reason": "refusal", "content": [{"type": "text", "text": "no"}]}),
    httpx.Response(200, json={"stop_reason": "end_turn", "content": []}),
    httpx.Response(200, json={"stop_reason": "end_turn", "content": [{"type": "text", "text": "   "}]})])
def test_unusable_responses_are_bad_output(resp):
    with pytest.raises(ProviderError) as e:
        run(provider(lambda r: resp).generate("s", "u", SCHEMA))
    assert e.value.code == "bad_output"
