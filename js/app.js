import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  BYE, MIN_PLAYERS, MAX_PLAYERS, buildSlots, bracketSize, computeBracket, decide, cancel, decidedAfter,
} from "./bracket.js";
import { BracketView } from "./render.js";

const UNDO_LIMIT = 50;

const $app = document.getElementById("app");
const $title = document.getElementById("pageTitle");
const $actions = document.getElementById("actions");
const $auth = document.getElementById("authBox");
const $toast = document.getElementById("toast");

let auth, db;
let currentUser = null;
let cleanup = () => {};
let keyHandler = null;

// ---------- 小工具 ----------

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") node.className = v;
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $toast.classList.remove("show"), 2400);
}

function viewUrl(id) {
  const url = new URL(location.href);
  url.search = `?t=${id}&view=1`;
  url.hash = "";
  return url.toString();
}

async function copyViewLink(id) {
  try {
    await navigator.clipboard.writeText(viewUrl(id));
    toast("已複製觀看連結");
  } catch {
    prompt("複製這個觀看連結：", viewUrl(id));
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

function showError(err) {
  console.error(err);
  toast(err.code === "permission-denied" ? "沒有權限執行這個動作" : `發生錯誤：${err.message}`);
}

// ---------- 登入 ----------

async function login() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === "auth/popup-blocked") await signInWithRedirect(auth, provider);
    else if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") showError(err);
  }
}

function renderAuth() {
  if (currentUser) {
    $auth.replaceChildren(
      currentUser.photoURL ? h("img", { class: "avatar", src: currentUser.photoURL, alt: "", referrerpolicy: "no-referrer" }) : null,
      h("span", { class: "user-name" }, currentUser.displayName || currentUser.email),
      h("button", { class: "btn ghost", onclick: () => signOut(auth) }, "登出")
    );
  } else {
    $auth.replaceChildren(h("button", { class: "btn", onclick: login }, "登入"));
  }
}

// ---------- 路由 ----------

function route() {
  cleanup();
  cleanup = () => {};
  $actions.replaceChildren();
  $title.textContent = "";
  document.body.classList.remove("bracket-page");
  const params = new URLSearchParams(location.search);
  const id = params.get("t");
  if (id) showTournament(id, params.get("view") === "1");
  else showHome();
}

// ---------- 首頁：建立賽程 + 我的賽程 ----------

function showHome() {
  document.title = "擂台賽程表";
  if (!currentUser) {
    $app.replaceChildren(
      h("section", { class: "hero" },
        h("div", { class: "hero-kicker" }, "TOURNAMENT BRACKET"),
        h("h1", {}, "擂台賽淘汰賽程表"),
        h("p", {}, "建立單淘汰賽程、現場投影、即時同步到每一台裝置。"),
        h("p", { class: "muted" }, "登入後就能建立自己的賽程；拿到觀看連結的人不用登入也能即時觀看。"),
        h("button", { class: "btn primary big", onclick: login }, "使用 Google 登入")
      )
    );
    return;
  }

  const names = h("div", { class: "names" });
  const count = h("input", { type: "number", min: MIN_PLAYERS, max: MAX_PLAYERS, value: 8, inputmode: "numeric" });
  const title = h("input", { type: "text", maxlength: 40, value: "擂台賽" });
  const shuffle = h("input", { type: "checkbox" });
  const bulk = h("textarea", { rows: 6, placeholder: "王小明\n李大華\n陳小美\n…" });
  const info = h("div", { class: "muted small" });

  const renderNames = () => {
    const n = Math.round(Number(count.value));
    if (!(n >= MIN_PLAYERS && n <= MAX_PLAYERS)) {
      info.textContent = `人數請輸入 ${MIN_PLAYERS}～${MAX_PLAYERS}`;
      return;
    }
    const old = [...names.querySelectorAll("input")].map((i) => i.value);
    names.replaceChildren(
      ...Array.from({ length: n }, (_, i) =>
        h("label", { class: "name-field" },
          h("span", { class: "idx" }, i + 1),
          h("input", { type: "text", maxlength: 24, placeholder: `選手 ${i + 1}`, value: old[i] ?? "" })
        )
      )
    );
    const byes = bracketSize(n) - n;
    info.textContent = `${bracketSize(n)} 強賽程` + (byes ? `，${byes} 位選手第一輪輪空直接晉級` : "");
  };

  const applyBulk = () => {
    const list = bulk.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_PLAYERS);
    if (list.length < MIN_PLAYERS) return toast(`至少要 ${MIN_PLAYERS} 個名字`);
    count.value = list.length;
    names.replaceChildren();
    renderNames();
    names.querySelectorAll("input").forEach((input, i) => (input.value = list[i]));
    toast(`已套用 ${list.length} 位選手`);
  };

  const create = async (e) => {
    const n = Math.round(Number(count.value));
    if (!(n >= MIN_PLAYERS && n <= MAX_PLAYERS)) return toast(`人數請輸入 ${MIN_PLAYERS}～${MAX_PLAYERS}`);
    const players = [...names.querySelectorAll("input")].map((input, i) => input.value.trim() || `選手 ${i + 1}`);
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const ref = await addDoc(collection(db, "tournaments"), {
        ownerUid: currentUser.uid,
        ownerName: currentUser.displayName || "",
        title: title.value.trim() || "擂台賽",
        players,
        size: bracketSize(n),
        slots: buildSlots(n, shuffle.checked),
        winners: {},
        undo: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      location.search = `?t=${ref.id}`;
    } catch (err) {
      button.disabled = false;
      showError(err);
    }
  };

  count.addEventListener("input", renderNames);
  const list = h("div", { class: "list" }, h("div", { class: "muted" }, "載入中…"));

  $app.replaceChildren(
    h("div", { class: "home" },
      h("section", { class: "card" },
        h("h2", {}, "建立新賽程"),
        h("label", { class: "field" }, h("span", {}, "賽程名稱"), title),
        h("label", { class: "field" }, h("span", {}, `參賽人數（${MIN_PLAYERS}～${MAX_PLAYERS}）`), count),
        info,
        h("details", { class: "bulk" },
          h("summary", {}, "一次貼上名單（每行一個名字）"),
          bulk,
          h("button", { class: "btn", onclick: applyBulk }, "套用名單")
        ),
        names,
        h("label", { class: "check" }, shuffle, "隨機打亂順序（抽籤）"),
        h("button", { class: "btn primary big", onclick: create }, "產生賽程")
      ),
      h("section", { class: "card" }, h("h2", {}, "我的賽程"), list)
    )
  );
  renderNames();
  loadMyList(list);
}

async function loadMyList(container) {
  try {
    const snap = await getDocs(query(collection(db, "tournaments"), where("ownerUid", "==", currentUser.uid)));
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
    if (!items.length) {
      container.replaceChildren(h("div", { class: "muted" }, "還沒有賽程，從左邊建立一個吧。"));
      return;
    }
    container.replaceChildren(
      ...items.map((t) => {
        const c = computeBracket(t);
        const status = c.champion !== null ? `🏆 ${t.players[c.champion]}` : `進行中 ${c.decided}/${c.total}`;
        const date = t.createdAt ? new Date(t.createdAt.seconds * 1000).toLocaleDateString("zh-TW") : "";
        return h("div", { class: "list-item" },
          h("a", { class: "list-main", href: `?t=${t.id}` },
            h("div", { class: "list-title" }, t.title),
            h("div", { class: "muted small" }, `${t.players.length} 人 · ${date} · ${status}`)
          ),
          h("button", { class: "btn ghost", onclick: () => copyViewLink(t.id) }, "觀看連結"),
          h("button", {
            class: "btn ghost danger",
            onclick: async () => {
              if (!confirm(`確定要刪除「${t.title}」？這個動作無法復原。`)) return;
              try {
                await deleteDoc(doc(db, "tournaments", t.id));
                loadMyList(container);
              } catch (err) {
                showError(err);
              }
            },
          }, "刪除")
        );
      })
    );
  } catch (err) {
    container.replaceChildren(h("div", { class: "muted" }, "載入失敗"));
    showError(err);
  }
}

// ---------- 賽程頁 ----------

function celebrate(name) {
  const overlay = h("div", { class: "celebrate", onclick: () => overlay.remove() },
    h("div", { class: "celebrate-inner" },
      h("div", { class: "celebrate-label" }, "🏆 CHAMPION"),
      h("div", { class: "celebrate-name" }, name)
    )
  );
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 7000);

  const fire = window.confetti;
  if (!fire) return;
  const colors = ["#22d3ee", "#f472b6", "#fbbf24", "#a78bfa", "#ffffff"];
  fire({ particleCount: 160, spread: 100, startVelocity: 55, origin: { y: 0.6 }, colors, zIndex: 1000 });
  const until = Date.now() + 3500;
  (function frame() {
    fire({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors, zIndex: 1000 });
    fire({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, zIndex: 1000 });
    if (Date.now() < until) requestAnimationFrame(frame);
  })();
}

function showTournament(id, forceView) {
  document.body.classList.add("bracket-page");
  const viewport = h("div", { class: "viewport" });
  $app.replaceChildren(viewport);

  const ref = doc(db, "tournaments", id);
  let t = null;
  let isOwner = false;
  let lastChampion;

  const commit = async (winners) => {
    const undo = [...(t.undo || []), t.winners || {}].slice(-UNDO_LIMIT);
    try {
      await updateDoc(ref, { winners, undo, updatedAt: serverTimestamp() });
    } catch (err) {
      showError(err);
    }
  };

  const undo = async () => {
    const stack = [...(t.undo || [])];
    if (!stack.length) return toast("沒有可以復原的步驟");
    const winners = stack.pop();
    try {
      await updateDoc(ref, { winners, undo: stack, updatedAt: serverTimestamp() });
    } catch (err) {
      showError(err);
    }
  };

  const reset = () => {
    if (!confirm("確定要重置賽程？所有比賽結果都會被清除（之後仍可按「復原」找回）。")) return;
    commit({});
  };

  const nameOf = (pid) => (pid === BYE ? "輪空" : t.players[pid]);

  const view = new BracketView(viewport, {
    onPick(r, m, side) {
      if (!isOwner) return;
      const mt = computeBracket(t).rounds[r][m];
      if (!mt.ready) return;
      const name = nameOf(mt.p[side]);
      const later = decidedAfter(t, r, m);
      const laterNote = later ? `\n（之後已判定的 ${later} 場也會一起取消）` : "";
      if (mt.winSide === null) {
        commit(decide(t, r, m, side));
      } else if (mt.winSide === side) {
        if (later && !confirm(`取消 ${name} 的晉級？${laterNote}`)) return;
        commit(cancel(t, r, m));
      } else {
        if (!confirm(`改判 ${name} 獲勝？${laterNote}`)) return;
        commit(decide(t, r, m, side));
      }
    },
    onChampionClick() {
      const c = computeBracket(t);
      if (c.champion !== null) celebrate(nameOf(c.champion));
    },
  });

  const renderActions = () => {
    const zoom = [
      h("button", { class: "btn icon", title: "縮小", onclick: () => view.zoomBy(1 / 1.25) }, "−"),
      h("button", { class: "btn", title: "縮放到一個畫面（快捷鍵 0）", onclick: () => view.fit() }, "適應畫面"),
      h("button", { class: "btn icon", title: "放大", onclick: () => view.zoomBy(1.25) }, "+"),
      h("button", { class: "btn icon", title: "全螢幕（快捷鍵 F）", onclick: toggleFullscreen }, "⛶"),
    ];
    const owner = isOwner
      ? [
          h("button", { class: "btn", title: "復原上一步（Ctrl+Z）", disabled: !(t.undo || []).length, onclick: undo }, "↶ 復原"),
          h("button", { class: "btn danger", onclick: reset }, "重置賽程"),
          h("button", { class: "btn", onclick: () => copyViewLink(id) }, "複製觀看連結"),
          h("span", { class: "sep" }),
        ]
      : [];
    const backToControl =
      forceView && currentUser && t.ownerUid === currentUser.uid
        ? [h("a", { class: "btn", href: `?t=${id}` }, "進入操控模式"), h("span", { class: "sep" })]
        : [];
    $actions.replaceChildren(...owner, ...backToControl, ...zoom);
  };

  const unsub = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        $app.replaceChildren(h("section", { class: "hero" }, h("h1", {}, "找不到這個賽程"), h("a", { class: "btn", href: "./" }, "回首頁")));
        return;
      }
      t = snap.data();
      isOwner = !forceView && !!currentUser && currentUser.uid === t.ownerUid;
      document.title = `${t.title}｜擂台賽程表`;
      $title.replaceChildren(
        h("span", {}, t.title),
        isOwner ? h("span", { class: "mode-tag control" }, "操控模式") : h("span", { class: "mode-tag" }, "觀看")
      );
      renderActions();
      view.update(t, isOwner);

      const { champion } = computeBracket(t);
      if (lastChampion === null && champion !== null) celebrate(nameOf(champion));
      lastChampion = champion;
    },
    showError
  );

  keyHandler = (e) => {
    if (e.target.matches("input, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && isOwner) {
      e.preventDefault();
      undo();
    } else if (e.key === "f" || e.key === "F") toggleFullscreen();
    else if (e.key === "0") view.fit();
    else if (e.key === "+" || e.key === "=") view.zoomBy(1.25);
    else if (e.key === "-") view.zoomBy(1 / 1.25);
  };
  document.addEventListener("keydown", keyHandler);

  cleanup = () => {
    unsub();
    document.removeEventListener("keydown", keyHandler);
  };
}

// ---------- 啟動 ----------

if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_")) {
  $app.replaceChildren(
    h("section", { class: "hero" },
      h("h1", {}, "尚未設定 Firebase"),
      h("p", {}, "請依照 README.md 建立 Firebase 專案，並把設定貼到 js/firebase-config.js。")
    )
  );
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    renderAuth();
    route();
  });
}
