import { defineStore } from "pinia";
import metaRaw from "../data/meta_data.json";
import connRaw from "../data/conn_data.json";
import { buildFurnitureTree, collectGroupsBottomUp, removeNodeByPath, collectAtomicGroups, findByPath, insertLeafUnderParent } from "../utils/geometryUtils";

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
        visitedGroups: new Set(),
        meshRevision: 0,          // ← 新增：mesh 删除时自增
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

            /* ========== 进入 Step 2 ========== */
            if (n === 2) {
                /* 1. 取消隔离，显示所有物体 */
                this.threeCtx?.isolatePath([]);
                this.currentNodePath = [];

                /* 2.收集所有 Atomic Group，并横向排布 */
                const atomicPaths = collectAtomicGroups(this.furnitureTree);
                this.threeCtx?.layoutPathsLine(atomicPaths);

                /* 3. 默认切到连接模式，方便立即操作 */
                this.setMode("connect");
            }

            /* ---------- 进入 Step-3 (完成) ---------- */
            if (n === 3) {
                /* 全部显示、取消高亮、保证可拖动但默认关闭 gizmo */
                this.threeCtx?.isolatePath([]);
                this.threeCtx?.highlightPath([]);
                this.currentNodePath = [];
                this.setMode("drag");           // 回到 drag，gizmo 可用
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
            // ★ 仅对子结构(非叶)排布
            if (this.step === 1 && this.currentNodePath.length) {
                const node = findByPath(this.furnitureTree, this.currentNodePath);
                if (node && !node.isLeaf) {
                    this.threeCtx?.layoutGroupLine(this.currentNodePath);
                }
            }
        },


        /** ---------- 删除单个 mesh ---------- */
        deleteMesh(pathStr) {
            // 1. three.js 场景侧
            this.threeCtx?.removeMesh(pathStr);

            // 2. 删除 furnitureTree 中对应节点
            removeNodeByPath(this.furnitureTree, pathStr.split("/"));

            // 3. 清理所有相关连接
            const leafName = pathStr.split("/").at(-1);
            const filtered = this.connections.filter(c => {
                const ks = Object.keys(c);
                return !ks.includes(leafName);
            });
            this.updateConnections(filtered);

            // 4. 更新选中状态 & 步骤特有排布
            if (this.currentNodePath.join("/") === pathStr) this.currentNodePath = [];
            if (this.step === 1 && this.currentNodePath.length) {
                const node = findByPath(this.furnitureTree, this.currentNodePath);
                const grpPath = node?.isLeaf ? this.currentNodePath.slice(0, -1) : this.currentNodePath;
                if (grpPath.length) this.threeCtx?.layoutGroupLine(grpPath);
            }

            // 5. 触发依赖刷新
            this.meshRevision++;
        },

        /* =============== 新增：在当前子结构下添加部件 =============== */
        addMesh(parentPath, name, dims) {
            // 1. 同级重名校验
            const parentNode = findByPath(this.furnitureTree, parentPath);
            if (!parentNode || parentNode.children.some(c => c.name === name)) return;

            const pathArr = [...parentPath, name];
            const leaf = { name, type: "board", dims, path: pathArr, children: [], isLeaf: true };

            // 2. 更新家具树
            insertLeafUnderParent(this.furnitureTree, parentPath, leaf);

            // 3. three.js 场景插入
            this.threeCtx?.addMesh(pathArr, dims);

            // 4. 触发依赖刷新 & 重新排布
            this.meshRevision++;
            if (this.step === 1) {
                this.threeCtx?.layoutGroupLine(parentPath);   // parent 一定是子结构
            }
        },

        /* -------- (1) 复制已有 mesh -------- */
        copyMesh(parentPath, srcPathStr, newName) {
            const srcNode = findByPath(this.furnitureTree, srcPathStr.split("/"));
            if (!srcNode || !srcNode.dims) return;
            this.addMesh(parentPath, newName, { ...srcNode.dims });
        },

        /* -------- (2) 创建默认尺寸 mesh -------- */
        createDefaultMesh(parentPath, newName) {
            const parentNode = findByPath(this.furnitureTree, parentPath);
            const base = parentNode?.dims ?? { width: 300, height: 300, depth: 300 };
            const dims = {
                width: base.width / 3,
                height: base.height / 3,
                depth: base.depth / 3
            };
            this.addMesh(parentPath, newName, dims);
        }

    }
});
