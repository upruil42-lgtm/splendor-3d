// 电脑对手决策
// 核心思路：用"分级优先级"而不是把不同量纲的动作塞进一个分数比较。
//   1 级：能拿分的卡 -> 买
//   2 级：值得买的引擎卡 -> 买
//   3 级：手牌快满 -> 买掉，避免弃牌浪费
//   4 级：预留（离目标很近 / 有黄金且目标香）
//   5 级：拿宝石（含"换牌"：满手时拿有用的、丢没用的）
//   6 级：无子可动 -> 跳过
import { COLORS, GOLD, totalCost } from './cards.js';
import {
  legalActions,
  paymentPlan,
  qualifiedNobles,
  tokenTotal,
  currentPlayer,
  requiredDiscard,
  TOKEN_LIMIT,
} from './rules.js';

function emptyVec() {
  const v = {};
  for (const c of COLORS) v[c] = 0;
  return v;
}

function cardOf(state, action) {
  if (action.source.kind === 'market') return state.market[action.source.level][action.source.index];
  return currentPlayer(state).reserved[action.source.index];
}

export function cardValue(state, p, card, opponents = []) {
  let s = card.points * 10;

  for (const nb of state.nobles) {
    let need = 0;
    let before = 0;
    let after = 0;
    for (const c of COLORS) {
      if (!nb.req[c]) continue;
      need += nb.req[c];
      before += Math.min(nb.req[c], p.bonuses[c]);
      after += Math.min(nb.req[c], p.bonuses[c] + (c === card.bonus ? 1 : 0));
    }
    if (after >= need) s += 30;
    else if (after > before) s += (after - before) * 4 * (1 + before / need);
  }

  const own = p.bonuses[card.bonus];
  s += Math.max(0, 3 - own) * 2.5;
  if (own >= 4) s -= 3;

  if (card.level === 3) s += 4;
  else if (card.level === 2 && card.points >= 2) s += 3;
  else s += 2;

  s -= totalCost(card) * 0.15;

  for (const o of opponents) {
    if (o.bonuses[card.bonus] >= 3) s += 1;
  }
  return s;
}

function visibleCards(state, p) {
  const out = [];
  for (const lv of [1, 2, 3]) {
    state.market[lv].forEach((card) => {
      if (card) out.push(card);
    });
  }
  for (const card of p.reserved) out.push(card);
  return out;
}

function gapOf(p, card) {
  const miss = emptyVec();
  let gap = 0;
  for (const c of COLORS) {
    const need = Math.max(0, (card.cost[c] || 0) - p.bonuses[c]);
    miss[c] = Math.max(0, need - p.tokens[c]);
    gap += miss[c];
  }
  return { miss, gap };
}

// 每种颜色对当前玩家"未来有用程度"
function colorWant(state, p, cards, values) {
  const want = emptyVec();
  for (const card of cards) {
    const { miss, gap } = gapOf(p, card);
    if (gap === 0) continue;
    const v = values.get(card.id) || 0;
    for (const c of COLORS) {
      if (miss[c] > 0) want[c] = Math.max(want[c], (v / (1 + gap * 0.8)) * Math.min(miss[c], 2) * 0.5);
    }
  }
  for (const nb of state.nobles) {
    let need = 0;
    let have = 0;
    for (const c of COLORS) {
      if (!nb.req[c]) continue;
      need += nb.req[c];
      have += Math.min(nb.req[c], p.bonuses[c]);
    }
    for (const c of COLORS) {
      if (nb.req[c] && p.bonuses[c] < nb.req[c]) {
        want[c] = Math.max(want[c], 2.5 * (1 + have / need));
      }
    }
  }
  return want;
}

// 满手时拿牌要先弃牌：算出"净增"向量（拿到的减去被迫丢掉的）
function netGain(p, gain, want) {
  const net = emptyVec();
  net[GOLD] = 0;
  let total = tokenTotal(p.tokens) + (gain[GOLD] || 0);
  const pool = {};
  for (const c of COLORS) pool[c] = p.tokens[c] + gain[c];
  pool[GOLD] = p.tokens[GOLD] + (gain[GOLD] || 0);

  for (const c of COLORS) net[c] = gain[c];
  net[GOLD] = gain[GOLD] || 0;

  if (total <= TOKEN_LIMIT) return net;

  let excess = total - TOKEN_LIMIT;
  const order = COLORS.slice().sort((a, b) => want[a] - want[b]);
  order.push(GOLD);
  for (const c of order) {
    while (excess > 0 && pool[c] > 0) {
      pool[c] -= 1;
      excess -= 1;
      // 先抵掉刚拿到的，再扣原有的
      if (net[c] > 0) net[c] -= 1;
      else net[c] -= 1;
    }
    if (excess === 0) break;
  }
  return net;
}

function pickBest(list, rand) {
  list.sort((x, y) => y.s - x.s);
  if (rand > 0 && Math.random() < rand && list.length > 1) return list[1].a;
  return list[0].a;
}

export function rankActions(state, difficulty = 'normal') {
  const p = currentPlayer(state);
  const opponents = state.players.filter((x) => x.id !== p.id);
  const acts = legalActions(state);
  const cards = visibleCards(state, p);
  const values = new Map();
  for (const card of cards) values.set(card.id, cardValue(state, p, card, opponents));
  const want = colorWant(state, p, cards, values);

  const scored = acts.map((a) => {
    if (a.type === 'buy') {
      const card = cardOf(state, a);
      const plan = paymentPlan(state, p, card);
      const v = values.get(card.id) ?? cardValue(state, p, card, opponents);
      let s = v + 10;
      s -= plan.gold * (difficulty === 'hard' ? 2.5 : 1.5);
      s -= plan.total * 0.05;
      if (a.source.kind === 'reserved') s += 2;
      return { a, s, card, v };
    }

    if (a.type === 'take3' || a.type === 'take2') {
      const gain = emptyVec();
      gain[GOLD] = 0;
      let count = 0;
      if (a.type === 'take3') {
        for (const c of a.colors) {
          gain[c] = 1;
          count++;
        }
      } else {
        gain[a.color] = 2;
        count = 2;
      }
      const net = netGain(p, gain, want);

      let s = 0;
      for (const card of cards) {
        const { miss, gap } = gapOf(p, card);
        if (gap === 0) continue;
        let cut = 0;
        for (const c of COLORS) if (miss[c] > 0 && net[c] > 0) cut += Math.min(miss[c], net[c]);
        if (cut <= 0) continue;
        // 距离折扣：离得越远的卡，它缺的颜色越不值得优先去拿
        const discount = 1 / (1 + gap * 0.32);
        s = Math.max(s, (values.get(card.id) || 0) * 0.34 * (cut / gap) * discount);
      }
      let nobleTerm = 0;
      for (const nb of state.nobles) {
        let need = 0;
        let have = 0;
        for (const c of COLORS) {
          if (!nb.req[c]) continue;
          need += nb.req[c];
          have += Math.min(nb.req[c], p.bonuses[c]);
        }
        for (const c of COLORS) {
          if (nb.req[c] && p.bonuses[c] < nb.req[c] && net[c] > 0) {
            nobleTerm = Math.max(nobleTerm, 2.4 * (1 + have / need));
          }
        }
      }
      s += nobleTerm;
      // 净亏（丢掉有用的牌）要扣分
      for (const c of COLORS) {
        if (net[c] < 0) s += net[c] * (1 + want[c] * 0.4);
      }
      if (net[GOLD] < 0) s += net[GOLD] * 4;
      return { a, s };
    }

    if (a.type === 'reserve') {
      if (a.source.kind === 'deck') return { a, s: difficulty === 'hard' ? -6 : -20 };
      const card = state.market[a.source.level][a.source.index];
      const { gap } = gapOf(p, card);
      const v = values.get(card.id) || 0;
      let s = -14 - p.reserved.length * 10;
      if (gap <= 2 && v >= 25) s += v * 0.3;
      if (gap <= 1) s += 6;
      if (p.cards.length === 0) s -= 12;
      if (state.supply[GOLD] > 0 && tokenTotal(p.tokens) < TOKEN_LIMIT) s += 3;
      if (p.reserved.length >= 2) s -= 12;
      return { a, s };
    }
    if (a.type === 'pass') return { a, s: -100 };
    return { a, s: -1e6 };
  });

  scored.sort((x, y) => y.s - x.s);
  return { scored, p, opponents, cards, values, want };
}

export function chooseAction(state, difficulty = 'normal') {
  const p = currentPlayer(state);

  if (state.phase === 'discard') return chooseDiscard(state);
  if (state.phase === 'noble') {
    const opts = qualifiedNobles(state, p);
    if (!opts.length) return null;
    opts.sort((a, b) => nobleContest(state, b) - nobleContest(state, a));
    return { type: 'chooseNoble', nobleId: opts[0].id };
  }
  if (state.over) return null;

  const acts = legalActions(state);
  if (!acts.length) return null;

  const rand = difficulty === 'easy' ? 0.32 : 0;
  if (rand && Math.random() < rand) {
    const pool = acts.filter((a) => a.type !== 'pass');
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }

  const { scored, p: me } = rankActions(state, difficulty);
  const buys = scored.filter((x) => x.a.type === 'buy');
  const takes = scored.filter((x) => x.a.type === 'take3' || x.a.type === 'take2');
  const reserves = scored.filter((x) => x.a.type === 'reserve');

  const buyThreshold = difficulty === 'easy' ? 12 : difficulty === 'hard' ? 9 : 10;
  const tokens = tokenTotal(me.tokens);

  const scoring = buys.filter((x) => x.card.points > 0);
  if (scoring.length) return scoring[0].a;
  if (buys.length && buys[0].v >= buyThreshold) return buys[0].a;
  if (buys.length && tokens >= 8) return buys[0].a;
  if (reserves.length && reserves[0].s > 0) return reserves[0].a;
  if (takes.length && takes[0].s > -50) return takes[0].a;
  if (buys.length) return buys[0].a;
  if (reserves.length) return reserves[0].a;
  return scored[0].a;
}

function nobleContest(state, noble) {
  let d = 0;
  for (const pl of state.players) {
    for (const c of COLORS) {
      if (noble.req[c]) d += Math.min(noble.req[c], pl.bonuses[c]);
    }
  }
  return d;
}

export function chooseDiscard(state) {
  const p = currentPlayer(state);
  const need = requiredDiscard(state);
  const opponents = state.players.filter((x) => x.id !== p.id);
  const cards = visibleCards(state, p);
  const values = new Map();
  for (const card of cards) values.set(card.id, cardValue(state, p, card, opponents));
  const want = colorWant(state, p, cards, values);

  const tokens = emptyVec();
  tokens[GOLD] = 0;
  const keep = (c) => want[c] - p.tokens[c] * 0.5;
  const order = COLORS.slice().sort((a, b) => keep(a) - keep(b));
  order.push(GOLD);

  let left = need;
  for (const c of order) {
    while (left > 0 && p.tokens[c] - tokens[c] > 0) {
      tokens[c] += 1;
      left -= 1;
    }
    if (left === 0) break;
  }
  return { type: 'discard', tokens };
}

export function difficultyLabel(d) {
  return { easy: '简单', normal: '普通', hard: '困难' }[d] || '普通';
}
