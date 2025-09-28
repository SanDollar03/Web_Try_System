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
    const isGuest = (sessionStorage.getItem("isGuest") === "1");

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
        const o = document.createElement("option");
        o.value = c.name;
        o.label = c.email;
        dlContacts.appendChild(o);
    });

    /* ---------- users datalist (承認者用) ---------- */
    const dlUsers = document.createElement("datalist");
    dlUsers.id = "usersList";
    users.forEach(u => {
        const o = document.createElement("option");
        o.value = u.full;
        dlUsers.appendChild(o);
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
        <button type="button" class="btn-reject approver-btn">却下</button>`;
        fld.appendChild(row);
        approverRows.push(row);
    }

    /* ---------- 情報共有者行（ボタンなし） ---------- */
    const sharerRows = [];                            // ★追加
    {
        const fldSharers = document.getElementById("sharers");
        for (let i = 1; i <= 6; i++) {
            const row = document.createElement("div");
            row.className = "approver-row";              // 既存の見た目を流用
            row.innerHTML = `
            <input name="sharer${i}" list="usersList" placeholder="情報共有者 ${i}" autocomplete="off">`;
            fldSharers.appendChild(row);
            sharerRows.push(row);
        }
    }


    /* ---------- 承認/却下フラグの収集・保存 ---------- */
    function collectFlagsFromRows() {
        const approvers = [], approveFlags = [], rejectFlags = [];
        approverRows.forEach(r => {
            const name = r.querySelector("input").value.trim();
            if (!name) return;
            const a = r.querySelector(".btn-approve").classList.contains("pressed") ? 1 : 0;
            const rej = r.querySelector(".btn-reject").classList.contains("pressed") ? 1 : 0;
            approvers.push(name);
            approveFlags.push(a);
            rejectFlags.push(rej);
        });
        return { approvers, approveFlags, rejectFlags };
    }
    async function saveFlagsIfEditing() {
        if (!editing || !editingId || isGuest) return;
        const { approvers, approveFlags, rejectFlags } = collectFlagsFromRows();
        await api(`/api/events/${editingId}`, "PUT", {
            approvers, approve_flags: approveFlags, reject_flags: rejectFlags
        });
    }

    /* ---------- 承認ボタン活性 & 重複チェック ---------- */
    approverRows.forEach(row => {
        const inp = row.querySelector("input");
        const btns = row.querySelectorAll(".approver-btn");

        const validate = () => {
            const val = inp.value.trim();
            const duplicate = val && approverRows.some(r => r !== row && r.querySelector("input").value.trim() === val);
            if (duplicate) { alert("同じ承認者は重複入力できません。"); inp.value = ""; }
            const self = val === currentFull;
            btns.forEach(b => { b.disabled = isGuest ? true : !self; });
            if (isGuest) inp.disabled = true;
        };
        inp.addEventListener("input", validate); validate();

        const btnApprove = row.querySelector(".btn-approve");
        const btnReject = row.querySelector(".btn-reject");

        const toggle = (btn, other) => {
            if (btn.disabled) return false;
            const willOn = !btn.classList.contains("pressed");
            [btn, other].forEach(b => b.classList.remove("pressed"));
            if (willOn) btn.classList.add("pressed");
            return willOn;
        };

        btnApprove.onclick = async () => {
            if (isGuest) { alert("ゲストは編集できません"); return; }
            try {
                toggle(btnApprove, btnReject);
                await saveFlagsIfEditing();
                if (editing) await calendar.refetchEvents();
            } catch (e) {
                alert("保存に失敗しました: " + e);
            }
        };

        btnReject.onclick = async () => {
            if (isGuest) { alert("ゲストは編集できません"); return; }
            const turnedOn = toggle(btnReject, btnApprove);
            if (!editing || !editingId) {
                alert("既存イベントを選択してから操作してください。");
                btnReject.classList.remove("pressed");
                return;
            }
            if (turnedOn) {
                const reason = prompt("却下の理由を記入してください");
                if (reason === null) { btnReject.classList.remove("pressed"); return; }
                if (!reason.trim()) { alert("理由が未入力です。"); btnReject.classList.remove("pressed"); return; }
                try {
                    await saveFlagsIfEditing();
                    await api(`/api/events/${editingId}/reject_notify`, "POST", { reason: reason.trim() });
                    alert("却下理由を工事担当者の電子トレイに投函しました。");
                    await calendar.refetchEvents();
                } catch (e) {
                    alert("投函または保存に失敗しました: " + e);
                }
            } else {
                try { await saveFlagsIfEditing(); await calendar.refetchEvents(); }
                catch (e) { alert("保存に失敗しました: " + e); }
            }
        };
    });

    /* ---------- Helper ---------- */
    const ymd = d => {
        const z = x => String(x).padStart(2, "0");
        return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    };
    const catClass = c => c === "内製" ? "cat-naisei" : c === "外注" ? "cat-gaichu" : "cat-try";

    function badgePrefix(p) {
        const appr = Array.isArray(p.approvers) ? p.approvers : [];
        const ok = Array.isArray(p.approve_flags) ? p.approve_flags : [];
        const ng = Array.isArray(p.reject_flags) ? p.reject_flags : [];
        if (ng.some(v => Number(v) === 1)) return "【却下】";
        if (appr.length > 0 && appr.every((_, i) => Number(ok[i]) === 1 && Number(ng[i] || 0) !== 1)) {
            return "【承認済】";
        }
        return "";
    }

    /* ---------- FullCalendar ---------- */
    const calendar = new FullCalendar.Calendar(calEl, {
        locale: "ja",
        initialView: "dayGridMonth",
        firstDay: 1,
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
                r.querySelector("input").value = (p.approvers || [])[i] || "";
                const aBtn = r.querySelector(".btn-approve");
                const rBtn = r.querySelector(".btn-reject");
                [aBtn, rBtn].forEach(b => b.classList.remove("pressed"));
                const aFlag = (p.approve_flags || [])[i] === 1;
                const rFlag = (p.reject_flags || [])[i] === 1;
                if (aFlag) aBtn.classList.add("pressed");
                if (rFlag) rBtn.classList.add("pressed");
                r.querySelector("input").dispatchEvent(new Event("input"));
            });

            // ★ 情報共有者の入力値を復元
            sharerRows.forEach((r, i) => {
                r.querySelector("input").value = (p.sharers || [])[i] || "";
            });

            // ★ 承認済みは編集ロック（キャンセルのみ可）
            lockApproved = (badgePrefix(p) === "【承認済】");
            if (lockApproved) {
                // フォーム内の要素を一括で無効化（キャンセルは除外）
                Array.from(form.elements).forEach(el => {
                    if (el.id !== "btn-cancel") el.disabled = true;
                });
                // 承認者行の入力とボタンも無効化
                approverRows.forEach(r => {
                    r.querySelectorAll(".approver-btn, input").forEach(el => el.disabled = true);
                });
                // 見出し
                mode.textContent = "編集不可（承認済）";
            }

        },
        // 置換後（★日跨ぎ対応）
        eventContent(arg) {
            const p = arg.event.extendedProps;
            const hm = s => s.slice(11, 16);
            const cls = arg.event.classNames || [];

            let range;
            if (cls.includes("multiday-first")) {
                // 1日目: 開始-23:59
                range = `${hm(p.start_dt)}-23:59`;
            } else if (cls.includes("multiday-last")) {
                // 最終日: 00:00-終了
                range = `00:00-${hm(p.end_dt)}`;
            } else if (cls.includes("multiday-mid")) {
                // 中日: 00:00-23:59
                range = `00:00-23:59`;
            } else {
                // 単日
                range = `${hm(p.start_dt)}-${hm(p.end_dt)}`;
            }

            const pre = badgePrefix(p);
            const head = pre ? `${pre} ` : "";
            return { html: `${head}${range} _ ${p.line_name}<br>${p.title}` };
        }

    });
    calendar.render();

    /* ---------- ゲストならUIを無効化 ---------- */
    if (isGuest) {
        // すべての入力を無効化
        Array.from(form.elements).forEach(el => el.disabled = true);
        // キャンセル/投函ボタンも無効
        const btnCancel = document.getElementById("btn-cancel");
        if (btnCancel) btnCancel.disabled = true;
        const depositBtn = document.getElementById("btn-deposit") || document.getElementById("btn-email");
        if (depositBtn) depositBtn.disabled = true;
        // タイトルだけ切替
        mode.textContent = "閲覧モード（ゲスト）";
    }

    /* ---------- Submit ---------- */
    let editing = false, editingId = null, lockApproved = false;  // ★ 承認済み編集ロック
    const submitBtn = form.querySelector('button[type="submit"]');

    form.onsubmit = async e => {
        e.preventDefault();
        if (isGuest) { alert("ゲストは編集できません"); return; }
        if (lockApproved) { alert("このイベントは承認済みのため編集できません（キャンセルは可能）"); return; }

        const req = ["category", "line_name", "title", "start_dt", "end_dt", "urgency", "unit"];
        if (req.some(k => !form[k].value.trim())) { alert("必須項目が未入力です"); return; }

        const approvers = [];
        const sharers = [];
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
        // 情報共有者を収集（ボタンは無いので名前だけ）
        sharerRows.forEach(r => {
            const val = r.querySelector("input").value.trim();
            if (val) sharers.push(val);
        });
        if (new Set(approvers).size !== approvers.length) {
            alert("承認者が重複しています"); return;
        }

        const data = Object.fromEntries(new FormData(form).entries());
        data.advance_qty = Number(data.advance_qty || 0);
        data.approvers = approvers;
        data.sharers = sharers;
        data.approve_flags = approveFlags;
        data.reject_flags = rejectFlags;

        await api(editing ? `/api/events/${editingId}` : "/api/events", editing ? "PUT" : "POST", data)
            .catch(err => { alert(err); throw err; });
        await calendar.refetchEvents();
        resetForm();
    };

    /* ---------- イベントのキャンセル ---------- */
    document.getElementById("btn-cancel").onclick = async () => {
        if (isGuest) { alert("ゲストは編集できません"); return; }
        if (!editing) { resetForm(); return; }
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

    /* ---------- 電子トレイに通知（ボタン復活用） ---------- */
    const notifyBtn = document.getElementById("btn-notify");
    if (notifyBtn) {
        notifyBtn.onclick = async () => {
            if (isGuest) { alert("ゲストは編集できません"); return; }
            if (!editing || !editingId) { alert("既存イベントを選択してください。"); return; }
            // 未保存の承認/却下状態を反映してから通知したい場合はコメント解除
            // try { await saveFlagsIfEditing(); } catch (_) {}

            if (!confirm("電子トレイに通知します。よろしいですか？")) return;

            try {
                notifyBtn.classList.add("loading");
                await api(`/api/events/${editingId}/deposit_tray`, "POST", {});
                alert("電子トレイに通知しました。");
            } catch (e) {
                alert("通知に失敗しました: " + e);
            } finally {
                notifyBtn.classList.remove("loading");
            }
        };
    }

    /* ---------- 電子トレイに投函（承認者へ） ---------- */
    const depositBtn = document.getElementById("btn-deposit") || document.getElementById("btn-email");
    if (depositBtn) {
        depositBtn.onclick = async () => {
            if (isGuest) { alert("ゲストは編集できません"); return; }
            if (!editing || !editingId) { alert("既存イベントを選択してください。"); return; }
            try { await saveFlagsIfEditing(); } catch (_) { }
            if (!confirm("承認者の電子トレイに投函します。よろしいですか？")) return;
            try {
                depositBtn.classList.add("loading");
                await api(`/api/events/${editingId}/deposit_tray`, "POST", {});
                alert("承認者の電子トレイに投函しました。");
            } catch (e) {
                alert("投函に失敗しました: " + e);
            } finally {
                depositBtn.classList.remove("loading");
            }
        };
    }

    /* ---------- reset ---------- */
    function resetForm() {
        if (selectedDayEl) { selectedDayEl.classList.remove("selected-day"); selectedDayEl = null; }
        form.reset(); editing = false; editingId = null;
        // ★ 承認済みロック解除（ゲストでなければ再有効化）
        lockApproved = false;
        if (!isGuest) {
            Array.from(form.elements).forEach(el => el.disabled = false);
            approverRows.forEach(r => {
                r.querySelectorAll(".approver-btn, input").forEach(el => el.disabled = false);
            });
        }
        mode.textContent = isGuest ? "閲覧モード（ゲスト）" : "新規登録";
        mode.classList.remove("mode-edit"); mode.classList.add(isGuest ? "mode-new" : "mode-new");
        submitBtn.textContent = isGuest ? "登録（無効）" : "登録";
        deptInp.value = currentDept;
        workerInp.value = currentFull;
        form.urgency.value = urgencies[0] || "";
        form.unit.value = units[0] || "";
        approverRows.forEach(r => {
            r.querySelector("input").value = "";
            r.querySelectorAll(".approver-btn").forEach(b => { b.classList.remove("pressed"); b.disabled = isGuest ? true : b.disabled; });
            if (isGuest) r.querySelector("input").disabled = true;
        });
        // ★ 情報共有者欄のクリア
        sharerRows.forEach(r => {
            r.querySelector("input").value = "";
            if (isGuest) r.querySelector("input").disabled = true;
        });
        if (isGuest) Array.from(form.elements).forEach(el => el.disabled = true);
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
        const arrow = cls === "multiday-first" ? "→" : cls === "multiday-last" ? "←" : "↔";
        const pre = badgePrefix(src);
        const head = pre ? `${pre} ` : "";
        return {
            id: src.id,
            title: `${head}${arrow}${src.line_name}_${src.title}`,
            start: ymd(date), allDay: true,
            classNames: [cls, catClass(src.category)],
            extendedProps: src
        };
    }
})();

/* ★ 追加: 「ユーザー編集」ボタンで /users へ遷移（既存構成を崩さない） */
document.addEventListener("DOMContentLoaded", () => {
    const btnUsers = document.getElementById("btn-users");
    if (btnUsers) {
        btnUsers.onclick = () => { location.href = "/users"; };
    }
});