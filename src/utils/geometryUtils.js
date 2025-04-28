/**
 * 递归构建带唯一 path 的家具树
 *  - 每个节点结构：
 *    {
 *      name: string,                // meta.object
 *      type: string,                // meta.object_type
 *      dims: {w,h,d},
 *      children: [...],
 *      path: string[]               // 根到此节点的 name 序列
 *    }
 */
export function buildFurnitureTree(meta, path = []) {
    const isLeaf = !meta.children || meta.children.length === 0;
    const node = {
        name: meta.object,
        type: meta.object_type,
        dims: meta.dimensions ?? null,
        path,
        children: [],
        isLeaf
    };
    if (!isLeaf) {
        node.children = meta.children.map((c) =>
            buildFurnitureTree(c.meta, [...path, c.meta.object])
        );
    }
    return node;
}

/**
 * 从树根据 path 查找节点
 */
export function findByPath(tree, path) {
    if (!path.length) return tree;
    const [head, ...rest] = path;
    const child = tree.children.find((c) => c.name === head);
    if (!child) return null;
    return findByPath(child, rest);
}

/**
 * 将 {width,height,depth} 快速转成 three.js BoxGeometry
 */
import * as THREE from "three";
export function dimsToBoxGeom({ width, height, depth }) {
    return new THREE.BoxGeometry(width, height, depth);
}

/**
 * 生成长方体可选锚点（局部坐标）：
 *  - 8 顶点
 *  - 12 棱中点
 *  - 6 面中心
 *  - 可选栅格点（gridStep > 0 时）
 * 若只想要“吸附”效果，把距离阈值设得稍大即可（ThreeScene 里会做）。
 */
export function generateAnchorPoints(
    { width: w, height: h, depth: d },
    gridStep = 50
) {
    const hw = w / 2,
        hh = h / 2,
        hd = d / 2;
    const pts = [];

    /* 8 顶点 */
    [-hw, hw].forEach((x) =>
        [-hh, hh].forEach((y) =>
            [-hd, hd].forEach((z) => pts.push(new THREE.Vector3(x, y, z)))
        )
    );

    /* 12 棱中点 */
    const addMid = (a, b) =>
        pts.push(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    for (let i = 0; i < 8; i++) {
        const vx = i & 1 ? hw : -hw;
        const vy = i & 2 ? hh : -hh;
        const vz = i & 4 ? hd : -hd;
        const v = new THREE.Vector3(vx, vy, vz);
        if (vx < 0) addMid(v, v.clone().setX(-vx));
        if (vy < 0) addMid(v, v.clone().setY(-vy));
        if (vz < 0) addMid(v, v.clone().setZ(-vz));
    }

    /* 6 面中心 */
    pts.push(
        new THREE.Vector3(0, 0, hd),
        new THREE.Vector3(0, 0, -hd),
        new THREE.Vector3(0, hh, 0),
        new THREE.Vector3(0, -hh, 0),
        new THREE.Vector3(hw, 0, 0),
        new THREE.Vector3(-hw, 0, 0)
    );

    /* 栅格点（可选）——在六个面上等距布点，便于“网格吸附” */
    if (gridStep > 0) {
        const axes = [
            ["y", "z", hw, "x"],
            ["y", "z", -hw, "x"],
            ["x", "z", hh, "y"],
            ["x", "z", -hh, "y"],
            ["x", "y", hd, "z"],
            ["x", "y", -hd, "z"],
        ];
        axes.forEach(([u, v, dConst, normal]) => {
            const du = { x: w, y: h, z: d }[u];
            const dv = { x: w, y: h, z: d }[v];
            const nu = Math.floor(du / gridStep);
            const nv = Math.floor(dv / gridStep);
            for (let i = -nu; i <= nu; i++) {
                for (let j = -nv; j <= nv; j++) {
                    const p = new THREE.Vector3();
                    p[u] = i * gridStep;
                    p[v] = j * gridStep;
                    p[normal] = dConst;
                    pts.push(p);
                }
            }
        });
    }
    return pts;
}


/** 取得所有非叶子 group 的 path（自底向上、左→右） */
export function collectGroupsBottomUp(root) {
    const result = [];
    function dfs(node) {
        node.children.forEach((c) => dfs(c));
        if (!node.isLeaf && node.path.length) result.push(node.path);
    }
    dfs(root);
    return result; // 已经是自底向上
}


/** 移除树中给定 pathArr 的节点（pathArr 至少含 1 层，根节点不可删） */
export function removeNodeByPath(root, pathArr) {
    if (!pathArr.length) return false;
    const [head, ...rest] = pathArr;
    const idx = root.children.findIndex(c => c.name === head);
    if (idx === -1) return false;
    if (rest.length === 0) {
        root.children.splice(idx, 1);
        return true;
    }
    return removeNodeByPath(root.children[idx], rest);
}

/** 收集所有“原子子结构”
 *   定义：自身不是 leaf，但它的 children 都是 leaf（board）
 *   返回值：path 数组列表
 */
export function collectAtomicGroups(root) {
    const result = [];
    function dfs(node) {
        if (node.isLeaf) return;                 // 叶节点跳过
        const hasGroupChild = node.children.some(c => !c.isLeaf);
        if (!hasGroupChild) {
            // 自己是最底层的非叶 group
            if (node.path.length) result.push(node.path);
        } else {
            node.children.forEach(c => dfs(c)); // 继续向下找
        }
    }
    dfs(root);
    return result;
}

/* ============ 新增：给定父 path，插入新的 leaf Node ============ */
export function insertLeafUnderParent(root, parentPathArr, leafNode) {
    const parent = findByPath(root, parentPathArr);
    if (!parent || parent.isLeaf) return false;
    parent.children.push(leafNode);
    return true;
}