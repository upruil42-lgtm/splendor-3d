// 程序化贴图：全部用 Canvas 现画，不依赖任何外部素材，保证加载快、不掉图
import * as THREE from 'three';
import { COLORS, COLOR_INFO, LEVEL_INFO, GOLD } from '../engine/cards.js';

const cache = new Map();
function cached(key, factory) {
  let v = cache.get(key);
  if (!v) {
    v = factory();
    cache.set(key, v);
  }
  return v;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// 各向异性过滤等级：卡牌平铺在桌面上是斜视角，等级太低会整片糊掉。
// 由 scene.js 在创建渲染器后写入设备支持的最大值（通常 16）。
let MAX_ANISO = 4;
export function setMaxAnisotropy(n) {
  if (typeof n === 'number' && isFinite(n) && n > MAX_ANISO) MAX_ANISO = Math.min(16, n);
}

// 贴图超采样倍率：画布放大 SS 倍，绘制坐标仍按原尺寸写，得到 SS 倍线密度的贴图
const SS = 1.5;

function texFromCanvas(canvas, aniso = 0) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.max(MAX_ANISO, aniso);
  t.needsUpdate = true;
  return t;
}

// 六边形切工宝石：原版筹码上就是这种刻面宝石
export function drawGem(ctx, cx, cy, r, hex, opts = {}) {
  const sides = 6;
  const ring = opts.ring !== false;
  ctx.save();
  ctx.translate(cx, cy);
  const path = (rad) => {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  path(r * 1.06);
  ctx.fillStyle = shade(hex, -0.55);
  ctx.fill();

  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, shade(hex, 0.5));
  g.addColorStop(0.45, hex);
  g.addColorStop(1, shade(hex, -0.35));
  path(r);
  ctx.fillStyle = g;
  ctx.fill();

  path(r * 0.58);
  const g2 = ctx.createLinearGradient(-r * 0.6, -r * 0.6, r * 0.6, r * 0.6);
  g2.addColorStop(0, shade(hex, 0.62));
  g2.addColorStop(1, shade(hex, 0.05));
  ctx.fillStyle = g2;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = shade(hex, -0.42);
  ctx.lineWidth = Math.max(1, r * 0.075);
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }

  if (ring) {
    path(r * 1.06);
    ctx.strokeStyle = shade(hex, -0.62);
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.stroke();
  }
  ctx.restore();
}

// 判断颜色是否偏亮 —— 亮底上用深色数字，暗底上用白色数字
function isLight(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

// 兑换需求圆盘：与桌上筹码同款配色，中间直接压一个特大号数字。
// 之前是「六边形宝石 + 叠一个数字」，宝石颜色一深一浅就把数字糊住了；
// 改成实心色盘 + 按底色亮度自动选黑/白数字，任何宝石色都一眼可读。
function drawCostDisc(ctx, cx, cy, R, color, count) {
  const hex = COLOR_INFO[color].hex;
  const light = isLight(hex);
  ctx.save();

  // 落地阴影，让圆盘从深色底板上浮起来
  ctx.beginPath();
  ctx.arc(cx, cy + R * 0.09, R * 0.98, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // 盘面
  const g = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.4, R * 0.08, cx, cy, R);
  g.addColorStop(0, shade(hex, 0.5));
  g.addColorStop(0.55, hex);
  g.addColorStop(1, shade(hex, -0.32));
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, R * 0.13);
  ctx.strokeStyle = shade(hex, -0.6);
  ctx.stroke();

  // 内圈（和筹码上的那圈呼应）
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.79, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.4, R * 0.075);
  ctx.strokeStyle = light ? 'rgba(90,80,60,0.35)' : 'rgba(255,255,255,0.55)';
  ctx.stroke();

  // 数字：字号接近盘径，描边选与字色相反的一侧补足对比
  const f = Math.round(R * 1.42);
  ctx.font = `bold ${f}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const ty = cy + f * 0.05;
  if (light) {
    ctx.lineWidth = Math.max(2, R * 0.12);
    ctx.strokeStyle = '#241a08';
    ctx.fillStyle = '#241a08';
  } else {
    ctx.lineWidth = Math.max(3, R * 0.22);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.fillStyle = '#ffffff';
  }
  ctx.strokeText(String(count), cx, ty);
  ctx.fillText(String(count), cx, ty);
  ctx.restore();
}

function paperBackground(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w * 0.6, h);
  g.addColorStop(0, '#f6efdd');
  g.addColorStop(0.5, '#efe4cb');
  g.addColorStop(1, '#e3d4b3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = i % 2 ? '#7a6a4a' : '#ffffff';
    const x = (i * 97.3) % w;
    const y = (i * 53.7) % h;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawLevelArt(ctx, x, y, w, h, level, tint) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, shade(tint, 0.72));
  sky.addColorStop(1, shade(tint, 0.36));
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);

  ctx.globalAlpha = 0.5;
  ctx.fillStyle = shade(tint, -0.25);
  if (level === 1) {
    for (let i = 0; i < 7; i++) {
      const bx = x + (i * w) / 7;
      const bh = h * (0.34 + 0.4 * ((i * 37) % 10) / 10);
      ctx.beginPath();
      ctx.moveTo(bx, y + h);
      ctx.lineTo(bx + w / 12, y + h - bh);
      ctx.lineTo(bx + w / 6, y + h);
      ctx.closePath();
      ctx.fill();
    }
  } else if (level === 2) {
    for (let i = 0; i < 5; i++) {
      const bx = x + 6 + (i * (w - 12)) / 5;
      ctx.beginPath();
      ctx.moveTo(bx, y + h);
      ctx.lineTo(bx, y + h * 0.52);
      ctx.quadraticCurveTo(bx + (w - 12) / 10, y + h * 0.24, bx + (w - 12) / 5, y + h * 0.52);
      ctx.lineTo(bx + (w - 12) / 5, y + h);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.fillRect(x + w * 0.12, y + h * 0.42, w * 0.76, h * 0.58);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = shade(tint, 0.2);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + h * 0.1);
    ctx.lineTo(x + w * 0.86, y + h * 0.44);
    ctx.lineTo(x + w * 0.14, y + h * 0.44);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = shade(tint, -0.45);
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(x + w * 0.19 + i * w * 0.17, y + h * 0.5, w * 0.07, h * 0.5);
    }
  }
  ctx.globalAlpha = 1;

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 9; i++) {
    ctx.fillRect(x, y + (i * h) / 9 + 2, w, 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.strokeStyle = shade(tint, -0.5);
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

export function makeCardTexture(card) {
  return cached(`card:${card.level}:${card.bonus}:${card.points}:${COLORS.map((c) => card.cost[c]).join('')}`, () => {
    const W = 256;
    const H = 358;
    const c = makeCanvas(Math.round(W * SS), Math.round(H * SS));
    const ctx = c.getContext('2d');
    ctx.scale(SS, SS);
    const info = COLOR_INFO[card.bonus];
    const lv = LEVEL_INFO[card.level];

    paperBackground(ctx, W, H);

    ctx.strokeStyle = lv.backDeep;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.strokeStyle = shade(info.hex, 0.35);
    ctx.lineWidth = 2;
    ctx.strokeRect(13, 13, W - 26, H - 26);

    // ---- 顶部信息条：深色底衬，让「分数」与「永久宝石」从插画上跳出来 ----
    const banner = ctx.createLinearGradient(0, 16, 0, 84);
    banner.addColorStop(0, 'rgba(30,22,8,0.5)');
    banner.addColorStop(1, 'rgba(30,22,8,0.26)');
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(16, 16, W - 32, 68, 16);
    ctx.fillStyle = banner;
    ctx.fill();
    ctx.strokeStyle = 'rgba(52,38,14,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // 顶部中间：等级圆点
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(W / 2 - 21 + i * 21, 50, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = i < card.level ? shade(lv.back, 0.45) : 'rgba(255,255,255,0.2)';
      ctx.fill();
      ctx.strokeStyle = i < card.level ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 左上：声望分（金色奖章 + 特大数字，远远就能看见）
    if (card.points > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(52, 52, 28, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      const g = ctx.createRadialGradient(45, 42, 3, 52, 50, 28);
      g.addColorStop(0, '#fffdf3');
      g.addColorStop(0.58, '#f4e0a6');
      g.addColorStop(1, '#d7b04c');
      ctx.beginPath();
      ctx.arc(52, 50, 28, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#85641f';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(52, 50, 23.5, 0, Math.PI * 2);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.stroke();
      ctx.font = 'bold 40px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#5b4109';
      ctx.strokeText(String(card.points), 52, 51);
      ctx.fillStyle = '#3c2c08';
      ctx.fillText(String(card.points), 52, 51);
      ctx.restore();
    }

    // 右上：永久奖励宝石（后面垫一层浅色光晕，深底上更醒目）
    ctx.save();
    ctx.beginPath();
    ctx.arc(W - 52, 50, 30, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.restore();
    drawGem(ctx, W - 52, 50, 28, info.hex);

    drawLevelArt(ctx, 24, 88, W - 48, 152, card.level, info.hex);

    // ---- 底部兑换需求：与桌上筹码同款的彩色圆盘 + 特大数字 ----
    const costs = COLORS.filter((col) => card.cost[col] > 0);
    const panelY = 248;
    const panelH = 96;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(16, panelY, W - 32, panelH, 18);
    ctx.fillStyle = 'rgba(30,22,8,0.46)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(52,38,14,0.6)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    const bw = Math.min(62, (W - 48) / costs.length);
    const discR = Math.min(30, bw * 0.47);
    const cy = panelY + panelH / 2;
    let bx = W / 2 - (costs.length * bw) / 2 + bw / 2;
    for (const col of costs) {
      drawCostDisc(ctx, bx, cy, discR, col, card.cost[col]);
      bx += bw;
    }

    return texFromCanvas(c);
  });
}

export function makeCardBackTexture(level) {
  return cached(`back:${level}`, () => {
    const W = 256;
    const H = 358;
    const c = makeCanvas(Math.round(W * SS), Math.round(H * SS));
    const ctx = c.getContext('2d');
    ctx.scale(SS, SS);
    const lv = LEVEL_INFO[level];
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, shade(lv.back, 0.18));
    g.addColorStop(1, shade(lv.backDeep, -0.1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    for (let i = -H; i < W; i += 22) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + H, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i + H, 0);
      ctx.lineTo(i, H);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 5;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 62, 0, Math.PI * 2);
    ctx.fillStyle = lv.backDeep;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();

    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(W / 2 - 26 + i * 26, H / 2, 10, 0, Math.PI * 2);
      ctx.fillStyle = i < level ? lv.dot : 'rgba(255,255,255,0.25)';
      ctx.fill();
    }
    return texFromCanvas(c);
  });
}

export function makeNobleTexture(noble) {
  return cached(`noble:${noble.id}`, () => {
    const S = 256;
    const c = makeCanvas(Math.round(S * SS), Math.round(S * SS));
    const ctx = c.getContext('2d');
    ctx.scale(SS, SS);

    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#f7f0dd');
    g.addColorStop(1, '#e0d0ab');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    ctx.strokeStyle = '#6a5326';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, S - 8, S - 8);
    ctx.strokeStyle = 'rgba(160,130,60,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, S - 28, S - 28);

    // 剪影肖像
    ctx.save();
    ctx.beginPath();
    ctx.rect(30, 26, S - 60, 118);
    ctx.clip();
    ctx.fillStyle = 'rgba(120,96,48,0.16)';
    ctx.fillRect(30, 26, S - 60, 118);
    ctx.fillStyle = '#6d5a33';
    ctx.beginPath();
    ctx.arc(S / 2, 78, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(S / 2, 138, 44, 34, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    // 王冠
    ctx.beginPath();
    ctx.moveTo(S / 2 - 24, 56);
    ctx.lineTo(S / 2 - 14, 34);
    ctx.lineTo(S / 2 - 5, 50);
    ctx.lineTo(S / 2, 30);
    ctx.lineTo(S / 2 + 5, 50);
    ctx.lineTo(S / 2 + 14, 34);
    ctx.lineTo(S / 2 + 24, 56);
    ctx.closePath();
    ctx.fillStyle = '#b7912f';
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(120,96,48,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 26, S - 60, 118);

    // 声望 3（金色奖章，与卡牌上的分数牌统一）
    ctx.save();
    ctx.beginPath();
    ctx.arc(40, 46, 24, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
    const mg = ctx.createRadialGradient(34, 38, 3, 40, 44, 24);
    mg.addColorStop(0, '#fffdf3');
    mg.addColorStop(0.58, '#f4e0a6');
    mg.addColorStop(1, '#d7b04c');
    ctx.beginPath();
    ctx.arc(40, 44, 24, 0, Math.PI * 2);
    ctx.fillStyle = mg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#85641f';
    ctx.stroke();
    ctx.font = 'bold 34px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#5b4109';
    ctx.strokeText('3', 40, 45);
    ctx.fillStyle = '#3c2c08';
    ctx.fillText('3', 40, 45);
    ctx.restore();

    // 需求：与卡牌同款的彩色圆盘 + 特大数字
    const reqs = COLORS.filter((col) => noble.req[col]);
    const panelY = 164;
    const panelH = 72;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(20, panelY, S - 40, panelH, 16);
    ctx.fillStyle = 'rgba(30,22,8,0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(52,38,14,0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    const bw = Math.min(62, (S - 56) / reqs.length);
    const discR = Math.min(27, bw * 0.47);
    const cy = panelY + panelH / 2;
    let bx = S / 2 - (reqs.length * bw) / 2 + bw / 2;
    for (const col of reqs) {
      drawCostDisc(ctx, bx, cy, discR, col, noble.req[col]);
      bx += bw;
    }
    return texFromCanvas(c);
  });
}

export function makeTokenTexture(color) {
  return cached(`token:${color}`, () => {
    const S = 256;
    const c = makeCanvas(Math.round(S * SS), Math.round(S * SS));
    const ctx = c.getContext('2d');
    ctx.scale(SS, SS);
    const info = COLOR_INFO[color];
    const R = S / 2 - 6;

    ctx.beginPath();
    ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(S / 2 - R * 0.35, S / 2 - R * 0.35, R * 0.1, S / 2, S / 2, R);
    g.addColorStop(0, shade(info.hex, 0.45));
    g.addColorStop(0.55, info.hex);
    g.addColorStop(1, shade(info.hex, -0.32));
    ctx.fillStyle = g;
    ctx.fill();

    ctx.lineWidth = 8;
    ctx.strokeStyle = shade(info.hex, -0.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(S / 2, S / 2, R * 0.82, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.stroke();

    // 边缘小点
    for (let i = 0; i < 24; i++) {
      const a = (Math.PI * 2 * i) / 24;
      ctx.beginPath();
      ctx.arc(S / 2 + Math.cos(a) * R * 0.91, S / 2 + Math.sin(a) * R * 0.91, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      ctx.fill();
    }

    drawGem(ctx, S / 2, S / 2, R * 0.6, info.hex);
    return texFromCanvas(c);
  });
}

export function makeEdgeTexture(hex = '#e8e0cd') {
  return cached(`edge:${hex}`, () => {
    const c = makeCanvas(16, 16);
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 16, 16);
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = i % 2 ? '#000' : '#fff';
      ctx.fillRect((i * 7) % 16, (i * 11) % 16, 2, 2);
    }
    return texFromCanvas(c);
  });
}

export function makeLabelTexture(text, opts = {}) {
  const key = `label:${text}:${opts.bg || ''}:${opts.color || ''}:${opts.size || ''}`;
  return cached(key, () => {
    const W = 128;
    const H = 128;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    if (opts.bg) {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, 54, 0, Math.PI * 2);
      ctx.fillStyle = opts.bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    ctx.font = `bold ${opts.size || 62}px "Microsoft YaHei", Georgia, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeText(text, W / 2, H / 2 + 2);
    ctx.fillStyle = opts.color || '#3a3020';
    ctx.fillText(text, W / 2, H / 2 + 2);
    return texFromCanvas(c);
  });
}

export function makePlayerMatTexture(seat, total) {
  return cached(`mat:${seat}:${total}`, () => {
    const W = 512;
    const H = 352;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#4a3826');
    g.addColorStop(1, '#2e2116');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : '#000';
      ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(233,200,132,0.85)';
    ctx.lineWidth = 7;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.setLineDash([12, 9]);
    ctx.strokeStyle = 'rgba(233,200,132,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(26, 26, W - 52, H - 52);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(233,200,132,0.55)';
    ctx.font = '500 26px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${seat + 1} 号座`, W - 34, 32);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(233,200,132,0.3)';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(42 + i * 88, 32, 62, 22);
    }
    return texFromCanvas(c);
  });
}

// 筹码侧面的叠片纹理（水平条纹，纵向按数量重复）
export function makeTokenSideTexture(color) {
  return cached(`tokenside:${color}`, () => {
    const W = 32;
    const H = 32;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const info = COLOR_INFO[color];
    ctx.fillStyle = shade(info.hex, -0.5);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = info.hex;
    ctx.fillRect(0, 0, W, H * 0.72);
    ctx.fillStyle = shade(info.hex, -0.28);
    ctx.fillRect(0, H * 0.06, W, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(0, H * 0.78, W, 2);
    const t = texFromCanvas(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

export function makeTableTexture() {
  return cached('table', () => {
    const S = 1024;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.52);
    g.addColorStop(0, '#1f5d4c');
    g.addColorStop(0.68, '#17493c');
    g.addColorStop(1, '#0f352c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // 绒面质感
    ctx.globalAlpha = 0.045;
    for (let i = 0; i < 12000; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#000000';
      ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    ctx.globalAlpha = 1;
    return texFromCanvas(c, 8);
  });
}

export function makeWoodTexture() {
  return cached('wood', () => {
    const S = 1024;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const y = (i * S) / 90;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) {
        ctx.lineTo(x, y + Math.sin(x * 0.012 + i) * 4.5);
      }
      ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,0.16)' : 'rgba(255,220,170,0.09)';
      ctx.lineWidth = 1.6 + (i % 4);
      ctx.stroke();
    }
    return texFromCanvas(c, 8);
  });
}

export function disposeTextureCache() {
  for (const t of cache.values()) if (t && t.dispose) t.dispose();
  cache.clear();
}
