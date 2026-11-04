import sys; sys.path.insert(0, "/Users/helaldiab/home-care-crm/predictive-service")
from fastapi.testclient import TestClient
import main
c = TestClient(main.app, raise_server_exceptions=False)
def post(path, raw):
    r = c.post(path, content=raw, headers={"Content-Type": "application/json"})
    return r.status_code, r.text[:160]
P = '{"points":[{"measured_at":"2026-01-01T00:00:00Z","value":%s},{"measured_at":"2026-01-01T01:00:00Z","value":80}],"horizon":"8h","vital":"pulse"}'
for label, v in [("NaN", "NaN"), ("Infinity", "Infinity"), ("null", "null"), ("normal 70", "70")]:
    print("vitals-forecast", label, "->", post("/predict/vitals-forecast", P % v))
W = '{"patient_context":{"age":50,"background_conditions":[],"smoking_status":null},"history":[{"measured_at":"2026-01-01T00:00:00Z","pulse":%s}],"horizon":"8h"}'
for label, v in [("NaN", "NaN"), ("normal 70", "70")]:
    print("medical-warning", label, "->", post("/predict/medical-warning", W % v))
