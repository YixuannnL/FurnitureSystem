/* ──────────────────────────────────────────────────────────────
 *  modes/connect.js
 *  -------------------------------------------------------------
 *  ‣ 负责“四步连接”交互模式：
 *      0. 选择 Mesh‑A
 *      1. 选择 Mesh‑A 上的锚点
 *      2. 选择 Mesh‑B
 *      3. 选择 Mesh‑B 上的锚点 → 建立连接并吸附
 *  ‣ 对外暴露 resetConnectMode() 供 controls.setMode 调用
 *  ‣ 依赖：
 *      · ctx.scene / camera / renderer / meshMap / highlightPath
 *      · ctx.findComponent   (graph.js 注入)
 *      · ctx.layoutGroupLine (layout.js 注入，完成后刷新排布)
 *  ‣ 外部状态：
 *      ctx.currentMode 由 controls.setMode 写入
 *      ctx.publicAPI.resetConnectMode 作为最终对外 API
 * ────────────────────────────────────────────────────────────── */

import * as THREE from "three";
import { useSceneStore } from "../../../store";

export function initConnectMode(ctx) {
    /* ---------------- 运行时状态 ---------------- */
    const store = useSceneStore();

    let connectState = 0;            // 0→meshA, 1→anchorA, 2→meshB, 3→anchorB
    let meshA = null;
    let meshB = null;
    let anchorAWorld = null;

    /* —— 鼠标点击判定阈值 —— */
    const CLICK_DIST = 6;                     // px
    const CLICK_DIST_SQ = CLICK_DIST * CLICK_DIST;

    /* —— 锚点吸附阈值 (mm) —— */
    const CONNECT_TOL = 25;

    /* ---------------- 预览 / 终态球体 ---------------- */
    const ballGeom = new THREE.SphereGeometry(12, 16, 16);
    const ballMatPreview = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6 });
    const ANCHOR_COLORS = {
        corner: 0xff8800,
        edge: 0xffc107,
        face: 0x4caf50,
        grid: 0x00aaff
    };

    let previewBall = null;
    let previewType = "";
    const finalBalls = [];                           // 所有已放置终态球

    function ensurePreviewBall() {
        if (!previewBall) {
            previewBall = new THREE.Mesh(ballGeom, ballMatPreview);
            previewBall.scale.set(1.5, 1.5, 1.5);
            ctx.scene.add(previewBall);
        }
        previewBall.visible = false;
    }
    function resetPreview() {
        if (previewBall) previewBall.visible = false;
    }
    function placeFinalBall(worldPos, type) {
        const mat = new THREE.MeshBasicMaterial({ color: ANCHOR_COLORS[type] });
        const ball = new THREE.Mesh(ballGeom, mat);
        ball.position.copy(worldPos);
        ctx.scene.add(ball);
        finalBalls.push(ball);
    }

    /* ---------------- 共用 Raycaster ---------------- */
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    /* —— 工具：当前可见的所有 leaf‑mesh —— */
    function getVisibleMeshes() {
        const arr = [];
        ctx.meshMap.forEach((m) => { if (m.visible) arr.push(m); });
        return arr;
    }

    /* ---------------- 连接模式主状态机 ---------------- */
    function pointerDown(ev) {
        if (ctx.currentMode !== "connect") return;

        /* 将鼠标转标准化设备坐标 (NDC) */
        const rect = ctx.renderer.domElement.getBoundingClientRect();
        mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, ctx.camera);

        /* ==== 先判断是否点中了任何 mesh ==== */
        const anyHit = raycaster
            .intersectObjects([...ctx.meshMap.values()], false)
            .length > 0;

        /* -------- 处理“空白点击”重置 -------- */
        if (!anyHit) {
            if (connectState !== 0) {
                const downX = ev.clientX, downY = ev.clientY;
                window.addEventListener(
                    "pointerup",
                    (e) => {
                        const dx = e.clientX - downX;
                        const dy = e.clientY - downY;
                        if (dx * dx + dy * dy < CLICK_DIST_SQ) resetConnectMode();
                    },
                    { once: true }
                );
            }
            return;                              // 让 OrbitControls 正常旋转
        }

        /* ============================================================ *
         *                0 → 1  ——  选中 Mesh‑A                        *
         * ============================================================ */
        if (connectState === 0) {
            const hits = raycaster.intersectObjects(getVisibleMeshes(), false);
            if (!hits.length) return;
            meshA = hits[0].object;
            ctx.highlightPath(meshA.userData.pathArr);
            connectState = 1;
            ctx.onSelect(meshA.userData.pathArr);          // 向 UI 通知当前选中
            return;
        }

        /* ============================================================ *
         *                1 → 2  ——  选中 Mesh‑A 锚点                   *
         * ============================================================ */
        if (connectState === 1) {
            const hits = raycaster.intersectObject(meshA, false);
            if (!hits.length) return;

            const localHit = meshA.worldToLocal(hits[0].point.clone());
            let best = null,
                bestDist = Infinity;
            meshA.userData.anchors.forEach(({ pos, type }) => {
                const d = pos.distanceToSquared(localHit);
                if (d < bestDist) {
                    bestDist = d;
                    best = { pos, type };
                }
            });
            if (best && bestDist <= CONNECT_TOL * CONNECT_TOL) {
                const wp = meshA.localToWorld(best.pos.clone());
                placeFinalBall(wp, best.type);
                anchorAWorld = wp.clone();

                resetPreview();
                ctx.highlightPath([]);              // 清掉高亮，准备选 Mesh‑B
                connectState = 2;
            }
            return;
        }

        /* ============================================================ *
         *                2 → 3  ——  选中 Mesh‑B                        *
         * ============================================================ */
        if (connectState === 2) {
            const hits = raycaster.intersectObjects(getVisibleMeshes(), false);
            if (!hits.length) return;
            const m = hits[0].object;
            if (m === meshA) return;              // 不允许同一 mesh
            meshB = m;

            ctx.highlightPath(meshB.userData.pathArr);
            ctx.onSelect(meshB.userData.pathArr);
            connectState = 3;
            return;
        }

        /* ============================================================ *
         *      3 → 完成 —— 选中 Mesh‑B 锚点，吸附 + 写连接              *
         * ============================================================ */
        if (connectState === 3) {
            const hits = raycaster.intersectObject(meshB, false);
            if (!hits.length) return;

            const localHit = meshB.worldToLocal(hits[0].point.clone());
            let best = null,
                bestDist = Infinity;
            meshB.userData.anchors.forEach(({ pos, type }) => {
                const d = pos.distanceToSquared(localHit);
                if (d < bestDist) {
                    bestDist = d;
                    best = { pos, type };
                }
            });
            if (!(best && bestDist <= CONNECT_TOL * CONNECT_TOL)) return;

            /* ---- 终态球 & 撤快照 ---- */
            const wp = meshB.localToWorld(best.pos.clone());
            placeFinalBall(wp, best.type);
            resetPreview();
            store.recordSnapshot();

            /* ---------- A. 组件吸附平移 ---------- */
            if (anchorAWorld) {
                const anchorBWorld = wp.clone();

                /* 取两端各自连通分量 */
                const compA = ctx.findComponent(meshA.userData.pathStr);
                const compB = ctx.findComponent(meshB.userData.pathStr);

                /* 选更小组件进行平移 */
                let movingComp, movingAnchor, refAnchor;
                if (compA.length <= compB.length) {
                    movingComp = compA;
                    movingAnchor = anchorAWorld;
                    refAnchor = anchorBWorld;
                } else {
                    movingComp = compB;
                    movingAnchor = anchorBWorld;
                    refAnchor = anchorAWorld;
                }
                const delta = refAnchor.clone().sub(movingAnchor);
                movingComp.forEach((p) => {
                    const m = ctx.meshMap.get(p);
                    if (m) m.position.add(delta);
                });
            }

            /* ---------- B. 更新连接数组 ---------- */
            const n1 = meshA.userData.pathArr.at(-1);
            const n2 = meshB.userData.pathArr.at(-1);
            if (n1 !== n2) {
                const exists = store.connections.some((c) => {
                    const ks = Object.keys(c);
                    return ks.includes(n1) && ks.includes(n2);
                });
                if (!exists) {
                    store.updateConnections(
                        [...store.connections, { [n1]: "", [n2]: "" }],
            /* skipUndo = */ true
                    );
                }
            }

            /* ---------- C. 收尾 ---------- */
            resetConnectMode(/* skip onSelect */ true);

            /* Step‑1 完成连接后实时重新排布当前子结构 */
            if (store.step === 1 && store.currentNodePath.length) {
                ctx.layoutGroupLine(store.currentNodePath, 50, /* focus */ false);
            }
        }
    }

    /* ---------------- Pointer‑Move：锚点预览 ---------------- */
    function pointerMove(ev) {
        if (ctx.currentMode !== "connect") return;
        if (!(connectState === 1 || connectState === 3)) return;

        ensurePreviewBall();
        const targetMesh = connectState === 1 ? meshA : meshB;
        if (!targetMesh) return;

        const rect = ctx.renderer.domElement.getBoundingClientRect();
        mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, ctx.camera);

        const hit = raycaster.intersectObject(targetMesh, false);
        if (!hit.length) {
            previewBall.visible = false;
            return;
        }

        const localHit = targetMesh.worldToLocal(hit[0].point.clone());
        let best = null,
            bestDist = Infinity;
        targetMesh.userData.anchors.forEach(({ pos, type }) => {
            const d = pos.distanceToSquared(localHit);
            if (d < bestDist) {
                bestDist = d;
                best = { pos, type };
            }
        });

        if (best && bestDist <= CONNECT_TOL * CONNECT_TOL) {
            const wp = targetMesh.localToWorld(best.pos.clone());
            previewBall.material.color.setHex(ANCHOR_COLORS[best.type]);
            previewBall.position.copy(wp);
            previewBall.visible = true;
            previewType = best.type;
        } else {
            previewBall.visible = false;
        }
    }

    /* ---------------- 对外重置函数 ---------------- */
    function resetConnectMode() {
        connectState = 0;
        meshA = meshB = null;
        anchorAWorld = null;
        resetPreview();
        finalBalls.forEach((b) => ctx.scene.remove(b));
        finalBalls.length = 0;
        ctx.highlightPath([]);
        ctx.onSelect([]);
    }

    /* —— 将重置函数挂到 ctx 和公开 API —— */
    ctx.resetConnectMode = resetConnectMode;
    ctx.publicAPI.resetConnectMode = resetConnectMode;

    /* ---------------- 事件监听挂载 ---------------- */
    ctx.renderer.domElement.addEventListener("pointerdown", pointerDown);
    ctx.renderer.domElement.addEventListener("pointermove", pointerMove);
}
