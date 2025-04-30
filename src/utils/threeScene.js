
import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { dimsToBoxGeom, generateAnchorPoints } from "./geometryUtils";
import { useSceneStore } from "../store";
import { pastelColors } from "./colorPalette";

/**
 * @param {HTMLCanvasElement} canvasEl
 * @param {Object}           furnitureTree  解析后的树
 * @param {Array}            connections    [{ partA : "", partB : "" }, ...]
 * @param {Function}         onSelect(pathArray)
 */
export function createThreeContext(canvasEl, furnitureTree, connections, onSelect) {

    let currentMode = "drag";
    /* ---------- 连接模式状态机 ---------- */
    const store = useSceneStore();
    const CONNECT_TOL = 25; // mm

    let connectState = 0;   // 0 等 meshA, 1 anchorA, 2 meshB, 3 anchorB
    let meshA = null,
        meshB = null;

    // ★★★ 新增：不同类别锚点的颜色
    const ANCHOR_COLORS = {
        corner: 0xff8800,  // 角
        edge: 0xffc107,  // 棱
        face: 0x4caf50,  // 面心
        grid: 0x00aaff   // 网格点
    };

    const ballGeom = new THREE.SphereGeometry(12, 16, 16);
    const ballMatFinal = new THREE.MeshBasicMaterial({ color: 0xff5533 });
    // const ballMatPreview = new THREE.MeshBasicMaterial({
    //     color: 0x00aaff,
    //     transparent: true,
    //     opacity: 0.6,
    // });
    const ballMatPreview = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6 });

    const finalBalls = [];   // 持久标记
    // let previewBall = null;
    let previewBall = null, previewType = "";
    let anchorAWorld = null;      // ★ 记录 meshA 选中的锚点（世界坐标）

    function ensurePreviewBall() {
        if (!previewBall) {
            previewBall = new THREE.Mesh(ballGeom, ballMatPreview);
            previewBall.scale.set(1.5, 1.5, 1.5);
            scene.add(previewBall);
        }
        previewBall.visible = false;
    }

    function placeFinalBall(worldPos, type) {
        const mat = new THREE.MeshBasicMaterial({ color: ANCHOR_COLORS[type] });
        const b = new THREE.Mesh(ballGeom, mat);
        b.position.copy(worldPos);
        scene.add(b);
        finalBalls.push(b);
    }

    function resetPreview() {
        if (previewBall) previewBall.visible = false;
    }

    function resetConnectMode() {
        connectState = 0;
        meshA = meshB = null;
        highlightPath([]);
        resetPreview();
        // 删除所有已放置的锚点球
        finalBalls.forEach((b) => scene.remove(b));
        finalBalls.length = 0;

        /* ★ 通知外部“已重置选取”——在 Step-1 会回到当前子结构 */
        onSelect([]);
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5).convertSRGBToLinear();
    const camera = new THREE.PerspectiveCamera(
        50,
        canvasEl.clientWidth / canvasEl.clientHeight,
        0.1,
        5000
    );
    camera.position.set(1000, 800, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvasEl });
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

    // let nameLabel = null;               // 当前 mesh 的名称标签
    // function removeNameLabel() {        // 统一清理标签
    //     if (nameLabel) {
    //         nameLabel.parent?.remove(nameLabel);
    //         nameLabel = null;
    //     }
    // }

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;

    // 柔和环境光 + 方向光
    const ambientCol = new THREE.Color(0xffffff).convertSRGBToLinear();
    scene.add(new THREE.AmbientLight(ambientCol, 1.0));
    const dirCol = new THREE.Color(0xffffff).convertSRGBToLinear();
    const dirLight = new THREE.DirectionalLight(dirCol, 0.6);
    dirLight.position.set(300, 600, 500);
    scene.add(dirLight);

    /* ---------- 全局坐标系箭头 ---------- */
    // 箭头长度取家具整体最大尺寸的 60%，缺省 1000 mm
    const rootDims = furnitureTree.dims ?? { width: 1000, height: 1000, depth: 1000 };
    const arrowLen = Math.max(rootDims.width, rootDims.height, rootDims.depth) * 0.6;
    const headLen = arrowLen * 0.1;    // 箭头头部为长度的 10%
    const headWd = headLen * 0.6;     // 箭头宽度略小于头长

    // X 轴 (红)
    const xDir = new THREE.Vector3(1, 0, 0);
    const xArrow = new THREE.ArrowHelper(xDir, new THREE.Vector3(0, 0, 0), arrowLen, 0xff0000, headLen, headWd);
    xArrow.renderOrder = 1000;
    scene.add(xArrow);

    // Y 轴 (绿)
    const yDir = new THREE.Vector3(0, 1, 0);
    const yArrow = new THREE.ArrowHelper(yDir, new THREE.Vector3(0, 0, 0), arrowLen, 0x00ff00, headLen, headWd);
    yArrow.renderOrder = 1000;
    scene.add(yArrow);

    // Z 轴 (蓝)
    const zDir = new THREE.Vector3(0, 0, 1);
    const zArrow = new THREE.ArrowHelper(zDir, new THREE.Vector3(0, 0, 0), arrowLen, 0x0000ff, headLen, headWd);
    zArrow.renderOrder = 1000;
    scene.add(zArrow);

    // 从 tree 递归生成 mesh
    const meshMap = new Map(); // key: path.join('/')  value: mesh
    const nameIndex = {};            // partName -> pathStr[]
    let colorIndex = 0;                        // 顺序取色
    function makeMaterial() {
        const hex = pastelColors[colorIndex++ % pastelColors.length];
        const mat = new THREE.MeshStandardMaterial({
            color: hex,
            roughness: 0.45,
            metalness: 0.05
        });
        // 将 sRGB 颜色转换到线性空间
        mat.color.convertSRGBToLinear();
        return mat;
    }

    /**
     * 递归把 tree 中每个带尺寸的节点转成 Mesh，
     * 再给它加一层淡灰描边：EdgesGeometry + LineSegments
     */
    function addNode(node, parentGroup) {
        const group = new THREE.Group();
        group.name = node.path.join("/");
        parentGroup.add(group);

        if (node.isLeaf && node.dims) {
            const geom = dimsToBoxGeom(node.dims);
            const mesh = new THREE.Mesh(geom, makeMaterial());

            /* ★ 为每个 mesh 做一个常驻名字标签 ------------------- */
            const div = document.createElement("div");
            div.className = "mesh-label";
            div.textContent = node.path.at(-1);
            /* 内联样式，免去全局 CSS */
            Object.assign(div.style, {
                padding: "2px 4px",
                fontSize: "12px",
                background: "rgba(255,255,255,0.8)",
                borderRadius: "3px",
                color: "#333"
            });
            const label = new CSS2DObject(div);
            const h = node.dims?.height || 0;
            label.position.set(0, h * 0.55 + 10, 0);
            mesh.add(label);
            /* 之后在高亮阶段会用到 */
            mesh.userData.label = label;

            /* --------- NEW: 给每个 mesh 加可见边框线 --------- */
            const edgeGeom = new THREE.EdgesGeometry(geom, 20);
            // 将 sRGB 灰色转换到线性空间
            const edgeCol = new THREE.Color(0x555555).convertSRGBToLinear();
            const edgeMat = new THREE.LineBasicMaterial({
                color: edgeCol,
                transparent: true,
                opacity: 0.4
            }); // 如果觉得边框还不够“亮”或“柔和”，也可以在这个基础上微调 opacity（比如 0.6）或换一个浅一点的灰（例如 0x777777）
            const edges = new THREE.LineSegments(edgeGeom, edgeMat);
            mesh.add(edges);// 直接作为子物体挂在 mesh 上，跟随缩放/移动

            /****************************************************/
            const pathStr = node.path.join("/");
            mesh.userData = { pathArr: node.path, path: node.path, pathStr };
            /* 预生成锚点表（局部坐标） */
            mesh.userData.anchors = generateAnchorPoints(node.dims, 50);
            group.add(mesh);

            meshMap.set(pathStr, mesh);
            const shortName = node.path.at(-1);
            (nameIndex[shortName] ??= []).push(pathStr);
        }

        node.children.forEach((child) => addNode(child, group));
    }
    addNode(furnitureTree, scene);

    /* ------------------------- 建立连接图（无向） ----------------------------- */
    let graph = new Map(); // pathStr -> Set<pathStr>
    rebuildGraph(connections);

    function rebuildGraph(conns) {
        graph = new Map();
        meshMap.forEach((_, k) => graph.set(k, new Set()));

        conns.forEach((pair) => {
            const [aName, bName] = Object.keys(pair);
            const aPaths = nameIndex[aName] ?? [];
            const bPaths = nameIndex[bName] ?? [];
            aPaths.forEach((pa) =>
                bPaths.forEach((pb) => {
                    if (pa !== pb) {
                        graph.get(pa).add(pb);
                        graph.get(pb).add(pa);
                    }
                })
            );
        });
    }


    // 选中辅助框
    // const boxHelper = new THREE.BoxHelper();
    // boxHelper.visible = false;
    // scene.add(boxHelper);

    // TransformControls
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSpace("world");
    tc.addEventListener("dragging-changed", (e) => {
        orbit.enabled = !e.value;
    });
    scene.add(tc.getHelper());

    /* 用于判断“本次 pointerDown 是否点在 gizmo 轴上” */
    function isClickingGizmo() {
        return tc.enabled && tc.axis !== null;   // axis 在 TransformControls 内部 pointerDown 时已被赋值
    }

    let selectedMesh = null;          // 当前 TransformControls 绑在哪个 mesh
    let component = [];               // 该 mesh 所在的连通分量 pathStr[]
    let prevPos = new THREE.Vector3();

    /** 根据连接图 BFS 求连通分量 */
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


    /* ---------- 高亮逻辑 ---------- */
    function highlightPath(selectedPath = []) {
        const targetStr = selectedPath.join("/");
        meshMap.forEach((mesh, pathStr) => {
            const isTarget =
                !targetStr || pathStr.startsWith(targetStr); // 空数组 => 全亮
            mesh.material.transparent = !isTarget;
            mesh.material.opacity = isTarget ? 1 : 0.15;
            mesh.material.needsUpdate = true;

            /* ① 当没有任何选中 (selectedPath.length===0) → 显示所有标签
                ② 选中了某个/某组 → 只显示相关 label，其他隐藏             */
            if (mesh.userData.label) {
                mesh.userData.label.visible =
                    selectedPath.length === 0 || isTarget;
            }

            /* -------- 灰色边框线 -------- */
            mesh.children.forEach((child) => {
                if (child.isLineSegments) {
                    child.material.transparent = !isTarget;
                    // 目标保持原来的 0.4，不相关的则几乎完全透明
                    child.material.opacity = isTarget ? 0.4 : 0.03;
                    child.material.needsUpdate = true;
                }
            });
        });
        // 当 selectedPath 为空 ⇒ 没有任何高亮，隐藏名称标签
        // if (selectedPath.length === 0) removeNameLabel();
    }


    /** 隔离显示：只对 pathArr 内的叶子 mesh 可见 */
    function isolatePath(pathArr = []) {
        const t = pathArr.join("/");
        meshMap.forEach((mesh, key) => {
            mesh.visible = !t || key.startsWith(t);
        });
        // if (!pathArr.length) removeNameLabel();   // 退出隔离时顺带清掉
    }


    // Raycaster 选择
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    let downX = 0,
        downY = 0;

    const CLICK_DIST = 6; // px² 阈值
    let blankDownX = 0, blankDownY = 0;   // 仅在 connect 模式下的“空白鼠标按下”使用

    function pointerDown(ev) {
        /* 若在手柄上按下，则完全交给 TransformControls 处理，阻断我们自己的选取逻辑 */
        if (isClickingGizmo()) return;
        if (currentMode === "connect") {
            handleConnectPointerDown(ev);
            return;
        }
        downX = ev.clientX;
        downY = ev.clientY;

        // 先检测是否点到 mesh
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const hit = raycaster.intersectObjects(getVisibleMeshes(), false);
        if (hit.length) {
            selectMesh(hit[0].object);
            return; // 点到了 mesh，直接结束
        }

        // 没点到 mesh：等待 pointerup 判定是否为“点击”
        window.addEventListener("pointerup", pointerUp, { once: true });
    }

    function pointerUp(ev) {
        const dx = ev.clientX - downX;
        const dy = ev.clientY - downY;
        if (dx * dx + dy * dy < CLICK_DIST * CLICK_DIST) {
            // 认为是单击空白 → 取消高亮
            selectMesh(null);
        }
    }

    /* ---------------- PointerMove：连接模式预览 ---------------- */
    function pointerMove(ev) {
        if (currentMode !== "connect") return;
        if (!(connectState === 1 || connectState === 3)) return;

        ensurePreviewBall();

        const targetMesh = connectState === 1 ? meshA : meshB;
        if (!targetMesh) return;

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const hit = raycaster.intersectObject(targetMesh, false);
        if (!hit.length) {
            previewBall.visible = false;
            return;
        }

        const localHit = targetMesh.worldToLocal(hit[0].point.clone());
        // let best = null,
        //     bestDist = Infinity;
        // targetMesh.userData.anchors.forEach((p) => {
        //     const d = p.distanceToSquared(localHit);
        let best = null, bestDist = Infinity;
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

    /** 仅返回当前可见的 leaf-mesh 列表，供射线检测使用 */
    function getVisibleMeshes() {
        const arr = [];
        meshMap.forEach(m => { if (m.visible) arr.push(m); });
        return arr;
    }

    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", pointerMove);

    /* ---------- 连接模式点击（四步状态机） ---------- */
    function handleConnectPointerDown(ev) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        /* --------  A. 处理“空白处”点击 / 拖拽  -------- */
        const anyMeshHit = raycaster.intersectObjects([...meshMap.values()], false).length > 0;
        if (!anyMeshHit) {
            // 已处于连接流程中 (state 1/2/3) 才考虑“撤销”
            if (connectState !== 0) {
                blankDownX = ev.clientX;
                blankDownY = ev.clientY;
                /* ↑ 不立即重置，等待 pointerup 判断是单击还是拖拽 */

                window.addEventListener("pointerup", function blankUp(e) {
                    const dx = e.clientX - blankDownX;
                    const dy = e.clientY - blankDownY;
                    if (dx * dx + dy * dy < CLICK_DIST * CLICK_DIST) {
                        // 判定为“单击空白” → 重置连接
                        resetConnectMode();
                    }
                    /* 移除一次性监听器 */
                }, { once: true });
            }
            // 即便 connectState === 0，也允许继续 OrbitControls 旋转
            return;   // 不做后续 Mesh / Anchor 处理
        }

        /* —— Step 0：选择 Mesh A —— */
        if (connectState === 0) {
            const hits = raycaster.intersectObjects(getVisibleMeshes(), false);
            if (!hits.length) return;
            meshA = hits[0].object;
            highlightPath(meshA.userData.pathArr);
            connectState = 1;
            /* ★ 通知外部：当前选中 Mesh A */
            onSelect(meshA.userData.pathArr);
            return;
        }

        /* —— Step 1：在 Mesh A 上选锚点 —— */
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
                highlightPath([]); // 取消高亮，进入选 Mesh B
                connectState = 2;
            }
            return;
        }

        /* —— Step 2：选择 Mesh B —— */
        if (connectState === 2) {
            const hits = raycaster.intersectObjects(getVisibleMeshes(), false);
            if (!hits.length) return;
            const m = hits[0].object;
            if (m === meshA) return; // 不允许同物体
            meshB = m;
            highlightPath(meshB.userData.pathArr);
            /* ★ 通知外部：当前选中 Mesh B */
            onSelect(meshB.userData.pathArr);
            connectState = 3;
            return;
        }

        /* —— Step 3：在 Mesh B 上选锚点 —— */
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
            if (best && bestDist <= CONNECT_TOL * CONNECT_TOL) {
                const wp = meshB.localToWorld(best.pos.clone());
                placeFinalBall(wp, best.type);
                resetPreview();

                /* ---------- 让 meshB 所在连通分量整体平移到 meshA ---------- */
                if (anchorAWorld) {
                    const anchorBWorld = wp.clone();
                    const delta = anchorAWorld.clone().sub(anchorBWorld);

                    /* 只移动 meshB “旧”连通分量（尚未加新边，因此不会包含 meshA） */
                    const compB = findComponent(meshB.userData.pathStr);
                    compB.forEach((pathStr) => {
                        const m = meshMap.get(pathStr);
                        if (m) m.position.add(delta);
                    });
                }

                /* ---- 更新连接关系 ---- */
                const n1 = meshA.userData.pathArr.at(-1);
                const n2 = meshB.userData.pathArr.at(-1);
                if (n1 !== n2) {
                    const exists = store.connections.some((c) => {
                        const ks = Object.keys(c);
                        return ks.includes(n1) && ks.includes(n2);
                    });
                    if (!exists) {
                        store.updateConnections([
                            ...store.connections,
                            { [n1]: "", [n2]: "" },
                        ]);
                    }
                }
                /* 重置，准备下一次连接 */
                resetConnectMode();
                // Step 1 中连接完，立即重新排布当前子结构
                if (store.step === 1 && store.currentNodePath.length) {
                    // 第 1 步只想重新排布，不要动相机
                    layoutGroupLine(store.currentNodePath, 50, false);
                }
            }
        }
    }

    function layoutGroupLine(pathArr, margin = 50, focusCamera = true) {
        const prefix = pathArr.join("/");

        /* ---------- 1. 先按连接图把属于该子结构的 mesh 聚成“连通分量” ---------- */
        const clusters = [];
        const visited = new Set();

        meshMap.forEach((_, key) => {
            if (!key.startsWith(prefix) || visited.has(key)) return;

            // BFS 找出一个组件
            const comp = [];
            const q = [key];
            while (q.length) {
                const p = q.shift();
                if (visited.has(p)) continue;
                visited.add(p);
                comp.push(p);
                graph.get(p)?.forEach((n) => {
                    if (n.startsWith(prefix) && !visited.has(n)) q.push(n);
                });
            }
            clusters.push(comp);
        });

        if (!clusters.length) return;

        // 用首个 pathStr 做字典序排序，确保排布确定性
        clusters.sort((a, b) => a[0].localeCompare(b[0]));

        /* ---------- 2. 统计每个组件的包围盒 & 宽度 ---------- */
        const boxes = [];
        const widths = [];
        clusters.forEach((paths) => {
            const box = new THREE.Box3();
            paths.forEach((p) => box.expandByObject(meshMap.get(p)));
            boxes.push(box);
            widths.push(box.max.x - box.min.x);
        });

        /* ---------- 3. 按“组件”水平排开（保持整体居中） ---------- */
        const total = widths.reduce((s, w) => s + w, 0) + margin * (widths.length - 1);
        let cursor = -total * 0.5;

        clusters.forEach((paths, idx) => {
            const box = boxes[idx];
            const center = new THREE.Vector3();
            box.getCenter(center);

            // 目标中心 X
            const newCX = cursor + widths[idx] * 0.5;
            const dx = newCX - center.x;

            // 整组件整体平移 dx
            paths.forEach((p) => {
                const m = meshMap.get(p);
                if (m) m.position.x += dx;
            });

            cursor += widths[idx] + margin;
        });

        /* ---------- 4. 相机一次性对焦所有组件 ---------- */
        if (focusCamera) {
            const groupBox = new THREE.Box3();
            clusters.forEach((paths) =>
                paths.forEach((p) => groupBox.expandByObject(meshMap.get(p)))
            );
            focusCameraOnBox(groupBox);
        }
    }

    /**
  * 将任意若干 group（通过 pathArr 指定）按 X 轴一字排开
  * @param {string[][]} pathsArr 形如 [['sideboard_frame'], ...]
  * @param {number}     margin   组件之间留白
  */
    function layoutPathsLine(pathsArr, margin = 150) {
        if (!pathsArr?.length) return;

        /* 1. 计算每个子结构包围盒 & 宽度 */
        const boxes = [], widths = [], groups = [];
        pathsArr.forEach(pathArr => {
            const group = scene.getObjectByName(pathArr.join("/"));
            if (!group) return;
            groups.push(group);
            const box = new THREE.Box3().setFromObject(group);
            boxes.push(box);
            widths.push(box.max.x - box.min.x);
        });
        if (!boxes.length) return;

        /* 2. 横向排布，保持整体居中 */
        const total = widths.reduce((s, w) => s + w, 0) + margin * (widths.length - 1);
        let cursor = -total * 0.5;

        groups.forEach((g, idx) => {
            const box = boxes[idx], center = new THREE.Vector3();
            box.getCenter(center);
            const newCx = cursor + widths[idx] * 0.5;
            const dx = newCx - center.x;
            g.position.x += dx;      // 整组平移
            cursor += widths[idx] + margin;
        });

        /* 3. 相机对焦全部子结构 */
        const allBox = new THREE.Box3();
        boxes.forEach(b => allBox.expandByPoint(b.min).expandByPoint(b.max));
        focusCameraOnBox(allBox);
    }

    /** 将相机和 OrbitControls 的 target 同时对准给定包围盒 */
    function focusCameraOnBox(box) {
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        // 取最大的边长估算距离，让包围盒恰好充满视野并留一点余量
        const maxDim = Math.max(size.x, size.y, size.z);
        const fovRad = THREE.MathUtils.degToRad(camera.fov);
        const distance = maxDim * 0.65 / Math.tan(fovRad * 0.5);   // 0.65 ≈ 7 5 % 画面填充率

        // 从右前上方 (1,1,1) 方向看过去，方向可随意
        const dir = new THREE.Vector3(1, 1, 1).normalize();
        camera.position.copy(center).addScaledVector(dir, distance);

        // 更新相机裁剪面，避免近裁剪过近 / 远裁剪过远
        camera.near = distance / 50;
        camera.far = distance * 50;
        camera.updateProjectionMatrix();

        // 保证 OrbitControls 以新的中心为旋转/缩放基点
        orbit.target.copy(center);
        orbit.update();
    }

    /* -------- 删除 mesh ---------- */
    function removeMesh(pathStr) {
        const mesh = meshMap.get(pathStr);
        if (!mesh) return;

        // 若当前正选中，解除 TransformControls
        if (mesh === selectedMesh) {
            tc.detach();
            selectedMesh = null;
            component = [];
            // removeNameLabel();
        }

        // 移出场景并释放资源
        mesh.parent?.remove(mesh);
        mesh.traverse(o => {
            if (o.geometry) o.geometry.dispose?.();
            if (o.material) {
                Array.isArray(o.material)
                    ? o.material.forEach(m => m.dispose?.())
                    : o.material.dispose?.();
            }
        });

        // 更新索引
        meshMap.delete(pathStr);
        const short = pathStr.split("/").at(-1);
        if (nameIndex[short]) {
            nameIndex[short] = nameIndex[short].filter(p => p !== pathStr);
            if (nameIndex[short].length === 0) delete nameIndex[short];
        }

        // 连通图删点
        graph.delete(pathStr);
        graph.forEach(set => set.delete(pathStr));
    }

    /* ====== 新增：向当前场景/索引里插入一个全新 leaf-mesh ====== */
    function addMesh(pathArr, dims) {
        const pathStr = pathArr.join("/");

        // 1. 找到父级 THREE.Group（不存在就挂场景根）
        const parentPath = pathArr.slice(0, -1).join("/");
        const parentGrp = scene.getObjectByName(parentPath) || scene;

        // 2. 生成几何、材质、mesh 及淡灰描边
        const geom = dimsToBoxGeom(dims);
        const mesh = new THREE.Mesh(geom, makeMaterial());
        const edgeG = new THREE.EdgesGeometry(geom, 20);
        const edgeM = new THREE.LineBasicMaterial({
            color: new THREE.Color(0x555555).convertSRGBToLinear(),
            transparent: true, opacity: 0.4
        });
        mesh.add(new THREE.LineSegments(edgeG, edgeM));

        /* userData & 预生成锚点 */
        mesh.userData = {
            pathArr,
            path: pathArr,
            pathStr,
            anchors: generateAnchorPoints(dims, 50)
        };

        // 3. 默认放到当前子结构几何中心
        const box = new THREE.Box3().setFromObject(parentGrp);
        box.getCenter(mesh.position);

        parentGrp.add(mesh);

        // 4. 更新各索引
        meshMap.set(pathStr, mesh);
        const short = pathArr.at(-1);
        (nameIndex[short] ??= []).push(pathStr);
        graph.set(pathStr, new Set());        // 初始无连接
    }


    function selectMesh(mesh) {
        // if (nameLabel) { nameLabel.parent?.remove(nameLabel); nameLabel = null; }
        // removeNameLabel();
        if (mesh) {
            selectedMesh = mesh;
            component = findComponent(mesh.userData.pathStr);
            tc.attach(mesh);
            /* 只有当 tc.enabled (drag / scale 模式) 时才 attach */
            if (tc.enabled) tc.attach(mesh);


            prevPos.copy(mesh.position);
            highlightPath(mesh.userData.pathArr);   // 始终是数组
            onSelect(mesh.userData.pathArr);

            /* 在 mesh 上方挂文字标签 */
            // const div = document.createElement("div");
            // div.className = "mesh-name-label";
            // div.textContent = mesh.userData.pathArr.at(-1);
            // div.style.padding = "2px 4px";
            // div.style.fontSize = "12px";
            // div.style.background = "rgba(255,255,255,0.75)";
            // div.style.borderRadius = "3px";
            // div.style.color = "#333";
            // // nameLabel = new CSS2DObject(div);
            // const { height = 0 } = mesh.geometry.parameters;
            // nameLabel.position.set(0, height * 0.55 + 10, 0);
            // mesh.add(nameLabel);
        } else {
            selectedMesh = null;
            component = [];
            // boxHelper.visible = false;
            tc.detach();
            highlightPath([]);            // 取消高亮放这里
            onSelect([]);
        }
    }

    /** 拖动时把 delta 同步到同组件其他 mesh */
    tc.addEventListener("objectChange", () => {
        if (!selectedMesh || tc.mode !== "translate") return;
        const delta = selectedMesh.position.clone().sub(prevPos);
        if (delta.lengthSq() === 0) return;
        prevPos.copy(selectedMesh.position);

        component.forEach((p) => {
            if (p === selectedMesh.userData.pathStr) return;
            const m = meshMap.get(p);
            if (m) m.position.add(delta);
        });
    });

    // ------------------ 模式切换：唯一入口 ------------------
    function setMode(mode) {
        /* 若从 connect 切到其他模式，先清理遗留状态 */
        if (currentMode === "connect" && mode !== "connect") {
            resetConnectMode();
        }
        switch (mode) {
            case "drag":
                tc.enabled = true;
                tc.setMode("translate");
                /* 重新绑定当前 mesh */
                if (selectedMesh) tc.attach(selectedMesh);
                break;

            case "planar":
            case "axis":
                tc.enabled = true;
                tc.setMode("scale");     // 伸缩共用 scale
                if (selectedMesh) tc.attach(selectedMesh);
                break;

            case "connect":
                selectMesh(null);
                resetConnectMode();
                tc.detach();
                tc.enabled = false;      // 完全禁用 gizmo，避免鼠标命中
                break;

            /* ======= 数值尺寸调整 ======= */
            case "numeric":
                tc.detach();             // 不出现 gizmo
                tc.enabled = false;
                break;
        }
        currentMode = mode;
    }

    // 渲染循环
    function animate() {
        requestAnimationFrame(animate);
        orbit.update();
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
    }
    animate();

    // 处理窗口 resize
    window.addEventListener("resize", () => {
        camera.aspect = canvasEl.clientWidth / canvasEl.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(canvasEl.clientWidth, canvasEl.clientHeight);
    });

    return {
        scene,
        camera,
        renderer,
        orbit,
        transformControls: tc,
        meshMap,

        setMode,
        highlightPath,  // 暴露给树面板调用
        isolatePath,     // 供 Pinia / TreeNode 调用

        /** 当连接数据变动时调用 */
        updateConnections(newConns) {
            rebuildGraph(newConns);
        },

        layoutGroupLine,
        layoutPathsLine,
        resetConnectMode,
        removeMesh,
        addMesh
    };
}
