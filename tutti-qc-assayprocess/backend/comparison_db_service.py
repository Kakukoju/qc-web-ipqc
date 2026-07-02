"""
Comparison DB Service — AI vs Human Build-Line Decision Analysis

Collects:
1. Human RD build-line decisions (from build_line_history in ipqcdrybeads.db)
2. AI curve-fitting results (from auto_curve_fit_service / ai_curve_score_service)

Stores comparison records in a standalone SQLite DB for:
- Analyzing divergence between human judgment and AI recommendations
- Production difference analysis (expandable schema)
- RAG knowledge base for Skyla AI production

Database path: /home/ubuntu/comparison_db/ai_human_comparison.db
Synced to S3 for downstream consumption.
"""

import json
import logging
import math
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)

# ─── Configuration ─────────────────────────────────────────────────────────────

COMPARISON_DB_DIR = Path(os.getenv(
    "COMPARISON_DB_DIR", "/home/ubuntu/comparison_db"
))
COMPARISON_DB_PATH = COMPARISON_DB_DIR / "ai_human_comparison.db"
S3_BUCKET = os.getenv("COMPARISON_S3_BUCKET", "beads-photos-harry")
S3_KEY_PREFIX = os.getenv("COMPARISON_S3_KEY_PREFIX", "comparison-db/")

IPQC_DB_PATH = Path(os.getenv("IPQC_DB_PATH", "/home/ubuntu/ipqcdrybeads.db"))


# ─── Schema ────────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS comparison_records (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Identifiers
    marker              TEXT NOT NULL,
    lot_code            TEXT NOT NULL,
    mfg_lot_no          TEXT,
    panel_name          TEXT,
    analyze_date        TEXT,
    species             TEXT,
    work_order_no       TEXT,

    -- Batch info (d, D, U)
    d_lot               TEXT,
    bigD_lot            TEXT,
    u_lot               TEXT,

    -- Human Decision
    human_equation      TEXT,
    human_model         TEXT,
    human_slope         REAL,
    human_intercept     REAL,
    human_r2            REAL,
    human_confirmed_by  TEXT,
    human_completed_at  TEXT,
    human_build_count   INTEGER,
    human_action_type   TEXT,

    -- AI Recommendation
    ai_equation         TEXT,
    ai_model            TEXT,
    ai_slope            REAL,
    ai_intercept        REAL,
    ai_r2               REAL,
    ai_curve_score      REAL,
    ai_strategy         TEXT,
    ai_outliers_removed INTEGER DEFAULT 0,

    -- Per-concentration metrics (JSON arrays)
    -- Each element: { level, assigned_conc, tea_pct, bias_pct, cv_pct, pass }
    human_level_metrics TEXT,
    ai_level_metrics    TEXT,

    -- Overall comparison
    decision_match      INTEGER DEFAULT 0,
    equation_diff_pct   REAL,
    tea_max_human       REAL,
    tea_max_ai          REAL,
    bias_max_human      REAL,
    bias_max_ai         REAL,
    cv_max_human        REAL,
    cv_max_ai           REAL,

    -- Metadata
    collected_at        TEXT NOT NULL,
    data_source         TEXT DEFAULT 'auto_collect',

    -- Rebuild tracking (改線歷史)
    build_version       INTEGER DEFAULT 1,
    prev_equation       TEXT,
    rebuild_reason      TEXT,

    -- Extensible fields for future production analysis
    extra_json          TEXT,

    UNIQUE(marker, lot_code, analyze_date, build_version)
);

CREATE INDEX IF NOT EXISTS idx_comp_marker ON comparison_records(marker);
CREATE INDEX IF NOT EXISTS idx_comp_lot ON comparison_records(lot_code);
CREATE INDEX IF NOT EXISTS idx_comp_date ON comparison_records(analyze_date);
CREATE INDEX IF NOT EXISTS idx_comp_panel ON comparison_records(panel_name);
CREATE INDEX IF NOT EXISTS idx_comp_collected ON comparison_records(collected_at);
CREATE INDEX IF NOT EXISTS idx_comp_match ON comparison_records(decision_match);

CREATE TABLE IF NOT EXISTS collection_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    collected_at    TEXT NOT NULL,
    records_added   INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_total   INTEGER DEFAULT 0,
    duration_ms     INTEGER,
    error           TEXT,
    synced_to_s3    INTEGER DEFAULT 0,
    s3_synced_at    TEXT
);
"""


# ─── DB Init ───────────────────────────────────────────────────────────────────

def _get_comparison_db() -> sqlite3.Connection:
    """Get connection to the comparison DB (auto-creates if needed)."""
    COMPARISON_DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(COMPARISON_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA_SQL)
    return conn


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(str(value).strip())
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def _as_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _get_rds_connection():
    """Get PostgreSQL connection to RDS."""
    from rds_sync_service import RDS_CONFIG
    return psycopg2.connect(**RDS_CONFIG)


# ─── Data Collection: Human Decisions ──────────────────────────────────────────

def _collect_human_decisions(since: str | None = None) -> list[dict]:
    """
    Read human build-line decisions from ipqcdrybeads.db (build_line_history table).
    Returns list of dicts with human decision data.
    """
    if not IPQC_DB_PATH.exists():
        logger.warning("IPQC DB not found: %s", IPQC_DB_PATH)
        return []

    conn = sqlite3.connect(str(IPQC_DB_PATH))
    conn.row_factory = sqlite3.Row

    query = """
        SELECT analyze_item, d_lot, bigD_lot, u_lot,
               work_order_no, mfg_lot_no, lot_code,
               panel_name, analyze_date, equation,
               test_well, species, points_json,
               completed_by, completed_at, build_count, task_id
        FROM build_line_history
    """
    params = []
    if since:
        query += " WHERE completed_at >= ?"
        params.append(since)
    query += " ORDER BY completed_at ASC"

    rows = conn.execute(query, params).fetchall()
    conn.close()

    results = []
    for row in rows:
        row_dict = dict(row)
        # Parse equation to extract model info
        eq = _as_text(row_dict.get("equation"))
        model, slope, intercept, r2 = _parse_equation(eq)
        results.append({
            "marker": _as_text(row_dict.get("analyze_item")),
            "lot_code": _as_text(row_dict.get("lot_code")) or _as_text(row_dict.get("mfg_lot_no")),
            "mfg_lot_no": _as_text(row_dict.get("mfg_lot_no")),
            "panel_name": _as_text(row_dict.get("panel_name")),
            "analyze_date": _as_text(row_dict.get("analyze_date")),
            "species": _as_text(row_dict.get("species")),
            "work_order_no": _as_text(row_dict.get("work_order_no")),
            "d_lot": _as_text(row_dict.get("d_lot")),
            "bigD_lot": _as_text(row_dict.get("bigD_lot")),
            "u_lot": _as_text(row_dict.get("u_lot")),
            "human_equation": eq,
            "human_model": model,
            "human_slope": slope,
            "human_intercept": intercept,
            "human_r2": r2,
            "human_confirmed_by": _as_text(row_dict.get("completed_by")),
            "human_completed_at": _as_text(row_dict.get("completed_at")),
            "human_build_count": row_dict.get("build_count") or 1,
            "points_json": row_dict.get("points_json"),
        })
    return results


def _parse_equation(equation: str) -> tuple[str, float | None, float | None, float | None]:
    """
    Parse equation string like:
    'y = 1.234x + 5.678; R2 = 0.999; n = 8'
    'conc = 1.234 * OD + 5.678'
    Returns (model, slope, intercept, r2).
    """
    import re
    if not equation:
        return ("unknown", None, None, None)

    model = "linear"
    slope = None
    intercept = None
    r2 = None

    # Detect model type
    if "ln(" in equation or "ln(OD)" in equation:
        model = "logarithmic"
    elif "OD^2" in equation or "OD²" in equation or "x²" in equation:
        model = "quadratic"

    # Extract R2
    r2_match = re.search(r'R[²2]\s*=\s*([\d.]+)', equation)
    if r2_match:
        r2 = _as_float(r2_match.group(1))

    # Extract slope and intercept for linear: y = <slope>x + <intercept>
    linear_match = re.search(
        r'[yc]\w*\s*=\s*([-\d.eE+]+)\s*\*?\s*[xO]', equation
    )
    if linear_match:
        slope = _as_float(linear_match.group(1))

    intercept_match = re.search(
        r'[+\-]\s*([\d.eE+]+)\s*(?:;|$)', equation
    )
    if intercept_match:
        intercept = _as_float(intercept_match.group(1))
        # Check if the sign before was minus
        sign_match = re.search(r'(-)\s*[\d.eE+]+\s*(?:;|$)', equation)
        if sign_match and intercept is not None:
            # Re-check: find the intercept with sign
            full_match = re.search(r'([-+]\s*[\d.eE+]+)\s*(?:;|$)', equation)
            if full_match:
                intercept = _as_float(full_match.group(1).replace(" ", ""))

    return (model, slope, intercept, r2)


# ─── Data Collection: AI Curve Fitting ─────────────────────────────────────────

def _collect_ai_results_for_group(
    lot_code: str, panel_name: str, analyze_date: str, species: str, marker: str
) -> dict | None:
    """
    Run AI curve scoring for a specific marker group via the existing
    auto_curve_fit_service logic (read-only, no writes).
    Returns AI fit result dict or None.
    """
    from auto_curve_fit_service import (
        _fetch_concentrations as fetch_conc,
        _get_rds_connection as get_pg,
        fit_model,
        apply_outlier_strategy,
        validate_clia,
        _fetch_spec_thresholds,
        CONTROL_IDS,
        CONTROL_CONC_COLUMNS,
        MODEL_TYPES,
        OUTLIER_STRATEGIES,
    )

    # Fetch raw OD points from RDS
    try:
        pg = get_pg()
        cur = pg.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute("""
            SELECT patient_id, final_delta_od, analyze_item, test_well
            FROM panel_production.assay_process_records
            WHERE LOWER(patient_id) IN ('control-1','control-2','control-3','control-4')
              AND analyze_item = %s
              AND COALESCE(NULLIF(lot_code, ''), NULLIF(mfg_lot_no, ''), '') = %s
              AND panel_name = %s
              AND analyze_date = %s
              AND species = %s
            ORDER BY patient_id, id
        """, [marker, lot_code, panel_name, analyze_date, species])
        rows = cur.fetchall()
        cur.close()
        pg.close()
    except Exception as exc:
        logger.warning("Failed to fetch OD points for AI: %s", exc)
        return None

    if not rows:
        return None

    points = []
    for row in rows:
        od = _as_float(row["final_delta_od"])
        points.append({
            "patient_id": _as_text(row["patient_id"]).lower(),
            "final_delta_od": od,
            "analyze_item": marker,
        })

    # Fetch concentrations
    concentrations = fetch_conc([marker])
    marker_conc = concentrations.get(marker, {})

    # Assign conc to points
    for p in points:
        pid = p["patient_id"]
        p["conc"] = marker_conc.get(pid)

    # Filter valid points
    valid_points = [
        p for p in points
        if p.get("final_delta_od") is not None and p.get("conc") is not None
    ]
    if len(valid_points) < 3:
        return None

    # Get spec thresholds
    spec = _fetch_spec_thresholds(marker)

    # Try combinations (simplified: best linear first, then others)
    best_result = None
    best_score = -1
    for model_type in MODEL_TYPES:
        for strategy in OUTLIER_STRATEGIES[:5]:
            kept, removed = apply_outlier_strategy(valid_points, strategy)
            od_vals = [p["final_delta_od"] for p in kept if p["final_delta_od"] is not None]
            conc_vals = [p["conc"] for p in kept if p["conc"] is not None]
            if len(od_vals) < 2:
                continue
            fit = fit_model(model_type, od_vals, conc_vals)
            if not fit:
                continue
            validation = validate_clia(kept, fit, marker_conc, spec)
            score = fit.get("r_squared", 0) * 100
            if validation.get("passed"):
                score += 20
            if score > best_score:
                best_score = score
                best_result = {
                    "ai_equation": fit.get("equation", ""),
                    "ai_model": fit.get("model", ""),
                    "ai_slope": fit.get("coefficients", {}).get("slope"),
                    "ai_intercept": fit.get("coefficients", {}).get("intercept"),
                    "ai_r2": fit.get("r_squared"),
                    "ai_curve_score": score,
                    "ai_strategy": strategy,
                    "ai_outliers_removed": len(removed),
                    "ai_validation": validation,
                    "ai_level_metrics": validation.get("metrics", {}),
                }
                if validation.get("passed"):
                    break
        if best_result and best_result.get("ai_validation", {}).get("passed"):
            break

    return best_result


# ─── Human Level Metrics Calculation ──────────────────────────────────────────

def _compute_human_level_metrics(points_json: str | None, equation: str) -> list[dict]:
    """
    Compute per-level TEa/Bias/CV for the human-chosen equation.
    Uses the points stored in build_line_history.
    """
    if not points_json or not equation:
        return []

    model, slope, intercept, r2 = _parse_equation(equation)
    if slope is None:
        return []

    try:
        points = json.loads(points_json)
    except (json.JSONDecodeError, TypeError):
        return []

    if not isinstance(points, list) or len(points) < 2:
        return []

    # Group by concentration level (patient_id -> conc)
    from auto_curve_fit_service import _fetch_concentrations, CONTROL_CONC_COLUMNS

    # Get marker from points
    marker = ""
    for p in points:
        m = _as_text(p.get("analyze_item"))
        if m:
            marker = m
            break
    if not marker:
        return []

    concentrations = _fetch_concentrations([marker])
    marker_conc = concentrations.get(marker, {})

    # Group OD values by control level
    from collections import defaultdict
    level_ods: dict[str, list[float]] = defaultdict(list)

    for p in points:
        pid = _as_text(p.get("patient_id")).lower()
        od = _as_float(p.get("final_delta_od"))
        if pid in CONTROL_CONC_COLUMNS and od is not None:
            level = CONTROL_CONC_COLUMNS[pid]
            level_ods[level].append(od)

    # Predict using human equation (linear assumed)
    def predict(od_val):
        if model == "linear" and slope is not None and intercept is not None:
            return slope * od_val + intercept
        return None

    results = []
    for level, ods in level_ods.items():
        if len(ods) < 2:
            continue
        # Get assigned concentration for this level
        # Reverse lookup: level -> control_id
        control_id = None
        for cid, lv in CONTROL_CONC_COLUMNS.items():
            if lv == level:
                control_id = cid
                break
        assigned_conc = marker_conc.get(control_id) if control_id else None
        if not assigned_conc or assigned_conc == 0:
            continue

        predicted = [predict(od) for od in ods]
        predicted = [p for p in predicted if p is not None and math.isfinite(p)]
        if len(predicted) < 2:
            continue

        import numpy as np
        arr = np.array(predicted)
        mean_pred = float(arr.mean())
        sd = float(arr.std(ddof=1)) if len(arr) > 1 else 0.0

        bias_pct = ((mean_pred - assigned_conc) / assigned_conc) * 100
        cv_pct = (sd / abs(mean_pred) * 100) if mean_pred != 0 else 0
        tea_pct = abs(bias_pct) + 1.65 * cv_pct

        results.append({
            "level": level,
            "assigned_conc": assigned_conc,
            "mean_predicted": round(mean_pred, 4),
            "n": len(predicted),
            "bias_pct": round(bias_pct, 2),
            "cv_pct": round(cv_pct, 2),
            "tea_pct": round(tea_pct, 2),
        })

    return results


# ─── Main Collection Logic ─────────────────────────────────────────────────────

def collect_comparison_data(since: str | None = None) -> dict:
    """
    Main entry: collect human decisions + AI results, store in comparison DB.

    Args:
        since: ISO date string to limit collection (e.g. "2026-01-01").
               If None, collects all available data.

    Returns:
        { ok, records_added, records_updated, records_total, duration_ms }
    """
    import time
    start_time = time.time()

    try:
        # 1. Collect human decisions
        human_records = _collect_human_decisions(since)
        if not human_records:
            return {"ok": True, "records_added": 0, "records_updated": 0,
                    "records_total": 0, "message": "No human decisions found"}

        # 2. For each human decision, get AI result and store comparison
        db = _get_comparison_db()
        added = 0
        updated = 0

        for human in human_records:
            marker = human["marker"]
            lot_code = human["lot_code"]
            panel_name = human["panel_name"]
            analyze_date = human["analyze_date"]
            species = human["species"]

            if not marker or not lot_code:
                continue

            # Get AI result for same group
            ai_result = _collect_ai_results_for_group(
                lot_code, panel_name, analyze_date, species, marker
            )

            # Compute human level metrics
            human_levels = _compute_human_level_metrics(
                human.get("points_json"), human.get("human_equation", "")
            )

            # Compute comparison metrics
            decision_match = 0
            equation_diff_pct = None
            if ai_result and human.get("human_equation") and ai_result.get("ai_equation"):
                # Compare equations: if same model and R2 within 1%, consider match
                if (human.get("human_model") == ai_result.get("ai_model")
                    and human.get("human_r2") and ai_result.get("ai_r2")):
                    r2_diff = abs((human["human_r2"] or 0) - (ai_result["ai_r2"] or 0))
                    if r2_diff < 0.01:
                        decision_match = 1
                # Equation difference: slope difference percentage
                if human.get("human_slope") and ai_result.get("ai_slope"):
                    if human["human_slope"] != 0:
                        equation_diff_pct = abs(
                            (ai_result["ai_slope"] - human["human_slope"])
                            / human["human_slope"] * 100
                        )

            # Extract max TEa/Bias/CV from level metrics
            tea_max_human = _max_from_levels(human_levels, "tea_pct")
            bias_max_human = _max_from_levels(human_levels, "bias_pct", absolute=True)
            cv_max_human = _max_from_levels(human_levels, "cv_pct")

            ai_levels_list = []
            tea_max_ai = None
            bias_max_ai = None
            cv_max_ai = None
            if ai_result and ai_result.get("ai_level_metrics"):
                ai_metrics = ai_result["ai_level_metrics"]
                if isinstance(ai_metrics, dict):
                    ai_levels_list = [
                        {"level": k, **v} for k, v in ai_metrics.items()
                        if isinstance(v, dict)
                    ]
                tea_max_ai = _max_from_levels(ai_levels_list, "tea_pct")
                bias_max_ai = _max_from_levels(ai_levels_list, "bias_pct", absolute=True)
                cv_max_ai = _max_from_levels(ai_levels_list, "cv_pct")

            # Upsert into comparison DB
            record = {
                "marker": marker,
                "lot_code": lot_code,
                "mfg_lot_no": human.get("mfg_lot_no", ""),
                "panel_name": panel_name,
                "analyze_date": analyze_date,
                "species": species,
                "work_order_no": human.get("work_order_no", ""),
                "d_lot": human.get("d_lot", ""),
                "bigD_lot": human.get("bigD_lot", ""),
                "u_lot": human.get("u_lot", ""),
                "human_equation": human.get("human_equation", ""),
                "human_model": human.get("human_model", ""),
                "human_slope": human.get("human_slope"),
                "human_intercept": human.get("human_intercept"),
                "human_r2": human.get("human_r2"),
                "human_confirmed_by": human.get("human_confirmed_by", ""),
                "human_completed_at": human.get("human_completed_at", ""),
                "human_build_count": human.get("human_build_count", 1),
                "human_action_type": human.get("human_action_type", ""),
                "ai_equation": ai_result.get("ai_equation", "") if ai_result else "",
                "ai_model": ai_result.get("ai_model", "") if ai_result else "",
                "ai_slope": ai_result.get("ai_slope") if ai_result else None,
                "ai_intercept": ai_result.get("ai_intercept") if ai_result else None,
                "ai_r2": ai_result.get("ai_r2") if ai_result else None,
                "ai_curve_score": ai_result.get("ai_curve_score") if ai_result else None,
                "ai_strategy": ai_result.get("ai_strategy", "") if ai_result else "",
                "ai_outliers_removed": ai_result.get("ai_outliers_removed", 0) if ai_result else 0,
                "human_level_metrics": json.dumps(human_levels, ensure_ascii=False),
                "ai_level_metrics": json.dumps(ai_levels_list, ensure_ascii=False),
                "decision_match": decision_match,
                "equation_diff_pct": equation_diff_pct,
                "tea_max_human": tea_max_human,
                "tea_max_ai": tea_max_ai,
                "bias_max_human": bias_max_human,
                "bias_max_ai": bias_max_ai,
                "cv_max_human": cv_max_human,
                "cv_max_ai": cv_max_ai,
                "collected_at": _now(),
            }

            result = _upsert_record(db, record)
            if result == "added":
                added += 1
            elif result == "updated":
                updated += 1

        # Log collection
        total = db.execute("SELECT COUNT(*) FROM comparison_records").fetchone()[0]
        duration_ms = int((time.time() - start_time) * 1000)

        db.execute("""
            INSERT INTO collection_log (collected_at, records_added, records_updated,
                                        records_total, duration_ms)
            VALUES (?, ?, ?, ?, ?)
        """, [_now(), added, updated, total, duration_ms])
        db.commit()
        db.close()

        return {
            "ok": True,
            "records_added": added,
            "records_updated": updated,
            "records_total": total,
            "duration_ms": duration_ms,
        }

    except Exception as exc:
        logger.exception("Comparison data collection failed")
        return {"ok": False, "error": str(exc)}


def _max_from_levels(levels: list[dict], key: str, absolute: bool = False) -> float | None:
    """Extract max value of a key from level metrics list."""
    values = []
    for lv in levels:
        v = _as_float(lv.get(key))
        if v is not None:
            values.append(abs(v) if absolute else v)
    return max(values) if values else None


def _upsert_record(db: sqlite3.Connection, record: dict) -> str:
    """
    Insert or update a comparison record.
    If build_count > existing max build_version, insert new record (改線歷史).
    Otherwise update the current version.
    Returns 'added' or 'updated'.
    """
    existing = db.execute(
        """SELECT id, build_version, human_equation FROM comparison_records
           WHERE marker=? AND lot_code=? AND analyze_date=?
           ORDER BY build_version DESC LIMIT 1""",
        [record["marker"], record["lot_code"], record["analyze_date"]]
    ).fetchone()

    build_count = record.get("human_build_count") or 1

    if existing:
        existing_version = existing["build_version"] or 1
        # If build_count > existing version → 改線, insert new version
        if build_count > existing_version:
            record["build_version"] = build_count
            record["prev_equation"] = existing["human_equation"] or ""
            record["rebuild_reason"] = "改線"
            _insert_record(db, record)
            return "added"
        else:
            # Same version, update in place
            db.execute("""
                UPDATE comparison_records SET
                    mfg_lot_no=?, panel_name=?, species=?, work_order_no=?,
                    d_lot=?, bigD_lot=?, u_lot=?,
                    human_equation=?, human_model=?, human_slope=?, human_intercept=?,
                    human_r2=?, human_confirmed_by=?, human_completed_at=?,
                    human_build_count=?, human_action_type=?,
                    ai_equation=?, ai_model=?, ai_slope=?, ai_intercept=?,
                    ai_r2=?, ai_curve_score=?, ai_strategy=?, ai_outliers_removed=?,
                    human_level_metrics=?, ai_level_metrics=?,
                    decision_match=?, equation_diff_pct=?,
                    tea_max_human=?, tea_max_ai=?,
                    bias_max_human=?, bias_max_ai=?,
                    cv_max_human=?, cv_max_ai=?,
                    collected_at=?
                WHERE id=?
            """, [
                record["mfg_lot_no"], record["panel_name"], record["species"],
                record["work_order_no"], record["d_lot"], record["bigD_lot"], record["u_lot"],
                record["human_equation"], record["human_model"],
                record["human_slope"], record["human_intercept"],
                record["human_r2"], record["human_confirmed_by"],
                record["human_completed_at"], record["human_build_count"],
                record["human_action_type"],
                record["ai_equation"], record["ai_model"],
                record["ai_slope"], record["ai_intercept"],
                record["ai_r2"], record["ai_curve_score"],
                record["ai_strategy"], record["ai_outliers_removed"],
                record["human_level_metrics"], record["ai_level_metrics"],
                record["decision_match"], record["equation_diff_pct"],
                record["tea_max_human"], record["tea_max_ai"],
                record["bias_max_human"], record["bias_max_ai"],
                record["cv_max_human"], record["cv_max_ai"],
                record["collected_at"],
                existing["id"],
            ])
            return "updated"
    else:
        # First build
        record["build_version"] = build_count
        record["prev_equation"] = ""
        record["rebuild_reason"] = ""
        _insert_record(db, record)
        return "added"


def _insert_record(db: sqlite3.Connection, record: dict) -> None:
    """Insert a new comparison record."""
    db.execute("""
        INSERT INTO comparison_records (
            marker, lot_code, mfg_lot_no, panel_name, analyze_date, species,
            work_order_no, d_lot, bigD_lot, u_lot,
            human_equation, human_model, human_slope, human_intercept,
            human_r2, human_confirmed_by, human_completed_at,
            human_build_count, human_action_type,
            ai_equation, ai_model, ai_slope, ai_intercept,
            ai_r2, ai_curve_score, ai_strategy, ai_outliers_removed,
            human_level_metrics, ai_level_metrics,
            decision_match, equation_diff_pct,
            tea_max_human, tea_max_ai,
            bias_max_human, bias_max_ai,
            cv_max_human, cv_max_ai,
            collected_at, build_version, prev_equation, rebuild_reason
        ) VALUES (
            ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )
    """, [
        record["marker"], record["lot_code"], record["mfg_lot_no"],
        record["panel_name"], record["analyze_date"], record["species"],
        record["work_order_no"], record["d_lot"], record["bigD_lot"], record["u_lot"],
        record["human_equation"], record["human_model"],
        record["human_slope"], record["human_intercept"],
        record["human_r2"], record["human_confirmed_by"],
        record["human_completed_at"], record["human_build_count"],
        record["human_action_type"],
        record["ai_equation"], record["ai_model"],
        record["ai_slope"], record["ai_intercept"],
        record["ai_r2"], record["ai_curve_score"],
        record["ai_strategy"], record["ai_outliers_removed"],
        record["human_level_metrics"], record["ai_level_metrics"],
        record["decision_match"], record["equation_diff_pct"],
        record["tea_max_human"], record["tea_max_ai"],
        record["bias_max_human"], record["bias_max_ai"],
        record["cv_max_human"], record["cv_max_ai"],
        record["collected_at"],
        record.get("build_version", 1),
        record.get("prev_equation", ""),
        record.get("rebuild_reason", ""),
    ])


# ─── Query API ─────────────────────────────────────────────────────────────────

def query_comparison_records(
    marker: str | None = None,
    lot_code: str | None = None,
    panel_name: str | None = None,
    analyze_date_from: str | None = None,
    analyze_date_to: str | None = None,
    decision_match: int | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    """
    Query comparison records with optional filters.
    Returns { ok, records, total, filters_applied }.
    """
    db = _get_comparison_db()
    conditions = []
    params = []

    if marker:
        conditions.append("marker = ?")
        params.append(marker)
    if lot_code:
        conditions.append("(lot_code LIKE ? OR mfg_lot_no LIKE ?)")
        params.extend([f"%{lot_code}%", f"%{lot_code}%"])
    if panel_name:
        conditions.append("panel_name LIKE ?")
        params.append(f"%{panel_name}%")
    if analyze_date_from:
        conditions.append("analyze_date >= ?")
        params.append(analyze_date_from)
    if analyze_date_to:
        conditions.append("analyze_date <= ?")
        params.append(analyze_date_to)
    if decision_match is not None:
        conditions.append("decision_match = ?")
        params.append(decision_match)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total = db.execute(
        f"SELECT COUNT(*) FROM comparison_records {where}", params
    ).fetchone()[0]

    rows = db.execute(f"""
        SELECT * FROM comparison_records {where}
        ORDER BY collected_at DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset]).fetchall()

    records = []
    for row in rows:
        r = dict(row)
        # Parse JSON fields
        for json_field in ("human_level_metrics", "ai_level_metrics", "extra_json"):
            if r.get(json_field):
                try:
                    r[json_field] = json.loads(r[json_field])
                except (json.JSONDecodeError, TypeError):
                    pass
        records.append(r)

    db.close()
    return {
        "ok": True,
        "records": records,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_comparison_summary() -> dict:
    """
    Get high-level summary statistics of the comparison DB.
    Useful for dashboard and RAG context.
    """
    db = _get_comparison_db()

    total = db.execute("SELECT COUNT(*) FROM comparison_records").fetchone()[0]
    matched = db.execute(
        "SELECT COUNT(*) FROM comparison_records WHERE decision_match = 1"
    ).fetchone()[0]
    mismatched = total - matched

    # Average metrics
    row = db.execute("""
        SELECT
            AVG(equation_diff_pct) as avg_eq_diff,
            AVG(tea_max_human) as avg_tea_human,
            AVG(tea_max_ai) as avg_tea_ai,
            AVG(bias_max_human) as avg_bias_human,
            AVG(bias_max_ai) as avg_bias_ai,
            AVG(cv_max_human) as avg_cv_human,
            AVG(cv_max_ai) as avg_cv_ai,
            COUNT(DISTINCT marker) as unique_markers,
            COUNT(DISTINCT panel_name) as unique_panels
        FROM comparison_records
        WHERE ai_equation IS NOT NULL AND ai_equation != ''
    """).fetchone()

    # Recent collections
    logs = db.execute("""
        SELECT * FROM collection_log ORDER BY collected_at DESC LIMIT 5
    """).fetchall()

    db.close()

    return {
        "ok": True,
        "total_records": total,
        "decision_match_count": matched,
        "decision_mismatch_count": mismatched,
        "match_rate_pct": round(matched / total * 100, 1) if total > 0 else 0,
        "averages": {
            "equation_diff_pct": round(row["avg_eq_diff"], 2) if row["avg_eq_diff"] else None,
            "tea_human": round(row["avg_tea_human"], 2) if row["avg_tea_human"] else None,
            "tea_ai": round(row["avg_tea_ai"], 2) if row["avg_tea_ai"] else None,
            "bias_human": round(row["avg_bias_human"], 2) if row["avg_bias_human"] else None,
            "bias_ai": round(row["avg_bias_ai"], 2) if row["avg_bias_ai"] else None,
            "cv_human": round(row["avg_cv_human"], 2) if row["avg_cv_human"] else None,
            "cv_ai": round(row["avg_cv_ai"], 2) if row["avg_cv_ai"] else None,
        },
        "unique_markers": row["unique_markers"],
        "unique_panels": row["unique_panels"],
        "recent_collections": [dict(log) for log in logs],
    }


# ─── S3 Sync ──────────────────────────────────────────────────────────────────

def sync_to_s3() -> dict:
    """
    Upload comparison DB to S3 for RAG consumption.
    Returns { ok, bucket, key, size_bytes, synced_at }.
    """
    try:
        import boto3
    except ImportError:
        return {"ok": False, "error": "boto3 not installed. Run: pip install boto3"}

    if not COMPARISON_DB_PATH.exists():
        return {"ok": False, "error": "Comparison DB not found. Run collect first."}

    try:
        s3 = boto3.client("s3")
        key = f"{S3_KEY_PREFIX}ai_human_comparison.db"
        file_size = COMPARISON_DB_PATH.stat().st_size
        synced_at = _now()

        s3.upload_file(
            str(COMPARISON_DB_PATH),
            S3_BUCKET,
            key,
            ExtraArgs={"ContentType": "application/x-sqlite3"}
        )

        # Also upload a JSON summary for quick RAG indexing
        summary = get_comparison_summary()
        summary_key = f"{S3_KEY_PREFIX}summary.json"
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=summary_key,
            Body=json.dumps(summary, ensure_ascii=False, indent=2),
            ContentType="application/json",
        )

        # Update collection_log with S3 sync info
        db = _get_comparison_db()
        db.execute("""
            UPDATE collection_log
            SET synced_to_s3 = 1, s3_synced_at = ?
            WHERE id = (SELECT MAX(id) FROM collection_log)
        """, [synced_at])
        db.commit()
        db.close()

        return {
            "ok": True,
            "bucket": S3_BUCKET,
            "key": key,
            "summary_key": summary_key,
            "size_bytes": file_size,
            "synced_at": synced_at,
        }

    except Exception as exc:
        logger.exception("S3 sync failed")
        return {"ok": False, "error": str(exc)}


# ─── Export for RAG ────────────────────────────────────────────────────────────

def export_for_rag(format: str = "jsonl") -> dict:
    """
    Export comparison records in a format suitable for RAG ingestion.
    Supports: jsonl (one JSON object per line), json (array).
    """
    db = _get_comparison_db()
    rows = db.execute("""
        SELECT * FROM comparison_records
        ORDER BY analyze_date DESC, marker
    """).fetchall()
    db.close()

    records = []
    for row in rows:
        r = dict(row)
        for json_field in ("human_level_metrics", "ai_level_metrics", "extra_json"):
            if r.get(json_field):
                try:
                    r[json_field] = json.loads(r[json_field])
                except (json.JSONDecodeError, TypeError):
                    pass
        records.append(r)

    output_dir = COMPARISON_DB_DIR / "exports"
    output_dir.mkdir(parents=True, exist_ok=True)

    if format == "jsonl":
        output_file = output_dir / "comparison_records.jsonl"
        with open(output_file, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")
    else:
        output_file = output_dir / "comparison_records.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2, default=str)

    return {
        "ok": True,
        "format": format,
        "file": str(output_file),
        "record_count": len(records),
        "size_bytes": output_file.stat().st_size,
    }
