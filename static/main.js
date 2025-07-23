(async () => {
    /* ---------- DOM ---------- */
    const calEl = document.getElementById("calendar");
    const form = document.getElementById("event-form");
    const mode = document.getElementById("form-mode");
    const fld = document.getElementById("approvers");
    if (!calEl || !form || !fld) return;

    /* ---------- 現在ユーザー情報 ---------- */
    const currentFull = sessionStorage.getItem("currentUserFull") || "";
    const currentDept = sessionStorage.getItem("currentUserDept") || "";

    /* ---------- API helper ---------- */
    const api = window.tryApi;

    /* ---------- マスタ取得 ---------- */
    const [urgencies, units, contacts, users] = await Promise.all([
        api("/api/urgencies").catch(() => []),
        api("/api/units").catch(() => []),
        api("/api/contacts").catch(() => []),
        api("/api/users").catch(() => [])
    ]);

    /* ---------- セレクト populate ---------- */
    urgencies.forEach(v => document.getElementById("urgencySelect").appendChild(new Option(v, v)));
    units.forEach(v => document.getElementById("unitSelect").appendChild(new Option(v, v)));

    /* ---------- contacts datalist ---------- */
    const dlContacts = document.getElementById("contactsList");
    contacts.forEach(c => {
        const o = document.createElement("option"); o.value = c.name; o.label = c.email; dlContacts.appendChild(o);
    });

    /* ---------- users datalist (承認者用) ---------- */
    const dlUsers = document.createElement("datalist"); dlUsers.id = "usersList";
    users.forEach(u => {
        const o = document.createElement("option"); o.value = u.full; dlUsers.appendChild(o);
    });
    document.body.appendChild(dlUsers);

    /* ---------- 部署コード & 工事担当者入力を固定 ---------- */
    const deptInp = form.dept_code;
    const workerInp = form.worker;
    deptInp.value = currentDept;
    workerInp.value = currentFull;
    deptInp.readOnly = true;
    workerInp.readOnly = true;

    /* ---------- 承認者行 ---------- */
    const approverRows = [];
    let selectedDayEl = null;
    for (let i = 1; i <= 6; i++) {
        const row = document.createElement("div");
        row.className = "approver-row";
        row.innerHTML = `
        <input name="approver${i}" list="usersList" placeholder="承認者 ${i}" autocomplete="off">
        <button type="button" class="btn-approve approver-btn">承認</button>
        <button type="button" class="btn-reject  approver-btn">却下</button>`;
        fld.appendChild(row); approverRows.push(row);
    }

    /* ---------- 承認ボタン活性 & 重複チェック ---------- */
    approverRows.forEach(row => {
        const inp = row.querySelector("input");
        const btns = row.querySelectorAll(".approver-btn");

        const validate = () => {
            const val = inp.value.trim();
            // 重複防止
            const duplicate = val && approverRows.some(r => r !== row && r.querySelector("input").value.trim() === val);
            if (duplicate) { alert("同じ承認者は重複入力できません。"); inp.value = ""; }
            const self = val === currentFull;
            /* 自分行以外は押下できないが、既に押されている色は残す */
            btns.forEach(b => { b.disabled = !self; });
        };
        inp.addEventListener("input", validate); validate();

        const btnApprove = row.querySelector(".btn-approve");
        const btnReject = row.querySelector(".btn-reject");
        const toggle = (btn, other) => {
            if (btn.disabled) return;
            const willOn = !btn.classList.contains("pressed");
            [btn, other].forEach(b => b.classList.remove("pressed"));
            if (willOn) btn.classList.add("pressed");
        };
        btnApprove.onclick = () => toggle(btnApprove, btnReject);
        btnReject.onclick = () => toggle(btnReject, btnApprove);
    });

    /* ---------- Helper: local YYYY-MM-DD ---------- */
    const ymd = d => {
        const z = x => String(x).padStart(2, "0");
        return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    };
    const catClass = c => c === "内製" ? "cat-naisei" : c === "外注" ? "cat-gaichu" : "cat-try";

    /* ---------- FullCalendar ---------- */
    const calendar = new FullCalendar.Calendar(calEl, {
        locale: "ja", initialView: "dayGridMonth", firstDay: 1,
        headerToolbar: { left: "prev,next today", center: "title", right: "" },
        titleFormat: { year: "numeric", month: "2-digit" },
        events: async (info, ok, ng) => {
            try {
                const list = await api(`/api/events?start=${info.startStr}&end=${info.endStr}`);
                ok(expand(list));
            } catch (e) { ng(e); }
        },
        dateClick(info) {
            resetForm();
            /* 選択セルをハイライト */
            if (selectedDayEl) selectedDayEl.classList.remove("selected-day");
            selectedDayEl = info.dayEl;
            selectedDayEl.classList.add("selected-day");
            form.start_dt.value = `${info.dateStr}T08:00`;
            form.end_dt.value = `${info.dateStr}T17:00`;
        },
        eventClick(info) {
            const p = info.event.extendedProps;
            editing = true; editingId = p.id;
            mode.textContent = `編集モード (ID:${p.id})`;
            mode.classList.replace("mode-new", "mode-edit");
            submitBtn.textContent = "更新";
            /* 部署コード／工事担当者は CSV の値を再現 */
            deptInp.value = p.dept_code;
            workerInp.value = p.worker;
            form.category.value = p.category;
            form.line_name.value = p.line_name;
            form.title.value = p.title;
            form.purpose.value = p.purpose || "";
            form.urgency.value = p.urgency || urgencies[0] || "";
            form.start_dt.value = p.start_dt;
            form.end_dt.value = p.end_dt;
            form.advance_qty.value = p.advance_qty;
            form.unit.value = p.unit || units[0] || "";
            form.memo.value = p.memo;

            approverRows.forEach((r, i) => {
                /* 入力値 */
                r.querySelector("input").value = (p.approvers || [])[i] || "";
                /* ボタン状態を初期化 */
                const aBtn = r.querySelector(".btn-approve");
                const rBtn = r.querySelector(".btn-reject");
                [aBtn, rBtn].forEach(b => b.classList.remove("pressed"));
                /* フラグ配列があれば復元（1 = ON）*/
                const aFlag = (p.approve_flags || [])[i] === 1;
                const rFlag = (p.reject_flags || [])[i] === 1;
                if (aFlag) aBtn.classList.add("pressed");
                if (rFlag) rBtn.classList.add("pressed");

                /* 活性 / 非活性を再評価 */
                r.querySelector("input").dispatchEvent(new Event("input"));
            });
        },
        eventContent(arg) {
            const p = arg.event.extendedProps, hm = s => s.slice(11, 16);
            return { html: `${hm(p.start_dt)}-${hm(p.end_dt)} _ ${p.line_name}<br>${p.title}` };
        }
    });
    calendar.render();

    /* ---------- Submit ---------- */
    let editing = false, editingId = null;
    const submitBtn = form.querySelector('button[type="submit"]');

    form.onsubmit = async e => {
        e.preventDefault();
        const req = ["category", "line_name", "title", "start_dt", "end_dt", "urgency", "unit"];
        if (req.some(k => !form[k].value.trim())) { alert("必須項目が未入力です"); return; }

        const approvers = [];
        const approveFlags = [];
        const rejectFlags = [];
        approverRows.forEach(r => {
            const val = r.querySelector("input").value.trim();
            const a = r.querySelector(".btn-approve").classList.contains("pressed") ? 1 : 0;
            const rej = r.querySelector(".btn-reject").classList.contains("pressed") ? 1 : 0;
            if (val) {
                approvers.push(val);
                approveFlags.push(a);
                rejectFlags.push(rej);
            }
        });
        if (new Set(approvers).size !== approvers.length) {
            alert("承認者が重複しています"); return;
        }

        const data = Object.fromEntries(new FormData(form).entries());
        data.advance_qty = Number(data.advance_qty || 0);
        data.approvers = approvers;
        data.approve_flags = approveFlags;
        data.reject_flags = rejectFlags;

        await api(editing ? `/api/events/${editingId}` : "/api/events", editing ? "PUT" : "POST", data)
            .catch(err => { alert(err); throw err; });
        await calendar.refetchEvents(); resetForm();
    };

    /* ---------- イベントのキャンセル ---------- */
    document.getElementById("btn-cancel").onclick = async () => {
        /* 編集モード以外 → ただのリセット */
        if (!editing) { resetForm(); return; }

        /* 権限チェック：工事担当者＝ログインユーザーのみ */
        if (workerInp.value !== currentFull) {
            alert("このイベントを削除する権限がありません。");
            return;
        }
        if (!confirm("このイベントを削除しますか？")) return;

        try {
            await api(`/api/events/${editingId}`, "DELETE");
            await calendar.refetchEvents();
            resetForm();
        } catch (err) { alert(err); }
    };

    /* ---------- reset ---------- */
    function resetForm() {
        if (selectedDayEl) { selectedDayEl.classList.remove("selected-day"); selectedDayEl = null; }
        form.reset(); editing = false; editingId = null;
        mode.textContent = "新規登録";
        mode.classList.replace("mode-edit", "mode-new");
        submitBtn.textContent = "登録";
        deptInp.value = currentDept;
        workerInp.value = currentFull;
        form.urgency.value = urgencies[0] || "";
        form.unit.value = units[0] || "";
        approverRows.forEach(r => {
            r.querySelector("input").value = "";
            r.querySelectorAll(".approver-btn").forEach(b => { b.classList.remove("pressed"); b.disabled = true; });
        });
    }

    /* ---------- 展開（マルチデイ） ---------- */
    function expand(list) {
        const res = [];
        list.forEach(e => {
            const s = new Date(e.start_dt);
            const end = new Date(e.end_dt); end.setHours(0, 0, 0, 0);
            const d = Math.ceil((end - s) / 86400000);
            if (d <= 0) { res.push(toEvt(e, s, "single")); return; }
            for (let i = 0; i <= d; i++) {
                const dt = new Date(s); dt.setDate(s.getDate() + i);
                const cls = i === 0 ? "multiday-first" : i === d ? "multiday-last" : "multiday-mid";
                res.push(toEvt(e, dt, cls));
            }
        });
        return res;
    }
    function toEvt(src, date, cls) {
        const arrow = cls === "multiday-first" ? "→" : cls === "multiday-last" ? "←" : cls === "multiday-mid" ? "↔" : "";
        return {
            id: src.id,
            title: `${arrow}${src.line_name}_${src.title}`,
            start: ymd(date), allDay: true,
            classNames: [cls, catClass(src.category)],
            extendedProps: src
        };
    }
})();
