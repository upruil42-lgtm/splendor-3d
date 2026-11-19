// 场景搭建：渲染器 / 相机 / 光照 / 桌台 / 环境反射
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { makeTableTexture, makeWoodTexture, setMaxAnisotropy } from './textures.js';

function makeEnvTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#fff6e4');
  g.addColorStop(0.42, '#cfe0ee');
  g.addColorStop(0.62, '#6d7f8d');
  g.addColorStop(1, '#2a2b30');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  // 几处高光，让宝石有立体的反射细节
  for (const [x, y, r] of [
    [120, 46, 42],
    [330, 34, 30],
    [460, 70, 22],
  ]) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  // 卡牌是平铺在桌面上看的（斜视角），各向异性过滤开到设备上限，卡面数字才不会糊
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0d1a17, 26, 46);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = makeEnvTexture();
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  pmrem.dispose();
  envTex.dispose();

  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 120);
  camera.position.set(0, 13.4, 10.3);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.75);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = 26;
  controls.minPolarAngle = 0.22;
  controls.maxPolarAngle = 1.32; // 允许更俯视一些，方便凑近读牌面
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.update();

  const hemi = new THREE.HemisphereLight(0xfff2dc, 0x11261f, 0.62);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff3dd, 2.05);
  key.position.set(6.5, 14, 7.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -12.5;
  key.shadow.camera.right = 12.5;
  key.shadow.camera.top = 12.5;
  key.shadow.camera.bottom = -12.5;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xa9c8ff, 0.5);
  fill.position.set(-8, 9, -7);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffc98a, 0.35);
  rim.position.set(-2, 4, -9);
  scene.add(rim);

  // 桌台：木质边缘 + 绒面
  const woodMat = new THREE.MeshStandardMaterial({
    map: makeWoodTexture(),
    roughness: 0.72,
    metalness: 0.06,
  });
  const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(7.54, 7.32, 0.62, 96, 1, true), woodMat);
  rimMesh.position.y = -0.31;
  rimMesh.receiveShadow = true;
  scene.add(rimMesh);

  const rimTop = new THREE.Mesh(new THREE.RingGeometry(7.18, 7.54, 96), woodMat);
  rimTop.rotation.x = -Math.PI / 2;
  rimTop.position.y = 0.005;
  rimTop.receiveShadow = true;
  scene.add(rimTop);

  const feltMat = new THREE.MeshStandardMaterial({
    map: makeTableTexture(),
    roughness: 0.95,
    metalness: 0,
  });
  const felt = new THREE.Mesh(new THREE.CircleGeometry(7.18, 96), feltMat);
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(7.48, 5.85, 1.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x3a2415, roughness: 0.85 })
  );
  base.position.y = -1.35;
  scene.add(base);

  const clock = new THREE.Clock();

  // ---- 自适应取景：把牌桌投影到屏幕，二分反解机位距离 ----
  // 牌桌是圆的、投影不对称，任何解析公式在极端宽高比下都会差几个像素。
  // 这里直接量投影包围盒，二分找到「刚好完整入镜」的距离，手机竖屏 / 横屏 / 宽屏都成立。
  // 取景圈收到 7.16：座位外移后牌垫光晕最远角约 7.08，全部内容都在圈内，
  // 而木桌沿（7.54）只留部分入镜 —— 桌沿不占画面，卡面尽量大。
  const FIT_RADIUS = 7.16;
  const BASE_DIST = 16.45; // 桌面端调好的默认机位：宽屏下不会比它更近
  const SAFE = 0.985; // 归一化坐标下留 1.5% 边距，避免桌沿贴边被裁

  const _fitDir = new THREE.Vector3();
  const _fitPt = new THREE.Vector3();

  // 当前机位下牌桌的最大归一化投影半径；<= SAFE 即完整入镜
  const fitOverflow = () => {
    camera.updateMatrixWorld(true);
    let k = 0;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const sx = Math.sin(a) * FIT_RADIUS;
      const sz = Math.cos(a) * FIT_RADIUS;
      // 桌沿平面与筹码高度各取一圈，纵向都不能出界
      for (let j = 0; j < 2; j++) {
        _fitPt.set(sx, j * 0.55, sz).project(camera);
        k = Math.max(k, Math.abs(_fitPt.x), Math.abs(_fitPt.y));
      }
    }
    return k;
  };

  // 上一次「刚好完整入镜」的距离，用来换算并保留用户自己的缩放倍率
  let lastFitDist = 0;

  const fitCamera = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);

    // 保持用户当前的观察方向，只调距离
    _fitDir.copy(camera.position).sub(controls.target);
    if (_fitDir.lengthSq() < 1e-6) _fitDir.set(0, 13.4, 9.55);
    const curDist = _fitDir.length();
    _fitDir.normalize();

    let lo = BASE_DIST; // 太近：一定放不下
    let hi = BASE_DIST * 3; // 太远：一定放得下
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      camera.position.copy(controls.target).addScaledVector(_fitDir, mid);
      if (fitOverflow() > SAFE) lo = mid;
      else hi = mid;
    }
    const fitDist = hi;

    // 关键：底栏高度变化、手机地址栏收放都会触发 resize。若每次都把机位拉回默认，
    // 玩家刚放大的视角就被清掉了（要反复重新放大）。这里只重算「完整入镜」的基准距离，
    // 再把用户当时的缩放倍率原样叠上去，视角与缩放都不丢。
    const zoom = lastFitDist > 0 ? THREE.MathUtils.clamp(curDist / lastFitDist, 0.45, 3.2) : 1;
    lastFitDist = fitDist;
    const dist = THREE.MathUtils.clamp(fitDist * zoom, fitDist * 0.42, fitDist * 2.1);

    controls.minDistance = Math.max(5.2, fitDist * 0.42);
    controls.maxDistance = Math.max(26, fitDist * 1.7);
    camera.position.copy(controls.target).addScaledVector(_fitDir, dist);
    if (scene.fog) {
      scene.fog.near = dist + 8;
      scene.fog.far = dist + 36;
    }
    controls.update();
    // setSize 会清空画布；即便相机位置没变也必须安排一次重绘
    stage.needsRender = true;
  };

  window.addEventListener('resize', fitCamera);
  window.addEventListener('orientationchange', () => setTimeout(fitCamera, 150));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitCamera);
  if (window.ResizeObserver) new ResizeObserver(fitCamera).observe(container);

  const stage = {
    renderer,
    scene,
    camera,
    controls,
    clock,
    needsRender: true,
    resize: fitCamera,
    felt,
    key,
  };

  // 按需渲染：相机动了才需要重绘（对象动画与悬停由各自回调置位）
  controls.addEventListener('change', () => {
    stage.needsRender = true;
  });

  return stage;
}
