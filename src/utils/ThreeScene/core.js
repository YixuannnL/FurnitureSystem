import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export function initCore(ctx) {
  const { canvasEl, furnitureTree } = ctx;

  /* === 1. 场景 & 相机 & 渲染器 === */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5).convertSRGBToLinear();
  const camera = new THREE.PerspectiveCamera(
    50,
    canvasEl.clientWidth / canvasEl.clientHeight,
    0.1,
    5000
  );
  camera.position.set(1000, 800, 1000);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas: canvasEl,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvasEl.clientWidth, canvasEl.clientHeight);

  // 开启 sRGB 输出与 ACES 色调映射，微调曝光度
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;

  /* ---------- 2-D 标签渲染器 ---------- */
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(canvasEl.clientWidth, canvasEl.clientHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  // 让 <canvas> 包装容器成为定位上下文
  canvasEl.parentElement.style.position = "relative";
  canvasEl.parentElement.appendChild(labelRenderer.domElement);

  // 柔和环境光 + 方向光
  const ambientCol = new THREE.Color(0xffffff).convertSRGBToLinear();
  scene.add(new THREE.AmbientLight(ambientCol, 1.0));
  const dirCol = new THREE.Color(0xffffff).convertSRGBToLinear();
  const dirLight = new THREE.DirectionalLight(dirCol, 0.6);
  dirLight.position.set(300, 600, 500);
  scene.add(dirLight);

  /* ---------- 全局坐标系箭头 ---------- */
  // 箭头长度取家具整体最大尺寸的 60%，缺省 1000 mm
  const rootDims = furnitureTree.dims ?? {
    width: 1000,
    height: 1000,
    depth: 1000,
  };
  const arrowLen =
    Math.max(rootDims.width, rootDims.height, rootDims.depth) * 0.6;
  const headLen = arrowLen * 0.1; // 箭头头部为长度的 10%
  const headWd = headLen * 0.6; // 箭头宽度略小于头长

  // X 轴 (红)
  const xDir = new THREE.Vector3(1, 0, 0);
  const xArrow = new THREE.ArrowHelper(
    xDir,
    new THREE.Vector3(0, 0, 0),
    arrowLen,
    0xff0000,
    headLen,
    headWd
  );
  xArrow.renderOrder = 1000;
  scene.add(xArrow);

  // Y 轴 (绿)
  const yDir = new THREE.Vector3(0, 1, 0);
  const yArrow = new THREE.ArrowHelper(
    yDir,
    new THREE.Vector3(0, 0, 0),
    arrowLen,
    0x00ff00,
    headLen,
    headWd
  );
  yArrow.renderOrder = 1000;
  scene.add(yArrow);

  // Z 轴 (蓝)
  const zDir = new THREE.Vector3(0, 0, 1);
  const zArrow = new THREE.ArrowHelper(
    zDir,
    new THREE.Vector3(0, 0, 0),
    arrowLen,
    0x0000ff,
    headLen,
    headWd
  );
  zArrow.renderOrder = 1000;
  scene.add(zArrow);

  // 渲染循环
  function animate() {
    requestAnimationFrame(animate);
    ctx.orbit?.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();

  // 处理窗口 resize
  window.addEventListener("resize", () => {
    camera.aspect =
      canvasEl.parentElement.clientWidth / canvasEl.parentElement.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(
      canvasEl.parentElement.clientWidth,
      canvasEl.parentElement.clientHeight
    );
  });

  // ……【移植原 threeScene.js 中与场景创建、光照、坐标轴、
  //     labelRenderer、resize 及 animate 循环相关的全部代码】……

  ctx.scene = scene;
  ctx.camera = camera;
  ctx.renderer = renderer;
  ctx.labelRenderer = labelRenderer; // ← animate 循环里会用到

  /* 无需对外暴露到 publicAPI */
}
