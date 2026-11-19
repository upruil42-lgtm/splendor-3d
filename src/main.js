// 主流程：场景 ←→ 规则引擎 ←→ HUD 的粘合层
import * as THREE from 'three';
import { createStage } from './render/scene.js';
import { Board, LAYOUT } from './render/board.js';
import { Hud, costHtml, cardTooltipHtml } from './ui/hud.js';
import {
  createGame,
  applyAction,
  legalActions,
  currentPlayer,
  tokenTotal,
  requiredDiscard,
  qualifiedNobles,
  paymentPlan,
  TOKEN_LIMIT,
  MAX_RESERVED,
  WIN_SCORE,
} from './engine/rules.js';
import { chooseAction, difficultyLabel } from './engine/ai.js';
import { COLORS, GOLD, TOKEN_COLORS, COLOR_INFO, LEVEL_INFO } from './engine/cards.js';

const settings = {
  playerCount: 4,
  difficulty: 'normal',
  aiDelay: 780,
};

const app = {
  game: null,
  selection: { tokens: {} },
  pending: null,
  busy: false,
  aiTimer: null,
  seed: 1,
};

const stage = createStage(document.getElementById('stage'));
const board = new Board(stage.scene);
board.onNeedsRender = () => {
  stage.needsRender = true;
};
const hud = new Hud({ onAction: handleButton, onChip: handleChip });

/* ================= 提示 ================= */
function hintFor() {
  const g = app.game;
  if (!g || g.over) return '对局已结束，可以点击右上角重新开局';
  const p = currentPlayer(g);
  if (!p.human) return `${p.name} 正在思考…`;
  if (g.phase === 'discard') return `手上超过 ${TOKEN_LIMIT} 枚代币，需要弃掉多余的`;
  if (g.phase === 'noble') return '满足多位贵族条件，请选择一位';
  if (app.pending) {
    const card = app.pending.card;
    const plan = paymentPlan(g, p, card);
    if (plan.affordable) return '这张卡可以直接买下';
    return '代币不足，可以先预留（还能白拿 1 枚黄金）';
  }
  const chosen = selectedColors();
  if (chosen.length) {
    if (chosen.length === 1 && app.selection.tokens[chosen[0]] === 2) {
      return `已选 2 枚${COLOR_INFO[chosen[0]].name}（再点它一次即可取消）`;
    }
    return `已选 ${chosen.length} 种宝石：${chosen.map((c) => COLOR_INFO[c].short).join('、')}（点同一颗可取消，最多 3 种）`;
  }
  return '点击桌上的宝石筹码拿取；金色筹码不能直接拿，需预留卡牌获得';
}

// 只有 5 种普通宝石可以选；黄金（GOLD）不参与直接拾取
function selectedColors() {
  return COLORS.filter((c) => (app.selection.tokens[c] || 0) > 0);
}

function tokenSelectionAction() {
  const g = app.game;
  const chosen = selectedColors();
  if (!chosen.length) return null;
  const avail = COLORS.filter((c) => g.supply[c] > 0);
  const need = Math.min(3, avail.length);
  if (chosen.length === 1 && app.selection.tokens[chosen[0]] === 2) {
    return g.supply[chosen[0]] >= 4 ? { type: 'take2', color: chosen[0] } : null;
  }
  if (chosen.length === need && chosen.every((c) => app.selection.tokens[c] === 1)) {
    return { type: 'take3', colors: chosen };
  }
  return null;
}

/* ================= HUD 刷新 ================= */
function refresh() {
  const g = app.game;
  if (!g) return;
  hud.renderTop(g);
  hud.renderPlayers(g);
  hud.renderLog(g);

  const p = currentPlayer(g);
  const isHumanTurn = p.human && !g.over;
  const actions = [];
  const chips = [];

  if (g.over) {
    actions.push({ id: 'restart', label: '再来一局', kind: 'primary' });
  } else if (!isHumanTurn) {
    actions.push({ id: 'noop', label: `${p.name} 行动中…`, kind: 'ghost', disabled: true });
  } else if (g.phase === 'discard') {
    actions.push({ id: 'discard', label: `弃牌（需弃 ${requiredDiscard(g)} 枚）`, kind: 'primary' });
  } else if (g.phase === 'noble') {
    for (const nb of qualifiedNobles(g, p)) {
      actions.push({ id: 'noble:' + nb.id, label: '邀请' + nobleLabel(nb), kind: 'primary' });
    }
  } else if (app.pending) {
    const card = app.pending.card;
    const plan = paymentPlan(g, p, card);
    if (card) {
      // 手机上看不到悬浮提示，把卡牌要点直接放进操作栏
      chips.push({ label: `永久${COLOR_INFO[card.bonus].name}${card.points ? ` · ${card.points} 分` : ''}` });
      for (const c of COLORS) {
        if (card.cost[c] > 0) chips.push({ color: c, label: String(card.cost[c]) });
      }
    }
    actions.push({
      id: 'buy',
      label: plan.affordable ? `购买（支付 ${plan.total} 枚）` : '代币不足',
      kind: 'primary',
      disabled: !plan.affordable,
    });
    actions.push({
      id: 'reserve',
      label: app.pending.source.kind === 'reserved' ? '已在自己手上' : '预留 +1 黄金',
      kind: 'ghost',
      disabled: app.pending.source.kind === 'reserved' || p.reserved.length >= MAX_RESERVED,
    });
    actions.push({ id: 'cancel', label: '取消', kind: 'ghost' });
  } else {
    for (const c of selectedColors()) {
      chips.push({ color: c, removable: true, label: `${COLOR_INFO[c].name} ×${app.selection.tokens[c]}` });
    }
    const act = tokenSelectionAction();
    if (selectedColors().length) {
      actions.push({ id: 'take', label: actionLabel(act), kind: 'primary', disabled: !act });
      actions.push({ id: 'clear', label: '清空', kind: 'ghost' });
    }
  }

  hud.renderAction({ hint: hintFor(), chips, actions });
  board.setSelectedTokens(selectedColors());
}

function actionLabel(act) {
  if (!act) return '再选 1 种宝石';
  if (act.type === 'take2') return `拿取 2 枚${COLOR_INFO[act.color].name}`;
  return `拿取 ${act.colors.map((c) => COLOR_INFO[c].short).join('、')}`;
}

function nobleLabel(nb) {
  return COLORS.filter((c) => nb.req[c])
    .map((c) => `${nb.req[c]}${COLOR_INFO[c].short}`)
    .join('+');
}

/* ================= 操作 ================= */
// 点掉底部某一颗已选宝石（比「清空重选」轻得多）
function handleChip(color) {
  const g = app.game;
  if (!g || g.over) return;
  const p = currentPlayer(g);
  if (!p.human || g.phase !== 'action') return;
  if (!app.selection.tokens[color]) return;
  app.selection.tokens[color] = 0;
  refresh();
}

function handleButton(id) {
  const g = app.game;
  if (!g) return;
  if (id === 'restart') return newGame();
  if (id === 'cancel') {
    app.pending = null;
    refresh();
    return;
  }
  if (id === 'clear') {
    app.selection.tokens = {};
    refresh();
    return;
  }
  if (id === 'take') {
    const act = tokenSelectionAction();
    if (act) {
      app.selection.tokens = {};
      doAction(act);
    }
    return;
  }
  if (id === 'buy') {
    if (!app.pending) return;
    const act = { type: 'buy', source: app.pending.source };
    app.pending = null;
    doAction(act);
    return;
  }
  if (id === 'reserve') {
    if (!app.pending) return;
    const act = { type: 'reserve', source: app.pending.source };
    app.pending = null;
    doAction(act);
    return;
  }
  if (id === 'discard') {
    showDiscardModal();
    return;
  }
  if (id.startsWith('noble:')) {
    const nobleId = id.slice(6);
    doAction({ type: 'chooseNoble', nobleId });
    return;
  }
}

function hintsFor(action) {
  const hints = {};
  const g = app.game;
  if (action.type === 'buy' && action.source.kind === 'market') {
    const card = g.market[action.source.level][action.source.index];
    if (card) {
      hints[card.id] = new THREE.Vector3(LAYOUT.cols[action.source.index], 0.45, LAYOUT.rows[action.source.level]);
    }
  }
  if (action.type === 'buy' && action.source.kind === 'reserved') {
    const card = currentPlayer(g).reserved[action.source.index];
    if (card) {
      const seat = currentPlayer(g).id;
      const gp = board.seatGroups[seat];
      if (gp) {
        const local = board.reservedLocal(action.source.index).clone();
        gp.localToWorld(local);
        hints[card.id] = local.setY(0.45);
      }
    }
  }
  return hints;
}

function doAction(action) {
  const g = app.game;
  if (!g || app.busy) return;
  const hints = hintsFor(action);
  const res = applyAction(g, action);
  if (!res.ok) {
    console.warn('非法操作：', action, res.error);
    refresh();
    return;
  }
  app.selection.tokens = {}; // 行动已生效，清掉本次选牌
  board.sync(g, hints);
  refresh();
  if (g.over) {
    setTimeout(showResult, 900);
    return;
  }
  scheduleAI();
}

/* ================= AI ================= */
function scheduleAI() {
  const g = app.game;
  clearTimeout(app.aiTimer);
  if (!g || g.over) return;
  const p = currentPlayer(g);
  if (p.human) {
    if (g.phase === 'discard') showDiscardModal();
    else if (g.phase === 'noble') refresh();
    return;
  }
  const delay = g.phase === 'action' ? settings.aiDelay : 420;
  app.aiTimer = setTimeout(() => {
    if (!app.game || app.game.over) return;
    const act = chooseAction(app.game, settings.difficulty);
    if (!act) return;
    const hints = hintsFor(act);
    const res = applyAction(app.game, act);
    if (!res.ok) {
      console.warn('AI 非法操作', act, res.error);
      return;
    }
    app.selection.tokens = {}; // 轮到电脑行动时清掉残留的手选
    board.sync(app.game, hints);
    refresh();
    if (app.game.over) {
      setTimeout(showResult, 900);
      return;
    }
    scheduleAI();
  }, delay);
}

/* ================= 拾取交互 ================= */
// 有些浏览器（含部分 WebView / 平板模式 / 桌面模拟）并不上报 (pointer: coarse)，
// 所以把 UA 判定出的 is-phone 一起纳入；同时排除「带触摸屏的笔记本」——
// 那种设备仍有鼠标，悬停提示该保留。
const IS_TOUCH = (() => {
  if (document.documentElement.classList.contains('is-phone')) return true;
  if (window.matchMedia('(pointer: coarse)').matches) return true;
  const anyCoarse = window.matchMedia('(any-pointer: coarse)').matches;
  const anyFine = window.matchMedia('(any-pointer: fine)').matches;
  return anyCoarse && !anyFine;
})();
const pointer = new THREE.Vector2();
const raycasterState = { downX: 0, downY: 0, downTime: 0, moved: false };

function toNdc(event) {
  const rect = stage.renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  return pointer;
}

function pickAt(event) {
  return board.raycast(toNdc(event), stage.camera);
}

stage.renderer.domElement.addEventListener('pointerdown', (e) => {
  raycasterState.downX = e.clientX;
  raycasterState.downY = e.clientY;
  raycasterState.downTime = performance.now();
  raycasterState.moved = false;
});

stage.renderer.domElement.addEventListener('pointermove', (e) => {
  const th = e.pointerType === 'touch' ? 12 : 6;
  if (Math.abs(e.clientX - raycasterState.downX) > th || Math.abs(e.clientY - raycasterState.downY) > th) {
    raycasterState.moved = true;
  }
  if (!IS_TOUCH) onHover(e);
});

// 触屏：禁掉长按菜单 / 选中文字，避免干扰快速点击
if (IS_TOUCH) {
  stage.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.renderer.domElement.addEventListener('touchstart', () => {}, { passive: true });
}

stage.renderer.domElement.addEventListener('pointerup', (e) => {
  const limit = e.pointerType === 'touch' ? 900 : 600;
  const fast = performance.now() - raycasterState.downTime < limit;
  if (raycasterState.moved || !fast) return;
  onClick(e);
});

stage.renderer.domElement.addEventListener('pointerleave', () => {
  board.setHover(null);
  hud.hideTooltip();
});

let hoverRaf = null;
function onHover(e) {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = null;
    const hit = pickAt(e);
    const ud = hit && hit.object.userData;
    const g = app.game;
    if (!ud || !g) {
      board.setHover(null);
      hud.hideTooltip();
      stage.renderer.domElement.style.cursor = 'grab';
      return;
    }
    board.setHover(ud.key);
    stage.renderer.domElement.style.cursor = 'pointer';
    const human = currentPlayer(g);
    const isMyTurn = human.human && !g.over && g.phase === 'action';

    if (ud.kind === 'market' || ud.kind === 'reserved' || ud.kind === 'owned') {
      const card = ud.card;
      let html = cardTooltipHtml(card);
      if ((ud.kind === 'market' || ud.kind === 'reserved') && isMyTurn) {
        const plan = paymentPlan(g, human, card);
        html += costHtml(card, human, plan);
        html += `<div class="sub" style="margin-top:5px;color:${plan.affordable ? '#6fdcae' : '#e8806f'}">${
          plan.affordable ? '可购买 · ' + (ud.kind === 'market' ? '点击选择' : '点击选择') : '代币不足 · 可预留'
        }</div>`;
      }
      hud.showTooltip(html, e.clientX, e.clientY);
    } else if (ud.kind === 'supply') {
      const c = ud.color;
      hud.showTooltip(
        `<div class="t-title">${COLOR_INFO[c].name}</div><div>剩余 ${g.supply[c]} 枚</div>
         <div class="sub" style="margin-top:4px">点击选取${g.supply[c] >= 4 ? '，再点一次可取 2 枚' : ''}</div>`,
        e.clientX,
        e.clientY
      );
    } else if (ud.kind === 'noble') {
      hud.showTooltip(
        `<div class="t-title">贵族 · +3 分</div><div>需要永久宝石：${nobleLabel(ud.noble)}</div>
         <div class="sub" style="margin-top:4px">达成后回合结束自动到访</div>`,
        e.clientX,
        e.clientY
      );
    } else if (ud.kind === 'deck') {
      hud.showTooltip(
        `<div class="t-title">${LEVEL_INFO[ud.level].name}牌堆</div><div>剩余 ${g.decks[ud.level].length} 张</div>
         <div class="sub" style="margin-top:4px">点击可盲抽预留（+1 黄金）</div>`,
        e.clientX,
        e.clientY
      );
    } else {
      hud.hideTooltip();
    }
  });
}

function onClick(e) {
  const g = app.game;
  if (!g || g.over) return;
  const p = currentPlayer(g);
  if (!p.human) return;
  if (g.phase === 'discard' || g.phase === 'noble') return;
  const hit = pickAt(e);
  const ud = hit && hit.object.userData;
  if (!ud) {
    app.pending = null;
    refresh();
    return;
  }

  if (ud.kind === 'supply') {
    const c = ud.color;
    // 黄金不能直接拿取，只在预留卡牌时获得；这里再兜一层，避免任何路径选到它
    if (c === GOLD) {
      hud.toast('黄金不能直接拿取，预留一张卡牌即可获得 1 枚');
      return;
    }
    if (g.supply[c] <= 0) return;

    const sel = app.selection.tokens;
    const cur = sel[c] || 0;
    const chosen = selectedColors();

    if (cur === 0) {
      // 每次点击只影响被点的这一颗，绝不波及其他已选宝石（这是之前最反人类的地方）
      const twin = COLORS.some((k) => k !== c && (sel[k] || 0) >= 2);
      if (twin) {
        hud.toast('已选 2 枚同色，先点掉它再选其他颜色');
        return;
      }
      if (chosen.length >= 3) {
        hud.toast('最多选 3 种宝石，先点掉一种再换');
        return;
      }
      sel[c] = 1;
    } else if (cur === 1) {
      // 只有这一种被选中时，再点一次表示「拿 2 枚同色」；否则视为取消这一颗
      if (chosen.length === 1 && g.supply[c] >= 4) sel[c] = 2;
      else sel[c] = 0;
    } else {
      sel[c] = 0;
    }

    app.pending = null;
    refresh();
    return;
  }

  if (ud.kind === 'deck') {
    if (p.reserved.length >= MAX_RESERVED) return;
    if (g.decks[ud.level].length <= 0) return;
    app.pending = { card: null, source: { kind: 'deck', level: ud.level }, deck: true };
    hud.showModal(`
      <h2>盲抽预留</h2>
      <p>从 ${LEVEL_INFO[ud.level].name}牌堆顶抽一张卡放在自己手上（不公开），同时获得 1 枚黄金。</p>
      <div class="sub">自己手上已有的预留卡：${p.reserved.length} / ${MAX_RESERVED}</div>
      <div class="actions-right">
        <button class="btn ghost" id="mCancel">取消</button>
        <button class="btn primary" id="mOk">确认预留</button>
      </div>`);
    document.getElementById('mCancel').onclick = () => {
      hud.closeModal();
      app.pending = null;
    };
    document.getElementById('mOk').onclick = () => {
      hud.closeModal();
      const act = { type: 'reserve', source: { kind: 'deck', level: ud.level } };
      app.pending = null;
      doAction(act);
    };
    return;
  }

  if (ud.kind === 'market' || ud.kind === 'reserved') {
    if (ud.kind === 'reserved' && ud.player !== 0) return;
    // 不清空已选宝石：点了卡牌又取消时，之前的选牌还在，不用重来一遍
    app.pending = {
      card: ud.card,
      source:
        ud.kind === 'market'
          ? { kind: 'market', level: ud.level, index: ud.index }
          : { kind: 'reserved', index: ud.index },
    };
    refresh();
    return;
  }

  if (ud.kind === 'noble') {
    hud.showTooltip(
      `<div class="t-title">贵族 · +3 分</div><div>需要永久宝石：${nobleLabel(ud.noble)}</div>`,
      e.clientX,
      e.clientY
    );
  }
}

/* ================= 弃牌弹窗 ================= */
let discardPick = null;
function showDiscardModal() {
  const g = app.game;
  const p = currentPlayer(g);
  const need = requiredDiscard(g);
  if (need <= 0) {
    refresh();
    return;
  }
  if (!discardPick) discardPick = {};
  const render = () => {
    const pickedTotal = TOKEN_COLORS.reduce((s, c) => s + (discardPick[c] || 0), 0);
    hud.showModal(`
      <h2>弃掉多余代币</h2>
      <p>手上共有 ${tokenTotal(p.tokens)} 枚代币，超过上限 ${TOKEN_LIMIT} 枚，需要弃掉 <b style="color:#f0d79a">${need}</b> 枚。</p>
      <div class="setting-row" style="flex-wrap:wrap;gap:10px;border:none;padding-top:4px">
        ${TOKEN_COLORS.map((c) => {
          const v = p.tokens[c];
          const pick = discardPick[c] || 0;
          return `<div style="display:flex;align-items:center;gap:8px;margin:6px 0">
            <span class="pip" style="background:radial-gradient(circle at 32% 28%, ${COLOR_INFO[c].hex}, ${COLOR_INFO[c].deep});width:24px;height:24px"></span>
            <span style="font-size:13px;min-width:64px">${COLOR_INFO[c].name} ${v}</span>
            <button class="btn ghost" data-dc="${c}" data-d="-1">−</button>
            <span style="min-width:18px;text-align:center">${pick}</span>
            <button class="btn ghost" data-dc="${c}" data-d="1">+</button>
          </div>`;
        }).join('')}
      </div>
      <div class="sub">已选择 ${pickedTotal} / ${need} 枚</div>
      <div class="actions-right">
        <button class="btn ghost" id="dAuto">自动弃最没用的</button>
        <button class="btn primary" id="dOk" ${pickedTotal !== need ? 'disabled' : ''}>确认弃牌</button>
      </div>`);
    hud.dom.overlay.querySelectorAll('[data-dc]').forEach((b) => {
      b.onclick = () => {
        const c = b.dataset.dc;
        const d = Number(b.dataset.d);
        const cur = discardPick[c] || 0;
        const nv = Math.max(0, Math.min(p.tokens[c], Math.min(need - pickedTotal + cur, cur + d)));
        discardPick[c] = nv;
        render();
      };
    });
    const ok = document.getElementById('dOk');
    if (ok)
      ok.onclick = () => {
        const tokens = {};
        for (const c of TOKEN_COLORS) tokens[c] = discardPick[c] || 0;
        discardPick = null;
        hud.closeModal();
        doAction({ type: 'discard', tokens });
      };
    document.getElementById('dAuto').onclick = () => {
      discardPick = null;
      hud.closeModal();
      const tokens = {};
      for (const c of TOKEN_COLORS) tokens[c] = 0;
      let left = need;
      const order = COLORS.slice().sort((a, b) => a.localeCompare(b));
      order.push(GOLD);
      for (const c of order) {
        while (left > 0 && p.tokens[c] - tokens[c] > 0) {
          tokens[c] += 1;
          left -= 1;
        }
      }
      doAction({ type: 'discard', tokens });
    };
  };
  render();
}

/* ================= 结算 / 规则 / 设置 ================= */
function showResult() {
  const g = app.game;
  const rows = g.ranking
    .map((pid, i) => {
      const p = g.players[pid];
      return `<div class="rank-row ${i === 0 ? 'win' : ''}">
        <span class="pos">${i + 1}</span>
        <span class="who">${p.name}<div class="det">卡牌 ${p.cards.length} 张 · 贵族 ${p.nobles.length} 位</div></span>
        <span class="pts">${p.points}<small style="font-size:10px;color:#8a8069">分</small></span>
      </div>`;
    })
    .join('');
  const win = g.players[g.winner];
  hud.showModal(`
    <h2>${win.human ? '你赢了' : win.name + ' 获胜'}</h2>
    <p class="sub">${g.endReason === 'score' ? `率先达到 ${WIN_SCORE} 分并补完本轮` : '长时间无人购卡，按当前分数结算'}</p>
    <div class="rank-list">${rows}</div>
    <div class="actions-right">
      <button class="btn ghost" id="mClose">查看桌面</button>
      <button class="btn primary" id="mAgain">再来一局</button>
    </div>`);
  document.getElementById('mClose').onclick = () => hud.closeModal();
  document.getElementById('mAgain').onclick = () => newGame();
}

function showRules() {
  hud.showModal(`
    <h2>玩法速览</h2>
    <p class="sub">文艺复兴时期的宝石商人，先攒到 ${WIN_SCORE} 点声望者胜。</p>
    <h3>回合：四选一</h3>
    <ul>
      <li><b>拿 3 枚不同颜色</b>的宝石（不足 3 色时能拿几枚拿几枚）</li>
      <li><b>拿 2 枚同色</b>宝石（该色场上至少剩 4 枚时才能这么做）</li>
      <li><b>预留一张发展卡</b>：从桌面或牌堆顶拿一张放到自己手上，同时获得 1 枚黄金（最多留 3 张）</li>
      <li><b>购买一张发展卡</b>：桌面上的或自己预留的都可以</li>
    </ul>
    <h3>关键规则</h3>
    <ul>
      <li>已购卡牌提供<b>永久宝石折扣</b>，同色需求可被抵扣，不够的部分用黄金（万能）补</li>
      <li><b>金色筹码点不了</b>——黄金无法直接拿取，只有<b>预留卡牌</b>时才会自动获得 1 枚</li>
      <li>回合结束时手上代币（含黄金）<b>最多 10 枚</b>，超出必须弃掉</li>
      <li>回合结束时若满足贵族条件，贵族<b>自动到访</b>并 +3 分（不占用行动，每回合最多一位）</li>
      <li>有人达到 ${WIN_SCORE} 分后补完本轮，分数最高者胜；同分则<b>买卡更少</b>的人胜</li>
    </ul>
    <h3>操作</h3>
    <ul>
      <li>${IS_TOUCH ? '单指拖动旋转视角，双指捏合缩放' : '鼠标左键拖动旋转视角，滚轮缩放'}（点击与拖动会自动区分）</li>
      ${IS_TOUCH ? `<li>手机上建议<b>横屏全屏</b>游玩：${document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen ? '点顶栏「全屏」或竖屏提示里的按钮' : '把手机转成横向'}，牌桌会完整展开</li>` : ''}
      <li>点筹码选宝石：同一色连点两次表示拿 2 枚，点已选中的那一颗即可取消，最多选 3 种</li>
      <li>点卡牌出现购买 / 预留按钮；点牌堆可以盲抽预留</li>
    </ul>
    <div class="actions-right"><button class="btn primary" id="mClose">知道了</button></div>`);
  document.getElementById('mClose').onclick = () => hud.closeModal();
}

function showSettings() {
  const seg = (name, options, cur) =>
    `<div class="seg">${options
      .map((o) => `<button data-set="${name}" data-v="${o.v}" class="${o.v === cur ? 'on' : ''}">${o.label}</button>`)
      .join('')}</div>`;
  hud.showModal(`
    <h2>对局设置</h2>
    <div class="setting-row">
      <span class="label">玩家人数<small>你始终是 1 号座，其余由电脑操作</small></span>
      ${seg('playerCount', [2, 3, 4].map((n) => ({ v: n, label: `${n} 人` })), settings.playerCount)}
    </div>
    <div class="setting-row">
      <span class="label">电脑难度<small>影响电脑的取舍与前瞻，越难越会抢卡和抢贵族</small></span>
      ${seg('difficulty', [
        { v: 'easy', label: '简单' },
        { v: 'normal', label: '普通' },
        { v: 'hard', label: '困难' },
      ], settings.difficulty)}
    </div>
    <div class="setting-row">
      <span class="label">电脑思考速度<small>调快可以让对局更紧凑</small></span>
      ${seg('aiDelay', [
        { v: 380, label: '快速' },
        { v: 780, label: '标准' },
        { v: 1300, label: '悠闲' },
      ], settings.aiDelay)}
    </div>
    <p class="sub" style="margin-top:14px">修改人数会立即开始新的一局。</p>
    <div class="actions-right">
      <button class="btn ghost" id="mClose">关闭</button>
      <button class="btn primary" id="mApply">应用并开局</button>
    </div>`);
  hud.dom.overlay.querySelectorAll('[data-set]').forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.set;
      let v = b.dataset.v;
      if (key === 'playerCount' || key === 'aiDelay') v = Number(v);
      settings[key] = v;
      showSettings();
    };
  });
  document.getElementById('mClose').onclick = () => hud.closeModal();
  document.getElementById('mApply').onclick = () => {
    hud.closeModal();
    newGame();
  };
}

/* ================= 开局 ================= */
function newGame() {
  hud.closeModal();
  clearTimeout(app.aiTimer);
  app.selection = { tokens: {} };
  app.pending = null;
  app.busy = false;
  discardPick = null;

  app.seed = (app.seed * 7919 + 13) % 1000003;
  app.game = createGame({
    playerCount: settings.playerCount,
    seed: app.seed,
    humanSeats: [0],
  });

  board.dispose();
  board.buildStatic(app.game);
  board.sync(app.game);
  hud.logCount = 0;
  hud.dom.log.innerHTML = '';
  hud.buildPlayers(app.game);
  refresh();
  scheduleAI();
}

document.getElementById('btnRules').onclick = showRules;
document.getElementById('btnSettings').onclick = showSettings;
document.getElementById('btnRestart').onclick = () => newGame();

/* ================= 横屏 / 全屏 =================
   手机上的目标形态是「横屏全屏」。浏览器不允许网页凭空旋转屏幕，
   所以这里做两件事：
   1) 竖屏且是触摸设备时，用 #rotate 提示层引导用户把手机转横（CSS 控制显示）
   2) 用户点「全屏并锁定横屏」时，申请全屏 + 请求系统锁定横屏方向
      （Android Chrome 支持；iOS Safari 不支持锁定，只能靠用户手动转）      */
function requestFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen;
  if (!fn) return null;
  return fn.call(el, { navigationUI: 'hide' });
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
  if (!fn) return;
  try {
    await fn.call(document);
  } catch (e) {
    /* 忽略 */
  }
}

async function lockLandscape() {
  const so = screen.orientation;
  try {
    if (so && typeof so.lock === 'function') await so.lock('landscape');
    else if (typeof screen.lockOrientation === 'function') screen.lockOrientation('landscape');
    else if (typeof screen.mozLockOrientation === 'function') screen.mozLockOrientation('landscape');
  } catch (e) {
    /* 不支持或未获授权：保持现状，用户手动转横屏同样可以玩 */
  }
}

async function enterImmersiveLandscape() {
  if (!isFullscreen()) {
    try {
      const p = requestFullscreen();
      if (p && typeof p.then === 'function') await p.catch(() => {});
    } catch (e) {
      /* 用户拒绝或需手势，忽略 */
    }
  }
  await lockLandscape();
  syncFullButton();
  // 全屏切换会改变视口尺寸，重新取景让整张牌桌完整入镜
  setTimeout(() => stage.resize(), 120);
}

function syncFullButton() {
  const b = document.getElementById('btnFull');
  if (b) b.textContent = isFullscreen() ? '退出全屏' : '全屏';
}

function initDisplayMode() {
  const supported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  const fullBtn = document.getElementById('btnFull');
  const rotFull = document.getElementById('rotFull');
  const rotSub = document.getElementById('rotSub');

  if (fullBtn) {
    if (supported) {
      fullBtn.classList.remove('hidden');
      fullBtn.onclick = () => (isFullscreen() ? exitFullscreen() : enterImmersiveLandscape());
    } else {
      fullBtn.classList.add('hidden');
    }
  }

  if (rotFull) {
    if (supported) rotFull.onclick = () => enterImmersiveLandscape();
    else rotFull.classList.add('hidden');
  }
  if (rotSub && !supported) {
    rotSub.textContent = '把手机转成横向，整张宝石牌桌才会完整展开';
  }

  const skip = document.getElementById('rotSkip');
  if (skip) {
    skip.onclick = () => {
      document.body.classList.add('allow-portrait');
      stage.resize();
    };
  }

  document.addEventListener('fullscreenchange', () => {
    syncFullButton();
    setTimeout(() => stage.resize(), 120);
  });
  document.addEventListener('webkitfullscreenchange', () => {
    syncFullButton();
    setTimeout(() => stage.resize(), 120);
  });
  syncFullButton();
}

initDisplayMode();

// 调试 / 自动化测试钩子
window.__splendor = {
  state: () => app.game,
  board,
  stage,
  settings,
  doAction: (a) => doAction(a),
  aiChoose: (s) => chooseAction(s, settings.difficulty),
  newGame,
  refresh,
  discardNeed: () => requiredDiscard(app.game),
  ndcOf(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(stage.camera);
    return { x: v.x, y: v.y };
  },
  clickNdc(nx, ny) {
    const el = stage.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + ((nx + 1) / 2) * rect.width;
    const cy = rect.top + ((1 - ny) / 2) * rect.height;
    const opts = { clientX: cx, clientY: cy, bubbles: true, pointerId: 1, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    return { cx, cy };
  },
};

/* ================= 渲染循环 ================= */
let last = performance.now();
let running = true;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (running) {
    const camMoved = stage.controls.update();
    const boardMoved = board.update(dt);
    if (camMoved || boardMoved || stage.needsRender) {
      stage.needsRender = false;
      window.__renderCount = (window.__renderCount || 0) + 1;
      stage.renderer.render(stage.scene, stage.camera);
    }
  }
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  last = performance.now();
});

window.addEventListener('resize', () => stage.resize());

newGame();
requestAnimationFrame(frame);
setTimeout(() => hud.hideLoading(), 420);
