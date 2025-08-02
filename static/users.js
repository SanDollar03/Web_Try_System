// static/users.js

document.addEventListener("DOMContentLoaded", async () => {
    // /users ページ以外では動作しない
    if (!location.pathname.startsWith("/users")) return;
    const api = window.tryApi;

    // 認証チェック
    const me = await api("/api/me").catch(() => null);
    if (!me || !me.id) {
        location.href = "/login.html";
        return;
    }

    // 「戻る」ボタン
    document.getElementById("btn-back").onclick = () => {
        location.href = "/calendar";
    };

    // ユーザー一覧を取得
    const users = await api("/api/users/all");
    const tbody = document.querySelector("#user-table tbody");
    tbody.innerHTML = "";

    users.forEach(u => {
        const tr = document.createElement("tr");

        // ID / 姓 / 名 / メール / 部署コード
        ["id", "last_name", "first_name", "email", "dept_code"].forEach(field => {
            const td = document.createElement("td");
            td.style.border = "1px solid #ccc";
            td.style.padding = "6px";
            td.textContent = u[field] || "";
            tr.appendChild(td);
        });

        // 電子トレイパス：テキスト入力欄
        const tdInput = document.createElement("td");
        tdInput.style.border = "1px solid #ccc";
        tdInput.style.padding = "6px";
        const input = document.createElement("input");
        input.type = "text";
        input.value = u.tray_path || "";
        input.style.width = "100%";
        tdInput.appendChild(input);
        tr.appendChild(tdInput);

        // 保存ボタン列
        const tdSave = document.createElement("td");
        tdSave.style.border = "1px solid #ccc";
        tdSave.style.padding = "6px";
        const btnSave = document.createElement("button");
        btnSave.textContent = "保存";
        btnSave.className = "action";
        btnSave.onclick = async () => {
            try {
                const newPath = input.value.trim();
                await api(`/api/users/${u.id}`, "PUT", { tray_path: newPath });
                alert("電子トレイパスを保存しました");
            } catch (err) {
                alert("保存に失敗しました: " + err);
            }
        };
        tdSave.appendChild(btnSave);
        tr.appendChild(tdSave);

        tbody.appendChild(tr);
    });
});
