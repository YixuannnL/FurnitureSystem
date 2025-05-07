/* ────────────────────────────────────────────────────────────────────
 *  modes/snap.js
 *  ------------------------------------------------------------------
 *  “拖拽贴面‑连接”模式（取代旧 anchor‑connect）
 *
 *  ▸ 指令流程
 *      0. pointerdown 选中 meshA 及其连通分量 compMove
 *      1. pointermove 拖拽：
 *          · 按屏幕射线与相机正交面的交点移动 compMove
 *          · 实时检测 “平行 + 距离 < snapThreshold” 的面对
 *          · 命中后用 PlaneHelper 半透明高亮
 *      2. pointerup  (若存在高亮)
 *          · 平移 compMove 让两面重合
 *          · 若两面在 width/height/depth 任一维完全相等 ⇒ 自动对齐
 *          · 否则留下 1 自由轴 → 计算网格吸附 & 比例 ratio
 *          · 记录连接对象并触发 store.updateConnections()
 *
 *  公开 API
 *      ctx.resetSnapMode()    // 离开模式时自动调用
 *      ctx.snapPointerMove()  // controls.js 调用（实时拖拽时）
 *      ctx.snapPointerUp()    // controls.js 调用（pointerup）
 *
 *  依赖
 *      • ctx.meshMap / ctx.highlightPath / ctx.findComponent
 *      • faceUtils.js          (平行面检测 / 位移 / 网格吸附 / 比例)
 *      • Pinia useSceneStore   (撤销 & 设置项)
 * ──────────────────────────────────────────────────────────────────── */

import * as THREE from "three";
import { useSceneStore } from "../../../store";
import { getParallelFaces, gridSnap, ratioFromOffset } from "../../faceUtils";
import { getFaceBBox, findByPath } from "../../geometryUtils";

export function initSnapMode(ctx) {
  /* ─────────────── 共享引用与配置 ─────────────── */
  const store = useSceneStore();
  const domEl = ctx.renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();

  /* ─────────────── 运行时状态 ─────────────── */
  let dragging = false;
  let orbitPrevEnabled = true; // 记录拖拽前 orbit 的状态
  /** @type {THREE.Mesh|null}   主选中 meshA */
  let meshA = null;
  /** @type {string[]}          compMove 内所有 pathStr */
  let compMove = [];
  /** 起点世界坐标 (PointerDown 射线与 dragPlane 交点) */
  let dragStart = new THREE.Vector3();
  let dragPlane = new THREE.Plane(); // 垂直于相机视线
  let slidingMinOff = 0,
    slidingMaxOff = 0; // 二段滑动区间

  /** 高亮缓存 */
  /** @type {THREE.PlaneHelper[]} */
  const helpers = [];

  /** 当前检测到的候选面对 */
  let candidate = null;
  /*
      candidate = {
        meshA, faceA,            // faceA,faceB 结构来自 faceUtils
        meshB, faceB,
        delta: Vector3,          // 让两面重合的 world Δ
        commonAxis: 'x'|'y'|'z'|null   // 自动对齐后剩余自由轴
      }
    */
  /* ---------- ★★  二段式滑动阶段状态 ---------- */
  let slidingReady = false; // 已经贴面、等待第二次拖动
  let slidingAxis = null; // 'x'|'y'|'z'
  let slidingConn = null; // 预生成的连接对象（实时更新 ratio）
  let slidingComp = []; // compMove 列表
  let slidingCenterB = 0; // faceB.center[axis]，常数
  let faceBLenU = 0,
    faceBLenV = 0; // 供顶/底/中吸附
  let lenAaxis = 0,
    lenBaxis = 0; // 两物体在滑动轴方向的尺寸
  let slidingDragging = false; // 第二段拖拽标记
  const SNAP_T = () => store.snapThreshold;

  /* ================================================================
   *  utils：保证连接唯一
   * ============================================================= */
  function withUniqueConn(array, objA, objB, newConn) {
    /* 过滤掉已经连接同一对板件的旧条目（忽略顺序） */
    const next = array.filter((c) => {
      const ks = Object.keys(c);
      return !(ks.includes(objA) && ks.includes(objB));
    });
    next.push(newConn);
    return next;
  }

  /* —— 小工具：十进制 → 最简分数（分母 ≤20） —— */
  function dec2frac(dec) {
    if (Math.abs(dec) < 1e-4) return "0";
    for (let d = 1; d <= 20; d++) {
      const n = Math.round(dec * d);
      if (Math.abs(dec - n / d) < 1e-4) {
        return `${n}/${d}`;
      }
    }
    return dec.toFixed(3);
  }

  /* 让下一帧 objectChange 的 delta = 0 */
  function syncPrev(mesh) {
    if (ctx.prevPosRef) ctx.prevPosRef.copy(mesh.position);
  }

  function restoreOrbit() {
    if (ctx.orbit) ctx.orbit.enabled = true;
  }

  /* === 工具函数 ==================================================== */
  function clearHelpers() {
    helpers.forEach((h) => ctx.scene.remove(h));
    helpers.length = 0;
    candidate = null;
    slidingReady = false;
    slidingAxis = null;
    slidingConn = null;
    slidingComp = [];
    slidingDragging = false;
  }

  /* ——— 在面实际位置画矩形轮廓 ——— */
  function addRectHelper(face, color) {
    const geo = new THREE.BufferGeometry();
    const offset = face.normal.clone().setLength(1); // 1 mm 前移
    const pA = face.center
      .clone()
      .addScaledVector(face.uDir, face.uLen / 2)
      .addScaledVector(face.vDir, face.vLen / 2)
      .add(offset);
    const pB = face.center
      .clone()
      .addScaledVector(face.uDir, -face.uLen / 2)
      .addScaledVector(face.vDir, face.vLen / 2)
      .add(offset);
    const pC = face.center
      .clone()
      .addScaledVector(face.uDir, -face.uLen / 2)
      .addScaledVector(face.vDir, -face.vLen / 2)
      .add(offset);
    const pD = face.center
      .clone()
      .addScaledVector(face.uDir, face.uLen / 2)
      .addScaledVector(face.vDir, -face.vLen / 2)
      .add(offset);
    const verts = new Float32Array([
      ...pA.toArray(),
      ...pB.toArray(),
      ...pC.toArray(),
      ...pD.toArray(),
      ...pA.toArray(),
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    ctx.scene.add(line);
    helpers.push(line);
  }

  /** 将 client 坐标转为 NDC */
  function toNDC(ev) {
    const rect = domEl.getBoundingClientRect();
    mouseNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** 重新计算 compMove 的 faceBBox（在 XYZ 伸缩等后已刷新 userData） */
  // function refreshCompFaceBBox() {
  //     compMove.forEach(p => {
  //         const m = ctx.meshMap.get(p);
  //         m?.updateMatrixWorld(true);
  //     });
  // }
  function refreshCompFaceBBox() {
    compMove.forEach((p) => {
      const m = ctx.meshMap.get(p);
      if (!m) return;
      m.updateMatrixWorld(true); // 矩阵
      /* 关键：实时重算六面数据 */
      m.userData.faceBBox = getFaceBBox(m);
    });
  }

  /* ===  新增：引用 TransformControls 及其事件钩子  ================= */
  const tc = ctx.transformCtrls;
  let tcDragging = false; // 当前是否由 gizmo 拖动
  let adjusting = false; // snap.js 内部自动补偿位移保护锁
  let lastPos = new THREE.Vector3(); // 上一帧 gizmo 位姿

  /* -------------------------------------------------------- *
   *  当 gizmo 抓取开始 / 结束 ————— 记录快照 & 完成提交
   * -------------------------------------------------------- */
  tc.addEventListener("dragging-changed", (e) => {
    if (ctx.currentMode !== "connect") return;
    tcDragging = e.value; // true = 开始，false = 结束

    /* ===== 拖拽结束 ===== */
    if (!tcDragging) {
      /* ---------- ①  二段拖拽结束  ---------- */
      if (slidingReady) {
        store.updateConnections([...store.connections]); // ratio 已写入
        slidingReady = false;

        /* 复位 gizmo / 选中 */
        if (ctx.transformCtrls) {
          const t = ctx.transformCtrls;
          t.detach();
          t.showX = t.showY = t.showZ = true;
          t.showXY = t.showYZ = t.showXZ = t.showXYZ = false;
        }
        ctx.selectedMesh = null;
        clearHelpers();
        ctx.highlightPath([]);
        return; // 全部收尾 → 退出
      }

      /* ---------- ②  第一段贴面完成 ---------- */
      if (candidate) {
        finalizeCandidate(); // 可能进入二段滑动

        /* 若 **没有** 进入二段滑动 ⇒ 立即做收尾 */
        if (!slidingReady) {
          if (ctx.transformCtrls) {
            const t = ctx.transformCtrls;
            t.detach();
            t.showX = t.showY = t.showZ = true;
            t.showXY = t.showYZ = t.showXZ = t.showXYZ = false;
          }
          ctx.selectedMesh = null;
          clearHelpers();
          ctx.highlightPath([]);
        }
        return;
      }

      /* ---------- ③ 只是普通拖拽 ---------- */
      clearHelpers();
      ctx.highlightPath([]);
    }
  });

  /* -------------------------------------------------------- *
   *  gizmo 拖动过程：实时检测平行面 / 二段滑动
   * -------------------------------------------------------- */
  tc.addEventListener("objectChange", () => {
    if (ctx.currentMode !== "connect" || !tcDragging || adjusting) return;
    if (!ctx.selectedMesh) return;

    /* —— 和 controls.js 一样，同步整组 compMove —— 已由 controls.js 完成
     *    这里只做吸附检测 / 二段滑动逻辑
     */

    if (slidingReady) {
      updateSliding(); // 二段滑动实时 ratio 更新
    } else {
      updateCandidate(); // 第一段拖拽实时检测面对
    }
  });

  /* === pointer 事件 ================================================= */

  /** ----- pointerdown : 选中组件并建立拖拽平面 ----- */
  function onPointerDown(ev) {
    if (ctx.currentMode !== "connect") return; // 名称沿用 "connect"
    if (ev.button !== 0) return; // 左键

    /* 若点中的是 gizmo 把手则完全交给 TransformControls */
    if (ctx.transformCtrls && ctx.transformCtrls.axis) return;

    /* ---------- ★★ 如处于二段滑动准备态，改为启动单轴拖动 ---------- */
    if (slidingReady) {
      /* 只要点中 slidingComp 里的任何 mesh 就进入拖动 */
      toNDC(ev);
      raycaster.setFromCamera(mouseNDC, ctx.camera);
      const hits = raycaster.intersectObjects(
        slidingComp.map((p) => ctx.meshMap.get(p)),
        false
      );

      if (hits.length) {
        // slidingDragging = true;

        /* 拖动平面同第一段：相机正对面 */
        dragPlane.setFromNormalAndCoplanarPoint(
          ctx.camera.getWorldDirection(new THREE.Vector3()),
          hits[0].point
        );
        dragStart.copy(hits[0].point);

        /* 关闭 OrbitControls */
        orbitPrevEnabled = ctx.orbit.enabled;
        ctx.orbit.enabled = false;

        domEl.setPointerCapture(ev.pointerId);
        return;
      }
      /* 如果没点到组件则视为取消操作 */
      clearHelpers();
      ctx.highlightPath([]);
      restoreOrbit();
      return;
    }

    toNDC(ev);
    raycaster.setFromCamera(mouseNDC, ctx.camera);
    const hits = raycaster.intersectObjects(
      [...ctx.meshMap.values()].filter((m) => m.visible),
      false
    );
    if (!hits.length) return;

    meshA = hits[0].object;
    ctx.highlightPath(meshA.userData.pathArr);

    /* 连通分量作为整体移动 */
    compMove = ctx.findComponent(meshA.userData.pathStr);
    refreshCompFaceBBox();

    /* 构建拖拽平面（摄像机前方平行面） */
    dragPlane.setFromNormalAndCoplanarPoint(
      ctx.camera.getWorldDirection(new THREE.Vector3()),
      hits[0].point
    );
    dragStart.copy(hits[0].point);

    // dragging = true;
    clearHelpers();

    /* -------------- Gizmo 设置：仅三轴把手 ---------------- */
    if (ctx.transformCtrls) {
      const t = ctx.transformCtrls;
      t.attach(meshA); // 绑定 gizmo
      t.setMode("translate");
      t.showX = t.showY = t.showZ = true;
      t.showXY = t.showYZ = t.showXZ = t.showXYZ = false; // 关闭平面/中心
    }
    ctx.selectedMesh = meshA; // ← 让 objectChange 能正常工作

    /* 不再启用旧的自由拖拽平面 —— 删除 dragging = true */
    clearHelpers();

    /* 撤销栈：先拍快照，避免 pointermove 每帧拍 */
    store.recordSnapshot();

    /* ---------- 关闭 OrbitControls ---------- */
    // if (ctx.orbit) {
    //   orbitPrevEnabled = ctx.orbit.enabled;
    //   ctx.orbit.enabled = false;
    // }

    // domEl.setPointerCapture(ev.pointerId);
  }

  /** ----- pointermove : 拖拽 & 面对检测 ----- */
  function onPointerMove(ev) {
    // /* ---------- ★★ 滑动阶段的 pointermove ---------- */
    // if (slidingDragging) {
    //   toNDC(ev);
    //   raycaster.setFromCamera(mouseNDC, ctx.camera);
    //   const pos = new THREE.Vector3();
    //   raycaster.ray.intersectPlane(dragPlane, pos);
    //   if (!pos) return;

    //   const delta = pos.clone().sub(dragStart);
    //   dragStart.copy(pos);

    //   const axis = slidingAxis;
    //   const step = store.gridStep;

    //   /* 只保留该轴位移 */
    //   const move = delta[axis];
    //   if (Math.abs(move) < 1e-6) return;

    //   /* 先整组平移 */
    //   slidingComp.forEach((p) => {
    //     const m = ctx.meshMap.get(p);
    //     if (m) m.position[axis] += move;
    //   });

    //   /* —— 计算中心差值 & 吸附 —— */
    //   const meshA0 = ctx.meshMap.get(slidingComp[0]);
    //   // const ctrA = new THREE.Box3().setFromObject(meshA0).getCenter(new THREE.Vector3())[axis];
    //   // let offset = ctrA - slidingCenterB;                // A 相对 B 的位移

    //   // /* a) 端点 / 中点吸附  —— 优先级最高 */
    //   // const halfA = lenAaxis * 0.5;
    //   // const halfB = lenBaxis * 0.5;
    //   // const targets = [-halfB + halfA, 0, halfB - halfA];  // Bottom / Center / Top
    //   // let snapped = null;
    //   // for (const t of targets) {
    //   //     if (Math.abs(offset - t) < SNAP_T()) { snapped = t; break; }
    //   // }

    //   // /* b) 网格吸附  */
    //   // if (snapped === null) {
    //   //     const g = gridSnap(offset, step);
    //   //     if (Math.abs(offset - g) < SNAP_T()) snapped = g;
    //   // }

    //   // /* c) 若需吸附 → 计算补偿位移 */
    //   // if (snapped !== null && Math.abs(snapped - offset) > 1e-6) {
    //   //     const need = snapped - offset;
    //   //     slidingComp.forEach(p => {
    //   //         const m = ctx.meshMap.get(p);
    //   //         if (m) m.position[axis] += need;
    //   //     });
    //   //     offset = snapped;
    //   //     /* 关键：更新 dragStart，让下一帧以新基准计算，防抖动 */
    //   //     dragStart[axis] += need;
    //   // }
    //   const ctrA = new THREE.Box3()
    //     .setFromObject(meshA0)
    //     .getCenter(new THREE.Vector3())[axis];
    //   let offset = ctrA - slidingCenterB; // A 相对 B 的位移

    //   /* ---------- A) 限制在合法区间 ---------- */
    //   const halfA = lenAaxis * 0.5;
    //   const halfB = lenBaxis * 0.5;
    //   let minOff = -halfB + halfA;
    //   let maxOff = halfB - halfA;
    //   /* 若 A 比 B 大，则无法滑动，夹为 0 */
    //   if (minOff > maxOff) minOff = maxOff = 0;

    //   if (offset < minOff) offset = minOff;
    //   if (offset > maxOff) offset = maxOff;

    //   /* ---------- B) 端点 / 中点 / 网格吸附 ---------- */
    //   const snapTargets = [minOff, 0, maxOff]; // Bottom / Center / Top
    //   let snapped = null;
    //   for (const t of snapTargets) {
    //     if (Math.abs(offset - t) < SNAP_T()) {
    //       snapped = t;
    //       break;
    //     }
    //   }
    //   if (snapped === null) {
    //     const g = gridSnap(offset, step);
    //     if (Math.abs(offset - g) < SNAP_T()) snapped = g;
    //   }
    //   if (snapped !== null)
    //     offset = THREE.MathUtils.clamp(snapped, minOff, maxOff);

    //   /* ---------- C) 把 compMove 校正到 offset ---------- */
    //   const need = offset - (ctrA - slidingCenterB);
    //   if (Math.abs(need) > 1e-6) {
    //     slidingComp.forEach((p) => {
    //       const m = ctx.meshMap.get(p);
    //       if (m) m.position[axis] += need;
    //     });
    //     /* 更新 dragStart —— 防止下一帧累积误差 / 抖动 */
    //     dragStart[axis] += need;
    //   }

    //   /* ---------- D) ratio 实时刷新 ---------- */
    //   const axisRange = lenBaxis - lenAaxis; // 有效可移动长度
    //   const ratioDec = axisRange < 1e-3 ? 0 : (offset - minOff) / axisRange; // 0 at Bottom, 1 at Top
    //   slidingConn.ratio = dec2frac(ratioDec);
    //   /* —— 实时写 ratio，右侧面板自动刷新 —— */
    //   return;
    // }

    /* ---------- ★★ 第一段拖拽检测 ---------- */
    if (!dragging) return;
    toNDC(ev);
    raycaster.setFromCamera(mouseNDC, ctx.camera);
    const pos = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, pos);

    if (!pos) return;
    const delta = pos.clone().sub(dragStart);
    dragStart.copy(pos); // 更新基准点

    /* 平移 compMove 整体 */
    compMove.forEach((p) => {
      const m = ctx.meshMap.get(p);
      if (m) m.position.add(delta);
    });

    /* --- 实时面‑面检测 & 高亮 ----------------------- */
    clearHelpers();
    refreshCompFaceBBox();

    const snapT = store.snapThreshold;
    let best = null;
    let bestDist = snapT;

    compMove.forEach((pathStr) => {
      const mA = ctx.meshMap.get(pathStr);
      if (!mA) return;

      const facesA = mA.userData.faceBBox; // 每次 stretch 都已刷新
      ctx.meshMap.forEach((mB, pB) => {
        if (compMove.includes(pB) || !mB.visible) return;
        // const facesB = mB.userData.faceBBox;
        /* 保证目标 mesh 的面数据始终最新 */
        mB.updateMatrixWorld(true);
        mB.userData.faceBBox = getFaceBBox(mB);
        const facesB = mB.userData.faceBBox;

        const pairs = getParallelFaces(facesA, facesB, snapT);
        // console.log("pairs:", pairs);
        pairs.forEach((pair) => {
          if (pair.dist < bestDist) {
            best = { ...pair, meshA: mA, meshB: mB };
            bestDist = pair.dist;
          }
        });
      });
    });

    if (best) {
      candidate = best;
      addRectHelper(best.faceA, 0x00ff00); // 绿 → meshA
      addRectHelper(best.faceB, 0xff8800); // 橙 → meshB
    }
  }

  /** ----- pointerup : 若有候选则建立连接 ----- */
  function onPointerUp(ev) {
    /* ---------- ★★ 第二段滑动结束 ---------- */
    // if (slidingDragging) {
    //   slidingDragging = false;
    //   domEl.releasePointerCapture(ev.pointerId);

    //   // /* 最终提交（ratio 已在 pointermove 中写入） */
    //   // store.updateConnections(
    //   //     [...store.connections.filter(c => c !== slidingConn), slidingConn]
    //   // );
    //   /* 最终提交：拷贝当前数组即可（ratio 已写入） */
    //   store.updateConnections([...store.connections]);

    //   clearHelpers();
    //   ctx.highlightPath([]);
    //   restoreOrbit();
    //   return;
    // }

    /* ---------- ★★ 第一段拖拽结束 ---------- */
    if (!dragging) return;
    dragging = false;
    domEl.releasePointerCapture(ev.pointerId);

    if (!candidate) {
      clearHelpers();
      ctx.highlightPath([]);
      restoreOrbit(); // ★ 始终恢复 OrbitControls
      return; // 无贴面
    }

    /* 1. 让 compMove 与目标面重合 */
    compMove.forEach((p) => {
      const m = ctx.meshMap.get(p);
      if (m) m.position.add(candidate.delta);
    });

    /* ---------- ★ 平面内自动对齐 ---------- */
    let deltaPlane = new THREE.Vector3(); // ← 提升作用域，外层可见
    {
      const EPS = 1; // 1 mm 判定阈

      /* A 面中心已平移到 A'，需使用新中心参与计算 */
      const centerA = candidate.faceA.center.clone().add(candidate.delta);
      const centerB = candidate.faceB.center.clone();

      const { uDir, vDir, uLen, vLen } = candidate.faceA;
      const sameU = Math.abs(uLen - candidate.faceB.uLen) < EPS;
      const sameV = Math.abs(vLen - candidate.faceB.vLen) < EPS;

      /* 计算沿 u/v 方向需要补偿的平移量（让中心重合） */
      // const deltaPlane = new THREE.Vector3();
      if (sameU) {
        const du = centerB.clone().sub(centerA).dot(uDir);
        deltaPlane.addScaledVector(uDir, du);
      }
      if (sameV) {
        const dv = centerB.clone().sub(centerA).dot(vDir);
        deltaPlane.addScaledVector(vDir, dv);
      }

      /* 把补偿量同步到 compMove 整体 */
      if (deltaPlane.lengthSq() > 1e-6) {
        compMove.forEach((p) => {
          const m = ctx.meshMap.get(p);
          if (m) m.position.add(deltaPlane);
        });
      }
    }

    /* 2. 自动对齐 & 网格吸附 ------------------------ */
    let ratio = null;
    let axis = candidate.commonAxis; // 剩余自由轴 (可能为 null)

    if (axis) {
      /* 沿该轴做网格吸附 (gridStep) */
      const step = store.gridStep;

      const centerA = candidate.faceA.center
        .clone()
        .add(candidate.delta) // 法向平移
        .add(deltaPlane); // 平面贴边补偿（可能是 0 向量）
      const centerB = candidate.faceB.center.clone();

      const offset = centerA[axis] - centerB[axis];
      const snapped = gridSnap(offset, step);

      const deltaSnap = snapped - offset;
      if (Math.abs(deltaSnap) > 1e-3) {
        compMove.forEach((p) => {
          const m = ctx.meshMap.get(p);
          if (m) m.position[axis] += deltaSnap;
        });
        syncPrev(candidate.meshA); // ← 新增
      }

      /* 计算比例 offset / axisLen */
      const axisLen = candidate.faceB.axisLen; // faceUtils 提供
      ratio = ratioFromOffset(snapped, axisLen);
    }

    /* 3. 生成连接对象 ------------------------------ */
    const objA = candidate.meshA.userData.pathArr.at(-1);
    const objB = candidate.meshB.userData.pathArr.at(-1);

    const connObj = {
      [objA]: "",
      [objB]: "",
      faceA: candidate.faceA.name, // 'Left' / 'Top' / ...
      faceB: candidate.faceB.name,
      axis, // null = 已完全对齐
      ratio: axis ? "0" : null, // ★ 初次进入滑动阶段 → 起点 0
    };

    /* ---------- ★★ 若还有 1 自由轴：进入滑动准备态 ---------- */
    if (axis) {
      slidingReady = true;
      slidingAxis = axis;
      slidingConn = connObj;
      slidingComp = [...compMove];
      slidingCenterB = candidate.faceB.center[axis];
      faceBLenU = candidate.faceB.uLen;
      faceBLenV = candidate.faceB.vLen;

      store.updateConnections([...store.connections, connObj], true);

      /* 重要：让 slidingConn 指向 **数组里的那份对象**（避免引用失配） */
      slidingConn = store.connections.find((c) => {
        const k = Object.keys(c);
        return k.includes(objA) && k.includes(objB);
      });

      /* 计算沿 slidingAxis 的尺寸（用包围盒） */
      {
        const vec = new THREE.Vector3();
        const meshA0 = ctx.meshMap.get(slidingComp[0]);
        const boxA = new THREE.Box3().setFromObject(meshA0);
        boxA.getSize(vec);
        lenAaxis = vec[slidingAxis];

        const meshB0 = candidate.meshB;
        const boxB = new THREE.Box3().setFromObject(meshB0);
        boxB.getSize(vec);
        lenBaxis = vec[slidingAxis];
      }

      /* 保留高亮，允许转视角查看 */
      restoreOrbit();
      return;
    }

    /* ---------- ★★ 0 自由度：一次性完成 ---------- */
    store.updateConnections([...store.connections, connObj]);

    clearHelpers();
    ctx.highlightPath([]);
    restoreOrbit();
  }

  /* === 重置接口（切模式 / 撤销） ============================ */
  function resetSnapMode() {
    dragging = false;
    meshA = null;
    compMove = [];
    clearHelpers();
    // if (ctx.orbit) ctx.orbit.enabled = orbitPrevEnabled;
    restoreOrbit(); // ★ 切模式必开启旋转
  }

  /* ------------------------------------------------------------------ *
   *  updateCandidate  —— 选中第一面对后，轴向拖动实时检测最佳吸附面
   * ------------------------------------------------------------------ */
  function updateCandidate() {
    clearHelpers();
    refreshCompFaceBBox();

    const snapT = store.snapThreshold;
    let best = null,
      bestDist = snapT;

    compMove.forEach((pathStr) => {
      const mA = ctx.meshMap.get(pathStr);
      if (!mA) return;
      const facesA = mA.userData.faceBBox;

      ctx.meshMap.forEach((mB, pB) => {
        if (compMove.includes(pB) || !mB.visible) return;
        mB.updateMatrixWorld(true);
        mB.userData.faceBBox = getFaceBBox(mB);
        const facesB = mB.userData.faceBBox;

        const pairs = getParallelFaces(facesA, facesB, snapT);
        pairs.forEach((pair) => {
          if (pair.dist < bestDist) {
            best = { ...pair, meshA: mA, meshB: mB };
            bestDist = pair.dist;
          }
        });
      });
    });

    if (best) {
      candidate = best;
      addRectHelper(best.faceA, 0x00ff00); // 绿
      addRectHelper(best.faceB, 0xff8800); // 橙
    }
  }

  /* ------------------------------------------------------------------ *
   *  updateSliding —— 二段滑动时沿单轴实时吸附 & ratio 更新
   * ------------------------------------------------------------------ */
  function updateSliding() {
    if (!slidingReady || !slidingAxis || !slidingComp.length) return;

    const axis = slidingAxis;
    const step = store.gridStep;
    const meshA = ctx.meshMap.get(slidingComp[0]);
    if (!meshA) return;

    /* 当前偏移（中心差值） */
    const ctrA = new THREE.Box3()
      .setFromObject(meshA)
      .getCenter(new THREE.Vector3())[axis];
    let offset = ctrA - slidingCenterB;

    /* ---------- A) 合法区间 ---------- */
    const halfA = lenAaxis * 0.5;
    const halfB = lenBaxis * 0.5;
    const minOff = -(halfA + halfB);
    const maxOff = halfA + halfB;
    if (offset < minOff) offset = minOff;
    if (offset > maxOff) offset = maxOff;

    /* ---------- B) 端点 / 中点 / 网格吸附 ---------- */
    const snapTargets = [minOff, 0, maxOff];
    let snapped = null;
    for (const t of snapTargets) {
      if (Math.abs(offset - t) < SNAP_T()) {
        snapped = t;
        break;
      }
    }
    if (snapped === null) {
      const g = gridSnap(offset, step);
      if (Math.abs(offset - g) < SNAP_T()) snapped = g;
    }
    if (snapped !== null)
      offset = THREE.MathUtils.clamp(snapped, minOff, maxOff);

    /* ---------- C) 把 compMove 校正到 offset ---------- */
    const need = offset - (ctrA - slidingCenterB);
    if (Math.abs(need) > 1e-6) {
      adjusting = true;
      slidingComp.forEach((p) => {
        const m = ctx.meshMap.get(p);
        if (m) m.position[axis] += need;
      });
      adjusting = false;
      syncPrev(meshA); // 防止下一帧反拖
    }

    /* ---------- D) ratio 实时刷新 ---------- */
    const axisRange = lenAaxis + lenBaxis; // always >0
    const ratioDec = (offset - minOff) / axisRange; // ∈[0,1]
    slidingConn.ratio = dec2frac(ratioDec);
  }

  /* ------------------------------------------------------------------ *
   *  finalizeCandidate()
   *  ---------------------------------------------------------------
   *  在 gizmo 轴向拖动 **结束** 时调用，功能与旧 pointerup
   *  逻辑完全一致：把 compMove 贴到目标面 → 自动平面对齐 →
   *  若还剩 1 自由轴则进入二段滑动，否则直接写入连接。
   * ------------------------------------------------------------------ */
  function finalizeCandidate() {
    if (!candidate) return;

    /* === 1. 让 compMove 整体平移到目标面 ========================== */
    compMove.forEach((p) => {
      const m = ctx.meshMap.get(p);
      if (m) m.position.add(candidate.delta);
    });
    syncPrev(candidate.meshA); // ← 新增

    /* === 2. 同平面内自动对齐 (uDir / vDir) ======================== */
    const EPS = 1; // mm
    const deltaPlane = new THREE.Vector3();

    const centerA = candidate.faceA.center.clone().add(candidate.delta);
    const centerB = candidate.faceB.center.clone();

    const { uDir, vDir, uLen, vLen } = candidate.faceA;
    const sameU = Math.abs(uLen - candidate.faceB.uLen) < EPS;
    const sameV = Math.abs(vLen - candidate.faceB.vLen) < EPS;

    if (sameU) {
      const du = centerB.clone().sub(centerA).dot(uDir);
      deltaPlane.addScaledVector(uDir, du);
    }
    if (sameV) {
      const dv = centerB.clone().sub(centerA).dot(vDir);
      deltaPlane.addScaledVector(vDir, dv);
    }

    if (deltaPlane.lengthSq() > 1e-6) {
      compMove.forEach((p) => {
        const m = ctx.meshMap.get(p);
        if (m) m.position.add(deltaPlane);
      });
      syncPrev(candidate.meshA); // ← 新增
    }

    /* === 3. 网格吸附 & 决定是否进入二段滑动 ======================= */
    let axis = candidate.commonAxis; // 可能为 null（已经全对齐）

    if (axis) {
      const step = store.gridStep;
      const centerA2 = candidate.faceA.center
        .clone()
        .add(candidate.delta)
        .add(deltaPlane);
      const centerB2 = candidate.faceB.center.clone();

      let offset = centerA2[axis] - centerB2[axis];
      const snap = gridSnap(offset, step);
      const delta = snap - offset;

      if (Math.abs(delta) > 1e-3) {
        compMove.forEach((p) => {
          const m = ctx.meshMap.get(p);
          if (m) m.position[axis] += delta;
        });
        offset = snap; // 更新为吸附后值
        syncPrev(candidate.meshA); // ← 新增
      }

      /* 此时仍剩 1 自由轴 —— 比例 ratio 延后到二段滑动实时更新 */
    }

    /* === 4. 生成连接对象 ========================================= */
    const objA = candidate.meshA.userData.pathArr.at(-1);
    const objB = candidate.meshB.userData.pathArr.at(-1);

    const connObj = {
      [objA]: "",
      [objB]: "",
      faceA: candidate.faceA.name,
      faceB: candidate.faceB.name,
      axis: axis, // null ⇢ 已完全对齐
      ratio: axis ? "0" : null,
    };

    /* ---------- 4‑A. 剩 1 自由轴 → 进入二段滑动 ------------------ */
    if (axis) {
      slidingReady = true;
      slidingAxis = axis;
      slidingConn = connObj;
      slidingComp = [...compMove];
      slidingCenterB = candidate.faceB.center[axis];
      faceBLenU = candidate.faceB.uLen;
      faceBLenV = candidate.faceB.vLen;

      /* 把新连接推入数组但 skipUndo=true（快照已拍） */
      //   store.updateConnections([...store.connections, connObj], true);
      store.updateConnections(
        withUniqueConn(store.connections, objA, objB, connObj),
        true // skipUndo，快照已拍
      );

      /* 让 slidingConn 引用数组里真正那一份对象 */
      slidingConn = store.connections.find((c) => {
        const k = Object.keys(c);
        return k.includes(objA) && k.includes(objB);
      });

      /* 记录 A、B 在滑动轴上的尺寸，供 updateSliding() 计算比例 */
      const vec = new THREE.Vector3();
      const meshA0 = ctx.meshMap.get(slidingComp[0]);
      const boxA = new THREE.Box3().setFromObject(meshA0).getSize(vec);
      lenAaxis = vec[slidingAxis];

      const boxB = new THREE.Box3().setFromObject(candidate.meshB).getSize(vec);
      lenBaxis = vec[slidingAxis];

      /* ----------- 计算合法区间 ----------- */
      const halfA = lenAaxis * 0.5;
      const halfB = lenBaxis * 0.5;
      slidingMinOff = -(halfA + halfB); // 刚好“左边缘接触”
      slidingMaxOff = halfA + halfB; // 右边缘接触

      /* ---------- FIX‑BEGIN : Gizmo 仅显示自由轴 ---------- */
      if (ctx.transformCtrls) {
        const t = ctx.transformCtrls;
        t.attach(candidate.meshA); // 确保绑定
        t.showX = axis === "x";
        t.showY = axis === "y";
        t.showZ = axis === "z";
        t.showXY = t.showYZ = t.showXZ = t.showXYZ = false;
        t.setMode("translate");
        t.update();
      }
      /* ---------- FIX‑END --------------------------------- */

      restoreOrbit(); // 允许用户旋转视图
      return; // 重要：保留 helper + 高亮
    }

    /* ---------- 4‑B. 没自由轴 → 一次性完成 ----------------------- */
    // store.updateConnections([...store.connections, connObj]);
    store.updateConnections(
      withUniqueConn(store.connections, objA, objB, connObj)
    );

    clearHelpers();
    ctx.highlightPath([]);
    restoreOrbit();
  }

  /* === 挂载事件 & 公共 API ======================== */
  domEl.addEventListener("pointerdown", onPointerDown);
  domEl.addEventListener("pointermove", onPointerMove);
  domEl.addEventListener("pointerup", onPointerUp);

  /* 供 controls.js 转发 —— 保持旧结构兼容 */
  ctx.snapPointerMove = onPointerMove;
  ctx.snapPointerUp = onPointerUp;

  ctx.resetSnapMode = resetSnapMode;
  ctx.publicAPI.resetSnapMode = resetSnapMode;
}
