/*  src/utils/threeScene/meshManager.js
    --------------------------------------------------------------
    负责：
      • 解析 meta 树 → 生成 three.js Mesh & 淡灰描边
      • pastel 随机上色、名称标签
      • meshMap / nameIndex（同名板件 disambiguation）维护
      • addMesh / removeMesh 动态增删
      • 调 assembleAllDrawers 进行抽屉自动装配
    -------------------------------------------------------------- */

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { dimsToBoxGeom, generateAnchorPoints, getFaceBBox } from "../geometryUtils";
import { pastelColors } from "../colorPalette";
import { assembleAllDrawers } from "../drawerUtils";

/**
 * 供 threeScene/index.js 调用
 * @param {Object} ctx — 共享上下文对象（在 index.js 里创建）
 */
export function initMeshManager(ctx) {
    const {
        furnitureTree,
        scene
        /* ctx 里还会陆续注入 camera / orbit / graph / … */
    } = ctx;

    /* ------------------------------------------------------------
       1. 全局索引 & 辅助
    ------------------------------------------------------------ */
    ctx.meshMap = new Map();   // pathStr  → THREE.Mesh
    ctx.nameIndex = {};          // shortName → [pathStr, …]

    let colorIndex = 0;
    function makeMaterial() {
        const hex = pastelColors[colorIndex++ % pastelColors.length];
        const mat = new THREE.MeshStandardMaterial({
            color: hex,
            roughness: 0.45,
            metalness: 0.05
        });
        mat.color.convertSRGBToLinear();     // pastel → 线性空间
        return mat;
    }

    /* ------------------------------------------------------------
       2. 递归把 meta 树转成 THREE.Group / Mesh
    ------------------------------------------------------------ */
    function addNode(node, parentGroup) {
        const group = new THREE.Group();
        group.name = node.path.join("/");
        parentGroup.add(group);

        if (node.isLeaf && node.dims) {
            /* ---------- 创建带描边的 Mesh ---------- */
            const geom = dimsToBoxGeom(node.dims);
            const mesh = new THREE.Mesh(geom, makeMaterial());
            mesh.name = node.path.at(-1);

            /* 2.1   名称标签 (CSS2DObject) */
            const div = document.createElement("div");
            div.className = "mesh-label";
            div.textContent = mesh.name;
            Object.assign(div.style, {
                padding: "2px 4px",
                fontSize: "12px",
                background: "rgba(255,255,255,0.8)",
                borderRadius: "3px",
                color: "#333"
            });
            const label = new CSS2DObject(div);
            const h = node.dims.height || 0;
            label.position.set(0, h * 0.55 + 10, 0);
            mesh.add(label);

            /* 2.2   外轮廓淡灰线 */
            const edgeGeom = new THREE.EdgesGeometry(geom, 20);
            const edgeMat = new THREE.LineBasicMaterial({
                color: new THREE.Color(0x555555).convertSRGBToLinear(),
                transparent: true,
                opacity: 0.4
            });
            mesh.add(new THREE.LineSegments(edgeGeom, edgeMat));

            /* 2.3   userData / 预生成锚点 */
            const pathStr = node.path.join("/");
            mesh.userData = {
                pathArr: node.path,
                path: node.path,
                pathStr,
                faceBBox: getFaceBBox(mesh),      /* ← 新增 */
                label
            };

            group.add(mesh);

            /* ---------- 索引写入 ---------- */
            ctx.meshMap.set(pathStr, mesh);
            const short = node.path.at(-1);
            (ctx.nameIndex[short] ??= []).push(pathStr);
        }

        /* 递归子节点 */
        node.children.forEach(c => addNode(c, group));
    }

    /* 初始整树生成 */
    addNode(furnitureTree, scene);

    /* ------------------------------------------------------------
       3. 抽屉识别 & 自动装配（依赖 meshMap 已就绪）
    ------------------------------------------------------------ */
    assembleAllDrawers(
        furnitureTree,
        ctx.meshMap,
        removeMesh,
        addMesh
    );

    /* ------------------------------------------------------------
       4. 动态新增 / 删除（供 Pinia store 使用）
    ------------------------------------------------------------ */

    /**
     * 删除一个 leaf‑mesh（pathStr 形如 "a/b/c"）
     */
    function removeMesh(pathStr) {
        const mesh = ctx.meshMap.get(pathStr);
        if (!mesh) return;

        /* 若正被 TransformControls 选中，先解除 */
        if (ctx.transformCtrls && ctx.selectedMesh === mesh) {
            ctx.transformCtrls.detach();
            ctx.selectedMesh = null;
            ctx.component = [];
        }

        /* 从场景移除并彻底释放 GPU 资源 */
        mesh.parent?.remove(mesh);
        mesh.traverse(o => {
            o.geometry?.dispose?.();
            if (o.material) {
                Array.isArray(o.material)
                    ? o.material.forEach(m => m.dispose?.())
                    : o.material.dispose?.();
            }
        });

        /* 索引表更新 */
        ctx.meshMap.delete(pathStr);
        const short = pathStr.split("/").at(-1);
        if (ctx.nameIndex[short]) {
            ctx.nameIndex[short] = ctx.nameIndex[short].filter(p => p !== pathStr);
            if (ctx.nameIndex[short].length === 0) delete ctx.nameIndex[short];
        }

        /* 从无向图里删点（若 graph 已建立） */
        if (ctx.graph) {
            ctx.graph.delete(pathStr);
            ctx.graph.forEach(set => set.delete(pathStr));
        }
    }

    /**
     * 在 parentPathArr 下新建一个板件 mesh
     * @param {string[]} pathArr  完整路径（父 + name）
     * @param {Object}   dims     {width,height,depth}
     */
    function addMesh(pathArr, dims) {
        const pathStr = pathArr.join("/");

        /* 1) 找父 THREE.Group（若不存在则挂场景根） */
        const parentPath = pathArr.slice(0, -1).join("/");
        const parentGrp = ctx.scene.getObjectByName(parentPath) || ctx.scene;

        /* 2) Mesh + 描边 + 锚点 */
        const geom = dimsToBoxGeom(dims);
        const mesh = new THREE.Mesh(geom, makeMaterial());
        mesh.name = pathArr.at(-1);

        const edgeG = new THREE.EdgesGeometry(geom, 20);
        const edgeM = new THREE.LineBasicMaterial({
            color: new THREE.Color(0x555555).convertSRGBToLinear(),
            transparent: true,
            opacity: 0.4
        });
        mesh.add(new THREE.LineSegments(edgeG, edgeM));

        /* 名称标签 */
        const div = document.createElement("div");
        div.className = "mesh-label";
        div.textContent = mesh.name;
        Object.assign(div.style, {
            padding: "2px 4px",
            fontSize: "12px",
            background: "rgba(255,255,255,0.8)",
            borderRadius: "3px",
            color: "#333"
        });
        const label = new CSS2DObject(div);
        label.position.set(0, dims.height * 0.55 + 10, 0);
        mesh.add(label);

        /* userData */
        mesh.userData = {
            pathArr: node.path,
            path: node.path,
            pathStr,
            faceBBox: getFaceBBox(mesh),      /* ← 新增 */
            label
        };

        /* 默认摆到父组包围盒中心 */
        const box = new THREE.Box3().setFromObject(parentGrp);
        box.getCenter(mesh.position);

        parentGrp.add(mesh);

        /* 索引维护 */
        ctx.meshMap.set(pathStr, mesh);
        const short = pathArr.at(-1);
        (ctx.nameIndex[short] ??= []).push(pathStr);

        /* 无向图里加一个孤立节点（稍后外部可自行连边） */
        if (ctx.graph) ctx.graph.set(pathStr, new Set());
    }

    /* ------------------------------------------------------------
       5. 对上层暴露 API
    ------------------------------------------------------------ */
    Object.assign(ctx.publicAPI, {
        meshMap: ctx.meshMap,
        addMesh,
        removeMesh
    });

    /* 其它模块若需内部方法（makeMaterial 等）可在 ctx 上取 */
    Object.assign(ctx, { addMesh, removeMesh });
}
