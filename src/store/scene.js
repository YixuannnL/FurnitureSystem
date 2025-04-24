import { defineStore } from "pinia";
import metaRaw from "../data/meta_data.json";
import connRaw from "../data/conn_data.json";
import { buildFurnitureTree } from "../utils/geometryUtils";

export const useSceneStore = defineStore("scene", {
    state: () => ({
        /** three.js 场景对象与辅助 API（在 utils/threeScene.js 中创建） */
        threeCtx: null,
        /** 当前高亮 / 编辑的节点（完整路径） */
        currentNodePath: [],
        /** 当前步骤 0~3（0 表示初始总览）*/
        step: 0,
        /** 家具数据树（解析自 meta_data.json） */
        furnitureTree: buildFurnitureTree(metaRaw.meta),
        /** 连接数据（数组） */
        connections: connRaw.data,
        /** 操作模式："connect"|"planar"|"axis"|"drag" */
        mode: "drag"
    }),
    actions: {
        setThreeCtx(ctx) {
            this.threeCtx = ctx;
        },
        setMode(m) {
            this.mode = m;
            this.threeCtx?.setMode(m);
        },
        nextStep() {
            if (this.step < 3) this.step += 1;
        },
        prevStep() {
            if (this.step > 0) this.step -= 1;
        },
        goStep(i) {
            if (i >= 0 && i <= 3) this.step = i;
        },
        updateConnections(newConns) {
            this.connections = newConns;
        }
    }
});
