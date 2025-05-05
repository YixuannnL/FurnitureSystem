/* ────────────────────────────────────────────────────────────────
 *  faceUtils.js
 *  ---------------------------------------------------------------
 *  提供拖拽贴面‑连接所需的几何算法工具：
 *     • getParallelFaces(facesA, facesB, threshold)
 *     • gridSnap(value, step)
 *     • ratioFromOffset(offset, axisLen)
 *
 *  约定 face 对象格式（由 meshManager 写入 userData.faceBBox）：
 *     {
 *       name    : 'Left'|'Right'|'Top'|'Bottom'|'Front'|'Back',
 *       axis    : 'x'|'y'|'z',        // 法向所在轴
 *       normal  : THREE.Vector3,      // 单位法向，指向外部
 *       plane   : THREE.Plane,        // 世界坐标平面
 *       center  : THREE.Vector3,      // 面中心 (world)
 *       uDir    : THREE.Vector3,      // 面内第一轴单位向量
 *       vDir    : THREE.Vector3,      // 面内第二轴单位向量
 *       uLen    : Number,             // 对应长度 (mm)
 *       vLen    : Number,
 *       axisLen : Number              // 整体厚度 (沿 normal)
 *     }
 * ──────────────────────────────────────────────────────────────── */

import * as THREE from "three";

/* ================================================================
 * 1. 判断两面是否“平行 + 距离 < threshold”
 *    返回满足条件的 {faceA, faceB, dist, delta, commonAxis}
 * ================================================================
 */
export function getParallelFaces(facesA, facesB, threshold = 30) {
    const result = [];

    Object.values(facesA).forEach(fA => {
        Object.values(facesB).forEach(fB => {
            /* ---- 法向需近似平行 & 相对 ---- */
            const dot = fA.normal.dot(fB.normal);
            if (dot > -0.95) return;              // 必须反向平行 (≈‑1)

            const n = fA.normal;                         // 指向外侧
            const signedDist = fB.center.clone().sub(fA.center).dot(n); // >0 才相向
            const dist = Math.abs(signedDist);

            if (dist > threshold) return;               // 距离超阈

            /* ---- 平移向量 delta (让 A 面贴到 B 面) ---- */
            // const delta = n.clone().setLength(signedDist);

            // /* ---- 面内重叠判定 ------------------------------------------ */
            // const vecAB = fB.center.clone().sub(fA.center);
            // const offU = Math.abs(vecAB.dot(fA.uDir));
            // const offV = Math.abs(vecAB.dot(fA.vDir));
            // const halfU = fA.uLen * 0.5 + fB.uLen * 0.5 + 1;  // +1 mm 容差
            // const halfV = fA.vLen * 0.5 + fB.vLen * 0.5 + 1;

            // if (offU > halfU || offV > halfV) return;   // 两矩形在面内无交集
            /* ---- 面内“旋转矩形”重叠判定 (SAT 简化) --------------------- *
                *  A 面以 (uDirA,vDirA) 为基；B 面可能旋转
                *  计算 B 面在 A 基向量上的投影半径，再做 1D 重叠测试
                * ----------------------------------------------------------- */
            const vecAB = fB.center.clone().sub(fA.center);

            /* 重叠测试对 A.uDir 轴 -------------------------------------- */
            const projABu = Math.abs(vecAB.dot(fA.uDir));
            const rAu = fA.uLen * 0.5;
            const rBu = Math.abs(fB.uDir.dot(fA.uDir)) * (fB.uLen * 0.5) +
                Math.abs(fB.vDir.dot(fA.uDir)) * (fB.vLen * 0.5);
            if (projABu > rAu + rBu + 1) return;     // +1 mm 容差

            /* 重叠测试对 A.vDir 轴 -------------------------------------- */
            const projABv = Math.abs(vecAB.dot(fA.vDir));
            const rAv = fA.vLen * 0.5;
            const rBv = Math.abs(fB.uDir.dot(fA.vDir)) * (fB.uLen * 0.5) +
                Math.abs(fB.vDir.dot(fA.vDir)) * (fB.vLen * 0.5);
            if (projABv > rAv + rBv + 1) return;

            /* ---- 让 A 面平移 delta 后可与 B 面重合 ----------------------- */
            const delta = n.clone().setLength(signedDist);

            /* ---- 判断自动对齐维度 --------------------- */
            let commonAxis = null;          // null = 全对齐 或 2 自由度
            const EPS = 1;                  // 1 mm 容忍
            const sameU = Math.abs(fA.uLen - fB.uLen) < EPS;
            const sameV = Math.abs(fA.vLen - fB.vLen) < EPS;

            if (sameU && !sameV) {
                commonAxis = axisOfDir(fA.vDir);          // v 方向剩余自由度
            } else if (!sameU && sameV) {
                commonAxis = axisOfDir(fA.uDir);          // u 方向剩余自由度
            } else if (!sameU && !sameV) {
                // 两维都不同 → 用户需手动调 2D；此实现先返回 null
                commonAxis = null;
            } /* else 两维都相同 ⇒ commonAxis 留 null */

            result.push({
                faceA: fA,
                faceB: fB,
                dist,
                delta,
                commonAxis      // 可能为 null
            });
        });
    });

    return result;
}

/* 将单位方向量映射到主轴 'x'|'y'|'z' */
function axisOfDir(v) {
    const ax = Math.abs(v.x);
    const ay = Math.abs(v.y);
    const az = Math.abs(v.z);
    if (ax > ay && ax > az) return "x";
    if (ay > az) return "y";
    return "z";
}

/* ================================================================
 * 2. 网格吸附
 * ================================================================
 */
export function gridSnap(value, step = 50) {
    return Math.round(value / step) * step;
}

/* ================================================================
 * 3. 比例换算 offset / axisLen  → 小数 (三位小数)
 * ================================================================
 */
export function ratioFromOffset(offset, axisLen) {
    if (axisLen < 1e-3) return 0;
    return +(offset / axisLen).toFixed(3);
}
