from __future__ import annotations
from flask import Flask, send_from_directory, request, jsonify, abort
from datetime import datetime, timezone
import os, re, json, pandas as pd
from pathlib import Path
from utils.csv_store import read_csv, write_csv, ensure_columns

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

CSV_EVENTS   = DATA_DIR / "events.csv"
CSV_CONTACTS = DATA_DIR / "contacts.csv"

app = Flask(__name__, static_folder="static")


# ── UTILS ─────────────────────────────────────────────
def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _serialize(lst: list[str]) -> str:
    return json.dumps(lst, ensure_ascii=False)


def _deserialize(s: str | float | None) -> list[str]:
    if isinstance(s, str) and s:
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return [x for x in re.split(r"[|;,]", s) if x]
    return []


def _validate_event(d: dict):
    if d.get("category") not in ("内製", "外注", "トライ"):
        abort(400, "category invalid")
    if not re.fullmatch(r"[A-Za-z0-9]+", d.get("dept_code", "")):
        abort(400, "dept_code invalid")
    if d["start_dt"] >= d["end_dt"]:
        abort(400, "start_dt >= end_dt")


def _validate_contact(name: str, mail: str):
    if not name.strip():
        abort(400, "name required")
    if not re.fullmatch(r"[^@]+@[^@]+\.[^@]+", mail):
        abort(400, "invalid email")


# ── STATIC ────────────────────────────────────────────
@app.route("/")
def index():  # type: ignore
    return send_from_directory(app.static_folder, "index.html")


@app.route("/register")
def register_page():  # type: ignore
    return send_from_directory(app.static_folder, "register.html")


@app.route("/<path:path>")
def static_proxy(path):  # type: ignore
    return send_from_directory(app.static_folder, path)


# ── CONTACTS API ──────────────────────────────────────
@app.get("/api/contacts")
def api_contacts():
    df = read_csv(CSV_CONTACTS)
    return df.to_dict(orient="records")


@app.post("/api/contacts")
def api_contacts_create():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    _validate_contact(name, email)

    df = read_csv(CSV_CONTACTS)
    if not df.empty and email in df["email"].str.lower().values:
        abort(400, "duplicate email")

    new_row = {"name": name, "email": email}
    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
    ensure_columns(df, ["name", "email"])
    write_csv(df, CSV_CONTACTS)
    return jsonify({"status": "created"}), 201


# ── EVENTS API ────────────────────────────────────────
@app.get("/api/events")
def api_events():
    start_q, end_q = request.args.get("start"), request.args.get("end")
    df = read_csv(CSV_EVENTS)

    if not df.empty:
        ensure_columns(df, ["approvers"])
        df["approvers"] = df["approvers"].apply(_deserialize)

    if start_q and end_q and not df.empty:
        df = df[(df["start_dt"] < end_q) & (df["end_dt"] > start_q)]

    return df.to_dict(orient="records")


@app.post("/api/events")
def api_events_create():
    d = request.get_json(force=True)
    _validate_event(d)

    df = read_csv(CSV_EVENTS)
    next_id = int(df["id"].astype(int).max() + 1) if not df.empty else 1

    new_row = {
        "id": next_id,
        "category": d["category"],
        "line_name": d["line_name"],
        "title": d["title"],
        "dept_code": d["dept_code"],
        "worker": d["worker"],
        "start_dt": d["start_dt"],
        "end_dt": d["end_dt"],
        "advance_qty": int(d.get("advance_qty", 0)),
        "memo": d.get("memo", ""),
        "approvers": _serialize(d.get("approvers", [])),
        "created_at": utc_iso(),
    }
    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
    write_csv(df, CSV_EVENTS)
    return jsonify({"id": next_id}), 201


@app.put("/api/events/<int:eid>")
def api_events_update(eid: int):
    d = request.get_json(force=True)
    _validate_event(d)

    df = read_csv(CSV_EVENTS)
    if eid not in df["id"].astype(int).values:
        abort(404, "event not found")

    d["approvers"] = _serialize(d.get("approvers", []))
    for k, v in d.items():
        if k != "id":
            df.loc[df["id"].astype(int) == eid, k] = v
    write_csv(df, CSV_EVENTS)
    return jsonify({"status": "updated"})


# ── ENTRY ─────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.getenv("PORT", "5010"))
    app.run(host="0.0.0.0", port=port, debug=True)
