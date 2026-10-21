// 由下往上的樹狀賽程圖：第一輪在最下面，冠軍在最上面。支援自動縮放、拖曳、滾輪與雙指縮放。
import { BYE, computeBracket, roundName } from "./bracket.js";

const BOX_W = 230;
const SLOT_H = 50;
const BOX_H = SLOT_H * 2 + 6;
const GAP_X = 30;
const ROW_GAP = 80;
const PAD = 48;
const LABEL_W = 110;
const CHAMP_W = 380;
const CHAMP_H = 130;
const STAGGER_FROM = 16; // 第一輪達到這麼多場時改成上下交錯，寬度約減半
const STAGGER_DY = BOX_H + 34;
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
const SVG_NS = "http://www.w3.org/2000/svg";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function place(node, x, y, w, h) {
  Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
}

export class BracketView {
  constructor(viewport, handlers) {
    this.vp = viewport;
    this.handlers = handlers;
    this.stage = el("div", "stage");
    this.vp.appendChild(this.stage);
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.autoFit = true;
    this.W = 0;
    this.H = 0;
    this.bindGestures();
    this.stage.addEventListener("click", (e) => this.onClick(e));
    new ResizeObserver(() => this.autoFit && this.fit()).observe(this.vp);
  }

  update(t, canEdit) {
    const { rounds, champion, current } = computeBracket(t);
    const R = rounds.length;
    const n0 = rounds[0].length;
    const stagger = n0 >= STAGGER_FROM;
    const step = stagger ? (BOX_W + GAP_X) / 2 : BOX_W + GAP_X;
    const dy0 = stagger ? STAGGER_DY : 0;
    const rowW = (n0 - 1) * step + BOX_W;
    const W = LABEL_W + PAD * 2 + Math.max(rowW, CHAMP_W);
    const H = PAD * 2 + CHAMP_H + ROW_GAP + R * BOX_H + (R - 1) * ROW_GAP + dy0;
    const firstRender = !this.W;
    this.W = W;
    this.H = H;

    const x0 = LABEL_W + PAD + (Math.max(rowW, CHAMP_W) - rowW) / 2;
    const yOf = (r) => PAD + CHAMP_H + ROW_GAP + (R - 1 - r) * (BOX_H + ROW_GAP);
    const yAt = (r, m) => yOf(r) + (r === 0 && m % 2 ? dy0 : 0);
    const cx = [];
    rounds.forEach((row, r) => {
      cx[r] = row.map((_, m) =>
        r === 0 ? x0 + m * step + BOX_W / 2 : (cx[r - 1][2 * m] + cx[r - 1][2 * m + 1]) / 2
      );
    });
    const champX = cx[R - 1][0];
    const nameOf = (pid) => (pid === BYE ? "輪空" : t.players[pid]);

    const frag = document.createDocumentFragment();

    // 連線：已晉級的線畫在後面，蓋住未晉級的
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "lines");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    const paths = [];
    rounds.forEach((row, r) =>
      row.forEach((mt, m) => {
        const x1 = cx[r][m];
        const y1 = yAt(r, m);
        const x2 = r === R - 1 ? champX : cx[r + 1][m >> 1];
        const y2 = r === R - 1 ? PAD + CHAMP_H : yOf(r + 1) + BOX_H;
        const ym = (y1 + y2) / 2;
        paths.push({ d: `M${x1} ${y1}V${ym}H${x2}V${y2}`, win: mt.winnerId !== null && mt.winnerId !== BYE });
      })
    );
    paths.sort((a, b) => a.win - b.win).forEach(({ d, win }) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      if (win) path.setAttribute("class", "win");
      svg.appendChild(path);
    });
    frag.appendChild(svg);

    rounds.forEach((row, r) => {
      const label = el("div", "round-label", roundName(row.length * 2));
      place(label, PAD / 2, yOf(r), LABEL_W, BOX_H + (r === 0 ? dy0 : 0));
      frag.appendChild(label);
    });

    rounds.forEach((row, r) =>
      row.forEach((mt, m) => {
        const box = el("div", "match");
        place(box, cx[r][m] - BOX_W / 2, yAt(r, m), BOX_W, BOX_H);
        if (mt.winSide !== null) box.classList.add("done");
        else if (mt.ready) box.classList.add("ready");
        if (mt === current) {
          box.classList.add("current");
          box.appendChild(el("div", "live-badge", "LIVE"));
        }
        mt.p.forEach((pid, side) => {
          const slot = el("div", side ? "slot bottom" : "slot top");
          const name = el("span", "name");
          if (pid === null) {
            slot.classList.add("tbd");
            name.textContent = "待定";
          } else {
            name.textContent = nameOf(pid);
            slot.title = nameOf(pid);
            if (pid === BYE) slot.classList.add("bye");
            if (mt.winSide === side) slot.classList.add("winner");
            else if (mt.winSide !== null) slot.classList.add("loser");
          }
          slot.appendChild(name);
          if (canEdit && mt.ready) {
            slot.classList.add("clickable");
            Object.assign(slot.dataset, { r, m, side });
          }
          box.appendChild(slot);
        });
        frag.appendChild(box);
      })
    );

    const champ = el("div", "champion");
    place(champ, champX - CHAMP_W / 2, PAD, CHAMP_W, CHAMP_H);
    champ.appendChild(el("div", "champ-label", "🏆 CHAMPION 冠軍"));
    champ.appendChild(el("div", "champ-name", champion === null ? "？" : nameOf(champion)));
    if (champion !== null) champ.classList.add("crowned");
    frag.appendChild(champ);

    this.stage.style.width = `${W}px`;
    this.stage.style.height = `${H}px`;
    this.stage.replaceChildren(frag);
    if (firstRender || this.autoFit) this.fit();
  }

  onClick(e) {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const slot = e.target.closest(".slot.clickable");
    if (slot) {
      const { r, m, side } = slot.dataset;
      this.handlers.onPick(+r, +m, +side);
      return;
    }
    if (e.target.closest(".champion.crowned")) this.handlers.onChampionClick?.();
  }

  apply() {
    this.stage.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  }

  fit() {
    const vw = this.vp.clientWidth;
    const vh = this.vp.clientHeight;
    if (!vw || !vh || !this.W) return;
    this.scale = Math.min(vw / this.W, vh / this.H, 1.6);
    this.tx = (vw - this.W * this.scale) / 2;
    this.ty = (vh - this.H * this.scale) / 2;
    this.autoFit = true;
    this.apply();
  }

  zoomAt(factor, px, py) {
    const s = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    this.tx = px - ((px - this.tx) * s) / this.scale;
    this.ty = py - ((py - this.ty) * s) / this.scale;
    this.scale = s;
    this.autoFit = false;
    this.apply();
  }

  zoomBy(factor) {
    this.zoomAt(factor, this.vp.clientWidth / 2, this.vp.clientHeight / 2);
  }

  bindGestures() {
    const vp = this.vp;
    const pts = new Map();
    let start = null;
    this.dragging = false;
    this.suppressClick = false;

    const snapshot = () => {
      const rect = vp.getBoundingClientRect();
      const list = [...pts.values()];
      const cx = list.reduce((s, p) => s + p.x, 0) / list.length - rect.left;
      const cy = list.reduce((s, p) => s + p.y, 0) / list.length - rect.top;
      const dist = list.length > 1 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0;
      return { cx, cy, dist };
    };
    const begin = () => {
      start = pts.size ? { ...snapshot(), scale: this.scale, tx: this.tx, ty: this.ty } : null;
    };

    vp.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.suppressClick = false;
      begin();
    });

    vp.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = snapshot();
      if (!this.dragging) {
        if (pts.size < 2 && Math.hypot(g.cx - start.cx, g.cy - start.cy) < 6) return;
        this.dragging = true;
        vp.classList.add("dragging");
      }
      const s = pts.size > 1 && start.dist ? clamp((start.scale * g.dist) / start.dist, MIN_SCALE, MAX_SCALE) : start.scale;
      const wx = (start.cx - start.tx) / start.scale;
      const wy = (start.cy - start.ty) / start.scale;
      this.scale = s;
      this.tx = g.cx - wx * s;
      this.ty = g.cy - wy * s;
      this.autoFit = false;
      this.apply();
    });

    const end = (e) => {
      if (!pts.delete(e.pointerId)) return;
      if (this.dragging) this.suppressClick = true;
      if (!pts.size) {
        this.dragging = false;
        vp.classList.remove("dragging");
      }
      begin();
    };
    vp.addEventListener("pointerup", end);
    vp.addEventListener("pointercancel", end);
    vp.addEventListener("pointerleave", end);

    vp.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = vp.getBoundingClientRect();
        this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false }
    );
  }
}
