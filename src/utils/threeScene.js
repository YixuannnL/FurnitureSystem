
import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { dimsToBoxGeom } from "./geometryUtils";
import { pastelColors } from "./colorPalette";

/**
 * @param {HTMLCanvasElement} canvasEl
 * @param {Object}           furnitureTree  解析后的树
 * @param {Array}            connections    [{ partA : "", partB : "" }, ...]
 * @param {Function}         onSelect(pathArray)
 */
export function createThreeContext(canvasEl, furnitureTree, connections, onSelect) {
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

    let nameLabel = null;               // 当前 mesh 的名称标签

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;

    // 柔和环境光 + 方向光
    const ambientCol = new THREE.Color(0xffffff).convertSRGBToLinear();
    scene.add(new THREE.AmbientLight(ambientCol, 1.0));
    const dirCol = new THREE.Color(0xffffff).convertSRGBToLinear();
    const dirLight = new THREE.DirectionalLight(dirCol, 0.6);
    dirLight.position.set(300, 600, 500);
    scene.add(dirLight);

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
    }


    /** 隔离显示：只对 pathArr 内的叶子 mesh 可见 */
    function isolatePath(pathArr = []) {
        const t = pathArr.join("/");
        meshMap.forEach((mesh, key) => {
            mesh.visible = !t || key.startsWith(t);
        });
        // // 选中框如失焦需隐藏
        // if (boxHelper.visible && !boxHelper.object.visible) {
        //     boxHelper.visible = false;
        //     tc.detach();
        // }
    }


    // Raycaster 选择
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    let downX = 0,
        downY = 0;

    const CLICK_DIST = 6; // px² 阈值

    function pointerDown(ev) {
        /* 若在手柄上按下，则完全交给 TransformControls 处理，阻断我们自己的选取逻辑 */
        if (isClickingGizmo()) return;
        downX = ev.clientX;
        downY = ev.clientY;

        // 先检测是否点到 mesh
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const hit = raycaster.intersectObjects([...meshMap.values()], false);
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

    renderer.domElement.addEventListener("pointerdown", pointerDown);

    /* ---------- 新增：将一组 mesh 排成一行 ---------- */
    function layoutGroupLine(pathArr, spacing = 200) {
        const prefix = pathArr.join("/");
        const meshes = [];
        meshMap.forEach((m, k) => { if (k.startsWith(prefix)) meshes.push(m); });
        if (!meshes.length) return;

        meshes.sort((a, b) => a.userData.pathStr.localeCompare(b.userData.pathStr));
        const start = -(meshes.length - 1) * spacing * 0.5;
        meshes.forEach((m, i) => m.position.set(start + i * spacing, 0, 0));
    }


    function selectMesh(mesh) {
        if (nameLabel) { nameLabel.parent?.remove(nameLabel); nameLabel = null; }
        if (mesh) {
            selectedMesh = mesh;
            component = findComponent(mesh.userData.pathStr);
            // boxHelper.setFromObject(mesh);
            // boxHelper.visible = true;
            tc.attach(mesh);
            /* 只有当 tc.enabled (drag / scale 模式) 时才 attach */
            if (tc.enabled) tc.attach(mesh);


            prevPos.copy(mesh.position);
            highlightPath(mesh.userData.pathArr);   // 始终是数组
            onSelect(mesh.userData.pathArr);

            /* 在 mesh 上方挂文字标签 */
            const div = document.createElement("div");
            div.className = "mesh-name-label";
            div.textContent = mesh.userData.pathArr.at(-1);
            div.style.padding = "2px 4px";
            div.style.fontSize = "12px";
            div.style.background = "rgba(255,255,255,0.75)";
            div.style.borderRadius = "3px";
            div.style.color = "#333";
            nameLabel = new CSS2DObject(div);
            const { height = 0 } = mesh.geometry.parameters;
            nameLabel.position.set(0, height * 0.55 + 10, 0);
            mesh.add(nameLabel);
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
            default:
                tc.detach();
                tc.enabled = false;      // 完全禁用 gizmo，避免鼠标命中
                break;
        }
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

        layoutGroupLine
    };
}
