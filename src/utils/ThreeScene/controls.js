/* ──────────────────────────────────────────────
 *  src/utils/threeScene/controls.js
 *  负责：
 *    • OrbitControls & TransformControls 的初始化
 *    • mesh 选中 / 高亮 / 隔离
 *    • 拖动 (translate) 与 XYZ 伸缩 (scale)
 *    • setMode — drag / axis / connect / planar 的统一切换口
 *  对外暴露：
 *    highlightPath, isolatePath, setMode, resetConnectMode(由 connect.js 写入)
 * ────────────────────────────────────────────── */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import {
  dimsToBoxGeom,
  generateAnchorPoints,
  findByPath,
  getFaceBBox,
} from "../geometryUtils";

import { useSceneStore } from "../../store";

export function initControls(ctx) {
  /* ——— 本文件内部频繁使用的引用 ——— */
  const { scene, camera, renderer, meshMap, graph, onSelect, publicAPI } = ctx;

  const store = useSceneStore();

  /* ===========================================================
   * 1. 轨道控制 & 变换控制
   * ========================================================= */
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;

  const tc = new TransformControls(camera, renderer.domElement);
  tc.setSpace("world");
  scene.add(tc.getHelper());

  // Orbit 与 TransformControls 交互互斥
  tc.addEventListener("dragging-changed", (e) => {
    orbit.enabled = !e.value;
  });

  ctx.orbit = orbit;
  ctx.transformCtrls = tc;

  /* ===========================================================
   * 2. 运行时状态
   * ========================================================= */
  ctx.currentMode = "drag"; // "drag" | "axis" | "connect" | "planar"
  ctx.selectedMesh = null; // 当前 gizmo 绑定的 mesh
  ctx.component = []; // 与 selectedMesh 同连通分量（pathStr[]）
  const prevPos = new THREE.Vector3();
  ctx.prevPosRef = prevPos; // ← 让 snap.js 能同步基准

  let scalingOrigDims = null; // XYZ 缩放开始时的尺寸

  /* ===========================================================
   * 3. TransformControls 事件 —— 拖动 / 缩放
   * ========================================================= */
  tc.addEventListener("mouseDown", () => {
    if (!ctx.selectedMesh) return;

    /* ---------- A) XYZ 伸缩 ---------- */
    if (tc.mode === "scale") {
      if (!store.connectSessionActive) {
        // 连接事务期间跳过
        store.recordSnapshot();
      }
      const node = findByPath(
        store.furnitureTree,
        ctx.selectedMesh.userData.pathArr
      );
      scalingOrigDims = node?.dims ? { ...node.dims } : null;
      return;
    }

    /* ---------- B) 拖动 ---------- */
    if (tc.mode === "translate") {
      if (!store.connectSessionActive) {
        // 连接事务期间跳过
        store.recordSnapshot();
      }
    }
  });

  // 拖动同步同组件
  tc.addEventListener("objectChange", () => {
    if (!ctx.selectedMesh || tc.mode !== "translate") return;

    const delta = ctx.selectedMesh.position.clone().sub(prevPos);
    if (delta.lengthSq() === 0) return;

    prevPos.copy(ctx.selectedMesh.position);
    ctx.component.forEach((p) => {
      if (p === ctx.selectedMesh.userData.pathStr) return;
      meshMap.get(p)?.position.add(delta);
    });
  });

  // 伸缩结束：写回 meta 并替换几何
  tc.addEventListener("dragging-changed", (e) => {
    if (
      !(tc.mode === "scale" && ctx.selectedMesh && scalingOrigDims) ||
      e.value /* true = 开始，false = 结束 */
    )
      return;

    const node = findByPath(
      store.furnitureTree,
      ctx.selectedMesh.userData.pathArr
    );
    if (!node || !node.dims) {
      scalingOrigDims = null;
      return;
    }

    const s = ctx.selectedMesh.scale;
    const newDims = {
      width: scalingOrigDims.width * s.x,
      height: scalingOrigDims.height * s.y,
      depth: scalingOrigDims.depth * s.z,
    };
    node.dims = newDims; // 写回 meta

    // 替换几何
    ctx.selectedMesh.geometry.dispose();
    ctx.selectedMesh.geometry = dimsToBoxGeom(newDims);

    // 边框
    ctx.selectedMesh.children.forEach((c) => {
      if (c.isLineSegments) {
        c.geometry.dispose();
        c.geometry = new THREE.EdgesGeometry(ctx.selectedMesh.geometry, 20);
      }
    });

    // 六面数据刷新，保障后续连接检测
    ctx.selectedMesh.userData.faceBBox = getFaceBBox(ctx.selectedMesh);

    // 顶部标签高度
    if (ctx.selectedMesh.userData.label) {
      ctx.selectedMesh.userData.label.position.set(
        0,
        newDims.height * 0.55 + 10,
        0
      );
    }

    // 恢复 scale
    ctx.selectedMesh.scale.set(1, 1, 1);

    store.meshRevision++;
    scalingOrigDims = null;
  });

  /* ===========================================================
   * 4. 高亮 / 隔离 / 选中
   * ========================================================= */

  function highlightPath(selectedPath = []) {
    /* ---------- 解析传参 ---------- */
    let prefixes = [];
    if (selectedPath.length === 0) {
      prefixes = [""]; // 空 ⇒ 全亮
    } else if (Array.isArray(selectedPath[0])) {
      // 数组套数组
      prefixes = selectedPath.map((p) => p.join("/"));
    } else {
      // 单一路径
      prefixes = [selectedPath.join("/")];
    }

    meshMap.forEach((mesh, pathStr) => {
      const isTarget = prefixes.some((pre) => pathStr.startsWith(pre));

      mesh.material.transparent = !isTarget;
      mesh.material.opacity = isTarget ? 1 : 0.15;
      mesh.material.needsUpdate = true;

      // 顶部标签可见性
      if (mesh.userData.label) {
        mesh.userData.label.visible = selectedPath.length === 0 || isTarget;
      }

      // 边框线淡显
      mesh.children.forEach((child) => {
        if (child.isLineSegments) {
          child.material.transparent = !isTarget;
          child.material.opacity = isTarget ? 0.4 : 0.03;
          child.material.needsUpdate = true;
        }
      });
    });
  }

  /** 隔离显示某路径（空数组 = 全显） */
  function isolatePath(pathArr = []) {
    const prefix = pathArr.join("/");
    meshMap.forEach((mesh, key) => {
      mesh.visible = !prefix || key.startsWith(prefix);
    });
  }

  /** 找到 rootPathStr 所在连通分量（BFS） */
  function findComponent(rootPathStr) {
    const result = [];
    const visited = new Set();
    const queue = [rootPathStr];
    while (queue.length) {
      const p = queue.shift();
      if (visited.has(p)) continue;
      visited.add(p);
      result.push(p);
      graph.get(p)?.forEach((n) => queue.push(n));
    }
    return result;
  }

  /** 选中或取消选中一个 mesh（null = 取消） */
  function selectMesh(mesh) {
    if (mesh) {
      ctx.selectedMesh = mesh;
      ctx.component = findComponent(mesh.userData.pathStr);
      if (tc.enabled) tc.attach(mesh);

      prevPos.copy(mesh.position);
      highlightPath(mesh.userData.pathArr);
      onSelect(mesh.userData.pathArr);
    } else {
      ctx.selectedMesh = null;
      ctx.component = [];
      tc.detach();
      highlightPath([]);
      onSelect([]);
    }
  }

  /* ===========================================================
   * 5. pointerDown — 只处理 drag / axis 场景的「选中」
   *    connect / planar 的 pointer 逻辑由各自 mode 文件单独监听
   * ========================================================= */
  function isClickingGizmo() {
    return tc.enabled && tc.axis !== null;
  }

  let downX = 0,
    downY = 0;
  const CLICK_DIST = 6; // px

  renderer.domElement.addEventListener("pointerdown", (ev) => {
    // 仅 drag / axis 模式接管
    // if (!["drag", "axis"].includes(ctx.currentMode)) return;
    if (!["drag", "axis", "connect"].includes(ctx.currentMode)) return;
    if (isClickingGizmo()) return;

    downX = ev.clientX;
    downY = ev.clientY;

    // Raycast
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(
      [...meshMap.values()].filter((m) => m.visible),
      false
    );

    if (hits.length) {
      selectMesh(hits[0].object);
      return;
    }

    // 空白点击 → 等 pointerup 判断是否真正清除选中
    const onUp = (e) => {
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (dx * dx + dy * dy < CLICK_DIST * CLICK_DIST) {
        // selectMesh(null);
        /* connect 模式下单击空白不清除，由 snap 自管 */
        if (ctx.currentMode !== "connect") selectMesh(null);
      }
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointerup", onUp);
  });

  /* -------- 监听转发给 snap 模式 -------- */
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (ctx.currentMode === "connect") ctx.snapPointerMove?.(e);
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (ctx.currentMode === "connect") ctx.snapPointerUp?.(e);
  });

  /* ===========================================================
   * 6. setMode — 统一模式切换入口
   *      drag   : 拖动 (translate)
   *      axis   : XYZ 伸缩 (scale)
   *      connect: 由 connect.js 接管 → 禁用 gizmo
   *      planar : 由 planar.js  接管 → 禁用 gizmo
   * ========================================================= */
  function setMode(mode) {
    // 离开 connect / planar 时要执行各自 reset
    if (ctx.currentMode === "connect" && mode !== "connect") {
      ctx.cancelCurrentConnection?.(); // 若有未完成连接，彻底撤销
      ctx.finalizePendingConnection?.(); // 已确认的正常收尾
      ctx.resetConnectMode?.();
    }
    if (ctx.currentMode === "planar" && mode !== "planar") {
      ctx.resetPlanarMode?.(true);
    }

    switch (mode) {
      case "drag":
        tc.enabled = true;
        tc.setMode("translate");
        if (ctx.selectedMesh) tc.attach(ctx.selectedMesh);
        // ★ 保证三轴全部可见
        tc.showX = tc.showY = tc.showZ = true;
        tc.showXY = tc.showYZ = tc.showXZ = false;
        tc.showXYZ = false;
        break;

      case "axis":
        tc.enabled = true;
        tc.setMode("scale");
        if (ctx.selectedMesh) tc.attach(ctx.selectedMesh);
        tc.showX = tc.showY = tc.showZ = true;
        tc.showXY = tc.showYZ = tc.showXZ = false;
        tc.showXYZ = false;
        break;

      case "connect":
        // snap 模式完全接管，关闭 gizmo
        // tc.detach();
        // tc.enabled = false;
        // selectMesh(null);
        // ctx.resetSnapMode?.();                /* 清空 snap 内部状态 */
        // break;
        /* 连接模式也需要 TransformControls，但仅显示三轴把手            *
         * 由 snap.js 决定何时 attach 到 mesh                           */
        tc.enabled = true;
        tc.setMode("translate");
        /* 先确保不把 gizmo 绑定到随机对象，等 snap.js 选中后再 attach */
        tc.detach();
        selectMesh(null); // 清空此前 drag/axis 的选中
        ctx.resetSnapMode?.(); // snap.js 内部状态重置
        break;

      case "planar":
        tc.detach();
        tc.enabled = false;
        selectMesh(null);
        ctx.resetPlanarMode?.(); // 进入模式先清空自身状态
        break;
    }

    ctx.currentMode = mode;
  }

  /* ===========================================================
   * 7. 把公开接口挂到 ctx.publicAPI
   * ========================================================= */
  ctx.highlightPath = highlightPath;
  ctx.isolatePath = isolatePath;
  ctx.setMode = setMode;

  /**
   * 供 snap / 其他模块使用：把 TransformControls attach 在 mesh 上，
   * 同时维护 selectedMesh / component / prevPosRef 三个引用。
   */
  ctx.attachWithComponent = function (mesh, compList) {
    if (mesh) {
      tc.attach(mesh);
      ctx.selectedMesh = mesh;
      ctx.component = compList ?? ctx.findComponent(mesh.userData.pathStr);
      if (ctx.prevPosRef) ctx.prevPosRef.copy(mesh.position);
    } else {
      tc.detach();
      ctx.selectedMesh = null;
      ctx.component = [];
    }
  };

  /* ② 再同步到对外 publicAPI，保持旧接口不变 */
  Object.assign(ctx.publicAPI, {
    highlightPath,
    isolatePath,
    setMode,
    resetConnectMode: () => ctx.resetConnectMode?.(),
  });
}
