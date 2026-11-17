#!/usr/bin/env bash
# Builds the two Railway images and proves, with no cloud and no real credentials:
#   backend:  both processes start, health checks answer, predictive is private + authenticated,
#             a predictive crash does not take the backend down and is restarted, clean shutdown.
#   frontend: headers from public/_headers are served, service worker is no-cache, 404s, no localhost.
# Used by the `containers` CI job. Synthetic values only (example.supabase.co never answers; fine for these checks).
set -euo pipefail

BE=hc-backend-smoke; WEB=hc-web-smoke
cleanup() { docker rm -f "$BE" "$WEB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; docker logs "$BE" 2>&1 | tail -30 >&2 || true; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
wait_for() {  # url expected seconds
  for _ in $(seq 1 "$3"); do [ "$(code "$1")" = "$2" ] && return 0; sleep 1; done; return 1; }

docker build -q -f backend/Dockerfile.railway -t hc-backend . >/dev/null
docker build -q -f Dockerfile.web -t hc-web \
  --build-arg SUPABASE_URL=https://example.supabase.co --build-arg SUPABASE_ANON_KEY=sb_publishable_ci \
  --build-arg BACKEND_URL=https://backend.example.com --build-arg APP_ENV=production . >/dev/null

# ---------------- backend ----------------
docker run -d --name "$BE" -p 18001:8080 -e PORT=8080 \
  -e SUPABASE_URL=https://example.supabase.co -e SUPABASE_ANON_KEY=sb_publishable_ci \
  -e ALLOWED_ORIGINS=https://frontend.example.com hc-backend >/dev/null
B=http://127.0.0.1:18001
wait_for "$B/healthz" 200 60 || fail "backend /healthz not 200 within 60s"
wait_for "$B/predict/health" 200 60 || fail "internal predictive not healthy within 60s"
echo "ok: both processes started"

[ "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$B/predict/risk-assessment")" = 401 ] || fail "predictive route without token must be 401"
[ "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$B/train/risk/logistic")" = 404 ] || fail "/train must not be routed"
for p in /docs /openapi.json; do [ "$(code "$B$p")" = 404 ] || fail "$p exposed"; done
docker exec "$BE" /opt/backend/bin/python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2)" \
  || fail "predictive not answering on 127.0.0.1:8000 inside the container"
docker exec "$BE" /opt/backend/bin/python - <<'PY' || fail "predictive must listen on 127.0.0.1 only"
import socket
ip = socket.gethostbyname(socket.gethostname())
assert not ip.startswith("127."), ip
s = socket.socket(); s.settimeout(1)
assert s.connect_ex((ip, 8000)) != 0, "port 8000 reachable on the container address"
PY
[ "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://evil.example.com' -H 'Access-Control-Request-Method: POST' "$B/bookings/request")" != 200 ] \
  || fail "foreign origin accepted by CORS"
curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://frontend.example.com' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,x-patient-id' "$B/predict/baseline" | grep -qi '^access-control-allow-origin: https://frontend.example.com' \
  || fail "frontend origin not allowed by CORS"
echo "ok: auth, routing, private bind, CORS"

# kill the predictive process: backend stays up, predictive is restarted by the loop
docker exec "$BE" /opt/backend/bin/python - <<'PY'
import os, signal
for pid in filter(str.isdigit, os.listdir("/proc")):
    try:
        cmd = open(f"/proc/{pid}/cmdline", "rb").read().split(b"\0")
    except OSError:
        continue
    if b"main:app" in cmd and b"8000" in cmd:
        os.kill(int(pid), signal.SIGKILL)
PY
sleep 0.5
[ "$(code "$B/healthz")" = 200 ] || fail "backend went down with the predictive process"
wait_for "$B/predict/health" 200 15 || fail "predictive not restarted within 15s"
echo "ok: predictive crash isolated and restarted"

start=$(date +%s); docker stop -t 10 "$BE" >/dev/null; took=$(( $(date +%s) - start ))
[ "$took" -lt 10 ] || fail "shutdown took ${took}s (SIGTERM not handled)"
echo "ok: clean shutdown in ${took}s"

# ---------------- frontend ----------------
docker run -d --name "$WEB" -p 18080:8080 -e PORT=8080 hc-web >/dev/null
W=http://127.0.0.1:18080
wait_for "$W/" 200 30 || fail "frontend not serving"
h=$(curl -s -D - -o /dev/null "$W/index.html")
for name in content-security-policy strict-transport-security x-content-type-options x-frame-options referrer-policy x-robots-tag; do
  echo "$h" | grep -qi "^$name:" || fail "missing header $name"
done
echo "$h" | grep -qi "^content-security-policy:.*connect-src 'self' https://example.supabase.co wss://example.supabase.co https://backend.example.com;" || fail "CSP connect-src mismatch"
echo "$h" | grep -qi '^server:' && fail "Server header exposed"
curl -s -D - -o /dev/null "$W/service-worker.js" | grep -qi '^cache-control: no-cache' || fail "service worker not no-cache"
curl -s -D - -o /dev/null "$W/manifest.json" | grep -qi '^content-type: application/\(manifest+\)\?json' || fail "manifest content type"
[ "$(code "$W/does-not-exist.html")" = 404 ] || fail "missing path not 404"
[ "$(code "$W/Caddyfile")" = 404 ] || fail "Caddyfile served"
[ "$(code "$W/js/")" != 200 ] || fail "directory listing enabled"
curl -s "$W/config.js" | grep -q 'localhost' && fail "production config.js contains localhost"
curl -s "$W/config.js" | grep -q 'window.APP_ENV = "production";' || fail "APP_ENV not production"
echo "ok: frontend headers, caching, 404, production config"
echo "container smoke: ALL PASSED"
