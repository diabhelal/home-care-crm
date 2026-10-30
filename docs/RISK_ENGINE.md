# Risk engine (rule-based decision support)

> Short version for readers: the Green / Yellow / Red indicator is **hand-written clinical rules plus classical statistics, not a trained ML model**, and is labelled "rule-based - demonstration" in the UI. Overview: [README](../README.md). Thresholds for clinician review: [`predictive-service/CLINICAL_THRESHOLDS_FOR_REVIEW.md`](../predictive-service/CLINICAL_THRESHOLDS_FOR_REVIEW.md).

**Meaning of the colours:** red = a dangerous value (for example a critical pulse or oxygen saturation under 90%), yellow = borderline, green = within the configured band. The overall level is the worst band among the vitals that were supplied; a background condition can escalate a yellow vital to red. A missing vital is never treated as normal.

**This is explicitly rule-based decision support, not a trained or validated machine-learning system for diagnosing medical events.** The distinction matters and is maintained throughout the codebase and this document.

The `predictive-service` (Python/FastAPI, `predictive-service/main.py`) exposes:

13 endpoints exist in `main.py`; the ones the frontend actually calls today:

| Endpoint | What it does |
|---|---|
| `POST /predict/capacity` | Arithmetic forecast: `(visits_this_month / active_patients) × (active_patients × (1 + growth_rate))`, rounded — an estimate of next month's expected visit volume, used for supply/staffing planning in the admin dashboard. |
| `POST /predict/risk-level` | Classifies a single set of vitals into Green/Yellow/Red using fixed, hand-written clinical threshold bands per vital (e.g. oxygen saturation <90% = red), optionally escalated by background medical conditions/smoking status. The overall result is the worst band among whichever vitals were supplied. |
| `POST /predict/risk-assessment` | The persisted version used by the app: classifies the current vitals, and if a previous visit's vitals are supplied, compares the two results to derive a `trend` (`improving`/`stable`/`worsening`). Always returns `probability: null` — explained below. |
| `POST /predict/vitals-forecast` | Forecasts a single vital's next value: linear regression by default, or an ARIMA time-series model once enough history points exist for that patient (superseded the earlier, now-removed `/predict/vitals-trend`). |
| `POST /predict/baseline` | Compares a patient's recent vitals against their own historical baseline per vital, flagging sudden changes or a worsening trend. |
| `POST /predict/medical-warning` | Aggregates baseline/anomaly/trend/risk signals across a patient's full vitals history into one combined "אבחון מקיף" result. |
| `POST /plan/generate-visits` | Given a service plan's date range and preferred weekdays, returns the concrete dates to create `service_plan_visits` rows for. |
| `POST /alerts/evaluate` | Rule-based check of whether a new risk reading should raise a clinical alert (e.g. new Red, worsening trend, repeated abnormal). |

Endpoints that exist but have no current caller in the frontend (kept as working, intentionally-scoped API surface, not dead code — see the code comments in `ml_targets.py`): `/predict/anomalies`, `/predict/vitals-timeseries`, `/predict/future-event`, `/train/{target}/{algorithm}`.

**Time-aware risk history:** every risk assessment is stored as an immutable, timestamped row in `risk_predictions` with an explicit `prediction_horizon_hours` (default 8) and a computed `expires_at`. A patient's "current risk" is derived — via the `current_patient_risk` view — as their most recent *non-expired* assessment. An assessment that has passed its horizon silently stops counting as current (it is never inferred to mean the patient remains high-risk indefinitely), and a newer assessment always supersedes an older one even before the older one's horizon has elapsed. Older rows remain queryable as history; none are ever overwritten.

**What this system deliberately does *not* do:**
- It does not predict specific future medical events (e.g. a heart attack or a hypoglycemic episode) — the repository contains no outcome-labeled dataset (no field anywhere records a real historical adverse-event outcome), so no such classifier could be trained or validated here, and none was built.
- `risk_predictions.probability` exists as a schema field reserved for a genuine future trained model, but is `null` in every row produced by the current rule-based logic — it is never fabricated.
- `risk_predictions.confidence` is **not** a statistical/medical probability; it is the fraction of the six vitals that were actually supplied for that reading (a data-completeness score), documented as such directly on the database column.
- There is no paging or "emergency" workflow: alert rows are generated server-side and shown on screen (dashboards, patient record), and a risk badge is a passive indicator that a human must look at; nothing is pushed by email, SMS or phone to staff or patients.

### What is machine learning and what is not

| Mechanism | Location | Kind | Honest status |
|---|---|---|---|
| Per-vital risk level (green/yellow/red) and background-condition escalation | `main.py` `classify_*`, `compute_risk` | **Hand-written clinical rules** | Active. Generic thresholds, not validated for this project; see `CLINICAL_THRESHOLDS_FOR_REVIEW.md` |
| Trend vs. previous visit | `compute_trend` | Rule (level comparison) | Active |
| Personal baseline, sudden change, persistent abnormal, anomalies | `clinical_baseline.py` | **Descriptive statistics** (median, rate of change, fixed thresholds) | Active; no trained model |
| Vital forecast | `main.py` `_linear_forecast`, `timeseries.py` | **Linear regression**; **ARIMA(1,1,0)** (statsmodels) when ≥ 8 measurements | Active; classical statistics, not a learned clinical model |
| Capacity forecast | `/predict/capacity` | Arithmetic projection (growth rate) | Active |
| Future-event classifiers (Logistic Regression / Decision Tree / Random Forest / KNN) | `ml_targets.py` | **Supervised ML (scikit-learn)** | **Architecture only — no model is trained** (`models/` is empty) because no labelled clinical-outcome data exists. Returns `model_available=false` rather than inventing a probability |
| LSTM | `lstm_interface.py` | Placeholder | Not implemented (needs far more longitudinal data) |

So the system today is a **rule-based decision-support tool with classical statistics**. It is not a trained ML product and must not be described as one. The risk panel is labelled "rule-based risk assessment — demonstration only".

## Status of the "current risk" display
On `main` and the live database, the `current_patient_risk` view only returns an assessment while it is inside its 8-hour horizon, so a patient's colour disappears 8 hours after the visit. The client already shows the age ("assessed 3 days ago"), an "outdated" label after 24 hours and a flag when a newer report has no assessment, but the view change that keeps the latest assessment visible is migration `011`, **not applied** to the live database ([DATABASE.md](DATABASE.md)). Also, the predictive service runs locally and manually; the last assessment stored in the live database dates from 2026-09-19, so without a running service no new assessments are produced.
