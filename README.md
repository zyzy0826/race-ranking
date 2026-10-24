# 擂台賽淘汰賽程表

給社課現場投影用的單淘汰賽程表：深色電競風、由下往上長的樹狀圖，操控端點選勝者後，投影幕和觀眾手機即時同步。

- 2～64 人，非 2 的次方自動補「輪空」，輪空用標準種子排位平均分散在兩側
- 可一次貼上名單、可隨機打亂（抽籤）
- 點選手名字判定勝利；點已晉級者取消判定；點輸家可改判（之後受影響的場次自動一起取消）
- 復原（最多 50 步，重置也能復原）、重置賽程（會先確認）
- 目前進行中的比賽發光並標示 LIVE；冠軍出現時全螢幕慶祝 + 彩帶（點冠軍框可再放一次）
- 自動縮放到一個畫面；可滾輪 / 雙指縮放、拖曳平移
- 快捷鍵：`F` 全螢幕、`0` 適應畫面、`+` / `-` 縮放、`Ctrl+Z` 復原

## 權限

| | 未登入 / 拿到觀看連結的人 | 賽程建立者 |
|---|---|---|
| 看賽程（即時更新） | ✅ | ✅ |
| 判定、復原、重置、刪除 | ❌ | ✅ |

任何人都能用 Google 登入建立自己的賽程，彼此互不干擾。權限由 Firestore 安全規則在伺服器端檢查。

投影建議：操控用自己的筆電或手機開「操控模式」，投影電腦開「觀看連結」（`?t=賽程ID&view=1`）。

---

## 第一次部署（約 10 分鐘）

### 1. 建立 Firebase 專案

1. 到 <https://console.firebase.google.com/> →「新增專案」，名稱隨意，Google Analytics 可以關掉。
2. 左側「Security（安全性）→ Authentication」→「開始使用」→「Sign-in method」→ 啟用 **Google**。
3. 左側「Databases & Storage（資料庫與儲存空間）→ Firestore」→「建立資料庫」→ 位置選 `asia-east1`（台灣）→ 選「以正式版模式啟動」。
4. 同一個地方（Databases & Storage → Firestore）的「Rules（規則）」分頁 → 把本專案 [`firestore.rules`](firestore.rules) 的內容整個貼上 →「發布」。
5. 專案設定（齒輪）→「一般」→ 下方「你的應用程式」→ 點 `</>`（網頁）註冊一個應用程式 → 複製 `firebaseConfig`，貼到 [`js/firebase-config.js`](js/firebase-config.js)。

> `firebaseConfig` 本來就會公開在網頁裡，放上 GitHub 沒問題；真正保護資料的是第 4 步的規則。

### 2. 部署到 GitHub Pages

1. 把這個資料夾推到 GitHub repo。
2. repo 的「Settings → Pages」→ Source 選「Deploy from a branch」→ Branch 選 `main` / `(root)` → Save。
3. 幾分鐘後網址會是 `https://<你的帳號>.github.io/<repo 名稱>/`。

### 3. 允許 GitHub Pages 網域登入

Firebase 主控台 →「Security（安全性）→ Authentication → Settings → 已授權網域」→ 新增 `<你的帳號>.github.io`。

沒加這步的話，按登入會出現 `auth/unauthorized-domain` 錯誤。

---

## 本機測試

ES module 不能直接用 `file://` 開，要起一個本機伺服器，例如：

```bash
npx serve .
```

然後打開 <http://localhost:3000>。`localhost` 預設已在 Firebase 授權網域內。

> Windows 上 `python -m http.server` 可能把 `.js` 當成 `text/plain` 送出，導致頁面空白，建議用上面的 `npx serve`。

## 費用

使用 Firebase 免費的 Spark 方案，沒綁信用卡就不會被收費。一場賽程只有幾 KB，社團規模用不完額度；萬一超過，服務會暫停到隔天，不會產生費用。

## 檔案結構

```
index.html            頁面骨架
style.css             樣式
js/app.js             路由、登入、Firestore 讀寫、首頁與賽程頁
js/bracket.js         純邏輯：種子排位、輪空、勝負推導、取消/改判
js/render.js          樹狀圖繪製、縮放與拖曳
js/firebase-config.js Firebase 設定（要自己填）
firestore.rules       Firestore 安全規則（貼到主控台）
```
