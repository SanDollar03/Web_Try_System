from __future__ import annotations
from flask import (
    Flask, send_from_directory, request,
    jsonify, session, abort, redirect
)
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os, re, json, pandas as pd
from utils.csv_store import read_csv, write_csv, ensure_columns

# ────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"; DATA_DIR.mkdir(exist_ok=True)

LOG_DIR  = BASE_DIR / "logs"; LOG_DIR.mkdir(exist_ok=True)
CSV_ULOG = LOG_DIR / "user_actions.csv"
CSV_ELOG = LOG_DIR / "server_errors.csv"

CSV_USERS    = DATA_DIR / "users.csv"
CSV_EVENTS   = DATA_DIR / "events.csv"
CSV_CONTACTS = DATA_DIR / "contacts.csv"
CSV_URGENCY  = DATA_DIR / "urgencies.csv"
CSV_UNIT     = DATA_DIR / "units.csv"

# ────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder="static")
app.secret_key = "change-me"
app.permanent_session_lifetime = timedelta(days=7)

# ── Utility ─────────────────────────────────────────────────────
def ts() -> str:
    """yyyy/mm/dd HH:MM:SS  (local timezone)"""
    return datetime.now().strftime("%Y/%m/%d %H:%M:%S")

def current_user() -> dict | None:
    return session.get("user")

def serialize(lst):   return json.dumps(lst, ensure_ascii=False)
def deserialize(s):   return json.loads(s) if isinstance(s,str) and s else []

def ensure_id(df: pd.DataFrame) -> pd.DataFrame:
    if "id" not in df.columns: df["id"] = pd.Series(dtype="int64")
    return df

def next_id(series: pd.Series) -> int:
    if series.empty: return 1
    return int(pd.to_numeric(series, errors="coerce").fillna(0).astype(int).max()+1)

def append_csv(path: Path, row: dict[str,str]):
    df = pd.DataFrame([row])
    mode, hdr = ("a", False) if path.exists() else ("w", True)
    df.to_csv(path, mode=mode, header=hdr, index=False, encoding="utf-8-sig")

def log_action(user: dict|None, action:str, detail:str=""):
    append_csv(CSV_ULOG, {
        "timestamp": ts(),
        "user"     : (user or {}).get("full","-"),
        "email"    : (user or {}).get("email","-"),
        "action"   : action,
        "detail"   : detail
    })

def log_error(exc: Exception):
    append_csv(CSV_ELOG, {
        "timestamp": ts(),
        "error"    : repr(exc),
        "path"     : request.path,
        "method"   : request.method,
        "user"     : (current_user() or {}).get("full","-")
    })

VALID_DEPT = re.compile(r"[A-Za-z0-9]{5}")
LIST_COLS  = ("approvers","approve_flags","reject_flags")

# ── Static pages ────────────────────────────────────────────────
@app.get("/")
def page_login(): return send_from_directory(app.static_folder, "login.html")

@app.get("/calendar")
def page_calendar():
    return redirect("/") if not current_user() else \
           send_from_directory(app.static_folder, "index.html")

@app.get("/<path:p>")
def static_proxy(p): return send_from_directory(app.static_folder, p)

# ── Auth ────────────────────────────────────────────────────────
@app.post("/api/login")
def api_login():
    email = request.get_json(force=True).get("email","").strip().lower()
    if not email: abort(400,"email required")

    df = ensure_id(read_csv(CSV_USERS))
    hit = df[df["email"].astype(str).str.strip().str.lower()==email]
    if hit.empty: abort(404,"user not found")

    r = hit.iloc[0]
    user = {
        "id":int(r["id"]),
        "last":r["last_name"],"first":r["first_name"],
        "full":f'{r["last_name"]}{r["first_name"]}',
        "email":email,
        "dept_code":r["dept_code"]
    }
    session.permanent=True; session["user"]=user
    log_action(user,"login")
    return jsonify(user)

@app.post("/api/logout")
def api_logout():
    u=current_user(); session.clear(); log_action(u,"logout")
    return jsonify(status="ok")

@app.get("/api/me")
def api_me(): return jsonify(current_user() or {})

# ── User Register / List ───────────────────────────────────────
@app.post("/api/users")
def api_user_create():
    d=request.get_json(force=True)
    ln=d.get("last_name","").strip(); fn=d.get("first_name","").strip()
    mail=d.get("email","").strip().lower(); dept=d.get("dept_code","").strip().upper()

    if not (ln and fn and mail and dept): abort(400,"all fields required")
    if not re.fullmatch(r"[^@]+@[^@]+\.[^@]+",mail): abort(400,"invalid email")
    if not VALID_DEPT.fullmatch(dept): abort(400,"dept_code must be 5 alnum")

    df=ensure_id(read_csv(CSV_USERS))
    if not df.empty and mail in df["email"].astype(str).str.strip().str.lower().values:
        abort(400,"email duplicated")

    new_id=next_id(df["id"])
    df = pd.concat([df, pd.DataFrame([{
        "id":new_id,"last_name":ln,"first_name":fn,"email":mail,"dept_code":dept
    }])], ignore_index=True)
    write_csv(df, CSV_USERS)
    log_action(current_user(),"user_register",mail)
    return jsonify(id=new_id),201

@app.get("/api/users")
def api_users(): return [
    {"id":int(r["id"]), "full":f'{r["last_name"]}{r["first_name"]}'}
    for _,r in read_csv(CSV_USERS).iterrows()
]

# ── Masters / Contacts ─────────────────────────────────────────
@app.get("/api/urgencies")
def api_urg():   return read_csv(CSV_URGENCY)["value"].tolist()
@app.get("/api/units")
def api_units(): return read_csv(CSV_UNIT)["value"].tolist()
@app.get("/api/contacts")
def api_cont(): return read_csv(CSV_CONTACTS).to_dict(orient="records")

# ── Events CRUD ────────────────────────────────────────────────
@app.get("/api/events")
def api_events():
    s=request.args.get("start"); e=request.args.get("end")
    df=read_csv(CSV_EVENTS)
    ensure_columns(df, ["purpose","urgency","unit",*LIST_COLS])
    for c in LIST_COLS: df[c]=df[c].apply(deserialize)
    if s and e: df=df[(df["start_dt"]<e)&(df["end_dt"]>s)]
    return df.to_dict(orient="records")

@app.post("/api/events")
def api_event_create():
    d=request.get_json(force=True)
    required=("category","line_name","title","dept_code","worker",
              "start_dt","end_dt","urgency","unit")
    if any(not d.get(k,"") for k in required): abort(400,"missing fields")

    df=ensure_id(read_csv(CSV_EVENTS))
    d["id"]=next_id(df["id"])
    for c in LIST_COLS: d[c]=serialize(d.get(c,[]))
    d["created_at"]=ts()

    df=pd.concat([df,pd.DataFrame([d])],ignore_index=True)
    write_csv(df,CSV_EVENTS)
    log_action(current_user(),"event_create",f'id={d["id"]}')
    return jsonify(id=d["id"]),201

@app.put("/api/events/<int:eid>")
def api_event_update(eid:int):
    d=request.get_json(force=True)
    df=ensure_id(read_csv(CSV_EVENTS))
    if eid not in df["id"].astype(int).values: abort(404,"event not found")

    if "approvers" in d:
        usr=current_user()
        if not usr: abort(401)
        lst=d["approvers"] if isinstance(d["approvers"],list) else []
        if usr["full"] not in lst: abort(403,"not your approver line")

    for k,v in d.items():
        if k=="id": continue
        if k in LIST_COLS and isinstance(v,list): v=serialize(v)
        df.loc[df["id"].astype(int)==eid,k]=v

    write_csv(df,CSV_EVENTS)
    log_action(current_user(),"event_update",f'id={eid}')
    return jsonify(status="updated")

@app.delete("/api/events/<int:eid>")
def api_event_delete(eid:int):
    df=ensure_id(read_csv(CSV_EVENTS))
    if eid not in df["id"].astype(int).values: abort(404,"event not found")

    row=df[df["id"].astype(int)==eid].iloc[0]
    usr=current_user()
    if not usr: abort(401,"login required")
    if str(row["worker"])!=usr["full"]: abort(403,"not your event")

    df=df[df["id"].astype(int)!=eid]
    write_csv(df,CSV_EVENTS)
    log_action(usr,"event_delete",f'id={eid}')
    return jsonify(status="deleted")

# ── Global Error Handler ───────────────────────────────────────
@app.errorhandler(Exception)
def handle_error(e:Exception):
    log_error(e)
    return jsonify(error=str(e)),500

# ── Run ─────────────────────────────────────────────────────────
if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT","5010")), debug=True)
