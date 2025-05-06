import * as THREE from "three";
import { defineStore } from "pinia";
import { UndoManager } from "../utils/undoManager.js";
import metaRaw from "../data/meta_data.json";
import connRaw from "../data/conn_data.json";
import desc from "../data/description.txt?raw";
import {
  buildFurnitureTree,
  collectGroupsBottomUp,
  removeNodeByPath,
  collectAtomicGroups,
  findByPath,
  insertLeafUnderParent,
  dimsToBoxGeom,
  generateAnchorPoints,
  getFaceBBox,
} from "../utils/geometryUtils";

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
    /* 连接数据支持“旧格式(两键)”与“新格式(含 faceA …)” */
    connections: connRaw.data,
    /** 操作模式："connect"|"planar"|"axis"|"drag" */
    mode: "drag",
    /** 第 1 步用到的遍历队列 */
    groupPaths: [],
    groupIdx: -1,
    /** ★ 记录已访问过的子结构，首次进入时用来触发“清空+排布” */
    visitedGroups: new Set(),
    meshRevision: 0, // ← 新增：mesh 删除时自增

    /* ---------- 全局设置 ---------- */
    gridStep: 50, // mm  网格吸附步长
    snapThreshold: 30, // mm  面‑面吸附阈值
    /* ---------- 撤销栈 ---------- */
    undoMgr: new UndoManager(),
    /* —— 共面伸缩实时信息 —— */
    planarInfo: {
      meshA: "", // A 名
      faceA: "", // A 面
      meshB: "", // B 名
      faceB: "", // B 面
    },
    /* ======== 新增：描述文本 & 显示开关 ======== */
    descriptionText: desc,
    showDescription: true,
    /** 已完成的子结构路径集合（路径用 "/" 拼成字符串）*/
    completedGroups: new Set(),
  }),

  getters: {
    hasMoreGroup: (s) =>
      s.groupIdx >= 0 && s.groupIdx < s.groupPaths.length - 1,

    hasPrevGroup: (s) => s.groupIdx > 0,

    /** 判断某个 pathArr 是否已完成（供 TreeNode.vue 调用） */
    isGroupCompleted: (s) => (pathArr) =>
      s.completedGroups.has(pathArr.join("/")),

    /* ---------- 当前子结构相关文本句子 ---------- */
    currentDescSentences(state) {
      /* 只在 Step-1 显示描述 */
      if (state.step !== 1) return [];

      /* —— 当前子结构根路径 —— */
      const grpPath =
        state.groupIdx >= 0
          ? state.groupPaths[state.groupIdx]
          : state.currentNodePath;
      if (!grpPath?.length) return [];

      const node = findByPath(state.furnitureTree, grpPath);
      if (!node) return [];

      /* ---------- 工具与常量 ---------- */
      const toTokens = (str) =>
        str
          .toLowerCase()
          .replace(/_/g, " ") // _ → space
          .split(/\s+/)
          .filter((t) => t && !/^\d+$/.test(t)); // 去纯数字 token

      const DIR = new Set(["left", "right", "top", "bottom", "front", "back"]);
      const GENERIC = new Set(["panel", "panels"]); // 过宽词
      const DRAWER_WORDS = new Set(["drawer", "drawers"]);

      /* 不规则复数映射（可按需扩充） */
      const IRREG = { shelf: "shelves" };

      /* 把 token 数组转成 regex，末词支持复数 */
      const tokensToRegex = (tokens) => {
        if (!tokens.length) return "";
        const last = tokens[tokens.length - 1];
        let lastPat;
        if (IRREG[last]) {
          lastPat = `(?:${last}|${IRREG[last]})`; // shelf / shelves
        } else {
          lastPat = `${last}s?`; // 常规可选 s
        }
        const seq = [...tokens.slice(0, -1), lastPat].join("\\s+");
        return `\\b${seq}\\b`;
      };

      /* ---------- 1) 收集关键词短语 ---------- */
      const phrases = [];

      /* a. 子结构自身名称 */
      phrases.push(toTokens(node.name));

      /* b. 递归收集 **所有后代** 叶子名称 */
      (function collectLeafTokens(n) {
        if (n.isLeaf) {
          phrases.push(toTokens(n.name));
          return;
        }
        n.children.forEach(collectLeafTokens);
      })(node);

      /* ---------- 2) 生成正则集合 ---------- */
      const regStrSet = new Set();

      phrases.forEach((tk) => {
        if (!tk.length) return;

        /* -- 原始短语 -- */
        regStrSet.add(tokensToRegex(tk));

        /* -- 去掉方向词后 (若有变化) -- */
        const noDir = tk.filter((w) => !DIR.has(w));
        if (noDir.length === tk.length || noDir.length === 0) return;

        if (noDir.length >= 2) {
          regStrSet.add(tokensToRegex(noDir));
        } else {
          /* 只剩 1 单词时额外判定：拒绝过宽 & drawer 特殊 */
          const single = noDir[0];
          if (!GENERIC.has(single) && !DRAWER_WORDS.has(single)) {
            regStrSet.add(tokensToRegex(noDir));
          }
        }
      });

      /* ---------- 3) drawer / drawers 专用严格匹配 ---------- */
      const nameTokens = toTokens(node.name);
      if (nameTokens.includes("drawers")) {
        regStrSet.add("\\bdrawers\\b"); // 只复数
      } else if (nameTokens.includes("drawer")) {
        regStrSet.add("\\bdrawer\\b(?!s)"); // 只单数
      }

      const regs = [...regStrSet].map((s) => new RegExp(s, "i"));

      /* ---------- 4) 分句并筛选 ---------- */
      const sentences = state.descriptionText
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      return sentences.filter((sen) => regs.some((re) => re.test(sen)));
    },
  },

  actions: {
    /* ---------- ratio 编辑后 → 即时移动组件 ---------- */
    applyRatioChange(connObj, oldR, newR) {
      if (
        !connObj.axis ||
        oldR === null ||
        newR === null ||
        Math.abs(newR - oldR) < 1e-6
      )
        return;

      /* 1. 找到 meshA / meshB 的唯一路径（同名取第一条） */
      const RESERVED = new Set(["faceA", "faceB", "axis", "ratio"]);
      const names = Object.keys(connObj).filter((k) => !RESERVED.has(k));
      if (names.length < 2) return;
      const [nameA, nameB] = names;

      const pathA = this.threeCtx?.nameIndex[nameA]?.[0];
      const pathB = this.threeCtx?.nameIndex[nameB]?.[0];
      const meshA = this.threeCtx?.meshMap.get(pathA);
      const meshB = this.threeCtx?.meshMap.get(pathB);
      if (!meshA || !meshB) return;

      /* 2. 计算 axis 长度（取 meshB 在该轴方向的尺寸） */
      const axis = connObj.axis; // 'x' | 'y' | 'z'
      let axisLen = 0;
      const dimsB = findByPath(this.furnitureTree, pathB.split("/"))?.dims;
      if (dimsB) {
        axisLen =
          axis === "x"
            ? dimsB.width
            : axis === "y"
            ? dimsB.height
            : dimsB.depth;
      } else {
        /* 退化：用包围盒 */
        const size = new THREE.Box3()
          .setFromObject(meshB)
          .getSize(new THREE.Vector3());
        axisLen = size[axis];
      }
      if (axisLen < 1e-3) return;

      //   /* 3. 仅平移 meshA（被拖动的板件或其父组） */
      //   const delta = (newR - oldR) * axisLen;
      /* 3. 仅平移 meshA：Δ = (newR − oldR) × (lenB − lenA) */
      //   const lenA = lenAaxis;
      //   const lenB = lenBaxis;

      /* 重新计算 lenAaxis / lenBaxis */
      //   {
      //     const vec = new THREE.Vector3();
      //     const boxA = new THREE.Box3().setFromObject(meshA);
      //     boxA.getSize(vec);
      //     lenAaxis = vec[axis];

      //     const boxB = new THREE.Box3().setFromObject(meshB);
      //     boxB.getSize(vec);
      //     lenBaxis = vec[axis];
      //   }
      //   const axisRange = lenBaxis - lenAaxis;
      //   if (axisRange < 1e-3) return;

      //   const delta = (newR - oldR) * axisRange;
      //   const meshMove = meshA; // 只动 A
      /* 3. 仅平移 meshA：Δ = (newR − oldR) × (lenB − lenA) */
      const vec = new THREE.Vector3();

      const lenAaxis = new THREE.Box3().setFromObject(meshA).getSize(vec)[axis];
      const lenBaxis = new THREE.Box3().setFromObject(meshB).getSize(vec)[axis];

      const axisRange = lenBaxis - lenAaxis;
      if (axisRange < 1e-3) return; // 无可滑动范围

      const delta = (newR - oldR) * axisRange;
      const meshMove = meshA; // 只移动 A
      meshMove.position[axis] += delta;
      meshMove.updateMatrixWorld(true);
      meshMove.userData.faceBBox = getFaceBBox(meshMove);
    },

    /* ===== 工具：把  "1/3"  → 0.333 ===== */
    _parseRatio(str) {
      if (typeof str === "number") return str;
      if (/^\d+\/\d+$/.test(str)) {
        const [a, b] = str.split("/").map(Number);
        return b ? +(a / b).toFixed(3) : 0;
      }
      const f = parseFloat(str);
      return isNaN(f) ? null : f;
    },

    /* ===== 快照：仅 Step-1 / Step-2 记录 ===== */
    recordSnapshot() {
      if (!(this.step === 1 || this.step === 2)) return;
      const snap = {
        furnitureTree: JSON.parse(JSON.stringify(this.furnitureTree)),
        connections: JSON.parse(JSON.stringify(this.connections)),
        meshPositions: {},
      };
      if (this.threeCtx) {
        this.threeCtx.meshMap.forEach((m, k) => {
          snap.meshPositions[k] = m.position.toArray(); // [x,y,z]
        });
      }
      this.undoMgr.push(snap);
    },

    /* ===== 撤销 ===== */
    undo() {
      const snap = this.undoMgr.pop();
      if (!snap) return;

      /* 1. 恢复 meta / 连接 */
      this.furnitureTree = snap.furnitureTree;
      this.connections = snap.connections;

      /* 2. three.js 场景同步 */
      if (this.threeCtx) {
        // a) 删除多余 mesh
        this.threeCtx.meshMap.forEach((_, pathStr) => {
          if (!snap.meshPositions[pathStr]) {
            this.threeCtx.removeMesh(pathStr);
          }
        });
        // b) 还原缺失或位置
        Object.entries(snap.meshPositions).forEach(([p, pos]) => {
          let mesh = this.threeCtx.meshMap.get(p);
          if (!mesh) {
            const node = findByPath(this.furnitureTree, p.split("/"));
            if (node && node.dims) this.threeCtx.addMesh(node.path, node.dims);
            mesh = this.threeCtx.meshMap.get(p);
          }
          mesh?.position.set(...pos);
        });

        /* 2-b 尺寸 / 几何 同步 */
        this.threeCtx.meshMap.forEach((mesh, pathStr) => {
          const node = findByPath(this.furnitureTree, pathStr.split("/"));
          if (!node || !node.dims) return;

          /* 若几何已是最新尺寸则跳过 */
          const gp = mesh.geometry?.parameters;
          const same =
            gp &&
            Math.abs(gp.width - node.dims.width) < 1e-3 &&
            Math.abs(gp.height - node.dims.height) < 1e-3 &&
            Math.abs(gp.depth - node.dims.depth) < 1e-3;
          if (same) return;

          /* ——— 重建几何体 ——— */
          mesh.geometry.dispose();
          mesh.geometry = dimsToBoxGeom(node.dims);

          /* ——— 更新描边 ——— */
          mesh.children.forEach((c) => {
            if (c.isLineSegments) {
              c.geometry.dispose();
              c.geometry = new THREE.EdgesGeometry(mesh.geometry, 20);
            }
          });

          /* ——— 重新生成锚点 ——— */
          mesh.userData.anchors = generateAnchorPoints(node.dims, 50);

          /* ——— 调整顶部文字标签高度 ——— */
          if (mesh.userData.label) {
            mesh.userData.label.position.set(
              0,
              node.dims.height * 0.55 + 10,
              0
            );
          }
        });

        // c) 重建连接图
        this.threeCtx.updateConnections(this.connections);
      }
      /* 3. 通知依赖刷 UI */
      this.meshRevision++;
    },

    /* ===== 在换子结构 / 切主步骤时清栈 ===== */
    clearUndo() {
      this.undoMgr.clear();
    },

    /* ---------- 标记当前子结构已完成 ---------- */
    markCurrentGroupCompleted() {
      if (this.step !== 1 || this.groupIdx < 0 || !this.groupPaths.length)
        return;
      const key = this.groupPaths[this.groupIdx].join("/");
      this.completedGroups.add(key);
    },

    /* ======= 新增：开关文字描述 ======= */
    toggleDescription() {
      this.showDescription = !this.showDescription;
    },

    /* -------- 实时写入共面伸缩面板信息 -------- */
    setPlanarInfo(info) {
      this.planarInfo = info;
    },

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
      this.clearUndo();
      // 切换任何步骤前，先清除残留的连接模式锚点
      this.threeCtx?.resetConnectMode?.();

      if (n < 0 || n > 3 || n === this.step) return;

      /* 离开第 1 步：取消隔离 */
      if (this.step === 1 && n !== 1) {
        this.markCurrentGroupCompleted();
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
        this.setMode("drag"); // 回到 drag，gizmo 可用
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
      this.clearUndo();
      // if (!this.hasMoreGroup) return;
      // this.groupIdx += 1;
      if (!this.hasMoreGroup) return;
      /* ⇢ 先把当前子结构记为完成，再进入下一个 */
      this.markCurrentGroupCompleted();
      this.groupIdx += 1;
      this.enterCurrentGroup();
    },
    prevGroup() {
      this.clearUndo();
      if (!this.hasPrevGroup) return;
      this.groupIdx -= 1;
      this.enterCurrentGroup();
    },
    /** 统一处理：隔离 + 首次进入逻辑 */
    enterCurrentGroup() {
      this.currentNodePath = this.groupPaths[this.groupIdx];
      this.threeCtx?.isolatePath(this.currentNodePath);
      this.firstVisitGroup(this.currentNodePath); // ★
    },

    /** ---------- 首次进入子结构：视情况清空内部连接并排布 ---------- */
    firstVisitGroup(pathArr) {
      const key = pathArr.join("/");
      if (this.visitedGroups.has(key)) return;

      const node = findByPath(this.furnitureTree, pathArr);
      const isAtomic =
        node && !node.isLeaf && node.children.every((c) => c.isLeaf);

      /* ---------- Step-1：Atomic 组才拆连接 ---------- */
      if (isAtomic && !node.isAutoDrawer) {
        console.log("node:", node.name);
        /* 1) 收集该组里 **所有** leaf-node 的名字集合 */
        const namesInGroup = new Set();
        this.threeCtx?.meshMap.forEach((_, pathStr) => {
          if (pathStr.startsWith(key)) {
            namesInGroup.add(pathStr.split("/").at(-1));
          }
        });

        /* 2) 删除 “两端都在 namesInGroup” 的旧连接 */
        const filtered = this.connections.filter((c) => {
          const [a, b] = Object.keys(c);
          return !(namesInGroup.has(a) && namesInGroup.has(b));
        });

        if (filtered.length !== this.connections.length) {
          this.updateConnections(filtered, true); // 不进撤销栈
        }
      }

      /* 无论是否 atomic，都要排布子结构 */
      this.threeCtx?.layoutGroupLine(pathArr);
      this.visitedGroups.add(key);
    },

    /** ---------- 连接编辑 ---------- */
    updateConnections(arr, skipUndo = false) {
      // this.recordSnapshot();                 // ★ 先拍快照
      if (!skipUndo) this.recordSnapshot(); // ★ 仅在需要时入栈
      // this.connections = arr;
      /* 深拷贝并统一 ratio 字段格式 */
      this.connections = arr.map((c) => {
        if (c && "ratio" in c) {
          return { ...c, ratio: this._parseRatio(c.ratio) };
        }
        return c;
      });
      // 通知 three.js 重新建立连接图
      this.threeCtx?.updateConnections(arr);
      // 若在Step 1 保证排布实时刷新
      // ★ 仅对子结构(非叶)排布
      if (this.step === 1 && this.currentNodePath.length) {
        const node = findByPath(this.furnitureTree, this.currentNodePath);
        if (node && !node.isLeaf) {
          // 只排布，不对焦
          this.threeCtx?.layoutGroupLine(this.currentNodePath, 50, false);
        }
      }
    },

    /** ---------- 删除单个 mesh ---------- */
    deleteMesh(pathStr) {
      this.recordSnapshot(); // 先拍快照
      // 1. three.js 场景侧
      this.threeCtx?.removeMesh(pathStr);

      // 2. 删除 furnitureTree 中对应节点
      removeNodeByPath(this.furnitureTree, pathStr.split("/"));

      // 3. 清理所有相关连接
      const leafName = pathStr.split("/").at(-1);
      const filtered = this.connections.filter((c) => {
        const ks = Object.keys(c);
        return !ks.includes(leafName);
      });
      this.updateConnections(filtered, true); // deleteMesh 开头已拍过快照

      // 4. 更新选中状态 & 步骤特有排布
      if (this.currentNodePath.join("/") === pathStr) this.currentNodePath = [];
      if (this.step === 1 && this.currentNodePath.length) {
        const node = findByPath(this.furnitureTree, this.currentNodePath);
        const grpPath = node?.isLeaf
          ? this.currentNodePath.slice(0, -1)
          : this.currentNodePath;
        if (grpPath.length) this.threeCtx?.layoutGroupLine(grpPath);
      }

      // 5. 触发依赖刷新
      this.meshRevision++;
    },

    /* =============== 新增：在当前子结构下添加部件 =============== */
    addMesh(parentPath, name, dims) {
      this.recordSnapshot(); // 先拍快照
      // 1. 同级重名校验
      const parentNode = findByPath(this.furnitureTree, parentPath);
      if (!parentNode || parentNode.children.some((c) => c.name === name))
        return;

      const pathArr = [...parentPath, name];
      const leaf = {
        name,
        type: "board",
        dims,
        path: pathArr,
        children: [],
        isLeaf: true,
      };

      // 2. 更新家具树
      insertLeafUnderParent(this.furnitureTree, parentPath, leaf);

      // 3. three.js 场景插入
      this.threeCtx?.addMesh(pathArr, dims);

      // 4. 触发依赖刷新 & 重新排布
      this.meshRevision++;
      if (this.step === 1) {
        this.threeCtx?.layoutGroupLine(parentPath); // parent 一定是子结构
      }
    },

    /* -------- (1) 复制已有 mesh -------- */
    copyMesh(parentPath, srcPathStr, newName) {
      this.recordSnapshot(); // 先拍快照
      const srcNode = findByPath(this.furnitureTree, srcPathStr.split("/"));
      if (!srcNode || !srcNode.dims) return;
      this.addMesh(parentPath, newName, { ...srcNode.dims });
    },

    /* -------- (2) 创建默认尺寸 mesh -------- */
    createDefaultMesh(parentPath, newName) {
      this.recordSnapshot(); // 先拍快照
      const parentNode = findByPath(this.furnitureTree, parentPath);
      const base = parentNode?.dims ?? { width: 300, height: 300, depth: 300 };
      const dims = {
        width: base.width / 3,
        height: base.height / 3,
        depth: base.depth / 3,
      };
      this.addMesh(parentPath, newName, dims);
    },
  },
});
