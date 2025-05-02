/* --------------------------------------------------------- *
 *  modes/planar.js  ——  共面伸缩（Planar Resize）交互模块
 * --------------------------------------------------------- */

import * as THREE from "three";
import { useSceneStore } from "../../../store";
import {
    findByPath,
    dimsToBoxGeom,
    generateAnchorPoints
} from "../../geometryUtils";

/**
 * 在 threeScene/index.js 中被调用：
 *    initPlanarMode(ctx)
 * ctx：所有子模块共享的运行时上下文对象
 */
export function initPlanarMode(ctx) {
    /* === 外部依赖 =================================================== */
    const store = useSceneStore();         // Pinia store
    const { renderer, camera } = ctx;         // 已在 core.js 初始化
    const CLICK_DIST = 6;                     // 判定“单击”的像素阈值²

    /* === 本模式用到的内部状态 ======================================= */
    let planarStage = 0;               // 0→等待 Mesh‑A 面；1→等待 Mesh‑B 面
    let planarMeshA = null;            // THREE.Mesh
    const planarNormalA = new THREE.Vector3();
    const planarCenterA = new THREE.Vector3();
    let planarAxis = "";              // 'x' | 'y' | 'z'

    /* —— 鼠标 / 射线工具 —— */
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    /* --------------------------------------------------------------- *
     *  公共工具
     * --------------------------------------------------------------- */

    /** 当前场景中 *可见* 的 leaf‑mesh 列表（供射线检测） */
    function getVisibleMeshes() {
        const arr = [];
        ctx.meshMap.forEach(m => { if (m.visible) arr.push(m); });
        return arr;
    }

    /** 根据轴与方向返回“TopFace / LeftFace …”字符串 */
    function getFaceName(axis, positive) {
        if (axis === "x") return positive ? "RightFace" : "LeftFace";
        if (axis === "y") return positive ? "TopFace" : "BottomFace";
    /* z */           return positive ? "FrontFace" : "BackFace";
    }

    /**
     * 真正执行尺寸修改 + 几何/锚点/标签同步
     * @param {THREE.Mesh} mesh          目标 Mesh (= planarMeshA)
     * @param {THREE.Vector3} normalW    被选中的 A 面法向（世界）
     * @param {'x'|'y'|'z'} axis         拉伸轴
     * @param {number} deltaSigned       A→B 面中心在法向上的位移
     */
    function performPlanarResize(mesh, normalW, axis, deltaSigned) {
        store.recordSnapshot();                       // 入撤销栈

        if (Math.abs(deltaSigned) < 1e-3) return;     // 改变太小直接忽略
        const AXIS_MAP = { x: "width", y: "height", z: "depth" };
        const dimKey = AXIS_MAP[axis];

        const node = findByPath(store.furnitureTree, mesh.userData.pathArr);
        if (!node?.dims) return;

        /* -- 1. 更新 meta 尺寸 -- */
        const newDims = { ...node.dims };
        newDims[dimKey] += deltaSigned;
        if (newDims[dimKey] < 1) return;              // 防止倒置
        node.dims = newDims;

        /* -- 2. 平移 Mesh 保持“对侧”对齐 -- */
        mesh.position.add(normalW.clone().setLength(deltaSigned / 2));

        /* -- 3. 重建几何 / 边线 / 锚点 -- */
        mesh.geometry.dispose();
        mesh.geometry = dimsToBoxGeom(newDims);

        mesh.children.forEach(c => {
            if (c.isLineSegments) {
                c.geometry.dispose();
                c.geometry = new THREE.EdgesGeometry(mesh.geometry, 20);
            }
        });
        mesh.userData.anchors = generateAnchorPoints(newDims, 50);

        /* -- 4. 调整顶部文字标签高度 -- */
        if (mesh.userData.label) {
            mesh.userData.label.position.set(0, newDims.height * 0.55 + 10, 0);
        }

        /* -- 5. 通知可能依赖尺寸的 UI 刷新 -- */
        store.meshRevision++;
    }

    /**
     * 复位本模式所有临时状态  
     * @param {boolean} clearInfo 是否清空右侧 Planar 面板显示
     */
    function resetPlanarMode(clearInfo = false) {
        planarStage = 0;
        planarMeshA = null;
        planarNormalA.set(0, 0, 0);
        planarCenterA.set(0, 0, 0);
        planarAxis = "";

        ctx.highlightPath([]);           // 取消高亮

        if (clearInfo) {
            store.setPlanarInfo({ meshA: "", faceA: "", meshB: "", faceB: "" });
        }
    }

    /* --------------------------------------------------------------- *
     *  Pointer 交互
     * --------------------------------------------------------------- */

    function handlePointerDown(ev) {
        if (ctx.currentMode !== "planar") return;       // 仅 planar 模式响应

        /* ---------- 0) 计算射线 ---------- */
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const hits = raycaster.intersectObjects(getVisibleMeshes(), false);

        /* ---------- 1) 点在空白 ---------- */
        if (!hits.length) {
            /* 仅在 Stage‑1（等待 B 面）时才允许“点击空白取消” */
            if (planarStage === 1) {
                /* 延迟到 pointerup 决定是否真取消（区分拖动旋转） */
                const sx = ev.clientX, sy = ev.clientY;
                function onUp(e) {
                    window.removeEventListener("pointerup", onUp);
                    const dx = e.clientX - sx, dy = e.clientY - sy;
                    if (dx * dx + dy * dy < CLICK_DIST * CLICK_DIST) {
                        resetPlanarMode(true);            // 清空 + 通知 UI
                        ctx.onSelect([]);                 // 取消选中
                    }
                }
                window.addEventListener("pointerup", onUp, { once: true });
            }
            return;
        }

        /* ---------- 2) 命中面 ---------- */
        const hit = hits[0];
        let mesh = hit.object;
        /* 点击的可能是 LineSegments / Label，向上找 Mesh */
        while (mesh && (!mesh.userData?.pathArr) && mesh.parent) {
            mesh = mesh.parent;
        }
        if (!mesh?.userData?.pathArr) return;           // 防御

        /* 面法向（世界） */
        const nWorld = hit.face.normal.clone()
            .transformDirection(mesh.matrixWorld).normalize();

        /* 主轴判断 */
        const abs = { x: Math.abs(nWorld.x), y: Math.abs(nWorld.y), z: Math.abs(nWorld.z) };
        const axis = abs.x >= abs.y && abs.x >= abs.z ? "x"
            : abs.y >= abs.z ? "y"
                : "z";

        /* ====================== Stage 0 ====================== */
        if (planarStage === 0) {
            planarMeshA = mesh;
            planarNormalA.copy(nWorld);
            planarCenterA.copy(hit.point);
            planarAxis = axis;
            planarStage = 1;

            store.setPlanarInfo({
                meshA: mesh.userData.pathArr.at(-1),
                faceA: getFaceName(axis, nWorld[axis] >= 0),
                meshB: "", faceB: ""
            });

            ctx.highlightPath(mesh.userData.pathArr);
            ctx.onSelect(mesh.userData.pathArr);          // 通知其它面板
            return;
        }

        /* ====================== Stage 1 ====================== */
        if (planarStage === 1) {
            if (mesh === planarMeshA) return;             // 同一 Mesh 不可
            if (axis !== planarAxis) return;            // 主轴需相同
            if (Math.abs(nWorld.dot(planarNormalA)) < 0.95) return; // 法向需平行

            const delta = hit.point.clone().sub(planarCenterA)
                .dot(planarNormalA);          // 正负 = 伸长 / 缩短

            store.setPlanarInfo({
                meshA: planarMeshA.userData.pathArr.at(-1),
                faceA: getFaceName(planarAxis, planarNormalA[planarAxis] >= 0),
                meshB: mesh.userData.pathArr.at(-1),
                faceB: getFaceName(axis, nWorld[axis] >= 0)
            });

            performPlanarResize(planarMeshA, planarNormalA, planarAxis, delta);
            resetPlanarMode();                            // 操作完成重置
        }
    }

    /* 绑定事件 —— 与 connect/drag 公共监听不会冲突 */
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);

    /* --------------------------------------------------------------- *
     *  对外（其它模块 / controls.setMode）需要调用的接口
     * --------------------------------------------------------------- */
    ctx.resetPlanarMode = resetPlanarMode;
}
