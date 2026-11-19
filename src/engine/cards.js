// 牌库数据：严格按照原版璀璨宝石的等级经济结构生成
// 一级 40 张（多数 0 分）、二级 30 张（1~3 分）、三级 20 张（3~5 分）
// 每种奖励色 8 / 6 / 4 张，五种奖励色合计 90 张

export const COLORS = ['W', 'U', 'G', 'R', 'K'];
export const GOLD = 'GOLD';
export const TOKEN_COLORS = ['W', 'U', 'G', 'R', 'K', 'GOLD'];

export const COLOR_INFO = {
  W: { name: '钻石', short: '钻', hex: '#f4f2ea', deep: '#b9b6a8', text: '#6b685c' },
  U: { name: '蓝宝石', short: '蓝', hex: '#3d7fd6', deep: '#1d4c8f', text: '#123058' },
  G: { name: '祖母绿', short: '绿', hex: '#1fa872', deep: '#0e6344', text: '#0a3d2a' },
  R: { name: '红宝石', short: '红', hex: '#d64038', deep: '#8c231d', text: '#5a1613' },
  K: { name: '黑玛瑙', short: '黑', hex: '#3b3b45', deep: '#17171d', text: '#101014' },
  GOLD: { name: '黄金', short: '金', hex: '#e2ac45', deep: '#946823', text: '#5c3f12' },
};

export const LEVEL_INFO = {
  1: { name: '一级', back: '#2f7d52', backDeep: '#1b4a31', dot: '#eaf6ee', art: '矿场' },
  2: { name: '二级', back: '#c99a1f', backDeep: '#7d5f0f', dot: '#fdf6e2', art: '商路' },
  3: { name: '三级', back: '#2f5f9e', backDeep: '#1b3a66', dot: '#eaf1fb', art: '工坊' },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 原版卡牌的主花费色与奖励色之间存在固定的对应关系（BGA 攻略整理）
const PRIMARY = {
  1: { W: 'G', U: 'R', G: 'K', R: 'W', K: 'U' },
  2: { W: 'R', U: 'U', G: 'G', R: 'K', K: 'W' },
  3: { W: 'K', U: 'W', G: 'U', R: 'G', K: 'R' },
};

// 模板中 M=主花费色，A/B/C=其余花费色（按颜色环顺序取）
const TEMPLATES = {
  1: [
    { p: 0, cost: [['M', 1], ['A', 1], ['B', 1]] },
    { p: 0, cost: [['M', 2], ['A', 1]] },
    { p: 0, cost: [['M', 1], ['A', 1], ['B', 1], ['C', 1]] },
    { p: 0, cost: [['M', 2], ['A', 1], ['B', 1]] },
    { p: 0, cost: [['M', 2], ['A', 2]] },
    { p: 0, cost: [['M', 3], ['A', 1]] },
    { p: 0, cost: [['M', 1], ['B', 1], ['C', 2]] },
    { p: 1, cost: [['M', 4]] },
  ],
  2: [
    { p: 1, cost: [['M', 3], ['A', 2], ['B', 2]] },
    { p: 1, cost: [['M', 5], ['A', 3]] },
    { p: 2, cost: [['M', 5]] },
    { p: 2, cost: [['M', 4], ['A', 2], ['B', 1]] },
    { p: 2, cost: [['M', 4], ['A', 2], ['B', 2]] },
    { p: 3, cost: [['M', 6]] },
  ],
  3: [
    { p: 4, cost: [['M', 3], ['A', 2], ['B', 2]] },
    { p: 5, cost: [['M', 7], ['A', 3]] },
    { p: 4, cost: [['M', 3], ['A', 3], ['B', 3], ['C', 3]] },
    { p: 3, cost: [['M', 7], ['A', 4], ['B', 3]] },
  ],
};

function secondaries(bonus, primary) {
  const im = COLORS.indexOf(primary);
  const out = [];
  for (let i = 1; i <= 4 && out.length < 3; i++) {
    const c = COLORS[(im + i) % COLORS.length];
    if (c !== bonus) out.push(c);
  }
  return out;
}

function emptyCost() {
  const c = {};
  for (const col of COLORS) c[col] = 0;
  return c;
}

export function totalCost(cost) {
  let t = 0;
  for (const col of COLORS) t += cost[col] || 0;
  return t;
}

// 用于贴图去重的内容指纹
export function cardKey(card) {
  return `L${card.level}-${card.bonus}-${card.points}-${COLORS.map((c) => card.cost[c]).join('')}`;
}

export function buildDeck() {
  const decks = { 1: [], 2: [], 3: [] };
  for (const level of [1, 2, 3]) {
    const templates = TEMPLATES[level];
    let n = 0;
    for (const bonus of COLORS) {
      const primary = PRIMARY[level][bonus];
      const [A, B, C] = secondaries(bonus, primary);
      const map = { M: primary, A, B, C };
      for (const tpl of templates) {
        const cost = emptyCost();
        for (const [slot, amount] of tpl.cost) cost[map[slot]] += amount;
        decks[level].push({
          id: `c${level}-${bonus}-${n}`,
          level,
          bonus,
          points: tpl.p,
          cost,
        });
        n++;
      }
    }
  }
  return decks;
}

// 10 张贵族板，每张 3 分
const NOBLE_TEMPLATES = [
  { W: 4, U: 4 },
  { U: 4, G: 4 },
  { G: 4, R: 4 },
  { R: 4, K: 4 },
  { K: 4, W: 4 },
  { W: 3, U: 3, G: 3 },
  { U: 3, G: 3, R: 3 },
  { G: 3, R: 3, K: 3 },
  { R: 3, K: 3, W: 3 },
  { K: 3, W: 3, U: 3 },
];

export function buildNobles() {
  return NOBLE_TEMPLATES.map((req, i) => ({ id: `n${i}`, points: 3, req }));
}

export function makeRng(seed) {
  return mulberry32(seed);
}

export function nobleText(noble) {
  return COLORS.filter((c) => noble.req[c]).map((c) => `${noble.req[c]}${COLOR_INFO[c].short}`).join(' + ');
}

export function cardTitle(card) {
  return `${LEVEL_INFO[card.level].name} · ${COLOR_INFO[card.bonus].name}${card.points ? ` · ${card.points}分` : ''}`;
}
