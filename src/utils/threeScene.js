
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { dimsToBoxGeom } from "./geometryUtils";
import { pastelColors } from "./colorPalette";

/**
 * 创建 three.js 场景并返回控制 API
 * @param {HTMLCanvasElement} canvasEl
 * @param {Object} furnitureTree
 * @param {(path:string[])=>void} onSelect 回调：高亮对象后，把 path 告诉 Pinia
 */
export function createThreeContext(canvasEl, furnitureTree, onSelect) {
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

            mesh.userData.path = node.path;
            group.add(mesh);
            meshMap.set(node.path.join("/"), mesh);
        }

        node.children.forEach((child) => addNode(child, group));
    }
    addNode(furnitureTree, scene);

    // 选中辅助框
    const boxHelper = new THREE.BoxHelper();
    boxHelper.visible = false;
    scene.add(boxHelper);

    // TransformControls
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSpace("world");
    tc.addEventListener("dragging-changed", (e) => {
        orbit.enabled = !e.value;
    });
    scene.add(tc.getHelper());

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


    // Raycaster 选择
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    function onPointer(e) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects([...meshMap.values()], false);
        if (intersects.length) {
            selectMesh(intersects[0].object);
        } else {
            selectMesh(null);
            highlightPath([]);
        }
    }
    renderer.domElement.addEventListener("pointerdown", onPointer);

    let currentMesh = null;
    function selectMesh(mesh) {
        currentMesh = mesh;
        if (mesh) {
            boxHelper.setFromObject(mesh);
            boxHelper.visible = true;
            tc.attach(mesh);
            highlightPath(mesh.userData.path);
            onSelect(mesh.userData.path);
        } else {
            boxHelper.visible = false;
            tc.detach();
            onSelect([]);
        }
    }

    // 模式切换
    function setMode(mode) {
        if (mode === "connect" || mode === "drag") {
            tc.setMode("translate");
        } else if (mode === "planar" || mode === "axis") {
            tc.setMode("scale");
        }
    }

    // 渲染循环
    function animate() {
        requestAnimationFrame(animate);
        orbit.update();
        renderer.render(scene, camera);
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
        highlightPath  // 暴露给树面板调用
    };
}
