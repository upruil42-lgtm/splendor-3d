# 璀璨宝石 · 3D（Splendor 3D）

经典桌游《璀璨宝石》(Splendor) 的网页 3D 重制版。纯前端、零依赖构建，浏览器打开即玩。

**在线游玩 → https://upruil42-lgtm.github.io/splendor-3d/**

## 玩法

你是文艺复兴时期的宝石商人：在矿区收集五色宝石，购买发展卡建立永久折扣，吸引贵族到访，最先拿到 **15 声望分**获胜。本作由你对抗 3 位 AI 对手。

- 拿宝石：同色 2 枚，或三种不同颜色各 1 枚（金色万能珠只能通过预留获得）
- 预留卡牌：可从市场或牌库顶预留，同时获得 1 枚金色万能珠
- 购买卡牌：费用可用宝石支付，发展卡提供永久折扣
- 贵族到访：满足条件自动获得，额外 3 分
- 手机横屏体验最佳，竖屏会提示旋转

## 技术栈

| 项目 | 说明 |
|---|---|
| 渲染 | three.js r161 + WebGL 2.0，PMREM 环境反射、ACES 色调映射、PCF 软阴影 |
| 贴图 | 全程序化 Canvas 绘制（卡牌/牌背/贵族/筹码/木纹/牌垫），零外部图片资源 |
| 架构 | `src/engine`（纯规则逻辑，可 Node 测试）+ `src/render`（场景与动画）+ `src/ui`（HUD） |
| 性能 | 按需渲染：静止时零重绘；插值包围盒 + 二分反解实现任意视口的相机自适应取景 |
| 适配 | 桌面 / 手机横屏 / 平板，触控目标 ≥44px，支持 PWA 添加到主屏幕 |

## 目录

```
index.html            入口
styles.css            界面样式（含手机横屏/竖屏提示断点）
src/engine/cards.js   卡牌与贵族数据
src/engine/rules.js   规则引擎（行动合法性、结算、事件流）
src/engine/ai.js      分级优先级 AI 决策
src/render/scene.js   舞台、光照、相机取景
src/render/board.js   牌桌布局与对象动画
src/render/textures.js 程序化贴图
src/ui/hud.js         HUD 渲染
vendor/               three.js 本地化（免 CDN）
icons/                PWA 图标
```

## 本地运行

```bash
# 任意静态服务器均可，例如：
npx serve .
# 或
python -m http.server 8000
```

然后访问 http://localhost:8000 。

> ES Module + importmap 需要 HTTP 协议，直接双击 index.html（file://）会被浏览器拦截。

## 部署

仓库根目录即站点根目录，GitHub Pages 选择 `main` 分支 `/ (root)` 即可发布，无需构建步骤。
