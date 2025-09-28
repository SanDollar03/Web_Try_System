// static/users.js
document.addEventListener("DOMContentLoaded", async () => {
    // /users 以外では動作しない
    if (!location.pathname.startsWith("/users")) return;

    const api = window.tryApi;

    // 認証
    const me = await api("/api/me").catch(() => null);
    if (!me || !me.id) { location.href = "/login.html"; return; }

    // 戻る
    document.getElementById("btn-back").onclick = () => { location.href = "/calendar"; };

    // 全ユーザー取得
    const users = await api("/api/users/all").catch(() => []);
    const tbody = document.querySelector("#user-table tbody");
    tbody.innerHTML = "";

    users.forEach(u => {
        const tr = document.createElement("tr");
        const isMine = Number(u.id) === Number(me.id);
        if (!isMine) tr.classList.add("readonly");

        // 各セル生成ヘルパ
        const td = (cls) => { const e = document.createElement("td"); if (cls) e.className = cls; return e; };
        const input = (val, type = "text", ro = false) => {
            const el = document.createElement("input");
            el.type = type; el.value = val ?? ""; el.className = "cell-input";
            if (ro) el.readOnly = true;
            return el;
        };

        // ID (表示のみ)
        const tdId = td("col-id"); tdId.textContent = u.id; tr.appendChild(tdId);

        // 姓 / 名 / メール / 部署コード / 電子トレイ
        const inpLast = input(u.last_name, "text", !isMine);
        const inpFirst = input(u.first_name, "text", !isMine);
        const inpMail = input(u.email, "email", !isMine);
        const inpDept = input(u.dept_code, "text", !isMine);
        const inpTray = input(u.tray_path || "", "text", !isMine);

        const tdLast = td(); tdLast.appendChild(inpLast); tr.appendChild(tdLast);
        const tdFirst = td(); tdFirst.appendChild(inpFirst); tr.appendChild(tdFirst);
        const tdMail = td("col-email"); tdMail.appendChild(inpMail); tr.appendChild(tdMail);
        const tdDept = td("col-dept"); tdDept.appendChild(inpDept); tr.appendChild(tdDept);
        const tdTray = td("col-tray"); tdTray.appendChild(inpTray); tr.appendChild(tdTray);

        // 保存ボタン
        const tdSave = td("col-save");
        if (isMine) {
            const btn = document.createElement("button");
            btn.textContent = "保存";
            btn.className = "action";
            btn.onclick = async () => {
                // 最小バリデーション
                const ln = inpLast.value.trim();
                const fn = inpFirst.value.trim();
                const mail = inpMail.value.trim().toLowerCase();
                const dept = inpDept.value.trim().toUpperCase();
                const tray = inpTray.value.trim();

                if (!ln || !fn || !mail || !dept) { alert("すべて必須です"); return; }
                if (!/^[^@]+@[^@]+\.[^@]+$/.test(mail)) { alert("メール形式が不正です"); return; }
                if (!/^[A-Za-z0-9]{5}$/.test(dept)) { alert("部署コードは英数字5桁です"); return; }

                btn.classList.add("loading");
                try {
                    // tray_path も一緒に送る（サーバ側は本体更新＋tray_pathの両方に対応済み）
                    await api(`/api/users/${u.id}`, "PUT", {
                        last_name: ln, first_name: fn, email: mail, dept_code: dept, tray_path: tray
                    });
                    alert("保存しました");
                } catch (e) {
                    // サーバーの日本語エラーメッセージもそのまま表示
                    alert("保存に失敗しました: " + e);
                } finally {
                    btn.classList.remove("loading");
                }
            };
            tdSave.appendChild(btn);
        } else {
            tdSave.textContent = "—";
            tdSave.style.color = "#999";
        }
        tr.appendChild(tdSave);

        tbody.appendChild(tr);
    });
});