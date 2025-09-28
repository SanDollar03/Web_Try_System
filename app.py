from __future__ import annotations
from flask import (
    Flask, send_from_directory, request,
    jsonify, session, abort, redirect
)
from datetime import datetime, timedelta
from pathlib import Path
import os, re, json, pandas as pd

from dotenv import load_dotenv
load_dotenv()

from utils.csv_store import read_csv, write_csv, ensure_columns

# Tk ダイアログは今は使わない運用ですが、エンドポイント自体は残します
import tkinter as tk
from tkinter import filedialog

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
    return datetime.now().strftime("%Y/%m/%d %H:%M:%S")

def current_user() -> dict | None:
    return session.get("user")

def is_guest() -> bool:
    u = current_user()
    return bool(u) and u.get("role") == "guest"

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
LIST_LISTS = ("approvers","approve_flags","reject_flags","sharers")  # ★追加（内部使用）

# ── 追加: 最終承認判定 & 工事担当者へ投函 ──────────────────────────
_INVALID_CHARS = r'[<>:"/\\|?*\x00-\x1f]'
def sanitize_filename(name: str) -> str:
    s = re.sub(_INVALID_CHARS, "_", name).strip().rstrip(". ")
    s = re.sub(r"_+", "_", s) or "noname"
    return s[:180]

def _to_int_list(x):
    lst = x if isinstance(x, list) else deserialize(x)
    return [int(v) if str(v).isdigit() else 0 for v in lst]

def _all_approved(row) -> bool:
    appr = row.get("approvers", [])
    appr = appr if isinstance(appr, list) else deserialize(appr)
    if not appr:
        return False
    ok  = _to_int_list(row.get("approve_flags", []))
    ng  = _to_int_list(row.get("reject_flags", []))
    m = min(len(appr), len(ok), len(ng) if ng else len(appr))
    ok  = ok[:m]  + [0]*(m-len(ok))
    ng  = ng[:m]  + [0]*(m-len(ng))
    return m > 0 and all(o == 1 for o in ok) and all(r != 1 for r in ng)

def _deposit_to_worker(ev: dict, eid: int):
    worker_full = str(ev.get("worker","")).strip()
    if not worker_full:
        return False
    df_u = ensure_id(read_csv(CSV_USERS))
    mask = (df_u["last_name"].fillna("") + df_u["first_name"].fillna("")) == worker_full
    hit = df_u[mask]
    if hit.empty:
        return False
    tray = (hit.iloc[0].get("tray_path") or "").strip()
    if not tray:
        return False

    fname = sanitize_filename(f"先行App）【全員承認】_{ev['line_name']}_{ev['title']}") + ".txt"
    body = (
        f"イベントID: {eid}\n"
        f"カテゴリ: {ev['category']}\n"
        f"ライン名: {ev['line_name']}\n"
        f"件名: {ev['title']}\n"
        f"開始日時: {ev['start_dt']}\n"
        f"終了日時: {ev['end_dt']}\n"
        f"緊急度: {ev['urgency']}\n"
        f"単位: {ev['unit']}\n"
        f"備考: {ev.get('memo','')}\n"
    )

    outdir = Path(tray); outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / fname
    i = 2
    while path.exists() and i < 1000:
        stem, ext = path.stem, path.suffix
        base = re.sub(r"\(\d+\)$", "", stem)
        path = outdir / f"{base}({i}){ext}"
        i += 1
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return True

# ── Static pages ────────────────────────────────────────────────
@app.get("/")
def page_login(): return send_from_directory(app.static_folder, "login.html")

@app.get("/calendar")
def page_calendar():
    return redirect("/") if not current_user() else \
           send_from_directory(app.static_folder, "index.html")

@app.get("/<path:p>")
def static_proxy(p):
    if p.endswith(".html") and p not in ("login.html",):
        return redirect("/login.html")
    return send_from_directory(app.static_folder, p)

# ── Auth ────────────────────────────────────────────────────────
@app.post("/api/login")
def api_login():
    email = request.get_json(force=True).get("email","").strip().lower()
    if not email: abort(400,"email required")

    # ★ ここを g → g@ に変更
    if email == "g@":
        user = {
            "id": 0,
            "last": "ゲスト", "first": "",
            "full": "ゲスト",
            "email": "-",
            "dept_code": "",
            "role": "guest"
        }
        session.permanent=True; session["user"]=user
        log_action(user,"login_guest")
        return jsonify(user)

    # 以下は既存の通常ログイン処理のまま
    df = ensure_id(read_csv(CSV_USERS))
    hit = df[df["email"].astype(str).str.strip().str.lower()==email]
    if hit.empty: abort(404,"user not found")
    r = hit.iloc[0]
    user = {
        "id":int(r["id"]),
        "last":r["last_name"],"first":r["first_name"],
        "full":f'{r["last_name"]}{r["first_name"]}',
        "email":email,
        "dept_code":r["dept_code"],
        "role":"user"
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
    if is_guest(): abort(403, "ゲストは編集できません")
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
    ensure_columns(df, ["purpose","urgency","unit",*LIST_LISTS]) 
    for c in LIST_LISTS: df[c]=df[c].apply(deserialize)   
    if s and e: df=df[(df["start_dt"]<e)&(df["end_dt"]>s)]
    return df.to_dict(orient="records")

@app.post("/api/events")
def api_event_create():
    if is_guest(): abort(403, "ゲストは編集できません")
    d=request.get_json(force=True)
    required=("category","line_name","title","dept_code","worker",
              "start_dt","end_dt","urgency","unit")
    if any(not d.get(k,"") for k in required): abort(400,"missing fields")

    df=ensure_id(read_csv(CSV_EVENTS))
    d["id"]=next_id(df["id"])
    for c in LIST_LISTS: d[c]=serialize(d.get(c,[]))
    d["created_at"]=ts()

    df=pd.concat([df,pd.DataFrame([d])],ignore_index=True)
    write_csv(df,CSV_EVENTS)
    log_action(current_user(),"event_create",f'id={d["id"]}')
    return jsonify(id=d["id"]),201

@app.put("/api/events/<int:eid>")
def api_event_update(eid:int):
    if is_guest(): abort(403, "ゲストは編集できません")
    d=request.get_json(force=True)
    df=ensure_id(read_csv(CSV_EVENTS))
    if eid not in df["id"].astype(int).values: abort(404,"event not found")

    usr = current_user()
    if not usr: abort(401)

    # 既存レコードを取得（権限判定に使用）
    before_row = df[df["id"].astype(int)==eid].iloc[0].to_dict()
    exist_approvers = before_row.get("approvers", [])
    if not isinstance(exist_approvers, list):
        exist_approvers = deserialize(exist_approvers)

    # ① 自分が承認者でない場合は、承認/却下フラグの更新は無視（403にしない）
    if usr["full"] not in exist_approvers:
        d.pop("approve_flags", None)
        d.pop("reject_flags", None)

    # ② 承認者リストそのものを変更する場合 → 工事担当者のみ許可
    if "approvers" in d and str(before_row.get("worker","")) != usr["full"]:
        d.pop("approvers", None)

    before_row = df[df["id"].astype(int)==eid].iloc[0].to_dict()
    was_all = _all_approved(before_row)

    for k,v in d.items():
        if k=="id": continue
        if k in LIST_LISTS and isinstance(v,list): v=serialize(v)
        df.loc[df["id"].astype(int)==eid,k]=v

    write_csv(df,CSV_EVENTS)
    log_action(current_user(),"event_update",f'id={eid}')

    after_row = df[df["id"].astype(int)==eid].iloc[0].to_dict()
    now_all = _all_approved(after_row)
    if (not was_all) and now_all:
        if _deposit_to_worker(after_row, eid):
            log_action(current_user(), "deposit_tray_auto", f"id={eid}")

    return jsonify(status="updated")

@app.delete("/api/events/<int:eid>")
def api_event_delete(eid:int):
    if is_guest(): abort(403, "ゲストは編集できません")
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

# ── 手動「電子トレイに投函」（承認者へ） ──────────────────────────
@app.post("/api/events/<int:eid>/deposit_tray")
def api_deposit_tray(eid: int):
    if is_guest(): abort(403, "ゲストは編集できません")
    df_e = ensure_id(read_csv(CSV_EVENTS))
    if eid not in df_e["id"].astype(int).values:
        abort(404, "event not found")
    ev = df_e[df_e["id"].astype(int) == eid].iloc[0]

    approvers = deserialize(ev.get("approvers", "[]"))
    sharers   = deserialize(ev.get("sharers",   "[]"))                               # ★追加
    recipients = list({*(approvers or []), *(sharers or [])})                        # ★重複除去
    df_u = ensure_id(read_csv(CSV_USERS))
    created_any = False
    for full in recipients:
        mask = (df_u["last_name"].fillna("") + df_u["first_name"].fillna("")) == full
        row_u = df_u[mask]
        if row_u.empty: continue
        tray = (row_u.iloc[0].get("tray_path") or "").strip()
        if not tray: continue

        fname = sanitize_filename(f"先行App）【承認要求】_{ev['line_name']}_{ev['title']}") + ".txt"
        body = (
            f"イベントID: {eid}\n"
            f"カテゴリ: {ev['category']}\n"
            f"ライン名: {ev['line_name']}\n"
            f"件名: {ev['title']}\n"
            f"開始日時: {ev['start_dt']}\n"
            f"終了日時: {ev['end_dt']}\n"
            f"緊急度: {ev['urgency']}\n"
            f"単位: {ev['unit']}\n"
            f"備考: {ev.get('memo','')}\n"
        )
        outdir = Path(tray); outdir.mkdir(parents=True, exist_ok=True)
        path = outdir / fname
        i = 2
        while path.exists() and i < 1000:
            stem, ext = path.stem, path.suffix
            base = re.sub(r"\(\d+\)$", "", stem)
            path = outdir / f"{base}({i}){ext}"
            i += 1
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        created_any = True

    if not created_any:
        abort(400, "投函先（承認者の電子トレイ）が見つかりません")

    log_action(current_user(), "deposit_tray_manual", f"eid={eid}")
    return jsonify(status="deposited")

# ── 却下時の「工事担当者への投函」API ─────────────────────────────
@app.post("/api/events/<int:eid>/reject_notify")
def api_reject_notify(eid: int):
    if is_guest(): abort(403, "ゲストは編集できません")
    usr = current_user()
    if not usr:
        abort(401, "login required")

    df_e = ensure_id(read_csv(CSV_EVENTS))
    if eid not in df_e["id"].astype(int).values:
        abort(404, "event not found")
    ev = df_e[df_e["id"].astype(int) == eid].iloc[0].to_dict()

    approvers = deserialize(ev.get("approvers", "[]"))
    if usr["full"] not in approvers:
        abort(403, "not your approver line")

    d = request.get_json(force=True)
    reason = (d.get("reason") or "").strip()
    if not reason:
        abort(400, "却下の理由が未入力です")

    worker_full = str(ev.get("worker","")).strip()
    if not worker_full:
        abort(400, "工事担当者が未設定です")

    df_u = ensure_id(read_csv(CSV_USERS))
    mask = (df_u["last_name"].fillna("") + df_u["first_name"].fillna("")) == worker_full
    hit = df_u[mask]
    if hit.empty:
        abort(400, "工事担当者のユーザー情報が見つかりません")
    tray = (hit.iloc[0].get("tray_path") or "").strip()
    if not tray:
        abort(400, "工事担当者の電子トレイパスが未設定です")

    fname = sanitize_filename(f"先行App）【却下通知】_{ev['line_name']}_{ev['title']}") + ".txt"
    body = (
        f"イベントID: {eid}\n"
        f"カテゴリ: {ev['category']}\n"
        f"ライン名: {ev['line_name']}\n"
        f"件名: {ev['title']}\n"
        f"開始日時: {ev['start_dt']}\n"
        f"終了日時: {ev['end_dt']}\n"
        f"緊急度: {ev['urgency']}\n"
        f"単位: {ev['unit']}\n"
        f"備考: {ev.get('memo','')}\n"
        f"却下の理由: {reason}\n"
    )
    outdir = Path(tray); outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / fname
    i = 2
    while path.exists() and i < 1000:
        stem, ext = path.stem, path.suffix
        base = re.sub(r"\(\d+\)$", "", stem)
        path = outdir / f"{base}({i}){ext}"
        i += 1
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)

    log_action(usr, "reject_notify", f"eid={eid}")
    return jsonify(status="notified")

# ── ユーザー用フォルダ選択＆CSV更新 API（使わない想定。ゲストは不可） ──
@app.get("/api/users/select_tray/<int:uid>")
def api_select_tray(uid: int):
    if is_guest(): abort(403, "ゲストは編集できません")
    root = tk.Tk(); root.withdraw()
    folder = filedialog.askdirectory(
        title="電子トレイフォルダを選択",
        initialdir=r"\\172.27.21.41\disk1\ElectricTray\鋳鍛造部"
    )
    root.destroy()
    if not folder: abort(400, "フォルダが選択されませんでした")

    df = ensure_id(read_csv(CSV_USERS))
    df = ensure_columns(df, ["tray_path"])
    df.loc[df["id"].astype(int) == uid, "tray_path"] = folder
    write_csv(df, CSV_USERS)
    log_action(current_user(), "select_tray", f"uid={uid} path={folder}")
    return jsonify(tray_path=folder)

# ── ユーザー編集画面＆API ─────────────────────────────────────────
@app.get("/users")
def page_users():
    if not current_user():
        return redirect("/login.html")
    return send_from_directory(app.static_folder, "users.html")

@app.get("/api/users/all")
def api_users_all():
    df = ensure_id(read_csv(CSV_USERS))
    for c in ("last_name","first_name","email","dept_code"):
        if c not in df.columns:
            df[c] = ""
    return df.to_dict(orient="records")

@app.put("/api/users/<int:uid>")
def api_user_update(uid: int):
    usr = current_user()
    if not usr:
        abort(401, "login required")
    if usr["id"] != uid:
        abort(403, "ログインユーザーが一致しないので保存できません")

    d = request.get_json(force=True)

    # tray_path 単独更新（既存のまま）
    if set(d.keys()) == {"tray_path"}:
        df = ensure_id(read_csv(CSV_USERS))
        df = ensure_columns(df, ["tray_path"])
        df.loc[df["id"].astype(int) == uid, "tray_path"] = (d.get("tray_path") or "").strip()
        write_csv(df, CSV_USERS)
        log_action(usr, "user_update_tray", f"id={uid}")
        return jsonify(status="tray_path updated")

    # ---- 通常更新（ここを拡張）----
    ln   = (d.get("last_name")  or "").strip()
    fn   = (d.get("first_name") or "").strip()
    mail = (d.get("email")      or "").strip().lower()
    dept = (d.get("dept_code")  or "").strip().upper()
    tray = (d.get("tray_path")  or "").strip()  # ★ 追加：一緒に受け取る

    # バリデーション
    if not (ln and fn and mail and dept):
        abort(400, "all fields required")
    if not re.fullmatch(r"[^@]+@[^@]+\.[^@]+", mail):
        abort(400, "invalid email")
    if not re.fullmatch(r"[A-Za-z0-9]{5}", dept):
        abort(400, "dept_code must be 5 alnum")

    df = ensure_id(read_csv(CSV_USERS))
    df = ensure_columns(df, ["tray_path"])  # ★ 追加：列の保証

    others = df[df["id"].astype(int) != uid]
    if mail in others["email"].astype(str).str.strip().str.lower().values:
        abort(400, "email duplicated")

    key = df["id"].astype(int) == uid
    df.loc[key, "last_name"]  = ln
    df.loc[key, "first_name"] = fn
    df.loc[key, "email"]      = mail
    df.loc[key, "dept_code"]  = dept
    df.loc[key, "tray_path"]  = tray      # ★ 追加：tray_path も保存

    write_csv(df, CSV_USERS)
    log_action(usr, "user_update", f"id={uid}")
    return jsonify(status="updated")

# ── Global Error Handler ───────────────────────────────────────
@app.errorhandler(Exception)
def handle_error(e:Exception):
    log_error(e)
    return jsonify(error=str(e)),500

# ── Run ─────────────────────────────────────────────────────────
if __name__=="__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT","5010")), debug=True)