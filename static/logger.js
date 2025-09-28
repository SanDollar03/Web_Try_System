/* logger.js – フロント操作を簡易送信 */

(() => {
    const api = window.tryApi || (async (u, m = "POST", b) => fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }));

    /** send log */
    function log(action, detail = "") {
        api("/api/log", "POST", { action, detail }).catch(() => { });
    }

    /* ---- グローバル操作例 ---- */
    document.addEventListener("DOMContentLoaded", () => {
        /* ボタンクリックなど必要に応じて呼び出し */
        const logout = document.getElementById("btn-logout");
        if (logout) logout.addEventListener("click", () => log("click_logout"));

        /* ページ閲覧 */
        log("page_view", location.pathname);
    });

    /* ---- JS エラー／未捕捉 Promise ---- */
    window.addEventListener("error", e => {
        log("front_error", `${e.filename}:${e.lineno} ${e.message}`);
    });
    window.addEventListener("unhandledrejection", e => {
        log("front_rejection", String(e.reason));
    });

    /* expose */
    window.logClient = log;
})();