# 財務儀表板（加密版 PWA）

私人財務儀表板。資料以 **AES-256-GCM** 加密（金鑰由密碼經 PBKDF2-SHA256、1,000,000 次迭代產生）後內嵌在 `index.html`，
只在瀏覽器內解密，不會上傳。倉庫內沒有任何明文資料，也沒有密碼。

- 開啟後輸入密碼解鎖；「🔒 鎖定」會清除記憶體中的資料。
- 可安裝到手機／電腦主畫面（PWA），支援離線開啟。
- 手動輸入與 CSV／Excel 匯入的資料只存在該裝置的瀏覽器（localStorage），可匯出 JSON 備份。

`tests/e2e.mjs`：端對端測試（需 Chrome、puppeteer-core；密碼由環境變數 `APP_PASSWORD` 提供）。
