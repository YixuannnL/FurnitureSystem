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
        groupIdx: -1,
        /** ★ 记录已访问过的子结构，首次进入时用来触发“清空+排布” */
        visitedGroups: new Set()
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

            // 切换任何步骤前，先清除残留的连接模式锚点
            this.threeCtx?.resetConnectMode?.();

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
                this.visitedGroups.clear();
                this.currentNodePath = this.groupPaths[0] ?? [];
                this.enterCurrentGroup();
            }

            /* 回到 Step 0：强制设为 drag，防止残留的连接/伸缩手柄 */
            if (n === 0) {
                this.setMode("drag");
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
            this.enterCurrentGroup();
        },
        prevGroup() {
            if (!this.hasPrevGroup) return;
            this.groupIdx -= 1;
            this.enterCurrentGroup();
        },
        /** 统一处理：隔离 + 首次进入逻辑 */
        enterCurrentGroup() {
            this.currentNodePath = this.groupPaths[this.groupIdx];
            this.threeCtx?.isolatePath(this.currentNodePath);
            this.firstVisitGroup(this.currentNodePath);   // ★
        },

        /** ---------- 首次进入子结构：清空内部连接并排布 ---------- */
        firstVisitGroup(pathArr) {
            const key = pathArr.join("/");
            if (this.visitedGroups.has(key)) return;

            /* 1) 取出该组内部全部 leaf 名 */
            const leafNames = [];
            this.threeCtx?.meshMap.forEach((_, k) => {
                if (k.startsWith(key)) leafNames.push(k.split("/").at(-1));
            });
            const nameSet = new Set(leafNames);

            /* 2) 过滤掉内部连接 */
            const newConns = this.connections.filter(c => {
                const [a, b] = Object.keys(c);
                return !(nameSet.has(a) && nameSet.has(b));
            });
            if (newConns.length !== this.connections.length) {
                this.updateConnections(newConns);
            }

            /* 3) 将内部 mesh 一字排开 */
            this.threeCtx?.layoutGroupLine(pathArr);

            this.visitedGroups.add(key);
        },


        /** ---------- 连接编辑 ---------- */
        updateConnections(arr) {
            this.connections = arr;
            // 通知 three.js 重新建立连接图
            this.threeCtx?.updateConnections(arr);
            // 若在Step 1 保证排布实时刷新
            if (this.step === 1 && this.currentNodePath.length) {
                this.threeCtx?.layoutGroupLine(this.currentNodePath);
            }
        }
    }
});
