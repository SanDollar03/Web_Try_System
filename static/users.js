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

        // 電子トレイパス表示列
        const tdPath = document.createElement("td");
        tdPath.style.border = "1px solid #ccc";
        tdPath.style.padding = "6px";
        tdPath.textContent = u.tray_path || "";
        tr.appendChild(tdPath);

        // フォルダ選択ボタン列
        const tdBtn = document.createElement("td");
        tdBtn.style.border = "1px solid #ccc";
        tdBtn.style.padding = "6px";
        const btn = document.createElement("button");
        btn.textContent = "選択";
        btn.className = "action";
        btn.onclick = async () => {
            try {
                // サーバー側でダイアログを開いて tray_path を返却
                const res = await api(`/api/users/select_tray/${u.id}`);
                tdPath.textContent = res.tray_path;
            } catch (err) {
                alert("フォルダ選択エラー: " + err);
            }
        };
        tdBtn.appendChild(btn);
        tr.appendChild(tdBtn);

        tbody.appendChild(tr);
    });
});
