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
  let slidingAxes = [];
  let slidingConn = null; // 预生成的连接对象（实时更新 ratio）
  let slidingComp = []; // compMove 列表
  let slidingCenterB = 0; // faceB.center[axis]，常数
  let lenAaxis = 0,
    lenBaxis = 0; // 两物体在滑动轴方向的尺寸
  let slidingDragging = false; // 第二段拖拽标记
  const SNAP_T = () => store.snapThreshold;

  /**
   * 在 compMove 内部与全场景可见 Mesh 比较，找到距离最近、
   * 且满足平行&重叠条件的面对 pair。
   * @returns {null|{ meshA, meshB, faceA, faceB, delta, commonAxis }}
   */
  function findBestCandidate() {
    const snapT = store.snapThreshold;
    let best = null;
    let bestDist = snapT;

    compMove.forEach((pathStr) => {
      const mA = ctx.meshMap.get(pathStr);
      if (!mA) return;
      const facesA = mA.userData.faceBBox;

      ctx.meshMap.forEach((mB, pB) => {
        if (compMove.includes(pB) || !mB.visible) return;
        mB.updateMatrixWorld(true);
        mB.userData.faceBBox = getFaceBBox(mB);

        getParallelFaces(facesA, mB.userData.faceBBox, snapT).forEach(
          (pair) => {
            if (pair.dist < bestDist) {
              best = { ...pair, meshA: mA, meshB: mB };
              bestDist = pair.dist;
            }
          }
        );
      });
    });
    return best;
  }

  /**
   * 将当前 candidate 应用为正式连接。
   * 负责：
   *   1. 把 compMove 贴合到 faceB
   *   2. 在同一平面内自动对齐（u/v 方向）
   *   3. 若仍有 1 自由轴：进入“二段滑动”准备态
   *      否则：直接写入连接并收尾
   *
   * @param {object|null} cand 由 findBestCandidate() 生成的最佳匹配
   */
  function applyCandidate(cand) {
    /* ---------- 基本防御 ---------- */
    if (!cand) {
      clearHelpers();
      ctx.highlightPath([]);
      restoreOrbit();
      return;
    }
    candidate = cand; // 挂到外层方便调试

    /* ================================================================
     * 1. 让 compMove 整体沿 candidate.delta 贴到 faceB
     * ============================================================= */
    compMove.forEach((p) => {
      const m = ctx.meshMap.get(p);
      if (m) m.position.add(cand.delta);
    });
    syncPrev(cand.meshA); // 重置 prevPos 防止 gizmo 抖动

    /* ================================================================
     * 2. 同平面内自动对齐（当 uLen / vLen 完全一致时）
     * ============================================================= */
    const EPS = 1; // 1 mm 判定阈
    const deltaPlane = new THREE.Vector3();

    const centerA = cand.faceA.center.clone().add(cand.delta); // 移动后的 A
    const centerB = cand.faceB.center.clone();

    const { uDir, vDir, uLen, vLen } = cand.faceA;
    const sameU = Math.abs(uLen - cand.faceB.uLen) < EPS;
    const sameV = Math.abs(vLen - cand.faceB.vLen) < EPS;

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
      syncPrev(cand.meshA);
    }

    /* ================================================================
     * 3. 判定剩余自由轴
     * ============================================================= */
    // helper – 把面内 u/v 向量映射到主轴
    const axisOfDir = (v) => {
      const ax = Math.abs(v.x),
        ay = Math.abs(v.y),
        az = Math.abs(v.z);
      return ax > ay && ax > az ? "x" : ay > az ? "y" : "z";
    };

    const freeAxes = [];
    if (!sameU) freeAxes.push(axisOfDir(cand.faceA.uDir)); // u 轴
    if (!sameV) freeAxes.push(axisOfDir(cand.faceA.vDir)); // v 轴

    const objA = cand.meshA.userData.pathArr.at(-1);
    const objB = cand.meshB.userData.pathArr.at(-1);

    /* ===============================================================
     * 4-A. 无自由轴 —— 直接写入连接
     * ============================================================= */
    if (freeAxes.length === 0) {
      const connObj = {
        [objA]: "",
        [objB]: "",
        faceA: cand.faceA.name,
        faceB: cand.faceB.name,
      };
      store.updateConnections(
        withUniqueConn(store.connections, objA, objB, connObj)
      );
      clearHelpers();
      ctx.highlightPath([]);
      restoreOrbit();
      return;
    }

    /* ===============================================================
     * 4-B. 单自由轴 —— 进入“一维滑动”阶段
     * ============================================================= */
    if (freeAxes.length === 1) {
      const axis = freeAxes[0];
      slidingReady = true;
      slidingAxis = axis;
      slidingAxes = [axis];
      slidingComp = [...compMove];
      slidingCenterB = cand.faceB.center[axis];

      // 长度数据
      const vec = new THREE.Vector3();
      lenAaxis = new THREE.Box3().setFromObject(cand.meshA).getSize(vec)[axis];
      lenBaxis = new THREE.Box3().setFromObject(cand.meshB).getSize(vec)[axis];

      // 连接对象
      slidingConn = {
        [objA]: "",
        [objB]: "",
        faceA: cand.faceA.name,
        faceB: cand.faceB.name,
        axis,
        ratio: "0",
      };
      store.updateConnections(
        withUniqueConn(store.connections, objA, objB, slidingConn),
        true
      );

      /* gizmo 只留这一根轴 */
      if (ctx.transformCtrls) {
        const t = ctx.transformCtrls;
        t.attach(cand.meshA);
        t.setMode("translate");
        t.showX = axis === "x";
        t.showY = axis === "y";
        t.showZ = axis === "z";
        t.showXY = t.showYZ = t.showXZ = t.showXYZ = false;
      }
      restoreOrbit();
      return;
    }

    /* ===============================================================
     * 4-C. 双自由轴 —— 进入“平面滑动”阶段
     * ============================================================= */
    if (freeAxes.length === 2) {
      slidingReady = true;
      slidingAxes = [...freeAxes]; // [axisU, axisV]
      slidingComp = [...compMove];
      slidingCenterB = cand.faceB.center; // 全向量保存

      // 用对角尺寸估算 range（XZ/YZ 平面时亦可）
      const vec = new THREE.Vector3();
      lenAaxis = new THREE.Box3().setFromObject(cand.meshA).getSize(vec);
      lenBaxis = new THREE.Box3().setFromObject(cand.meshB).getSize(vec);

      // 连接对象（ratioU / ratioV）
      slidingConn = {
        [objA]: "",
        [objB]: "",
        faceA: cand.faceA.name,
        faceB: cand.faceB.name,
        axisU: freeAxes[0],
        axisV: freeAxes[1],
        ratioU: "0",
        ratioV: "0",
      };
      store.updateConnections(
        withUniqueConn(store.connections, objA, objB, slidingConn),
        true
      );

      /* gizmo 开启这两轴把手 */
      if (ctx.transformCtrls) {
        const t = ctx.transformCtrls;
        t.attach(cand.meshA);
        t.setMode("translate");
        t.showX = freeAxes.includes("x");
        t.showY = freeAxes.includes("y");
        t.showZ = freeAxes.includes("z");
        t.showXY = t.showYZ = t.showXZ = t.showXYZ = false;
      }
      restoreOrbit();
      return;
    }
  }

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
  }

  /** ----- pointermove : 拖拽 & 面对检测 ----- */
  function onPointerMove(ev) {
    /* ---------- ★★ 第一段拖拽检测 ---------- */
    if (!dragging) return;

    /* ---------- 1. 把 compMove 整组随鼠标平移 ---------- */
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

    /* ---------- 2. 实时检测最近可吸附面对 ---------- */
    clearHelpers();
    refreshCompFaceBBox();

    const best = findBestCandidate();
    if (best) {
      candidate = best;
      addRectHelper(best.faceA, 0x00ff00); // 绿 → meshA
      addRectHelper(best.faceB, 0xff8800); // 橙 → meshB
    }
  }

  /** ----- pointerup : 若有候选则建立连接 ----- */
  function onPointerUp(ev) {
    /* ---------- ★★ 第一段拖拽结束 ---------- */
    if (!dragging) return;
    dragging = false;
    domEl.releasePointerCapture(ev.pointerId);

    applyCandidate(candidate);
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

    const best = findBestCandidate();
    if (!best) return;

    candidate = best;
    addRectHelper(best.faceA, 0x00ff00);
    addRectHelper(best.faceB, 0xff8800);
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
    applyCandidate(candidate);
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
