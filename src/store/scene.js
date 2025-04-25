import { defineStore } from "pinia";
import metaRaw from "../data/meta_data.json";
import connRaw from "../data/conn_data.json";
import { buildFurnitureTree, collectGroupsBottomUp } from "../utils/geometryUtils";

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
        mode: "drag",
        /** 第 1 步用到的遍历队列 */
        groupPaths: [],
        groupIdx: -1
    }),

    getters: {
        hasMoreGroup: s => s.groupIdx >= 0 && s.groupIdx < s.groupPaths.length - 1,
        hasPrevGroup: s => s.groupIdx > 0
    },

    actions: {
        setThreeCtx(ctx) {
            this.threeCtx = ctx;
            // 如果此刻正处于 group 隔离状态，需要立刻应用
            if (this.step === 1 && this.groupIdx >= 0 && this.groupPaths.length) {
                ctx.isolatePath(this.groupPaths[this.groupIdx]);
            }
        },

        setMode(m) {
            this.mode = m;
            this.threeCtx?.setMode(m);
        },

        /** ---------- 步骤切换 ---------- */
        goStep(n) {
            if (n < 0 || n > 3 || n === this.step) return;

            /* 离开第 1 步：取消隔离 */
            if (this.step === 1 && n !== 1) {
                this.threeCtx?.isolatePath([]);
                this.groupPaths = [];
                this.groupIdx = -1;
            }

            /* 进入第 1 步：准备自底向上遍历队列 */
            if (n === 1) {
                this.groupPaths = collectGroupsBottomUp(this.furnitureTree);
                this.groupIdx = 0;
                this.currentNodePath = this.groupPaths[0] ?? [];
                this.threeCtx?.isolatePath(this.currentNodePath);
            }

            this.step = n;
        },

        nextStep() {
            this.goStep(this.step + 1);
        },

        prevStep() {
            this.goStep(this.step - 1);
        },

        /** ---------- 子结构遍历 ---------- */
        nextGroup() {
            if (!this.hasMoreGroup) return;
            this.groupIdx += 1;
            this.currentNodePath = this.groupPaths[this.groupIdx];
            this.threeCtx?.isolatePath(this.currentNodePath);
        },
        prevGroup() {
            if (!this.hasPrevGroup) return;
            this.groupIdx -= 1;
            this.currentNodePath = this.groupPaths[this.groupIdx];
            this.threeCtx?.isolatePath(this.currentNodePath);
        },


        /** ---------- 连接编辑 ---------- */
        updateConnections(arr) {
            this.connections = arr;
            // 通知 three.js 重新建立连接图
            this.threeCtx?.updateConnections(arr);
        }
    }
});
