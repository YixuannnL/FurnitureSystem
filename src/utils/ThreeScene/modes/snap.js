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
import {
    getParallelFaces,
    gridSnap,
    ratioFromOffset
} from "../../faceUtils";
import { getFaceBBox } from "../../geometryUtils";

export function initSnapMode(ctx) {
    /* ─────────────── 共享引用与配置 ─────────────── */
    const store = useSceneStore();
    const domEl = ctx.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();

    /* ─────────────── 运行时状态 ─────────────── */
    let dragging = false;
    let orbitPrevEnabled = true;      // 记录拖拽前 orbit 的状态
    /** @type {THREE.Mesh|null}   主选中 meshA */
    let meshA = null;
    /** @type {string[]}          compMove 内所有 pathStr */
    let compMove = [];
    /** 起点世界坐标 (PointerDown 射线与 dragPlane 交点) */
    let dragStart = new THREE.Vector3();
    let dragPlane = new THREE.Plane();          // 垂直于相机视线

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

    function restoreOrbit() {
        if (ctx.orbit) ctx.orbit.enabled = true;
    }

    /* === 工具函数 ==================================================== */
    function clearHelpers() {
        helpers.forEach(h => ctx.scene.remove(h));
        helpers.length = 0;
        candidate = null;
    }

    // function addPlaneHelper(face, color) {
    //     const size = Math.max(face.uLen, face.vLen);
    //     const helper = new THREE.PlaneHelper(face.plane, size, color);
    //     ctx.scene.add(helper);
    //     helpers.push(helper);
    // }

    /* ——— 在面实际位置画矩形轮廓 ——— */
    function addRectHelper(face, color) {
        const geo = new THREE.BufferGeometry();
        const offset = face.normal.clone().setLength(1);      // 1 mm 前移
        const pA = face.center.clone()
            .addScaledVector(face.uDir, face.uLen / 2)
            .addScaledVector(face.vDir, face.vLen / 2)
            .add(offset);
        const pB = face.center.clone()
            .addScaledVector(face.uDir, -face.uLen / 2)
            .addScaledVector(face.vDir, face.vLen / 2)
            .add(offset);
        const pC = face.center.clone()
            .addScaledVector(face.uDir, -face.uLen / 2)
            .addScaledVector(face.vDir, -face.vLen / 2)
            .add(offset);
        const pD = face.center.clone()
            .addScaledVector(face.uDir, face.uLen / 2)
            .addScaledVector(face.vDir, -face.vLen / 2)
            .add(offset);
        const verts = new Float32Array([
            ...pA.toArray(), ...pB.toArray(), ...pC.toArray(), ...pD.toArray(), ...pA.toArray()
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
        compMove.forEach(p => {
            const m = ctx.meshMap.get(p);
            if (!m) return;
            m.updateMatrixWorld(true);          // 矩阵
            /* 关键：实时重算六面数据 */
            m.userData.faceBBox = getFaceBBox(m);
        });
    }


    /* === pointer 事件 ================================================= */

    /** ----- pointerdown : 选中组件并建立拖拽平面 ----- */
    function onPointerDown(ev) {
        if (ctx.currentMode !== "connect") return;  // 名称沿用 "connect"
        if (ev.button !== 0) return;                // 左键

        toNDC(ev);
        raycaster.setFromCamera(mouseNDC, ctx.camera);
        const hits = raycaster.intersectObjects(
            [...ctx.meshMap.values()].filter(m => m.visible),
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

        dragging = true;
        clearHelpers();

        /* 撤销栈：先拍快照，避免 pointermove 每帧拍 */
        store.recordSnapshot();

        /* ---------- 关闭 OrbitControls ---------- */
        if (ctx.orbit) {
            orbitPrevEnabled = ctx.orbit.enabled;
            ctx.orbit.enabled = false;
        }

        domEl.setPointerCapture(ev.pointerId);
    }

    /** ----- pointermove : 拖拽 & 面对检测 ----- */
    function onPointerMove(ev) {
        if (!dragging) return;
        toNDC(ev);
        raycaster.setFromCamera(mouseNDC, ctx.camera);
        const pos = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, pos);

        if (!pos) return;
        const delta = pos.clone().sub(dragStart);
        dragStart.copy(pos);                    // 更新基准点

        /* 平移 compMove 整体 */
        compMove.forEach(p => {
            const m = ctx.meshMap.get(p);
            if (m) m.position.add(delta);
        });

        /* --- 实时面‑面检测 & 高亮 ----------------------- */
        clearHelpers();
        refreshCompFaceBBox();

        const snapT = store.snapThreshold;
        let best = null;
        let bestDist = snapT;

        compMove.forEach(pathStr => {
            const mA = ctx.meshMap.get(pathStr);
            if (!mA) return;

            const facesA = mA.userData.faceBBox;   // 每次 stretch 都已刷新
            ctx.meshMap.forEach((mB, pB) => {
                if (compMove.includes(pB) || !mB.visible) return;
                // const facesB = mB.userData.faceBBox;
                /* 保证目标 mesh 的面数据始终最新 */
                mB.updateMatrixWorld(true);
                mB.userData.faceBBox = getFaceBBox(mB);
                const facesB = mB.userData.faceBBox;

                const pairs = getParallelFaces(facesA, facesB, snapT);
                pairs.forEach(pair => {
                    if (pair.dist < bestDist) {
                        best = { ...pair, meshA: mA, meshB: mB };
                        bestDist = pair.dist;
                    }
                });
            });
        });

        if (best) {
            candidate = best;
            addRectHelper(best.faceA, 0x00ff00);   // 绿 → meshA
            addRectHelper(best.faceB, 0xff8800);   // 橙 → meshB
        }
    }

    /** ----- pointerup : 若有候选则建立连接 ----- */
    function onPointerUp(ev) {
        if (!dragging) return;
        dragging = false;
        domEl.releasePointerCapture(ev.pointerId);

        if (!candidate) {
            clearHelpers();
            ctx.highlightPath([]);
            restoreOrbit();                     // ★ 始终恢复 OrbitControls
            return;                              // 无贴面
        }

        /* 1. 让 compMove 与目标面重合 */
        compMove.forEach(p => {
            const m = ctx.meshMap.get(p);
            if (m) m.position.add(candidate.delta);
        });

        /* 2. 自动对齐 & 网格吸附 ------------------------ */
        let ratio = null;
        let axis = candidate.commonAxis;   // 剩余自由轴 (可能为 null)

        if (axis) {
            /* 沿该轴做网格吸附 (gridStep) */
            const step = store.gridStep;

            const centerA = candidate.faceA.center.clone().add(candidate.delta);
            const centerB = candidate.faceB.center.clone();     // 已重合平面

            const offset = centerA[axis] - centerB[axis];
            const snapped = gridSnap(offset, step);

            const deltaSnap = snapped - offset;
            if (Math.abs(deltaSnap) > 1e-3) {
                compMove.forEach(p => {
                    const m = ctx.meshMap.get(p);
                    if (m) m.position[axis] += deltaSnap;
                });
            }

            /* 计算比例 offset / axisLen */
            const axisLen = candidate.faceB.axisLen;   // faceUtils 提供
            ratio = ratioFromOffset(snapped, axisLen);
        }

        /* 3. 生成连接对象 ------------------------------ */
        const objA = candidate.meshA.userData.pathArr.at(-1);
        const objB = candidate.meshB.userData.pathArr.at(-1);

        const connObj = {
            [objA]: "",
            [objB]: "",
            faceA: candidate.faceA.name,   // 'Left' / 'Top' / ...
            faceB: candidate.faceB.name,
            axis,                          // null 表示 0 自由轴 (全对齐)
            ratio                          // 可能为 null
        };

        /* 4. 更新全局连接 & 重建图 ---------------------- */
        store.updateConnections([...store.connections, connObj]);

        /* 5. 清理高亮 & 帮助线 */
        clearHelpers();
        ctx.highlightPath([]);

        /* ---------- 恢复 OrbitControls ---------- */
        // if (ctx.orbit) ctx.orbit.enabled = orbitPrevEnabled;
        restoreOrbit();                       // ★ 成功连接后也恢复 Orbit
    }

    /* === 重置接口（切模式 / 撤销） ============================ */
    function resetSnapMode() {
        dragging = false;
        meshA = null;
        compMove = [];
        clearHelpers();
        // if (ctx.orbit) ctx.orbit.enabled = orbitPrevEnabled;
        restoreOrbit();                       // ★ 切模式必开启旋转
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
