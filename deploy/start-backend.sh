#!/bin/sh
# Railway backend container entrypoint (run under `tini -g`, see backend/Dockerfile.railway).
#
# Two processes, one container:
#   * predictive-service  -> 127.0.0.1:8000 only (never public). Supervised by a restart loop, so a crash
#                            of the predictive service never stops the backend; risk calls answer 503 meanwhile
#                            and visit reports / measurements still save (they never call it).
#   * backend (FastAPI)   -> 0.0.0.0:$PORT (Railway's port). It is the container's main process: if it exits,
#                            the container exits and Railway restarts it.
# Shutdown: tini -g forwards SIGTERM to the whole process group (backend, loop and predictive).
# No migrations, seeds or other database writes ever run here.
set -eu

PORT="${PORT:-8001}"
export DISABLE_TRAINING=1
export PREDICTIVE_SERVICE_URL="${PREDICTIVE_SERVICE_URL:-http://127.0.0.1:8000}"

(
  cd /app/predictive-service
  while true; do
    /opt/predictive/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --no-server-header \
      --log-level warning --timeout-graceful-shutdown 5 || true
    echo "predictive-service exited; restarting in 2s" >&2
    sleep 2
  done
) &

cd /app/backend
exec /opt/backend/bin/uvicorn app.main:app --host 0.0.0.0 --port "$PORT" \
  --proxy-headers --forwarded-allow-ips '*' --no-server-header --timeout-graceful-shutdown 8
