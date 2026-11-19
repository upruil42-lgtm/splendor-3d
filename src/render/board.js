// 3D 棋盘：把游戏状态映射成场景对象，做增量更新与缓动动画
import * as THREE from 'three';
import { COLORS, GOLD, TOKEN_COLORS, COLOR_INFO } from '../engine/cards.js';
import {
  makeCardTexture,
  makeCardBackTexture,
  makeNobleTexture,
  makeTokenTexture,
  makeTokenSideTexture,
  makeEdgeTexture,
  makeLabelTexture,
  makePlayerMatTexture,
} from './textures.js';

// 牌面尺寸：整张桌面按「桌沿半径 7.54」定机位，卡牌放大不会让相机后退，
// 于是卡面在屏幕上的像素数直接变多 —— 这是解决「看不清分数与兑换需求」的关键。
// 1.30 : 1.82 ≈ 0.714，与卡牌贴图 384 : 538 的比例一致，不会被拉伸变形。
// 桌面空间加大版：座位外移到 5.0、牌垫 3.7×2.6，同色发展卡摊开间距加倍，
// 对手的卡不再几乎完全叠死，至少能看清每张的顶部信息带。
export const LAYOUT = {
  cardW: 1.3,
  cardH: 1.82,
  cols: [-2.4, -0.8, 0.8, 2.4],
  rows: { 3: -2.4, 2: -0.3, 1: 1.8 },
  deckX: -3.86,
  nobleZ: -4.0,
  nobleCols: [-2.5, -1.25, 0, 1.25, 2.5],
  nobleSize: 1.15,
  supplyZ: 3.1,
  supplyCols: [-2.75, -1.65, -0.55, 0.55, 1.65, 2.75],
  // 座位半径 5.7 + 牌垫径向厚 2.1：牌垫内缘 4.65，与左侧牌库列（外缘 4.51）脱开，
  // 三摞牌库不再压住左边玩家的牌垫。切向宽度保持 3.7 不变。
  seatRadius: 5.7,
  discH: 0.075,
  discR: 0.32,
  matW: 3.7,
  matD: 2.1,
};

const EASE_RATE = 9.0;

function easeTo(cur, target, rate, dt) {
  if (Math.abs(cur - target) < 0.0005) return target;
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

export class Board {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.objects = new Map();
    this.pickables = [];
    this.seatGroups = [];
    this.hoverKey = null;
    this.selectedTokens = new Set();
    this.time = 0;

    this.cardGeo = new THREE.BoxGeometry(LAYOUT.cardW, LAYOUT.cardH, 0.016);
    this.discGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, false);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);

    this.edgeMat = new THREE.MeshStandardMaterial({ map: makeEdgeTexture(), roughness: 0.9, metalness: 0 });
    this.cardMatCache = new Map();
    this.backMatCache = new Map();
  }

  cardMaterials(card) {
    const key = `${card.level}:${card.bonus}:${card.points}:${COLORS.map((c) => card.cost[c]).join(',')}`;
    let pair = this.cardMatCache.get(key);
    if (!pair) {
      const face = new THREE.MeshStandardMaterial({ map: makeCardTexture(card), roughness: 0.6, metalness: 0.03 });
      const back = new THREE.MeshStandardMaterial({ map: makeCardBackTexture(card.level), roughness: 0.68, metalness: 0.03 });
      pair = { face, back, mats: [this.edgeMat, this.edgeMat, this.edgeMat, this.edgeMat, face, back] };
      this.cardMatCache.set(key, pair);
    }
    return pair;
  }

  backMaterial(level) {
    let m = this.backMatCache.get(level);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: makeCardBackTexture(level), roughness: 0.7, metalness: 0.03 });
      this.backMatCache.set(level, m);
    }
    return m;
  }

  // ---------- 静态结构 ----------
  buildStatic(state) {
    const n = state.playerCount;
    for (let i = 0; i < n; i++) {
      // 3 人局固定用 底/右/顶 三个位（0°/90°/180°），把左侧整片让给三摞牌库，
      // 否则 120°/240° 的斜位牌垫会被牌库列压住。
      const a = n === 3 ? (i * Math.PI) / 2 : (i * Math.PI * 2) / n;
      const g = new THREE.Group();
      g.position.set(Math.sin(a) * LAYOUT.seatRadius, 0, Math.cos(a) * LAYOUT.seatRadius);
      g.rotation.y = a;
      this.root.add(g);
      this.seatGroups.push(g);

      const matMat = new THREE.MeshStandardMaterial({
        map: makePlayerMatTexture(i, n),
        roughness: 0.95,
        metalness: 0,
      });
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.matW, LAYOUT.matD), matMat);
      mat.rotation.x = -Math.PI / 2;
      mat.position.y = 0.006;
      mat.receiveShadow = true;
      g.add(mat);

      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(LAYOUT.matW + 0.12, LAYOUT.matD + 0.12),
        new THREE.MeshBasicMaterial({ color: 0x74e0ae, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.0015;
      glow.visible = false;
      g.add(glow);
      this.activeGlow = this.activeGlow || [];
      this.activeGlow.push(glow);
    }

    for (const lv of [1, 2, 3]) {
      const mats = [
        this.edgeMat,
        this.edgeMat,
        this.backMaterial(lv),
        this.edgeMat,
        this.edgeMat,
        this.edgeMat,
      ];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(LAYOUT.cardW, 0.3, LAYOUT.cardH), mats);
      mesh.position.set(LAYOUT.deckX, 0.15, LAYOUT.rows[lv]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { kind: 'deck', level: lv };
      this.root.add(mesh);
      this.objects.set(`deck:${lv}`, {
        key: `deck:${lv}`,
        mesh,
        parent: this.root,
        pos: new THREE.Vector3(LAYOUT.deckX, 0.15, LAYOUT.rows[lv]),
        target: new THREE.Vector3(LAYOUT.deckX, 0.15, LAYOUT.rows[lv]),
        targetScale: new THREE.Vector3(1, 1, 1),
        scale: new THREE.Vector3(1, 1, 1),
        kind: 'deck',
      });
      this.pickables.push(mesh);
    }

    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(LAYOUT.nobleSize + 0.06, LAYOUT.nobleSize + 0.06),
        new THREE.MeshStandardMaterial({ color: 0xd9cba8, roughness: 0.9 })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(LAYOUT.nobleCols[i], 0.004, LAYOUT.nobleZ);
      mesh.visible = false;
      this.root.add(mesh);
      this.objects.set(`nobleSlot:${i}`, {
        key: `nobleSlot:${i}`,
        mesh,
        parent: this.root,
        pos: new THREE.Vector3(LAYOUT.nobleCols[i], 0.004, LAYOUT.nobleZ),
        target: new THREE.Vector3(LAYOUT.nobleCols[i], 0.004, LAYOUT.nobleZ),
        targetScale: new THREE.Vector3(1, 1, 1),
        scale: new THREE.Vector3(1, 1, 1),
        kind: 'slot',
      });
    }
  }

  // ---------- 座位内局部坐标（牌垫径向厚 2.1，内容控制在 ±1.05 内） ----------
  ownedCardLocal(colorIndex, indexInColor, count) {
    // 五列色卡列距 0.58（卡宽 0.42），列间留出空隙；
    // 同色多张时最多摊开 0.17 间距（卡深 0.59，每张至少露出 1/4 顶部信息带）
    const x = -1.16 + colorIndex * 0.58;
    const spacing = count > 1 ? Math.min(0.17, 0.51 / (count - 1)) : 0;
    return new THREE.Vector3(x, 0.025 + indexInColor * 0.0025, -0.4 + indexInColor * spacing);
  }

  reservedLocal(index) {
    // 预留卡 0.55 间距（卡宽 0.39），互不重叠
    return new THREE.Vector3(-0.55 + index * 0.55, 0.032, 0.76);
  }

  tokenLocal(index) {
    return new THREE.Vector3(-1.2 + index * 0.48, 0, -0.85);
  }

  // ---------- 对象工厂 ----------
  ensureCard(key, card, parent, startPos, scale) {
    let rec = this.objects.get(key);
    if (!rec) {
      const pair = this.cardMaterials(card);
      const mesh = new THREE.Mesh(this.cardGeo, pair.mats);
      mesh.receiveShadow = true;
      parent.add(mesh);
      const p = startPos ? startPos.clone() : new THREE.Vector3(0, 5, 0);
      rec = {
        key,
        mesh,
        parent,
        cardId: card.id,
        pos: p.clone(),
        target: p.clone(),
        baseY: p.y,
        scale: new THREE.Vector3(scale, scale, scale),
        targetScale: new THREE.Vector3(scale, scale, scale),
        kind: 'card',
      };
      mesh.position.copy(p);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.setScalar(scale);
      this.objects.set(key, rec);
    }
    if (rec.cardId !== card.id) {
      rec.mesh.material = this.cardMaterials(card).mats;
      rec.cardId = card.id;
    }
    if (rec.targetScale.x !== scale) rec.targetScale.set(scale, scale, scale);
    return rec;
  }

  ensureStack(key, parent, color, radius, discHeight, startPos) {
    let rec = this.objects.get(key);
    if (!rec) {
      const sideTex = makeTokenSideTexture(color).clone();
      sideTex.needsUpdate = true;
      const side = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.42, metalness: 0.2 });
      const top = new THREE.MeshStandardMaterial({ map: makeTokenTexture(color), roughness: 0.38, metalness: 0.25 });
      const bottom = new THREE.MeshStandardMaterial({ color: new THREE.Color(COLOR_INFO[color].deep), roughness: 0.7 });
      const mesh = new THREE.Mesh(this.discGeo, [side, top, bottom]);
      mesh.castShadow = true;
      parent.add(mesh);
      rec = {
        key,
        mesh,
        parent,
        sideMat: side,
        sideTex,
        radius,
        discHeight,
        pos: startPos.clone(),
        target: startPos.clone(),
        scale: new THREE.Vector3(radius, discHeight, radius),
        targetScale: new THREE.Vector3(radius, discHeight, radius),
        count: -1,
        kind: 'stack',
      };
      mesh.position.copy(rec.pos);
      this.objects.set(key, rec);
    }
    return rec;
  }

  placeStack(rec, x, z, count, flatY) {
    rec.pos.x = x;
    rec.pos.z = z;
    const c = Math.max(count, 0);
    rec.mesh.visible = c > 0;
    if (c <= 0) {
      rec.target.set(x, flatY, z);
      rec.targetScale.set(rec.radius, rec.discHeight, rec.radius);
      return;
    }
    const h = rec.discHeight * c;
    rec.target.set(x, flatY + h / 2, z);
    rec.targetScale.set(rec.radius, h, rec.radius);
    if (rec.count !== c) {
      rec.sideTex.repeat.set(4, c);
      rec.count = c;
    }
  }

  ensureLabel(key, parent, startPos) {
    let rec = this.objects.get(key);
    if (!rec) {
      const mat = new THREE.SpriteMaterial({ map: makeLabelTexture('0'), transparent: true });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.42, 0.42, 1);
      parent.add(sprite);
      rec = { key, mesh: sprite, parent, mat, text: null, pos: startPos.clone(), target: startPos.clone(), kind: 'label' };
      this.objects.set(key, rec);
    }
    return rec;
  }

  setLabel(rec, text) {
    if (rec.text === text) return;
    rec.text = text;
    rec.mat.map = makeLabelTexture(text, { bg: 'rgba(16,20,18,0.7)', color: '#fff4d8', size: 64 });
    rec.mat.needsUpdate = true;
  }

  // ---------- 状态同步 ----------
  sync(state, sourceHints = {}) {
    const wanted = new Set();
    const deckTop = (lv) => new THREE.Vector3(LAYOUT.deckX, 0.4, LAYOUT.rows[lv]);

    for (const lv of [1, 2, 3]) {
      state.market[lv].forEach((card, i) => {
        const key = `m:${lv}:${i}`;
        const slot = new THREE.Vector3(LAYOUT.cols[i], 0.03, LAYOUT.rows[lv]);
        if (!card) {
          if (this.objects.has(key)) this.removeObject(key);
          return;
        }
        wanted.add(key);
        const rec = this.ensureCard(key, card, this.root, sourceHints[card.id] || deckTop(lv), 1);
        rec.target.copy(slot);
        rec.baseY = slot.y;
        rec.mesh.userData = { kind: 'market', level: lv, index: i, card, key };
        if (!this.pickables.includes(rec.mesh)) this.pickables.push(rec.mesh);
      });
      const deckRec = this.objects.get(`deck:${lv}`);
      if (deckRec) {
        const c = state.decks[lv].length;
        deckRec.targetScale.set(1, 0.22 + 0.78 * Math.min(1, c / 22), 1);
        deckRec.target.y = 0.15 * deckRec.targetScale.y;
      }
    }

    state.nobles.forEach((noble, i) => {
      const key = `n:${noble.id}`;
      wanted.add(key);
      let rec = this.objects.get(key);
      if (!rec) {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(LAYOUT.nobleSize, LAYOUT.nobleSize),
          new THREE.MeshStandardMaterial({ map: makeNobleTexture(noble), roughness: 0.78, metalness: 0.06 })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        rec = {
          key,
          mesh,
          parent: this.root,
          pos: new THREE.Vector3(LAYOUT.nobleCols[i], 1.4, LAYOUT.nobleZ),
          target: new THREE.Vector3(),
          scale: new THREE.Vector3(1, 1, 1),
          targetScale: new THREE.Vector3(1, 1, 1),
          kind: 'noble',
        };
        this.objects.set(key, rec);
        this.pickables.push(mesh);
      }
      rec.target.set(LAYOUT.nobleCols[i], 0.035, LAYOUT.nobleZ);
      rec.baseY = 0.035;
      rec.mesh.userData = { kind: 'noble', noble, key };
    });
    for (let i = 0; i < 5; i++) {
      const slot = this.objects.get(`nobleSlot:${i}`);
      if (slot) slot.mesh.visible = i < state.nobles.length;
    }

    TOKEN_COLORS.forEach((color, i) => {
      const key = `sup:${color}`;
      wanted.add(key);
      const rec = this.ensureStack(key, this.root, color, LAYOUT.discR, LAYOUT.discH, new THREE.Vector3(LAYOUT.supplyCols[i], 3.2, LAYOUT.supplyZ));
      this.placeStack(rec, LAYOUT.supplyCols[i], LAYOUT.supplyZ, state.supply[color], 0.006);
      rec.mesh.userData = { kind: 'supply', color, key };
      // 黄金只能通过「预留卡牌」获得，不参与直接拾取：
      // 让它可点却毫无反应是最容易让人误判的，所以干脆移出可拾取列表。
      if (color !== GOLD) {
        if (!this.pickables.includes(rec.mesh)) this.pickables.push(rec.mesh);
      } else {
        const pi = this.pickables.indexOf(rec.mesh);
        if (pi >= 0) this.pickables.splice(pi, 1);
      }

      const lkey = `suplabel:${color}`;
      wanted.add(lkey);
      const lrec = this.ensureLabel(lkey, this.root, new THREE.Vector3(LAYOUT.supplyCols[i], 1, LAYOUT.supplyZ));
      lrec.target.set(
        LAYOUT.supplyCols[i],
        0.24 + state.supply[color] * LAYOUT.discH + 0.18,
        LAYOUT.supplyZ
      );
      this.setLabel(lrec, String(state.supply[color]));
    });

    state.players.forEach((p, pi) => {
      const g = this.seatGroups[pi];
      if (!g) return;

      const byColor = {};
      for (const c of COLORS) byColor[c] = [];
      for (const card of p.cards) byColor[card.bonus].push(card);
      COLORS.forEach((c, ci) => {
        const list = byColor[c];
        list.forEach((card, idx) => {
          const key = `p:${pi}:${card.id}`;
          wanted.add(key);
          const rec = this.ensureCard(key, card, g, sourceHints[card.id] || new THREE.Vector3(0, 2.6, 0), 0.32);
          rec.target.copy(this.ownedCardLocal(ci, idx, list.length));
          rec.baseY = rec.target.y;
          rec.mesh.userData = { kind: 'owned', player: pi, card, key };
        });
      });

      p.reserved.forEach((card, idx) => {
        const key = `p:${pi}:${card.id}`;
        wanted.add(key);
        const rec = this.ensureCard(key, card, g, sourceHints[card.id] || new THREE.Vector3(0, 2.6, 0), 0.3);
        rec.target.copy(this.reservedLocal(idx));
        rec.baseY = rec.target.y;
        rec.mesh.userData = { kind: 'reserved', player: pi, index: idx, card, key };
        if (pi === 0 && !this.pickables.includes(rec.mesh)) this.pickables.push(rec.mesh);
      });

      TOKEN_COLORS.forEach((color, ci) => {
        const key = `pt:${pi}:${color}`;
        wanted.add(key);
        const rec = this.ensureStack(key, g, color, 0.135, 0.05, new THREE.Vector3(0, 2.2, 0));
        const lp = this.tokenLocal(ci);
        this.placeStack(rec, lp.x, lp.z, p.tokens[color], 0.01);
        rec.mesh.userData = { kind: 'playerToken', player: pi, color, key };
      });
    });

    for (const key of Array.from(this.objects.keys())) {
      const dynamic =
        key.startsWith('m:') ||
        key.startsWith('p:') ||
        key.startsWith('n:') ||
        key.startsWith('sup:') ||
        key.startsWith('suplabel:') ||
        key.startsWith('pt:');
      if (dynamic && !wanted.has(key)) this.removeObject(key);
    }

    if (this.activeGlow) {
      this.activeGlow.forEach((glow, i) => {
        glow.visible = i === state.current && !state.over;
      });
    }
  }

  removeObject(key) {
    const rec = this.objects.get(key);
    if (!rec) return;
    rec.parent.remove(rec.mesh);
    if (rec.kind === 'noble' && rec.mesh.material && rec.mesh.material.dispose) rec.mesh.material.dispose();
    if (rec.kind === 'stack') {
      rec.sideMat.dispose();
      rec.mesh.material[1].dispose();
      rec.mesh.material[2].dispose();
    }
    if (rec.kind === 'label' && rec.mat) rec.mat.dispose();
    const idx = this.pickables.indexOf(rec.mesh);
    if (idx >= 0) this.pickables.splice(idx, 1);
    this.objects.delete(key);
  }

  setHover(key) {
    if (this.hoverKey === key) return;
    this.hoverKey = key;
    if (this.onNeedsRender) this.onNeedsRender();
  }

  setSelectedTokens(colors) {
    const next = new Set(colors);
    const changed = [...next].join(',') !== [...this.selectedTokens].join(',');
    this.selectedTokens = next;
    if (changed && this.onNeedsRender) this.onNeedsRender();
  }

  // 返回本帧是否还有对象在运动（用于按需渲染）
  update(dt) {
    this.time += dt;
    let moved = false;
    for (const rec of this.objects.values()) {
      const ud = rec.mesh.userData || {};
      if (rec.target) {
        if (rec.baseY !== undefined) {
          rec.target.y = rec.baseY + (this.hoverKey === rec.key ? 0.15 : 0);
        }
        const before = rec.pos.x + rec.pos.y + rec.pos.z;
        rec.pos.x = easeTo(rec.pos.x, rec.target.x, EASE_RATE, dt);
        rec.pos.y = easeTo(rec.pos.y, rec.target.y, EASE_RATE, dt);
        rec.pos.z = easeTo(rec.pos.z, rec.target.z, EASE_RATE, dt);
        if (Math.abs(before - (rec.pos.x + rec.pos.y + rec.pos.z)) > 1e-6) moved = true;
        rec.mesh.position.copy(rec.pos);
      }
      if (rec.targetScale) {
        const bs = rec.scale.x + rec.scale.y + rec.scale.z;
        rec.scale.x = easeTo(rec.scale.x, rec.targetScale.x, EASE_RATE, dt);
        rec.scale.y = easeTo(rec.scale.y, rec.targetScale.y, EASE_RATE, dt);
        rec.scale.z = easeTo(rec.scale.z, rec.targetScale.z, EASE_RATE, dt);
        if (Math.abs(bs - (rec.scale.x + rec.scale.y + rec.scale.z)) > 1e-6) moved = true;
      }
      let mult = 1;
      if (ud.kind === 'supply') {
        mult = this.selectedTokens.has(ud.color) ? 1.18 : this.hoverKey === rec.key ? 1.09 : 1;
      } else if (ud.kind === 'market' && this.hoverKey === rec.key) {
        mult = 1.045;
      }
      if (rec.scale) rec.mesh.scale.set(rec.scale.x * mult, rec.scale.y * mult, rec.scale.z * mult);
    }

    if (this.activeGlow) {
      const pulse = moved ? 0.42 + 0.18 * Math.sin(this.time * 2.6) : 0.55;
      for (const glow of this.activeGlow) if (glow.visible) glow.material.opacity = pulse;
    }
    return moved;
  }

  raycast(ndc, camera) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(this.pickables, false);
    for (const h of hits) {
      if (h.object.visible && h.object.userData && h.object.userData.kind) return h;
    }
    return null;
  }

  dispose() {
    for (const key of Array.from(this.objects.keys())) this.removeObject(key);
    for (const g of this.seatGroups) this.root.remove(g);
    this.seatGroups = [];
    this.activeGlow = [];
    this.pickables = [];
    this.hoverKey = null;
    this.selectedTokens = new Set();
  }
}
