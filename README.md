scheduler-app/                   （アプリのルート）
│
├─ app.py                        … Flask 本体（最新版 v3.3）
│
├─ data/                         … 業務データ CSV 用フォルダ
│   ├─ users.csv
│   ├─ events.csv
│   ├─ contacts.csv
│   ├─ urgencies.csv
│   └─ units.csv
│
├─ logs/                         … ログ専用フォルダ
│   ├─ user_actions.csv          （操作ログ  yyyy/mm/dd HH:MM:SS）
│   └─ server_errors.csv         （エラーログ  同上書式）
│
├─ utils/                        … ヘルパーモジュール
│   └─ csv_store.py              （read_csv / write_csv / ensure_columns）
│
└─ static/                       … フロントエンド資産（Flask static）
    ├─ index.html                … カレンダー画面
    ├─ login.html                … ログイン / 新規登録画面
    │
    ├─ styles.css                … 共通スタイル（カレンダー等）
    ├─ login.css                 … ログイン画面専用スタイル
    │
    ├─ main.js                   … カレンダー／イベント操作 (削除対応版)
    ├─ auth.js                   … ログイン / 登録 / ログアウト制御
    │
    └─ (画像など任意の静的アセット)
