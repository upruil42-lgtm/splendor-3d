// HUD：纯 DOM 覆盖层，只在状态或选择变化时更新，不参与每帧渲染
import { COLORS, GOLD, TOKEN_COLORS, COLOR_INFO, LEVEL_INFO } from '../engine/cards.js';
import { tokenTotal, TOKEN_LIMIT, MAX_RESERVED } from '../engine/rules.js';

const el = (id) => document.getElementById(id);

export class Hud {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.dom = {
      players: el('players'),
      log: el('log'),
      hint: el('hintText'),
      chips: el('selectionChips'),
      buttons: el('actionButtons'),
      turnText: el('turnText'),
      roundNo: el('roundNo'),
      tooltip: el('tooltip'),
      overlay: el('overlay'),
      loading: el('loading'),
    };
    this.playerNodes = [];
    this.logCount = 0;
    this.actionKeyCache = '';
  }

  /* ---------- 玩家面板 ---------- */
  buildPlayers(state) {
    this.dom.players.innerHTML = '';
    this.playerNodes = state.players.map((p, i) => {
      const card = document.createElement('div');
      card.className = 'pcard' + (i === 0 ? ' me' : '');
      card.innerHTML = `
        <div class="phead">
          <span class="pname"><span class="nm"></span><span class="tag"></span></span>
          <span class="pscore"><span class="v">0</span><small>分</small></span>
        </div>
        <div class="prow tokens"></div>
        <div class="prow bonus"></div>
        <div class="psub"><span>卡牌 <b class="cc">0</b></span><span>贵族 <b class="nc">0</b></span><span>预留 <b class="rc">0</b></span></div>
        <div class="reserved-mini"></div>
      `;
      this.dom.players.appendChild(card);
      return {
        root: card,
        nm: card.querySelector('.nm'),
        tag: card.querySelector('.tag'),
        score: card.querySelector('.pscore .v'),
        tokens: card.querySelector('.tokens'),
        bonus: card.querySelector('.bonus'),
        cc: card.querySelector('.cc'),
        nc: card.querySelector('.nc'),
        rc: card.querySelector('.rc'),
        reserved: card.querySelector('.reserved-mini'),
        tokenPips: {},
        bonusPips: {},
      };
    });
  }

  renderPlayers(state) {
    state.players.forEach((p, i) => {
      const n = this.playerNodes[i];
      if (!n) return;
      n.nm.textContent = p.name;
      n.tag.textContent = p.human ? '玩家' : '电脑';
      n.score.textContent = String(p.points);
      n.cc.textContent = String(p.cards.length);
      n.nc.textContent = String(p.nobles.length);
      n.rc.textContent = `${p.reserved.length}/${MAX_RESERVED}`;
      n.root.classList.toggle('active', state.current === i && !state.over);

      if (!Object.keys(n.tokenPips).length) {
        for (const c of TOKEN_COLORS) {
          const d = document.createElement('span');
          d.className = 'pip';
          d.style.background = `radial-gradient(circle at 32% 28%, ${shade(COLOR_INFO[c].hex, 0.42)}, ${COLOR_INFO[c].hex} 60%, ${COLOR_INFO[c].deep})`;
          d.innerHTML = '<span class="cnt">0</span>';
          n.tokens.appendChild(d);
          n.tokenPips[c] = d;
        }
        for (const c of COLORS) {
          const d = document.createElement('span');
          d.className = 'pip bonus card-bonus';
          d.style.borderColor = COLOR_INFO[c].hex;
          d.style.color = COLOR_INFO[c].hex;
          d.textContent = '0';
          n.bonus.appendChild(d);
          n.bonusPips[c] = d;
        }
      }
      for (const c of TOKEN_COLORS) {
        const v = p.tokens[c];
        const d = n.tokenPips[c];
        d.querySelector('.cnt').textContent = String(v);
        d.classList.toggle('dim', v === 0);
      }
      for (const c of COLORS) {
        const v = p.bonuses[c];
        const d = n.bonusPips[c];
        d.textContent = String(v);
        d.style.opacity = v ? '1' : '0.3';
        d.style.borderStyle = v ? 'solid' : 'dashed';
      }

      n.reserved.innerHTML = '';
      for (let k = 0; k < MAX_RESERVED; k++) {
        const card = p.reserved[k];
        const d = document.createElement('div');
        if (card) {
          d.className = 'rc';
          d.innerHTML = `<span class="dot" style="background:${COLOR_INFO[card.bonus].hex}"></span><span>${card.points || 0}分</span>`;
        } else {
          d.className = 'rc empty';
          d.innerHTML = '<span>空</span>';
        }
        n.reserved.appendChild(d);
      }

      const total = tokenTotal(p.tokens);
      n.tokens.style.outline = total >= TOKEN_LIMIT ? '1px dashed rgba(232,128,111,0.7)' : 'none';
      n.tokens.style.borderRadius = '14px';
      n.tokens.style.padding = '3px';
    });
  }

  /* ---------- 日志 ---------- */
  renderLog(state) {
    if (state.log.length === this.logCount) return;
    const frag = document.createDocumentFragment();
    for (let i = this.logCount; i < state.log.length; i++) {
      const li = document.createElement('li');
      li.textContent = state.log[i];
      frag.appendChild(li);
    }
    this.logCount = state.log.length;
    this.dom.log.appendChild(frag);
    this.dom.log.scrollTop = this.dom.log.scrollHeight;
  }

  /* ---------- 顶栏 ---------- */
  renderTop(state) {
    const p = state.players[state.current];
    const label = state.over ? '对局结束' : `${p.name} 的行动`;
    this.dom.turnText.textContent = state.phase === 'discard' ? `${p.name} 需弃牌` : label;
    this.dom.roundNo.textContent = String(Math.floor(state.turnNo / state.playerCount) + 1);
  }

  /* ---------- 操作栏 ---------- */
  renderAction(ui) {
    this.dom.hint.textContent = ui.hint || '';
    this.dom.chips.innerHTML = '';
    for (const chip of ui.chips || []) {
      const d = document.createElement('span');
      d.className = 'chip' + (chip.removable ? ' removable' : '');
      d.innerHTML = chip.color
        ? `<span class="dot" style="background:${COLOR_INFO[chip.color].hex}"></span>${chip.label}${chip.removable ? '<span class="x">×</span>' : ''}`
        : chip.label;
      // 已选宝石的标签可以直接点掉，不用整批清空重选
      if (chip.removable && chip.color) {
        d.addEventListener('click', () => this.cb.onChip && this.cb.onChip(chip.color));
      }
      this.dom.chips.appendChild(d);
    }
    const key = JSON.stringify((ui.actions || []).map((a) => [a.id, a.label, !!a.disabled]));
    if (key !== this.actionKeyCache) {
      this.actionKeyCache = key;
      this.dom.buttons.innerHTML = '';
      for (const a of ui.actions || []) {
        const b = document.createElement('button');
        b.className = 'btn ' + (a.kind || 'ghost');
        b.textContent = a.label;
        b.disabled = !!a.disabled;
        if (a.title) b.title = a.title;
        b.addEventListener('click', () => this.cb.onAction && this.cb.onAction(a.id));
        this.dom.buttons.appendChild(b);
      }
    }
  }

  /* ---------- 提示气泡 ---------- */
  showTooltip(html, clientX, clientY) {
    const t = this.dom.tooltip;
    t.innerHTML = html;
    t.classList.remove('hidden');
    const rect = t.getBoundingClientRect();
    let x = clientX;
    let y = clientY;
    if (x + rect.width + 26 > window.innerWidth) x = window.innerWidth - rect.width - 26;
    if (y + rect.height + 26 > window.innerHeight) y = window.innerHeight - rect.height - 26;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }

  hideTooltip() {
    this.dom.tooltip.classList.add('hidden');
  }

  /* ---------- 轻提示（选牌被拦下时给个理由，不打断操作） ---------- */
  toast(msg) {
    let t = this.dom.toast;
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      (document.getElementById('app') || document.body).appendChild(t);
      this.dom.toast = t;
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  /* ---------- 弹窗 ---------- */
  showModal(html) {
    this.dom.overlay.innerHTML = `<div class="modal">${html}</div>`;
    this.dom.overlay.classList.remove('hidden');
  }

  closeModal() {
    this.dom.overlay.classList.add('hidden');
    this.dom.overlay.innerHTML = '';
  }

  hideLoading() {
    this.dom.loading.classList.add('done');
    setTimeout(() => this.dom.loading.classList.add('hidden'), 600);
  }
}

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function costHtml(card, player, payment) {
  const parts = COLORS.filter((c) => card.cost[c] > 0).map((c) => {
    const discount = Math.min(card.cost[c], player.bonuses[c]);
    const need = card.cost[c] - discount;
    const have = player.tokens[c];
    const use = Math.min(need, have);
    const gold = need - use;
    const lack = gold > 0 && player.tokens[GOLD] < 0;
    const color = gold > 0 ? '#f0b3a6' : '#ffffff';
    return `<span style="color:${color}"><i style="background:${COLOR_INFO[c].hex}"></i>${need}${discount ? `<small style="opacity:.6">(-${discount})</small>` : ''}</span>`;
  });
  let extra = '';
  if (payment && payment.gold > 0) {
    extra = `<span style="color:#f0d79a"><i style="background:${COLOR_INFO.GOLD.hex}"></i>黄金 ${payment.gold}</span>`;
  }
  const total = COLORS.reduce((s, c) => s + Math.max(0, card.cost[c] - player.bonuses[c]), 0);
  return `<div class="t-cost">${parts.join('')}${extra}</div><div class="sub" style="margin-top:5px">合计需支付 ${total} 枚</div>`;
}

export function cardTooltipHtml(card, level) {
  const name = `${LEVEL_INFO[card.level].name}发展卡`;
  return `<div class="t-title">${name}${card.points ? ` · ${card.points} 分` : ''}</div>
    <div>奖励：<span style="color:${COLOR_INFO[card.bonus].hex}">${COLOR_INFO[card.bonus].name}</span>永久 1 枚</div>
    <div class="t-cost">${COLORS.filter((c) => card.cost[c] > 0)
      .map((c) => `<span><i style="background:${COLOR_INFO[c].hex}"></i>${card.cost[c]}</span>`)
      .join('')}</div>`;
}
