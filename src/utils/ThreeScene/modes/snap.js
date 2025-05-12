import * as THREE from "three";
import { useSceneStore } from "../../../store";
import { getParallelFaces, gridSnap, ratioFromOffset } from "../../faceUtils";
import { getFaceBBox, findByPath } from "../../geometryUtils";
import { RESERVED } from "../../connectionUtils";

function pairKey(conn) {
  return Object.keys(conn)
    .filter((k) => !RESERVED.has(k))
    .sort() // A-B 与 B-A 归到同 key
    .join("#");
}

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

  let ratioAdjustStage = false; // 进入第 3 段？
  let pendingConnKey = ""; // pairKey(slidingConn)

  let undoBaseDepth = null; // 撤销到的目标深度

  /** 高亮缓存 */
  /** @type {THREE.PlaneHelper[]} */
  const helpers = [];

  /* ---- 点击选面阶段状态 ---- */
  let pickStage = 0; // 0=未选 1=已选A，待选B
  let pickFaceA = null; // {mesh, face} 结构

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
  let slidingMeshB = null; // cand.meshB 引用，便于 updateSliding

  const AXIS_NAME = { x: "宽度", y: "高度", z: "深度" };

  function axisOfDir(v) {
    const ax = Math.abs(v.x),
      ay = Math.abs(v.y),
      az = Math.abs(v.z);
    return ax > ay && ax > az ? "x" : ay > az ? "y" : "z";
  }

  /* ---- 单击-空白判定阈 ---- */
  const CLICK_DIST = 6; // px，与 controls.js 一致
  let downX = 0,
    downY = 0; // 记录 pointerDown 时的屏幕坐标

  /* ------------------------------------------------------------------ *
   *  若是“点一下空白” ⇒ 取消本次连接
   *  若是“在空白拖动”   ⇒ 仅视角旋转，不取消
   * ------------------------------------------------------------------ */
  function scheduleConditionalCancel(ev) {
    /* 1) 只有正在连接时才需要撤销判断 */
    const connecting =
      slidingReady || ratioAdjustStage || undoBaseDepth !== null;
    if (!connecting) return;

    const sx = ev.clientX,
      sy = ev.clientY;
    function onUp(e) {
      window.removeEventListener("pointerup", onUp);
      const dx = e.clientX - sx,
        dy = e.clientY - sy;
      if (dx * dx + dy * dy < CLICK_DIST * CLICK_DIST) {
        cancelCurrentConnection(); // 真·单击空白
      }
    }
    window.addEventListener("pointerup", onUp, { once: true });
  }

  /* 将当前中心偏移转为 0-1 比例 */
  function centerRatio(meshA, meshB, axis) {
    const vec = new THREE.Vector3();
    const ctrA = new THREE.Box3()
      .setFromObject(meshA)
      .getCenter(new THREE.Vector3())[axis];
    const ctrB = new THREE.Box3()
      .setFromObject(meshB)
      .getCenter(new THREE.Vector3())[axis];
    const lenA = new THREE.Box3().setFromObject(meshA).getSize(vec)[axis];
    const lenB = new THREE.Box3().setFromObject(meshB).getSize(vec)[axis];

    const halfA = lenA * 0.5;
    const halfB = lenB * 0.5;
    const minOff = -(halfA + halfB); // ratio = 0
    const axisRange = lenA + lenB; // 总范围
    const curOff = ctrA - ctrB;

    return THREE.MathUtils.clamp((curOff - minOff) / axisRange, 0, 1);
  }

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

    const pathA = cand.meshA.userData.pathStr;
    const pathB = cand.meshB.userData.pathStr;

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
        pathA: pathA, // ← 直接用已存在变量
        pathB: pathB, //
      };
      store.updateConnections(
        withUniqueConn(store.connections, objA, objB, connObj)
      );
      clearHelpers();
      ctx.highlightPath([]);
      restoreOrbit();
      store.clearConnectPick();

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
      slidingMeshB = cand.meshB;

      const axisText =
        freeAxes.length === 1
          ? AXIS_NAME[freeAxes[0]]
          : `${AXIS_NAME[freeAxes[0]]}/${AXIS_NAME[freeAxes[1]]}`;
      store.setHint(
        `${meshA.name} 可以沿着 ${axisText} 方向拖动，` +
          `把它移到你认为合适的位置吧。`
      );

      // 长度数据
      const vec = new THREE.Vector3();
      lenAaxis = new THREE.Box3().setFromObject(cand.meshA).getSize(vec)[axis];
      lenBaxis = new THREE.Box3().setFromObject(cand.meshB).getSize(vec)[axis];

      slidingConn = {
        [objA]: "",
        [objB]: "",
        faceA: cand.faceA.name,
        faceB: cand.faceB.name,
        axis,
        ratio: dec2frac(centerRatio(cand.meshA, cand.meshB, axis)),
        /* 显式记录绝对路径 ↓↓↓ */
        pathA: pathA, // ← 直接用已存在变量
        pathB: pathB, //
      };

      store.updateConnections(
        withUniqueConn(store.connections, objA, objB, slidingConn),
        true
      );
      slidingConn = store.connections.find((c) => {
        const k = Object.keys(c);
        return k.includes(objA) && k.includes(objB);
      });

      /* —— 标记“待确认”：立即显示确认按钮 —— */
      pendingConnKey = pairKey(slidingConn);
      store.setPendingConnectionKey(pendingConnKey);
      store.setCurrentSlidingComp(slidingComp);

      /* gizmo 只留这一根轴 */
      if (ctx.transformCtrls) {
        const t = ctx.transformCtrls;
        // t.attach(cand.meshA);
        t.setMode("translate");
        t.showX = axis === "x";
        t.showY = axis === "y";
        t.showZ = axis === "z";
        t.showXY = t.showYZ = t.showXZ = t.showXYZ = false;
      }
      /* 把 gizmo 与完整 slidingComp 绑定 */
      ctx.attachWithComponent(cand.meshA, slidingComp);
      store.clearConnectPick();

      restoreOrbit();
      return;
    }

    /* ===============================================================
     * 4-C. 双自由轴 —— 进入“平面滑动”阶段
     * ============================================================= */
    if (freeAxes.length === 2) {
      slidingReady = true;
      slidingAxes = [...freeAxes]; // [axisU, axisV]
      slidingMeshB = cand.meshB;
      slidingComp = [...compMove];
      slidingCenterB = cand.faceB.center; // 全向量保存

      const axisText =
        freeAxes.length === 1
          ? AXIS_NAME[freeAxes[0]]
          : `${AXIS_NAME[freeAxes[0]]}/${AXIS_NAME[freeAxes[1]]}`;
      store.setHint(
        `${meshA.name} 可以沿着 ${axisText} 方向拖动，` +
          `把它移到你认为合适的位置吧。`
      );

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
        ratioU: dec2frac(centerRatio(cand.meshA, cand.meshB, freeAxes[0])),
        ratioV: dec2frac(centerRatio(cand.meshA, cand.meshB, freeAxes[1])),
        pathA: pathA, // ← 直接用已存在变量
        pathB: pathB, //
      };
      store.updateConnections(
        withUniqueConn(store.connections, objA, objB, slidingConn),
        true
      );
      slidingConn = store.connections.find((c) => {
        const k = Object.keys(c);
        return (
          k.includes(cand.meshA.userData.pathArr.at(-1)) &&
          k.includes(cand.meshB.userData.pathArr.at(-1))
        );
      });

      /* —— 标记“待确认”：立即显示确认按钮 —— */
      pendingConnKey = pairKey(slidingConn);
      store.setPendingConnectionKey(pendingConnKey);
      store.setCurrentSlidingComp(slidingComp);

      /* gizmo 开启这两轴把手 */
      if (ctx.transformCtrls) {
        const t = ctx.transformCtrls;
        // t.attach(cand.meshA);
        t.setMode("translate");
        t.showX = freeAxes.includes("x");
        t.showY = freeAxes.includes("y");
        t.showZ = freeAxes.includes("z");
        t.showXY = t.showYZ = t.showXZ = t.showXYZ = false;
      }
      /* 同步 gizmo 与 slidingComp */
      ctx.attachWithComponent(cand.meshA, slidingComp);
      store.clearConnectPick();

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
  function faceFromHit(mesh, hitFace) {
    mesh.userData.faceBBox ??= getFaceBBox(mesh);
    const n = hitFace.normal
      .clone()
      .transformDirection(mesh.matrixWorld)
      .normalize();
    // 与六面 normal 比对
    for (const f of Object.values(mesh.userData.faceBBox)) {
      if (f.normal.dot(n) > 0.98) return f;
    }
    return null;
  }

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
        // store.up
        /* 1. 已写入 ratio；进入“第三段”等待确认 */
        ratioAdjustStage = true;
        store.setHint(
          `如果需要进一步精细调整，` +
            `请在右侧输入位置比例后点击“确认”，` +
            `这条连接就完成啦！`
        );

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

  function finalizePendingConnection() {
    // if (!ratioAdjustStage) return;
    if (!slidingReady) return;

    /* ① 确保最终连接写回（若用户没拖动自由轴时尚未写入撤销栈） */
    store.updateConnections([...store.connections], /*skipUndo=*/ true); // 不 skipUndo

    /* —— ② 恢复 TransformControls 三轴 —— */
    if (ctx.transformCtrls) {
      const t = ctx.transformCtrls;
      t.detach();
      t.showX = t.showY = t.showZ = true; // 主轴
      t.showXY = t.showYZ = t.showXZ = false; // 平面
      t.showXYZ = false; // 中心
    }
    ctx.selectedMesh = null;

    /* ③ 清 UI 辅助线 / 高亮 / 提示 */
    clearHelpers();
    ctx.highlightPath([]);
    restoreOrbit();
    store.clearHint();
    /* —— 关键：清除 A/B 面临时记录，防止提示条残留 —— */
    store.clearConnectPick();

    /* ④ 清状态标志 */
    ratioAdjustStage = false;
    slidingReady = false;
    store.clearPendingConnectionKey();
    store.clearCurrentSlidingComp();
    pendingConnKey = "";
    undoBaseDepth = null; // 本条连接已确认，重置

    store.endConnectSession(); // 关闭事务
  }

  /* ------------------------------------------------------------- *
   *  取消本次连接：撤销快照、清辅线、复位 gizmo / orbit / 高亮
   * ------------------------------------------------------------- */
  function cancelCurrentConnection() {
    // /* 1. 撤回到开始连接前的快照（如有） */
    // store.undo(); // UndoManager.pop() 恢复包括 mesh 位置
    /* 1. 一口气撤到 undoBaseDepth */
    if (undoBaseDepth !== null) {
      while (store.undoMgr.length > undoBaseDepth) {
        store.undo();
      }
    }

    /* 2. UI 清理 */
    clearHelpers();
    ctx.highlightPath([]);
    ctx.transformCtrls?.detach();
    ctx.selectedMesh = null;
    restoreOrbit();

    /* 让 FurnitureScene 的 onSelect 回调重置 currentNodePath，
     这样右侧面板恢复到“当前子结构的全部连接”视图            */
    ctx.onSelect?.([]); // ← 新增这一行

    /* 3. 连接状态标志清零 */
    slidingReady = false;
    ratioAdjustStage = false;
    store.clearPendingConnectionKey();
    store.clearCurrentSlidingComp?.();
    undoBaseDepth = null; // 清标志
    store.clearHint();

    store.endConnectSession(); // 关闭事务

    pickStage = 0;
    store.clearConnectPick();
  }

  /* === pointer 事件 ================================================= */

  /* ------------------------------------------------------------- *
   * pointerDown ⸺ 统一处理三种情况
   *   1) 不在 connect 模式 / 非左键 / 点到 gizmo ⸺ 直接 return
   *   2) 处于二段滑动 ready   → 单轴拖动 (第三段准备)
   *   3) 正常第一段          → 选中 meshA、建立拖拽平面
   * ------------------------------------------------------------- */
  function onPointerDown(ev) {
    /* ★★ 0. 基本过滤 ★★ */
    if (ctx.currentMode !== "connect") return; // 名称沿用 "connect"
    if (ev.button !== 0) return; // 左键
    /* 若点中的是 gizmo 把手则完全交给 TransformControls */
    if (ctx.transformCtrls && ctx.transformCtrls.axis) return;

    downX = ev.clientX;
    downY = ev.clientY;

    /* ★★ 1. 二段滑动 READY 状态：启动单轴拖动 ★★ */
    if (slidingReady) {
      /* 1-a. 射线仅检测 slidingComp */
      toNDC(ev);
      raycaster.setFromCamera(mouseNDC, ctx.camera);
      const hits = raycaster.intersectObjects(
        slidingComp.map((p) => ctx.meshMap.get(p)),
        false
      );

      /* 1-b. 命中 → 进入单轴拖动 */
      if (hits.length) {
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
      scheduleConditionalCancel(ev);
      return;
    }

    /* ★★ 2. 第一段：新建 compMove，准备贴面 ★★ */
    /* 2-a. 全场可见 Mesh 做射线拾取 */
    toNDC(ev);
    raycaster.setFromCamera(mouseNDC, ctx.camera);
    const hits = raycaster.intersectObjects(
      [...ctx.meshMap.values()].filter((m) => m.visible),
      false
    );

    if (!hits.length) {
      const connecting =
        slidingReady || ratioAdjustStage || undoBaseDepth !== null;

      if (connecting) {
        /* 正在连接：等待 pointerup 决定是否取消 */
        scheduleConditionalCancel(ev);
      } else {
        /* ---------- ① 并未处于连接流程 ---------- */
        /* 清选中 & 高亮，让右侧面板回到子结构全部连接 */
        ctx.transformCtrls?.detach();
        ctx.selectedMesh = null;
        ctx.highlightPath([]);
        ctx.onSelect?.([]); // ← 关键：把 currentNodePath 复位
      }
      return;
    }

    /* 2-b. 选中 meshA，并高亮 */
    meshA = hits[0].object;
    ctx.highlightPath(meshA.userData.pathArr);
    store.setHint(
      `您现在选中的是 ${meshA.name}，` +
        `请拖拽手柄将它移动到你认为应该连接的板材附近，` +
        `当两个板材靠得足够近、出现高亮面后松开鼠标即可。`
    );

    /* 2-c. compMove = meshA 所在连通分量 */
    compMove = ctx.findComponent(meshA.userData.pathStr);
    refreshCompFaceBBox();

    /* 2-d. 构建拖拽平面（摄像机正对） */
    dragPlane.setFromNormalAndCoplanarPoint(
      ctx.camera.getWorldDirection(new THREE.Vector3()),
      hits[0].point
    );
    dragStart.copy(hits[0].point);

    /* 2-e. 绑定 TransformControls（显示三轴） */
    if (ctx.transformCtrls) {
      const t = ctx.transformCtrls;
      //   t.attach(meshA); // 绑定 gizmo
      t.setMode("translate");
      t.showX = t.showY = t.showZ = true;
      t.showXY = t.showYZ = t.showXZ = t.showXYZ = false; // 关闭平面/中心
    }
    // ctx.selectedMesh = meshA; // ← 让 objectChange 能正常工作
    /* 统一写入选中 & 连通分量 */
    ctx.attachWithComponent(meshA, compMove);

    /* 2-f. 清除之前可能残留的辅助线 */
    clearHelpers();

    /* 2-g. 撤销栈快照（一次即可） */
    undoBaseDepth = store.undoMgr.length; // 记录开始前的深度
    store.startConnectSession(); // 标记事务
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
    console.log("best:", best);
    if (best) {
      candidate = best;
      addRectHelper(best.faceA, 0x00ff00); // 绿 → meshA
      addRectHelper(best.faceB, 0xff8800); // 橙 → meshB
    }
  }

  /** ----- pointerup : 若有候选则建立连接 ----- */
  function onPointerUp(ev) {
    /* ---------- 判断是否为“点击” ---------- */
    const dx = ev.clientX - downX;
    const dy = ev.clientY - downY;
    const isClick = dx * dx + dy * dy < CLICK_DIST * CLICK_DIST;

    /* ---------- ① 处理拖拽流程 ---------- */
    if (dragging) {
      dragging = false;
      domEl.releasePointerCapture(ev.pointerId);
      applyCandidate(candidate); // 原有逻辑
      return; // 结束
    }
    /* ---------- ② 处理点击选面贴面 ---------- */
    if (isClick) {
      handleClickPick(ev);
    }
  }

  function handleClickPick(ev) {
    /* ---------- 点击贴面：小位移 + 非拖拽 ---------- */
    const dx = ev.clientX - downX,
      dy = ev.clientY - downY;
    if (dx * dx + dy * dy < CLICK_DIST * CLICK_DIST && !dragging) {
      // 射线再次检测
      toNDC(ev);
      raycaster.setFromCamera(mouseNDC, ctx.camera);
      const hits = raycaster.intersectObjects(
        [...ctx.meshMap.values()].filter((m) => m.visible),
        false
      );
      if (!hits.length) return;

      let mesh = hits[0].object;
      while (mesh && !mesh.userData?.pathArr) mesh = mesh.parent;
      if (!mesh) return;

      const face = faceFromHit(mesh, hits[0].face);
      if (!face) return;

      /* === 选 A 面 === */
      if (pickStage === 0) {
        pickStage = 1;
        pickFaceA = { mesh, face };
        store.setConnectPick({
          meshA: mesh.name,
          faceA: face.name,
          meshB: "",
          faceB: "",
        });

        ctx.highlightPath(mesh.userData.pathArr);
        return;
      }

      /* === 选 B 面 === */
      if (pickStage === 1) {
        if (mesh === pickFaceA.mesh) return; // 不能同一 mesh
        // 法向需反向平行
        if (
          face.axis !== pickFaceA.face.axis ||
          face.normal.dot(pickFaceA.face.normal) > -0.95
        )
          return;

        compMove = ctx.findComponent(pickFaceA.mesh.userData.pathStr);
        refreshCompFaceBBox(); // 更新 faceBBox
        ctx.attachWithComponent(pickFaceA.mesh, compMove);

        pickStage = 0; // 重置
        store.clearConnectPick();

        /* 构造 candidate 并复用原 applyCandidate() 逻辑 */
        const cand = {
          meshA: pickFaceA.mesh,
          meshB: mesh,
          faceA: pickFaceA.face,
          faceB: face,
          delta: pickFaceA.face.normal
            .clone()
            .setLength(
              face.center
                .clone()
                .sub(pickFaceA.face.center)
                .dot(pickFaceA.face.normal)
            ),
          commonAxis: null, // 让 applyCandidate() 去判断
        };
        applyCandidate(cand);
        return;
      }
    }
  }

  /* === 重置接口（切模式 / 撤销） ============================ */
  function resetSnapMode() {
    dragging = false;
    meshA = null;
    compMove = [];
    clearHelpers();
    // if (ctx.orbit) ctx.orbit.enabled = orbitPrevEnabled;
    restoreOrbit(); // ★ 切模式必开启旋转

    pickStage = 0;
    store.clearConnectPick();
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
    // console.log("best2:", best);
    addRectHelper(best.faceA, 0x00ff00);
    addRectHelper(best.faceB, 0xff8800);
  }

  /* ------------------------------------------------------------------ *
   *  updateSliding —— 二段滑动时沿单轴实时吸附 & ratio 更新
   * ------------------------------------------------------------------ */
  function updateSliding() {
    if (!slidingReady || !slidingComp.length) return;

    const meshA = ctx.meshMap.get(slidingComp[0]);
    if (!meshA || !slidingMeshB) return;
    const meshB = slidingMeshB;

    /* —— 公用工具：单轴吸附 & ratio 更新 —— */
    function handleAxis(axis, ratioKey) {
      /* ---- 世界坐标下长度 & 中心 ---- */
      const vec = new THREE.Vector3();
      const lenA = new THREE.Box3().setFromObject(meshA).getSize(vec)[axis];
      const lenB = new THREE.Box3().setFromObject(meshB).getSize(vec)[axis];

      const halfA = lenA * 0.5,
        halfB = lenB * 0.5;
      const minOff = -(halfA + halfB); // ratio = 0
      const maxOff = halfA + halfB; // ratio = 1
      const axisRange = lenA + lenB; // 总可滑动范围
      /* ---------- 动态吸附阈值：取 25 mm 与 3 % 板宽中的较小值 ---------- */
      const edgeSnapT = Math.min(25, (lenA + lenB) * 0.03);

      /** 当前 offset（世界） */
      const ctrA = new THREE.Box3()
        .setFromObject(meshA)
        .getCenter(new THREE.Vector3())[axis];
      const ctrB = new THREE.Box3()
        .setFromObject(meshB)
        .getCenter(new THREE.Vector3())[axis];
      let offset = ctrA - ctrB; // A 相对 B

      /* ------- 吸附目标 (端点 / 中点 / 网格) ------- */
      offset = THREE.MathUtils.clamp(offset, minOff, maxOff);

      //   const snapT = SNAP_T();
      //   const targets = [minOff, 0, maxOff];
      //   let snapped = null;
      //   for (const t of targets) {
      //     if (Math.abs(offset - t) < snapT) {
      //       snapped = t;
      //       break;
      //     }
      //   }
      //   if (snapped === null) {
      //     const g = gridSnap(offset, store.gridStep);
      //     if (Math.abs(offset - g) < snapT) snapped = g;
      //   }
      const snapT = SNAP_T(); // 原“面-贴-面 / 网格”阈
      let snapped = null;

      /* ① 先试左右两端面吸附（阈值 edgeSnapT） */
      if (Math.abs(offset - minOff) < edgeSnapT) snapped = minOff;
      else if (Math.abs(offset - maxOff) < edgeSnapT) snapped = maxOff;

      /* ② 再试中心对齐 & 网格吸附 */
      if (snapped === null && Math.abs(offset) < snapT) snapped = 0;
      if (snapped === null) {
        const g = gridSnap(offset, store.gridStep);
        if (Math.abs(offset - g) < snapT) snapped = g;
      }
      if (snapped !== null) offset = snapped;

      /* ---- 需要的 world 位移 ---- */
      const desiredOffset = offset;
      const need = desiredOffset - (ctrA - ctrB);

      if (Math.abs(need) > 1e-6) {
        adjusting = true;
        slidingComp.forEach((p) => {
          const m = ctx.meshMap.get(p);
          if (m) {
            m.position[axis] += need; // 局部平移即可
            m.updateMatrixWorld(true);
          }
        });
        adjusting = false;
        syncPrev(meshA);
      }

      /* ---- 更新 ratio 字符串 ---- */
      const dec = (desiredOffset - minOff) / axisRange; // 0‥1
      slidingConn[ratioKey] = dec2frac(dec);
    }

    if (slidingAxes.length === 1) {
      handleAxis(slidingAxes[0], "ratio");
    } else {
      handleAxis(slidingAxes[0], "ratioU");
      handleAxis(slidingAxes[1], "ratioV");
    }
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

  ctx.finalizePendingConnection = finalizePendingConnection;
  ctx.publicAPI.finalizePendingConnection = finalizePendingConnection;
  ctx.cancelCurrentConnection = cancelCurrentConnection;
  ctx.publicAPI.cancelCurrentConnection = cancelCurrentConnection;
}
