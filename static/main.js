// main.js — カレンダー + 予定登録/編集 + 選択イベント強調
(async function () {
    const apiContacts = '/api/contacts';
    const apiEvents = '/api/events';

    // ---------- DOM ----------
    const calEl = document.getElementById('calendar');
    const form = document.getElementById('event-form');
    const modeEl = document.getElementById('form-mode');
    const dl = document.getElementById('contactsList');
    const fieldset = document.getElementById('approvers');
    if (!calEl || !form || !modeEl || !dl || !fieldset) return;

    // ---------- 承認者行生成 ----------
    const approverRows = [];
    for (let i = 1; i <= 6; i++) {
        const row = document.createElement('div');
        row.className = 'approver-row';
        row.innerHTML = `
      <input name="approver${i}" list="contactsList" placeholder="承認者 ${i}">
      <button type="button" class="btn-approve approver-btn">承認</button>
      <button type="button" class="btn-reject  approver-btn">却下</button>`;
        fieldset.appendChild(row);
        approverRows.push(row);
    }

    // ---------- 状態 ----------
    let editing = false, editingId = null;
    let selectedEventEl = null;              // ★ クリック中のイベント DOM
    const submitBtn = form.querySelector('button[type="submit"]');

    // ---------- ローディング ----------
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.textContent = '処理中...';
    document.body.appendChild(overlay);

    // ---------- 連絡先 ----------
    const contacts = await fetch(apiContacts).then(r => r.json()).catch(() => []);
    contacts.forEach(c => {
        const o = document.createElement('option');
        o.value = c.name; o.label = c.email;
        dl.appendChild(o);
    });

    // ---------- 承認者ボタン有効化 ----------
    approverRows.forEach(row => {
        const inp = row.querySelector('input');
        const btns = row.querySelectorAll('.approver-btn');
        const sync = () => { const ok = inp.value.trim() !== ''; btns.forEach(b => { b.disabled = !ok; if (!ok) b.classList.remove('pressed'); }); };
        inp.addEventListener('input', sync); sync();
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                const label = btn.classList.contains('btn-approve') ? '承認' : '却下';
                if (!confirm(`この行を${label}にしますか？`)) return;
                btns.forEach(b => b.classList.remove('pressed'));
                btn.classList.add('pressed');
            });
        });
    });

    // ---------- FullCalendar ----------
    const calendar = new FullCalendar.Calendar(calEl, {
        locale: 'ja', initialView: 'dayGridMonth', firstDay: 1,
        headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
        titleFormat: { year: 'numeric', month: '2-digit' },

        events: async (info, ok, ng) => {
            try {
                const list = await fetch(`${apiEvents}?start=${info.startStr}&end=${info.endStr}`).then(r => r.json());
                ok(expandMultiDay(list));
            } catch (err) { ng(err); }
        },

        dateClick(info) {
            if (editing && !confirm('編集中の内容を破棄しますか？')) return;
            resetForm();
            form.start_dt.value = `${info.dateStr}T08:00`;
            form.end_dt.value = `${info.dateStr}T17:00`;
        },

        eventClick(info) {
            highlightEvent(info.el);            // ★ ハイライト
            const p = info.event.extendedProps;
            editing = true; editingId = p.id;
            modeEl.textContent = `編集モード (ID:${editingId})`;
            modeEl.classList.replace('mode-new', 'mode-edit');
            submitBtn.textContent = '更新';

            form.category.value = p.category;
            form.line_name.value = p.line_name;
            form.title.value = p.title;
            form.dept_code.value = p.dept_code;
            form.worker.value = p.worker;
            form.start_dt.value = p.start_dt;
            form.end_dt.value = p.end_dt;
            form.advance_qty.value = p.advance_qty;
            form.memo.value = p.memo;

            const arr = p.approvers || [];
            approverRows.forEach((row, i) => {
                row.querySelector('input').value = arr[i] || '';
                row.querySelectorAll('.approver-btn').forEach(b => b.classList.remove('pressed'));
            });
            approverRows.forEach(r => r.querySelector('input').dispatchEvent(new Event('input')));
        }
    });
    calendar.render();

    // ---------- Submit ----------
    form.addEventListener('submit', async e => {
        e.preventDefault();
        overlay.style.visibility = 'visible';
        try {
            const req = ['category', 'line_name', 'title', 'dept_code', 'worker', 'start_dt', 'end_dt'];
            for (const k of req) { if (!form[k].value.trim()) throw new Error('必須項目が未入力です'); }
            const approvers = approverRows.map(r => r.querySelector('input').value.trim()).filter(Boolean);
            const data = Object.fromEntries(new FormData(form).entries());
            data.advance_qty = Number(data.advance_qty || 0);
            data.approvers = approvers;

            const res = await fetch(editing ? `${apiEvents}/${editingId}` : apiEvents, {
                method: editing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error(await res.text() || '保存失敗');

            await calendar.refetchEvents();
            resetForm();
        } catch (err) { alert(err.message || err); }
        finally { overlay.style.visibility = 'hidden'; }
    });

    // ---------- Cancel ----------
    document.getElementById('btn-cancel').addEventListener('click', () => {
        if (editing && !confirm('編集を破棄しますか？')) return;
        resetForm();
    });

    // ---------- Helpers ----------
    function highlightEvent(el) {
        if (selectedEventEl) selectedEventEl.classList.remove('selected-event');
        selectedEventEl = el;
        if (el) el.classList.add('selected-event');
    }

    function resetForm() {
        form.reset();
        editing = false; editingId = null;
        modeEl.textContent = '新規登録';
        modeEl.classList.replace('mode-edit', 'mode-new');
        submitBtn.textContent = '登録';
        approverRows.forEach(r => {
            r.querySelector('input').value = '';
            r.querySelectorAll('.approver-btn').forEach(b => { b.classList.remove('pressed'); b.disabled = true; });
        });
        if (selectedEventEl) { selectedEventEl.classList.remove('selected-event'); selectedEventEl = null; }
    }

    function expandMultiDay(list) {
        const evs = [];
        list.forEach(e => {
            const s = new Date(e.start_dt);
            const end = new Date(e.end_dt); end.setHours(0, 0, 0, 0);
            const days = Math.ceil((end - s) / 86400000);
            if (days <= 0) {
                evs.push(toEvent(e, s, 'single'));
            } else {
                for (let i = 0; i <= days; i++) {
                    const d = new Date(s); d.setDate(s.getDate() + i);
                    const cls = i === 0 ? 'multiday-first' : i === days ? 'multiday-last' : 'multiday-mid';
                    evs.push(toEvent(e, d, cls));
                }
            }
        });
        return evs;
    }

    function toEvent(src, date, cls) {
        const base = `${src.line_name}_${src.title}`;
        const title = cls === 'multiday-first' ? '→' + base
            : cls === 'multiday-last' ? '←' + base
                : cls === 'multiday-mid' ? '↔' + base
                    : base;
        return {
            id: src.id,
            title,
            start: date.toISOString().slice(0, 10),
            allDay: true,
            classNames: [cls],
            extendedProps: src
        };
    }
})();
