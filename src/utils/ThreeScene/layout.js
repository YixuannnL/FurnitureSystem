/* ------------------------------------------------------------------
 * threeScene / layout.js   （修正版）
 * ----------------------------------------------------------------- */

import * as THREE from "three";

export function initLayout(ctx) {
    /* 只提前取到始终不会变的引用 */
    const { meshMap, graph, scene } = ctx;

    /* ================================================================
     * 1. layoutGroupLine —— 子结构内部按连通分量排布
     * ================================================================ */
    function layoutGroupLine(pathArr, margin = 50, focusCamera = true) {
        const prefix = pathArr.join("/");
        const clusters = [];
        const visited = new Set();

        /* --- 聚连通分量 --- */
        meshMap.forEach((_, key) => {
            if (!key.startsWith(prefix) || visited.has(key)) return;
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

        clusters.sort((a, b) => a[0].localeCompare(b[0]));

        /* --- 计算宽度 & 排布 --- */
        const boxes = [];
        const widths = [];
        clusters.forEach((paths) => {
            const box = new THREE.Box3();
            paths.forEach((p) => box.expandByObject(meshMap.get(p)));
            boxes.push(box);
            widths.push(box.max.x - box.min.x);
        });

        const total = widths.reduce((s, w) => s + w, 0) + margin * (widths.length - 1);
        let cursor = -total * 0.5;

        clusters.forEach((paths, idx) => {
            const box = boxes[idx];
            const center = new THREE.Vector3();
            box.getCenter(center);

            const newCX = cursor + widths[idx] * 0.5;
            const dx = newCX - center.x;

            paths.forEach((p) => meshMap.get(p).position.x += dx);
            cursor += widths[idx] + margin;
        });

        if (focusCamera) {
            const groupBox = new THREE.Box3();
            clusters.forEach((paths) =>
                paths.forEach((p) => groupBox.expandByObject(meshMap.get(p)))
            );
            focusCameraOnBox(groupBox);
        }
    }

    /* ================================================================
     * 2. layoutPathsLine —— 多子结构排布
     * ================================================================ */
    function layoutPathsLine(pathsArr, margin = 150) {
        if (!pathsArr?.length) return;

        const boxes = [];
        const widths = [];
        const groups = [];

        pathsArr.forEach((pathArr) => {
            const g = scene.getObjectByName(pathArr.join("/"));
            if (!g) return;
            groups.push(g);
            const b = new THREE.Box3().setFromObject(g);
            boxes.push(b);
            widths.push(b.max.x - b.min.x);
        });
        if (!boxes.length) return;

        const total = widths.reduce((s, w) => s + w, 0) + margin * (widths.length - 1);
        let cursor = -total * 0.5;

        groups.forEach((g, idx) => {
            const box = boxes[idx];
            const center = new THREE.Vector3();
            box.getCenter(center);

            const newCx = cursor + widths[idx] * 0.5;
            g.position.x += newCx - center.x;
            cursor += widths[idx] + margin;
        });

        const allBox = new THREE.Box3();
        boxes.forEach((b) => allBox.expandByPoint(b.min).expandByPoint(b.max));
        focusCameraOnBox(allBox);
    }

    /* ================================================================
     * 3. focusCameraOnBox —— 公共对焦
     *    ★ 此处实时读取 ctx.camera / ctx.orbit ★
     * ================================================================ */
    function focusCameraOnBox(box) {
        const camera = ctx.camera;
        const orbit = ctx.orbit;
        if (!camera || !orbit) return;        // 防御：orbit 尚未就绪

        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        const fovRad = THREE.MathUtils.degToRad(camera.fov);
        const distance = (maxDim * 0.65) / Math.tan(fovRad * 0.5);

        const dir = new THREE.Vector3(1, 1, 1).normalize();
        camera.position.copy(center).addScaledVector(dir, distance);

        camera.near = distance / 50;
        camera.far = distance * 50;
        camera.updateProjectionMatrix();

        orbit.target.copy(center);
        orbit.update();
    }

    /* ================================================================
     * 4. 暴露 API
     * ================================================================ */
    // Object.assign(ctx.publicAPI, {
    //     layoutGroupLine,
    //     layoutPathsLine
    // });

    /* ① 先写回 ctx，供内部模块直接调用 */
    ctx.layoutGroupLine = layoutGroupLine;
    ctx.layoutPathsLine = layoutPathsLine;

    /* ② 再暴露到 publicAPI（保持外部接口向后兼容） */
    Object.assign(ctx.publicAPI, {
        layoutGroupLine,
        layoutPathsLine
    });
}
