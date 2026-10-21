// 賽程的純邏輯：種子排位、狀態推導、判定與取消。不碰 DOM 也不碰 Firebase。

export const BYE = -1;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 64;

export const matchKey = (r, m) => `${r}-${m}`;

export function bracketSize(n) {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

// 標準種子順序，例如 8 → [1, 8, 4, 5, 2, 7, 3, 6]
// 種子 1、2 分在兩側，輪空（最後幾號種子）會對上前幾號種子，因此自然平均分散。
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const len = order.length * 2;
    order = order.flatMap((s) => [s, len + 1 - s]);
  }
  return order;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 回傳第一輪每個位置對應的選手 index（輪空為 BYE）
export function buildSlots(n, shuffle) {
  const size = bracketSize(n);
  const ids = [...Array(n).keys()];
  const bySeed = shuffle ? shuffled(ids) : ids;
  return seedOrder(size).map((seed) => (seed <= n ? bySeed[seed - 1] : BYE));
}

export function roundName(players) {
  if (players === 2) return "決賽";
  if (players === 4) return "四強";
  if (players === 8) return "八強";
  return `${players} 強`;
}

// 由 slots + winners 推導整張賽程。
// 每場的 p 是兩位選手：選手 index、BYE，或 null（尚未確定）。
export function computeBracket(t) {
  const winners = t.winners || {};
  const R = Math.log2(t.size);
  const rounds = [];
  let current = null;

  for (let r = 0; r < R; r++) {
    const row = [];
    for (let m = 0; m < t.size >> (r + 1); m++) {
      const p = r === 0
        ? [t.slots[2 * m], t.slots[2 * m + 1]]
        : [rounds[r - 1][2 * m].winnerId, rounds[r - 1][2 * m + 1].winnerId];
      const known = p[0] !== null && p[1] !== null;
      let winSide = null;
      let auto = false;

      if (known && p[1] === BYE) { winSide = 0; auto = true; }
      else if (known && p[0] === BYE) { winSide = 1; auto = true; }
      else if (known) {
        const w = winners[matchKey(r, m)];
        if (w === 0 || w === 1) winSide = w;
      }

      const match = {
        r, m, p, auto, winSide,
        ready: known && !auto,
        winnerId: winSide === null ? null : p[winSide],
      };
      if (!current && match.ready && winSide === null) current = match;
      row.push(match);
    }
    rounds.push(row);
  }

  const champion = rounds[R - 1][0].winnerId;
  const playable = rounds.flat().filter((x) => x.ready);
  return {
    rounds,
    current,
    champion: champion === BYE ? null : champion,
    decided: playable.filter((x) => x.winSide !== null).length,
    total: playable.length,
  };
}

function ancestorKeys(r, m, size) {
  const R = Math.log2(size);
  const keys = [];
  while (++r < R) {
    m >>= 1;
    keys.push(matchKey(r, m));
  }
  return keys;
}

// 之後幾場已經有結果（取消或改判時會一起被清掉）
export function decidedAfter(t, r, m) {
  const winners = t.winners || {};
  return ancestorKeys(r, m, t.size).filter((k) => k in winners).length;
}

// 判定 / 改判：同時清掉之後所有依賴這場結果的判定
export function decide(t, r, m, side) {
  const winners = { ...(t.winners || {}) };
  for (const k of ancestorKeys(r, m, t.size)) delete winners[k];
  winners[matchKey(r, m)] = side;
  return winners;
}

export function cancel(t, r, m) {
  const winners = { ...(t.winners || {}) };
  for (const k of [matchKey(r, m), ...ancestorKeys(r, m, t.size)]) delete winners[k];
  return winners;
}
