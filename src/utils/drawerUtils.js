/*  src/utils/drawerUtils.js  —— Drawer 组自动装配  */

import * as THREE from "three";
import { useSceneStore } from "../store";
import { insertLeafUnderParent } from "./geometryUtils";

/* ---------- 角色枚举 ---------- */
const ROLES = ["front", "back", "left", "right", "bottom"];

/* --- 名称 → 角色  -------------------------------------------------- */
function classifyRole(name) {
    const n = name.toLowerCase();
    if (/(front|face)/.test(n)) return "front";
    if (/(back|rear)/.test(n)) return "back";
    if (/left/.test(n)) return "left";
    if (/right/.test(n)) return "right";
    if (/(bottom|base)/.test(n)) return "bottom";
    return null;                       // 未识别
}

/* --- 生成锚点描述 --------------------------------------------------- */
function anchorStr(objName, anchor) {
    return `<${objName}><Board>[<${anchor}>]`;
}

/* 角色 → 默认子板件名（保持与示例一致） */
const NAME_MAP = {
    front: "drawer_front",
    back: "drawer_back",
    left: "drawer_left_side",
    right: "drawer_right_side",
    bottom: "drawer_bottom"
};

/* --- 标准八条连接 --------------------------------------------------- */
function buildStandardConns(role2node) {
    const defs = [
        ["front", "left", "LeftEdge", "FrontEdge"],
        ["front", "right", "RightEdge", "FrontEdge"],
        ["front", "bottom", "BottomEdge", "FrontEdge"],
        ["back", "left", "LeftEdge", "BackEdge"],
        ["back", "right", "RightEdge", "BackEdge"],
        ["back", "bottom", "BottomEdge", "BackEdge"],
        ["bottom", "left", "LeftEdge", "BottomEdge"],
        ["bottom", "right", "RightEdge", "BottomEdge"]
    ];
    return defs.map(([ra, rb, aa, bb]) => ({
        [role2node[ra].name]: anchorStr(role2node[ra].name, aa),
        [role2node[rb].name]: anchorStr(role2node[rb].name, bb)
    }));
}

/* ------------ 角点辅助 ---------------- */
/**
 * 给定 mesh，按符号 ±1 取得局部角点，并转换到世界坐标
 * sx = -1/1 → Left/Right
 * sy = -1/1 → Bottom/Top
 * sz = -1/1 → Back/Front
 */
function cornerWorld(mesh, sx, sy, sz) {
    const g = mesh.geometry;
    const { width, height, depth } =
        g.parameters && g.type === "BoxGeometry"
            ? g.parameters
            : (() => {
                if (!g.boundingBox) g.computeBoundingBox();
                const box = g.boundingBox;
                return {
                    width: box.max.x - box.min.x,
                    height: box.max.y - box.min.y,
                    depth: box.max.z - box.min.z
                };
            })();

    const local = new THREE.Vector3(
        (sx * width) / 2,
        (sy * height) / 2,
        (sz * depth) / 2
    );
    return mesh.localToWorld(local);
}

/* 将 meshMove 的指定角点对齐到 meshRef 对应角点 */
function alignCorner(meshMove, moveCorner, meshRef, refCorner) {
    const cur = cornerWorld(meshMove, ...moveCorner);
    const target = cornerWorld(meshRef, ...refCorner);
    const delta = target.sub(cur);          // target - cur
    meshMove.position.add(delta);           // 仅平移
}

/* ======== 新增：从已有板件推断抽屉整体尺寸 ======== */
function inferDims(role2node) {
    let W = null, H = null, D = null;
    const pick = (v, cur) => cur ?? v;               // 只在值未确定时写入

    // front/back 提供 W & H
    ["front", "back"].forEach(r => {
        const n = role2node[r]; if (!n) return;
        W = pick(n.dims.width, W);
        H = pick(n.dims.height, H);
    });

    // left/right 提供 D & H
    ["left", "right"].forEach(r => {
        const n = role2node[r]; if (!n) return;
        D = pick(n.dims.depth, D);
        H = pick(n.dims.height, H);
    });

    // bottom 提供 W & D
    const b = role2node.bottom;
    if (b) {
        W = pick(b.dims.width, W);
        D = pick(b.dims.depth, D);
    }

    return { W, H, D };
}

/* 给定角色返回应该使用的厚度 */
function getThickness(role, role2node) {
    return role2node.left?.dims.width ?? role2node.right?.dims.width ?? role2node.front?.dims.depth ?? role2node.back?.dims.depth ?? role2node.bottom?.dims.height ?? 3;
}

/* 根据角色 + 整体尺寸 + 厚度 → 板件尺寸 */
function dimsForRole(role, { W, H, D }, t) {
    if (role === "front" || role === "back") return { width: W, height: H, depth: t };
    if (role === "left" || role === "right") return { width: t, height: H, depth: D };
    /* bottom */                       return { width: W, height: t, depth: D };
}

/* ---------- 单个 Drawer 处理 --------------------------------------- */
function processDrawer(groupNode, meshMap, removeMeshCb, addMeshCb) {
    const store = useSceneStore();
    const role2node = Object.fromEntries(ROLES.map(r => [r, null]));
    const redundant = [];

    /* —— 1. 角色归类 + 冗余收集 —— */
    groupNode.children.forEach(child => {
        if (!child.isLeaf) return;              // 只管 Leaf
        const role = classifyRole(child.name);
        if (role && !role2node[role]) {
            role2node[role] = child;              // 首次命中
        } else {
            redundant.push(child);                // 未识别 / 重复
        }
    });

    /* —— 2. 删除冗余部件（meta + three.js） —— */
    if (redundant.length) {
        groupNode.children = groupNode.children.filter(c => !redundant.includes(c));
        redundant.forEach(r => removeMeshCb?.(r.path.join("/")));
        store.meshRevision++;                  // 通知依赖刷新
        console.warn(`[drawerUtils] <${groupNode.name}> 删除冗余板件：${redundant.map(n => n.name).join(", ")}`);
    }

    /* —— 3. 若五件不齐，则跳过自动装配 —— */

    const missing = ROLES.filter(r => !role2node[r]);
    if (missing.length) {
        const { W, H, D } = inferDims(role2node);
        if (W && H && D) {
            /* 有足够尺寸信息，可自动补板 */
            missing.forEach(role => {
                const t = getThickness(role, role2node);
                const dims = dimsForRole(role, { W, H, D }, t);

                /* 生成唯一名字：若原本已有 NAME_MAP[role]，则加 _auto 后缀 */
                let base = NAME_MAP[role] || `${role}_panel`;
                if (groupNode.children.some(c => c.name === base)) {
                    let i = 1;
                    while (groupNode.children.some(c => c.name === `${base}_${i}`)) i++;
                    base = `${base}_${i}`;
                }

                // /* 通过 store.addMesh 插入新板件 + three.js mesh */
                // store.addMesh(groupNode.path, base, dims);

                // /* 取回刚插入的节点对象，更新 role2node */
                // const node = store.furnitureTree &&
                //     store.furnitureTree; // placeholder, will fetch below

                /* --- ① 更新 meta 树 --- */
                const leaf = {
                    name: base,
                    type: "board",
                    dims,
                    isLeaf: true,
                    children: [],
                    path: [...groupNode.path, base]
                };
                insertLeafUnderParent(store.furnitureTree, groupNode.path, leaf);

                /* --- ② 真正生成 mesh 并加入场景 & meshMap --- */
                if (typeof addMeshCb === "function") {
                    addMeshCb(leaf.path, dims);
                }

                /* --- ③ role2node 补位 —— 稍后统一刷 --- */

            });
            // 重新在树中检索一次，确保 role2node 填满
            groupNode.children.forEach(c => {
                const r = classifyRole(c.name);
                if (r && !role2node[r]) role2node[r] = c;
            });
        } else {
            /* 缺尺寸过多，记录状态并退出 */
            groupNode.isDrawerIncomplete = true;
            console.warn(`[drawerUtils] <${groupNode.name}> 缺少板件过多，自动装配已跳过`);
            return;
        }
    }
    // if (!ROLES.every(r => role2node[r])) {
    //     console.warn(`[drawerUtils] <${groupNode.name}> 板件不完整，已跳过自动装配`);
    //     return;
    // }
    /* 重新确认 role2node —— 这时肯定五件齐 */
    groupNode.children.forEach(c => {
        const r = classifyRole(c.name);
        if (r) role2node[r] = c;
    });
    /* 4) === 几何拼装（四次角点吸附）======================== */
    // const meshOf = role => meshMap.get(role2node[role].path.join("/"));
    const meshOf = r => {
        const n = role2node[r];
        return n ? meshMap.get(n.path.join("/")) : undefined;
    };

    /* 若仍缺失 mesh（极端情况），放弃几何对齐但继续写连接 */
    if (!ROLES.every(r => meshOf(r))) {
        console.warn(`[drawerUtils] <${groupNode.name}> mesh 不完整，仅建立连接`);
    } else {
        const mFront = meshOf("front");
        const mBack = meshOf("back");
        const mLeft = meshOf("left");
        const mRight = meshOf("right");
        const mBottom = meshOf("bottom");

        /* a. 左板：右前下 ↔ 前板：左前下 */
        alignCorner(mLeft, [+1, -1, +1], mFront, [-1, -1, +1]);
        /* b. 右板：左前下 ↔ 前板：右前下 */
        alignCorner(mRight, [-1, -1, +1], mFront, [+1, -1, +1]);
        /* c. 底板：左前上 ↔ 前板：左前下 */
        alignCorner(mBottom, [-1, +1, +1], mFront, [-1, -1, +1]);
        /* d. 后板：左前下 ↔ 左板：左后下 */
        // 先把左板已平移后的角点作为参照
        alignCorner(mBack, [-1, -1, +1], mLeft, [-1, -1, -1]);
    }

    /* 5) 连接关系：替换 Drawer 内部旧连接 → 新 8 条 */
    // const groupPrefix = groupNode.path.join("/");
    const partNamesInDrawer = new Set(
        groupNode.children.filter(c => c.isLeaf).map(c => c.name)
    );
    // 保留：至少一端不在 Drawer 内的连接
    const kept = store.connections.filter(c => {
        const ks = Object.keys(c);
        return !(partNamesInDrawer.has(ks[0]) && partNamesInDrawer.has(ks[1]));
    });

    const newConns = buildStandardConns(role2node);
    store.updateConnections([...kept, ...newConns]);

    /* 标记，供其它逻辑（例如 Step-1 排布优化）识别 */
    groupNode.isAutoDrawer = true;
    delete groupNode.isDrawerIncomplete;
}

/* ---------- 遍历整棵树，处理所有 Drawer 组 ------------------------- */
export function assembleAllDrawers(root, meshMap, removeMeshCb, addMeshCb) {
    (function dfs(node) {
        // 满足：非叶 && 名称含 drawer && 子节点至少 1 个 leaf
        if (
            !node.isLeaf &&
            /drawer/i.test(node.name) &&
            node.children.some(c => c.isLeaf)
        ) {
            processDrawer(node, meshMap, removeMeshCb, addMeshCb);
        }
        node.children.forEach(dfs);
    })(root);
}
