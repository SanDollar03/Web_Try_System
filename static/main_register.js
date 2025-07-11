// main_register.js — ユーザー登録ページ
(async function () {
    const api = '/api/contacts';
    const tableBody = document.querySelector('#contacts-table tbody');
    const nameInp = document.getElementById('new-name');
    const mailInp = document.getElementById('new-mail');
    const btnAdd = document.getElementById('btn-add');

    async function loadContacts() {
        tableBody.innerHTML = '';
        const list = await fetch(api).then(r => r.json()).catch(() => []);
        list.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${c.name}</td><td>${c.email}</td>`;
            tableBody.appendChild(tr);
        });
    }

    btnAdd.addEventListener('click', async () => {
        const name = nameInp.value.trim();
        const mail = mailInp.value.trim().toLowerCase();
        if (!name || !mail) { alert('氏名とメールを入力してください'); return; }
        try {
            const res = await fetch(api, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email: mail })
            });
            if (!res.ok) {
                const msg = await res.text();
                throw new Error(msg || '登録失敗');
            }
            nameInp.value = ''; mailInp.value = '';
            await loadContacts();
        } catch (err) { alert(err.message || err); }
    });

    loadContacts();
})();
