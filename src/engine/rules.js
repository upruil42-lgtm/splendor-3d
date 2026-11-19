// 纯逻辑规则引擎（不依赖 DOM / three.js），可被浏览器与 Node 测试共用
import {
  COLORS,
  GOLD,
  TOKEN_COLORS,
  buildDeck,
  buildNobles,
  shuffle,
  makeRng,
  COLOR_INFO,
} from './cards.js';

export const GEM_COUNT = { 2: 4, 3: 5, 4: 7 };
export const TOKEN_LIMIT = 10;
export const MAX_RESERVED = 3;
export const WIN_SCORE = 15;

function emptyTokens() {
  const t = {};
  for (const c of TOKEN_COLORS) t[c] = 0;
  return t;
}

function cloneTokens(t) {
  const o = {};
  for (const c of TOKEN_COLORS) o[c] = t[c] || 0;
  return o;
}

export function tokenTotal(t) {
  let s = 0;
  for (const c of TOKEN_COLORS) s += t[c] || 0;
  return s;
}

function makePlayer(id, human, name) {
  return {
    id,
    name,
    human,
    tokens: emptyTokens(),
    bonuses: (() => {
      const b = {};
      for (const c of COLORS) b[c] = 0;
      return b;
    })(),
    points: 0,
    cards: [],
    reserved: [],
    nobles: [],
    turnsTaken: 0,
  };
}

export function createGame({ playerCount = 4, seed = 1, humanSeats = [0], names = null } = {}) {
  const n = Math.max(2, Math.min(4, playerCount));
  const rng = makeRng(seed);
  const gemPer = GEM_COUNT[n];

  const supply = emptyTokens();
  for (const c of COLORS) supply[c] = gemPer;
  supply[GOLD] = 5;

  const decks = buildDeck();
  for (const lv of [1, 2, 3]) decks[lv] = shuffle(decks[lv], rng);

  const market = { 1: [], 2: [], 3: [] };
  for (const lv of [1, 2, 3]) {
    for (let i = 0; i < 4; i++) market[lv].push(decks[lv].pop() || null);
  }

  const noblePool = shuffle(buildNobles(), rng);
  const nobles = noblePool.slice(0, n + 1);

  const players = [];
  for (let i = 0; i < n; i++) {
    const name = names && names[i] ? names[i] : i === 0 ? '你' : `电脑 ${i}`;
    players.push(makePlayer(i, humanSeats.includes(i), name));
  }

  return {
    playerCount: n,
    seed,
    players,
    supply,
    decks,
    market,
    nobles,
    current: 0,
    phase: 'action',
    over: false,
    winner: null,
    ranking: [],
    version: 0,
    turnNo: 0,
    stall: 0,
    purchasedThisTurn: false,
    endReason: null,
    log: [],
    lastEvents: [],
  };
}

export function currentPlayer(state) {
  return state.players[state.current];
}

function cardFrom(source, state) {
  if (!source) return null;
  if (source.kind === 'market') {
    const slot = state.market[source.level];
    if (!slot) return null;
    return slot[source.index] || null;
  }
  if (source.kind === 'reserved') {
    return state.players[state.current].reserved[source.index] || null;
  }
  return null;
}

function refillMarket(state, level, index) {
  const deck = state.decks[level];
  state.market[level][index] = deck.length ? deck.pop() : null;
}

export function paymentPlan(state, player, card) {
  const pay = emptyTokens();
  let gold = 0;
  for (const c of COLORS) {
    const need = Math.max(0, (card.cost[c] || 0) - player.bonuses[c]);
    const use = Math.min(need, player.tokens[c]);
    pay[c] = use;
    gold += need - use;
  }
  const affordable = gold <= player.tokens[GOLD];
  return { pay, gold, affordable, total: tokenTotal(pay) + gold };
}

function combos(arr, k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

export function actionKey(a) {
  if (!a) return 'null';
  switch (a.type) {
    case 'take3':
      return `take3:${a.colors.slice().sort().join('')}`;
    case 'take2':
      return `take2:${a.color}`;
    case 'reserve':
      return a.source.kind === 'market'
        ? `reserve:m:${a.source.level}:${a.source.index}`
        : `reserve:d:${a.source.level}`;
    case 'buy':
      return a.source.kind === 'market'
        ? `buy:m:${a.source.level}:${a.source.index}`
        : `buy:r:${a.source.index}`;
    case 'discard':
      return `discard:${TOKEN_COLORS.map((c) => a.tokens[c] || 0).join('-')}`;
    case 'chooseNoble':
      return `noble:${a.nobleId}`;
    case 'pass':
      return 'pass';
    default:
      return 'unknown';
  }
}

export function qualifiedNobles(state, player) {
  return state.nobles.filter((nb) =>
    COLORS.every((c) => !nb.req[c] || player.bonuses[c] >= nb.req[c])
  );
}

export function requiredDiscard(state) {
  const p = currentPlayer(state);
  const total = tokenTotal(p.tokens);
  return total > TOKEN_LIMIT ? total - TOKEN_LIMIT : 0;
}

export function legalActions(state) {
  if (state.over) return [];
  const p = currentPlayer(state);
  const acts = [];

  if (state.phase === 'discard') {
    acts.push({ type: 'discard', count: requiredDiscard(state) });
    return acts;
  }

  if (state.phase === 'noble') {
    for (const nb of qualifiedNobles(state, p)) acts.push({ type: 'chooseNoble', nobleId: nb.id });
    return acts;
  }

  for (const lv of [1, 2, 3]) {
    const slot = state.market[lv];
    for (let i = 0; i < slot.length; i++) {
      const card = slot[i];
      if (!card) continue;
      const plan = paymentPlan(state, p, card);
      if (plan.affordable) acts.push({ type: 'buy', source: { kind: 'market', level: lv, index: i } });
      if (p.reserved.length < MAX_RESERVED) {
        acts.push({ type: 'reserve', source: { kind: 'market', level: lv, index: i } });
      }
    }
    if (p.reserved.length < MAX_RESERVED && state.decks[lv].length > 0) {
      acts.push({ type: 'reserve', source: { kind: 'deck', level: lv } });
    }
  }

  for (let i = 0; i < p.reserved.length; i++) {
    const card = p.reserved[i];
    const plan = paymentPlan(state, p, card);
    if (plan.affordable) acts.push({ type: 'buy', source: { kind: 'reserved', index: i } });
  }

  const available = COLORS.filter((c) => state.supply[c] > 0);
  const count = Math.min(3, available.length);
  if (count > 0) {
    for (const combo of combos(available, count)) acts.push({ type: 'take3', colors: combo });
  }
  for (const c of COLORS) {
    if (state.supply[c] >= 4) acts.push({ type: 'take2', color: c });
  }

  // 原版允许"确实无子可动"时跳过回合，这里作为兜底避免卡死
  if (acts.length === 0) acts.push({ type: 'pass' });

  return acts;
}

export function isLegal(state, action) {
  const key = actionKey(action);
  if (action.type === 'discard') {
    if (state.phase !== 'discard') return false;
    return tokensDiscardable(state, action.tokens);
  }
  return legalActions(state).some((a) => actionKey(a) === key);
}

function tokensDiscardable(state, tokens) {
  const p = currentPlayer(state);
  let sum = 0;
  for (const c of TOKEN_COLORS) {
    const v = tokens[c] || 0;
    if (v < 0 || v > p.tokens[c]) return false;
    sum += v;
  }
  return sum === requiredDiscard(state);
}

function takeEventsFor(state, player, tokens) {
  const ev = [];
  for (const c of TOKEN_COLORS) {
    const v = tokens[c] || 0;
    if (v > 0) ev.push({ kind: 'gainToken', player: player.id, color: c, count: v });
  }
  return ev;
}

/**
 * 执行一个动作。返回 { ok, error, events }。events 供动画层消费。
 */
export function applyAction(state, action) {
  if (state.over) return { ok: false, error: '对局已结束' };
  if (!isLegal(state, action)) return { ok: false, error: '非法操作' };

  const p = currentPlayer(state);
  const events = [];

  if (action.type === 'discard') {
    for (const c of TOKEN_COLORS) {
      const v = action.tokens[c] || 0;
      if (v > 0) {
        p.tokens[c] -= v;
        state.supply[c] += v;
        events.push({ kind: 'discardToken', player: p.id, color: c, count: v });
      }
    }
    state.phase = 'action';
    events.push({ kind: 'log', text: `${p.name} 弃掉多余代币` });
    afterAction(state, events);
    return finish(state, events);
  }

  if (action.type === 'chooseNoble') {
    const noble = state.nobles.find((nb) => nb.id === action.nobleId);
    state.nobles = state.nobles.filter((nb) => nb.id !== action.nobleId);
    p.nobles.push(noble);
    p.points += noble.points;
    // 每回合最多只能获得一位贵族，这里不再二次检查
    state.phase = 'action';
    events.push({ kind: 'takeNoble', player: p.id, noble });
    events.push({ kind: 'log', text: `${p.name} 获得贵族，+${noble.points} 分` });
    return finish(state, events);
  }

  if (action.type === 'pass') {
    events.push({ kind: 'log', text: `${p.name} 无子可动，跳过回合` });
    afterAction(state, events);
    return finish(state, events);
  }

  if (action.type === 'take3' || action.type === 'take2') {
    const colors = action.type === 'take3' ? action.colors : [action.color, action.color];
    for (const c of colors) {
      p.tokens[c] += 1;
      state.supply[c] -= 1;
    }
    events.push({ kind: 'takeTokens', player: p.id, colors });
    const label = action.type === 'take3' ? '拿了 3 枚不同宝石' : `拿了 2 枚${COLOR_INFO[action.color].name}`;
    events.push({ kind: 'log', text: `${p.name} ${label}` });
  } else if (action.type === 'reserve') {
    let card;
    if (action.source.kind === 'market') {
      const { level, index } = action.source;
      card = state.market[level][index];
      refillMarket(state, level, index);
    } else {
      card = state.decks[action.source.level].pop();
    }
    p.reserved.push(card);
    let gotGold = false;
    if (state.supply[GOLD] > 0) {
      state.supply[GOLD] -= 1;
      p.tokens[GOLD] += 1;
      gotGold = true;
    }
    events.push({ kind: 'reserve', player: p.id, card, gold: gotGold });
    events.push({
      kind: 'log',
      text: `${p.name} 预留了一张${card.level ? '' : ''}发展卡${gotGold ? '并拿走 1 枚黄金' : ''}`,
    });
  } else if (action.type === 'buy') {
    const card = cardFrom(action.source, state);
    const plan = paymentPlan(state, p, card);
    for (const c of COLORS) {
      if (plan.pay[c] > 0) {
        p.tokens[c] -= plan.pay[c];
        state.supply[c] += plan.pay[c];
      }
    }
    if (plan.gold > 0) {
      p.tokens[GOLD] -= plan.gold;
      state.supply[GOLD] += plan.gold;
    }
    if (action.source.kind === 'market') {
      refillMarket(state, action.source.level, action.source.index);
    } else {
      p.reserved.splice(action.source.index, 1);
    }
    p.cards.push(card);
    p.bonuses[card.bonus] += 1;
    p.points += card.points;
    state.purchasedThisTurn = true;
    events.push({ kind: 'buy', player: p.id, card, gold: plan.gold, pay: plan.pay, from: action.source });
    events.push({ kind: 'log', text: `${p.name} 买下${card.points ? ` ${card.points} 分` : ''}${COLOR_INFO[card.bonus].name}卡` });
  }

  afterAction(state, events);
  return finish(state, events);
}

// 动作结算完成后：先处理代币上限，再处理贵族
function afterAction(state, events) {
  const p = currentPlayer(state);
  if (tokenTotal(p.tokens) > TOKEN_LIMIT) {
    state.phase = 'discard';
    return;
  }
  const qualified = qualifiedNobles(state, p);
  if (qualified.length > 1) {
    state.phase = 'noble';
    events.push({ kind: 'nobleChoice', player: p.id, options: qualified });
    return;
  }
  if (qualified.length === 1) {
    const noble = qualified[0];
    state.nobles = state.nobles.filter((nb) => nb.id !== noble.id);
    p.nobles.push(noble);
    p.points += noble.points;
    events.push({ kind: 'takeNoble', player: p.id, noble });
    events.push({ kind: 'log', text: `${p.name} 获得贵族，+${noble.points} 分` });
  }
  state.phase = 'action';
}

function finish(state, events) {
  if (state.phase === 'action') {
    endTurn(state, events);
  }
  for (const e of events) {
    if (e.kind === 'log' && e.text) {
      state.log.push(e.text);
      if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
    }
  }
  state.version++;
  state.lastEvents = events;
  return { ok: true, events };
}

function endTurn(state, events) {
  const p = currentPlayer(state);
  p.turnsTaken += 1;
  state.turnNo += 1;

  if (state.purchasedThisTurn) {
    state.stall = 0;
    state.purchasedThisTurn = false;
  } else {
    state.stall = (state.stall || 0) + 1;
  }

  const reached = state.players.some((x) => x.points >= WIN_SCORE);
  const allEqual = state.players.every((x) => x.turnsTaken === state.players[0].turnsTaken);
  const normalEnd = reached && allEqual;
  const stalled = !normalEnd && state.stall >= state.playerCount * 8;

  if (normalEnd || stalled) {
    state.over = true;
    const sorted = state.players
      .slice()
      .sort((a, b) => b.points - a.points || a.cards.length - b.cards.length || a.id - b.id);
    state.ranking = sorted.map((x) => x.id);
    state.winner = sorted[0].id;
    state.endReason = normalEnd ? 'score' : 'stall';
    const top = sorted[0];
    events.push({ kind: 'gameOver', ranking: state.ranking, winner: state.winner, reason: state.endReason });
    events.push({
      kind: 'log',
      text: normalEnd
        ? `对局结束，${top.name} 以 ${top.points} 分获胜`
        : `长时间无人购卡，按当前分数结算：${top.name} 以 ${top.points} 分获胜`,
    });
    return;
  }

  state.current = (state.current + 1) % state.playerCount;
  state.phase = 'action';
}

// 便捷：自动完成被迫的弃牌 / 贵族选择（AI 与测试用）
export function autoResolve(state, dropOrder = TOKEN_COLORS) {
  const events = [];
  let guard = 0;
  while (!state.over && state.phase !== 'action' && guard++ < 20) {
    if (state.phase === 'discard') {
      const p = currentPlayer(state);
      const need = requiredDiscard(state);
      const tokens = emptyTokens();
      let left = need;
      for (const c of dropOrder) {
        while (left > 0 && p.tokens[c] - tokens[c] > 0) {
          tokens[c] += 1;
          left--;
        }
      }
      const res = applyAction(state, { type: 'discard', tokens });
      if (!res.ok) break;
      events.push(...res.events);
    } else if (state.phase === 'noble') {
      const opts = qualifiedNobles(state, currentPlayer(state));
      const res = applyAction(state, { type: 'chooseNoble', nobleId: opts[0].id });
      if (!res.ok) break;
      events.push(...res.events);
    } else break;
  }
  return events;
}

export function scoreOf(player) {
  return player.points;
}

export function describeAction(state, action) {
  if (!action) return '';
  const p = currentPlayer(state);
  switch (action.type) {
    case 'take3':
      return `拿取 ${action.colors.map((c) => COLOR_INFO[c].short).join('、')}`;
    case 'take2':
      return `拿取 2 枚${COLOR_INFO[action.color].name}`;
    case 'reserve': {
      const card = action.source.kind === 'market' ? state.market[action.source.level][action.source.index] : null;
      return card
        ? `预留 ${card.level} 级 ${COLOR_INFO[card.bonus].name}卡`
        : `盲抽预留 ${action.source.level} 级卡`;
    }
    case 'buy': {
      const card = cardFrom(action.source, state);
      return card ? `购买 ${card.points ? `${card.points}分 ` : ''}${COLOR_INFO[card.bonus].name}卡` : '购买';
    }
    default:
      return '';
  }
}
