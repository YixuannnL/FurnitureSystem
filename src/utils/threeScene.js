
import * as THREE from "three";
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { dimsToBoxGeom } from "./geometryUtils";

/**
 * 创建 three.js 场景并返回控制 API
 */
export function createThreeContext(canvasEl, furnitureTree, onSelect) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
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

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;

    // 默认灯光
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(300, 400, 500);
    scene.add(dirLight);

    // 从 tree 递归生成 mesh
    const meshMap = new Map(); // key: path.join('/')  value: mesh
    const tempMat = new THREE.MeshStandardMaterial({ color: 0x8fbcd4, roughness: 0.8 });

    function addNode(node, parentGroup) {
        const group = new THREE.Group();
        group.name = node.path.join("/");
        parentGroup.add(group);

        if (node.dims) {
            const geom = dimsToBoxGeom(node.dims);
            const mesh = new THREE.Mesh(geom, tempMat.clone());
            mesh.userData.path = node.path;
            group.add(mesh);
            meshMap.set(node.path.join("/"), mesh);
        }

        node.children.forEach((child) => addNode(child, group));
    }
    addNode(furnitureTree, scene);

    // 选中辅助框
    const boxHelper = new THREE.BoxHelper();
    scene.add(boxHelper);

    // TransformControls
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSpace("world");
    tc.addEventListener("dragging-changed", (e) => {
        orbit.enabled = !e.value;
    });
    scene.add(tc.getHelper());

    // Raycaster 选择
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    function onPointer(e) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(Array.from(meshMap.values()), true);
        if (intersects.length) {
            const mesh = intersects[0].object;
            selectMesh(mesh);
        } else {
            selectMesh(null);
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
        setMode
    };
}
