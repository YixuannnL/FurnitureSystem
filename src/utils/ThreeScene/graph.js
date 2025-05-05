/* ------------------------------------------------------------------
 *  threeScene / graph.js
 *  ――― 维护“无向连接图”：
 *        pathStr  <->  Set<neighborPathStr>
 *  ――― 解决同名板件歧义：若出现重名，只连接同父层级下的那对板件
 *  ――― 提供：
 *        1. rebuildGraph(connections)   → 重建整张图
 *        2. findComponent(rootPathStr)  → BFS 查连通分量
 *
 *  被 initGraph(ctx) 调用后，这两个函数会同时挂到：
 *        ctx.rebuildGraph
 *        ctx.findComponent
 *        ctx.publicAPI.updateConnections   (供外层调用)
 * ------------------------------------------------------------------ */

export function initGraph(ctx) {
    /** @type {Map<string, Set<string>>} */
    const graph = new Map();      // 真正存储连通关系
    ctx.graph = graph;            // 让别的模块也能直接访问

    /**
     * 根据最新连接数组 `conns` 重新生成无向图  
     * 规则：  
     *   - 若两端名称都是唯一 ⇒ 直接连  
     *   - 若出现重名 ⇒ 只连“同父路径”的那对（避免跨组误连）
     */
    function rebuildGraph(conns) {
        const { meshMap, nameIndex } = ctx;

        // 1. 初始化：为场景现存的每个 mesh 建立空邻接表
        graph.clear();
        meshMap.forEach((_, pathStr) => graph.set(pathStr, new Set()));

        // 2. 遍历连接数据
        // conns.forEach((pair) => {
        //     const [nameA, nameB] = Object.keys(pair);         // 连接两端短名
        /* ---------- 预处理：保留真正的 mesh 名（过滤掉新字段） ---------- */
        const RESERVED = new Set(["faceA", "faceB", "axis", "ratio"]);

        function meshKeys(obj) {
            return Object.keys(obj).filter(k => !RESERVED.has(k));
        }

        // 2. 遍历连接数据
        conns.forEach((pair) => {
            const keys = meshKeys(pair);
            if (keys.length < 2) return;                // 防御
            const [nameA, nameB] = keys;               // 两端短名

            const pathsA = nameIndex[nameA] ?? [];            // 同名可能多条路径
            const pathsB = nameIndex[nameB] ?? [];

            if (!pathsA.length || !pathsB.length) return;     // 有一端不存在 — 跳过

            /* —— A、B 都唯一：直接连 —— */
            if (pathsA.length === 1 && pathsB.length === 1) {
                const pa = pathsA[0], pb = pathsB[0];
                if (pa !== pb) {            // 防止自连
                    graph.get(pa).add(pb);
                    graph.get(pb).add(pa);
                }
                return;
            }

            /* —— 至少有一端重名：  
             *    只连“父路径完全相同”的那对，避免跨子结构误串联 —— */
            pathsA.forEach((pa) => {
                const parentA = pa.substring(0, pa.lastIndexOf("/"));
                pathsB.forEach((pb) => {
                    if (pa === pb) return;    // 同一块板件，跳过
                    const parentB = pb.substring(0, pb.lastIndexOf("/"));
                    if (parentA === parentB) {
                        graph.get(pa).add(pb);
                        graph.get(pb).add(pa);
                    }
                });
            });
        });

        /* 把最新 connections 也同步回 ctx，保持单一数据源 */
        ctx.connections = conns;
    }

    /**
     * BFS 取得 `rootPathStr` 所在的连通分量  
     * @param {string} rootPathStr
     * @returns {string[]}  pathStr 列表（包含 root 本身）
     */
    function findComponent(rootPathStr) {
        const visited = new Set();
        const comp = [];
        const queue = [rootPathStr];

        while (queue.length) {
            const p = queue.shift();
            if (visited.has(p)) continue;
            visited.add(p);
            comp.push(p);
            graph.get(p)?.forEach((nbr) => queue.push(nbr));
        }
        return comp;
    }

    /* --------------- 首次构建 --------------- */
    rebuildGraph(ctx.connections);

    /* --------------- 注入到 ctx --------------- */
    Object.assign(ctx, { rebuildGraph, findComponent });

    /* 暴露给外部（与旧版保持接口不变） */
    Object.assign(ctx.publicAPI, {
        updateConnections: rebuildGraph
    });
}
