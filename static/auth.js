/* auth.js – login / register / logout with dept_code */
const api = async (url, method = "GET", body) => {
    const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        // 非JSONの場合は data=null のまま
    }

    if (!r.ok) {
        // エラーメッセージの優先順：data.error → 全文 → HTTPステータス
        const msg = data && data.error
            ? data.error
            : text || `HTTP ${r.status}`;
        throw msg;
    }
    // 成功時は JSON オブジェクト or 生テキストを返す
    return data !== null ? data : text;
};
const $ = id => document.getElementById(id);

/* ========== LOGIN PAGE ================================== */
if (location.pathname === "/" || location.pathname.endsWith("login.html")) {
    $("tab-login").onclick = () => tab(true);
    $("tab-reg").onclick = () => tab(false);
    function tab(login) {
        $("login-form").classList.toggle("hidden", !login);
        $("reg-form").classList.toggle("hidden", login);
        $("tab-login").classList.toggle("active", login);
        $("tab-reg").classList.toggle("active", !login);
        $("msg").textContent = "";
    }

    /* ---- login ---- */
    $("login-form").onsubmit = async e => {
        e.preventDefault(); $("msg").textContent = "";
        const email = $("login-email").value.trim().toLowerCase();
        try {
            const me = await api("/api/login", "POST", { email });
            sessionStorage.setItem("justLoggedIn", "1");
            sessionStorage.setItem("currentUserFull", `${me.last}${me.first}`);
            sessionStorage.setItem("currentUserDept", me.dept_code || "");
            location.href = "/calendar";
        } catch (err) {
            $("msg").textContent = err.includes("user not found") ? "未登録のメールアドレスです。" : err;
        }
    };

    /* ---- register ---- */
    $("reg-form").onsubmit = async e => {
        e.preventDefault(); $("msg").textContent = "";
        const data = {
            last_name: $("reg-last").value.trim(),
            first_name: $("reg-first").value.trim(),
            email: $("reg-email").value.trim().toLowerCase(),
            dept_code: $("reg-dept").value.trim().toUpperCase()
        };
        if (!/^[A-Za-z0-9]{5}$/.test(data.dept_code)) {
            $("msg").textContent = "部署コードは半角英数字5桁です。"; return;
        }
        try {
            await api("/api/users", "POST", data);
            const me = await api("/api/login", "POST", { email: data.email });
            sessionStorage.setItem("justLoggedIn", "1");
            sessionStorage.setItem("currentUserFull", `${me.last}${me.first}`);
            sessionStorage.setItem("currentUserDept", me.dept_code || "");
            location.href = "/calendar";
        } catch (err) {
            $("msg").textContent = err.includes("email duplicated") ? "このメールは既に登録済みです。" : err;
        }
    };
}

/* ========== CALENDAR PAGE ================================= */
document.addEventListener("DOMContentLoaded", async () => {
    if (!location.pathname.startsWith("/calendar")) return;

    if (sessionStorage.getItem("justLoggedIn")) {
        sessionStorage.removeItem("justLoggedIn");   // keep session
    } else {
        await api("/api/logout", "POST").catch(() => { });
        location.href = "/login.html"; return;
    }

    const me = await api("/api/me").catch(() => null);
    if (!me || !me.last) { location.href = "/login.html"; return; }

    $("greeting").textContent = `ようこそ！${me.last} ${me.first} さん`;
    sessionStorage.setItem("currentUserFull", `${me.last}${me.first}`);
    sessionStorage.setItem("currentUserDept", me.dept_code || "");

    $("btn-logout").onclick = async () => {
        await api("/api/logout", "POST").catch(() => { });
        location.href = "/login.html";
    };
});

window.tryApi = api;        // main.js で再利用
