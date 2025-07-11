scheduler-app/
├─ app.py
├─ requirements.txt
├─ data/
│  ├─ events.csv          # 予定データ（ヘッダーのみ or 既存レコード）
│  └─ contacts.csv        # 連絡先データ
├─ utils/
│  ├─ __init__.py
│  └─ csv_store.py        # 汎用 CSV 読み書きユーティリティ
└─ static/
   ├─ index.html          # カレンダー画面
   ├─ register.html       # ユーザー登録画面
   ├─ styles.css          # 共通スタイル
   ├─ main.js             # カレンダー・予定登録／編集ロジック
   ├─ main_register.js    # ユーザー登録ページ用 JS
   └─ favicon.ico         # （任意）サイトアイコン
