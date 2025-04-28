import * as THREE from "three";

/* ---------- 公共下载工具 ---------- */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

/* ===== 计算 orientationData ===== */

/** 方向判定阈值（单位与模型一致，mm） */
const EPS = 1;            // 小于 1 mm 视为同平面，不计方向

/** 把 world-space 包围盒中心取出来 */
function getMeshCenter(mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const c = new THREE.Vector3();
    box.getCenter(c);
    return c;
}

/**
 * 生成 orientationData（递归）
 * @param {Object} node      家具树节点
 * @param {Map<string,THREE.Mesh>} meshMap
 * @returns {Object}         orientationData 结构
 */
function buildOrientationNode(node, meshMap) {
    /* 1. 仅考虑“直接叶子”子节点 */
    const leafChildren = node.children.filter((c) => c.isLeaf);

    /** 预存 { name, center } */
    const infos = leafChildren.map((c) => {
        const pathStr = c.path.join("/");
        const mesh = meshMap.get(pathStr);
        if (!mesh) return null;
        return { name: c.name, center: getMeshCenter(mesh) };
    }).filter(Boolean);

    /* 2. 两两比较方位 */
    const childrenOrientation = [];
    for (let i = 0; i < infos.length; i++) {
        for (let j = i + 1; j < infos.length; j++) {
            const a = infos[i], b = infos[j];
            const relAB = [];
            const relBA = [];

            const dx = b.center.x - a.center.x;
            if (dx > EPS) { relAB.push("<Right>"); relBA.push("<Left>"); }
            if (dx < -EPS) { relAB.push("<Left>"); relBA.push("<Right>"); }

            const dy = b.center.y - a.center.y;
            if (dy > EPS) { relAB.push("<Top>"); relBA.push("<Bottom>"); }
            if (dy < -EPS) { relAB.push("<Bottom>"); relBA.push("<Top>"); }

            const dz = b.center.z - a.center.z;
            if (dz > EPS) { relAB.push("<Front>"); relBA.push("<Back>"); }
            if (dz < -EPS) { relAB.push("<Back>"); relBA.push("<Front>"); }

            if (relAB.length) {
                childrenOrientation.push({
                    objectA: a.name,
                    objectB: b.name,
                    relation: relAB
                });
                childrenOrientation.push({
                    objectA: b.name,
                    objectB: a.name,
                    relation: relBA
                });
            }
        }
    }

    /* 3. 递归到下一层非叶子 child */
    const children = node.children
        .filter((c) => !c.isLeaf)
        .map((c) => buildOrientationNode(c, meshMap));

    return {
        objectName: node.name,
        childrenOrientation,                // 可能为空数组
        children                              // 可能为空数组
    };
}

/* ========= 对外主函数 ========= */

/**
 * 生成包含 meta/conn/orientation 的单一 JSON 并触发下载
 * @param {Object} metaTree   最新家具 meta 树（state.furnitureTree）
 * @param {Array}  connections 最新连接数组
 * @param {Map}    meshMap     threeCtx.meshMap（当前三维场景最终状态）
 */
export function exportFinalJson(metaTree, connections, meshMap) {
    const orientationData = buildOrientationNode(metaTree, meshMap);

    const final = {
        metaData: metaTree,
        connData: connections,
        orientationData
    };

    const blob = new Blob([JSON.stringify(final, null, 2)], {
        type: "application/json"
    });
    downloadBlob(blob, "final_furniture_data.json");
}
