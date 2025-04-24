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
    const node = {
        name: meta.object,
        type: meta.object_type,
        dims: meta.dimensions ?? null,
        path,
        children: []
    };
    if (meta.children?.length) {
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
