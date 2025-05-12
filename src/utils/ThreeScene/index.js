// src/utils/threeScene/index.js
import { initCore } from "./core";
import { initMeshManager } from "./meshManager";
import { initGraph } from "./graph";
import { initLayout } from "./layout";
import { initControls } from "./controls";
// import { initConnectMode } from "./modes/connect";
import { initSnapMode } from "./modes/snap";
import { initPlanarMode } from "./modes/planar";

/**
 * 保持原签名不变
 */
export function createThreeContext(
  canvasEl,
  furnitureTree,
  connections,
  onSelect
) {
  /* --------- 共享上下文对象 (模块间公用) --------- */
  const ctx = {
    /* 原 createThreeContext 里的公共状态字段全部移入这里 */
    canvasEl,
    furnitureTree,
    connections,
    onSelect,

    /* 以下字段由各 init* 方法填充 */
    scene: null,
    camera: null,
    renderer: null,
    labelRenderer: null,
    orbit: null,
    transformCtrls: null,

    meshMap: new Map(),
    nameIndex: {},
    graph: new Map(),

    /* UI‑层需要暴露的方法占位，稍后在 init* 内赋值 */
    publicAPI: {},
  };

  /* --------- 子模块初始化（顺序不能乱） --------- */
  initCore(ctx); // 场景 & 渲染循环
  initMeshManager(ctx); // meshMap / nameIndex / addMesh / removeMesh
  initGraph(ctx); // rebuildGraph / findComponent
  initLayout(ctx); // layout* 系列
  initControls(ctx); // Orbit & TransformControls，选中 / 高亮 / 拖动
  // initConnectMode(ctx);     // 连接模式
  initSnapMode(ctx); // 连接模式 拖拽贴面
  initPlanarMode(ctx); // 共面伸缩
  /* —— 让外层（Pinia store 等）也能拿到 scene —— */
  ctx.publicAPI.scene = ctx.scene;

  /* ---------- 返回统一的公开 API ---------- */
  return ctx.publicAPI;
}
