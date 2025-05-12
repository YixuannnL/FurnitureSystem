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
import { assembleAllDrawers } from "../utils/drawerUtils";
import { RESERVED } from "../utils/connectionUtils.js";

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
    /** Step-2 右侧面板显示模式：inter | internal | tree */
    step2View: "inter",
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
    /** 当前仍在“等待确认”的连接，对应 pairKey，空串=无 */
    pendingConnKey: "",
    /** 第三段中需要跟随微调的 pathStr[]，空数组 = 只调 meshA */
    currentSlidingComp: [],

    /** 右上角提示气泡 */
    hintMessage: "", // 为空 = 不显示
    showHint: true, // 用户可以隐藏
    connectSessionActive: false, // 是否处于连接事务
    _connectSnapshotTaken: false, // 该事务是否已拍首帧

    /* ★ 新增：连接模式点击选面临时信息 ★ */
    connectPick: { meshA: "", faceA: "", meshB: "", faceB: "" },

    /* ========== Constraint-Resize (Step-2 专用) ========== */
    constraintMode: false, // 是否处于该模式
    constraintTargets: [], // 选中的子结构 path[][]    (≤30 存数组)
    constraintRefPath: [], // 参考板件 path[]
    constraintAxis: "x", // "x"|"y"|"z"
    constraintRatios: [], // e.g.  [1,1,1]  与 targets 对齐
    constraintHistory: [], // 每次执行后 push 记录
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
    /* —— 切换模式 —— */
    enterConstraintMode() {
      if (this.step !== 2) return;
      this.constraintMode = true;
      this.constraintTargets = [];
      this.constraintRefPath = [];
      this.constraintRatios = [];
      this.constraintAxis = "x";
      this.mode = "constraint"; // 让 controls 等知道
      this.threeCtx?.setMode("constraint");
    },
    exitConstraintMode() {
      this.constraintMode = false;
      this.constraintTargets = [];
      this.constraintRefPath = [];
      this.constraintRatios = [];
      if (this.mode === "constraint") {
        this.mode = "drag";
        this.threeCtx?.setMode("drag");
      }
      this.threeCtx?.highlightPath([]);
    },

    /* —— 选目标子结构（toggle） —— */
    toggleConstraintTarget(pathArr) {
      if (!this.constraintMode) return;
      const key = pathArr.join("/");
      const idx = this.constraintTargets.findIndex((p) => p.join("/") === key);
      if (idx === -1) {
        this.constraintTargets.push(pathArr);
        this.constraintRatios.push(1);
      } else {
        this.constraintTargets.splice(idx, 1);
        this.constraintRatios.splice(idx, 1);
      }
      /* 高亮所有已选 targets & ref 板 */
      const hl = [
        ...this.constraintTargets,
        this.constraintRefPath.length ? this.constraintRefPath : [],
      ];
      this.threeCtx?.highlightPath(hl);
    },

    /* —— 设参考板 —— */
    setConstraintRef(pathArr) {
      if (!this.constraintMode) return;
      this.constraintRefPath = pathArr;
      const hl = [
        ...this.constraintTargets,
        this.constraintRefPath.length ? pathArr : [],
      ];
      this.threeCtx?.highlightPath(hl);
    },

    /* —— 改轴 / 比例 —— */
    setConstraintAxis(axis) {
      if (["x", "y", "z"].includes(axis)) this.constraintAxis = axis;
    },
    setConstraintRatio(idx, val) {
      const n = parseFloat(val);
      if (isFinite(n) && n > 0) this.constraintRatios[idx] = n;
    },

    /* ======== 核心执行：applyConstraintResize() ======== */
    applyConstraintResize() {
      if (
        !this.constraintMode ||
        this.constraintTargets.length < 1 ||
        !this.constraintRefPath.length
      )
        return;

      /* 0. 基本量准备 */
      const axis = this.constraintAxis;
      const refMesh = this.threeCtx?.meshMap.get(
        this.constraintRefPath.join("/")
      );
      if (!refMesh) return;
      const refSize = new THREE.Box3()
        .setFromObject(refMesh)
        .getSize(new THREE.Vector3())[axis];

      /* 比例归一化 → 每组目标长度 */
      const sumR = this.constraintRatios.reduce((s, v) => s + v, 0);
      const targetLens = this.constraintRatios.map((r) => (r / sumR) * refSize);

      /* 1. 拍快照 (整动作一次) */
      this.recordSnapshot();

      /* 2. 对每个子结构做缩放 ======================================= */
      this.constraintTargets.forEach((grpPath, idx) => {
        const gObj = this.threeCtx?.scene.getObjectByName(grpPath.join("/"));
        if (!gObj) return;

        /* A. 计算当前总长（包围盒） */
        const box = new THREE.Box3().setFromObject(gObj);
        const curLen = box.max[axis] - box.min[axis];
        if (curLen < 1e-3) return;
        const goalLen = targetLens[idx];
        const scale = goalLen / curLen;
        if (Math.abs(scale - 1) < 1e-4) return;

        /* B. 遍历该组所有叶子 - mesh，按“厚度判断”决定缩放/平移 */
        /*   – 判断板材在该轴的尺寸 ≤ 5 mm → 认为是厚度，不缩放
         *   – 其它板材：在该轴缩放；并整体对称向 center 平移 Δ/2   */

        /* box center 用来保持对称缩放 */
        const center = new THREE.Vector3();
        box.getCenter(center);

        gObj.traverse((obj) => {
          if (!obj.isMesh) return;
          const dims = (() => {
            const gp = obj.geometry?.parameters;
            if (gp && obj.geometry.type === "BoxGeometry") {
              return gp;
            }
            const b = new THREE.Box3().setFromObject(obj);
            return {
              width: b.max.x - b.min.x,
              height: b.max.y - b.min.y,
              depth: b.max.z - b.min.z,
            };
          })();
          const dimKey =
            axis === "x" ? "width" : axis === "y" ? "height" : "depth";
          const isThickness = dims[dimKey] <= 5.01; // ≤5 mm 视为厚度

          /* ---- 位置微调以保持两端固定 ---- */
          const delta = (scale - 1) * (obj.position[axis] - center[axis]);
          obj.position[axis] += delta;

          /* ---- 几何缩放（非厚度板才缩） ---- */
          if (!isThickness) {
            dims[dimKey] *= scale;
            /* 更新 meta - dims */
            const node = findByPath(this.furnitureTree, obj.userData.pathArr);
            if (node?.dims) node.dims[dimKey] = dims[dimKey];

            /* 替换几何 / 边线 */
            obj.geometry.dispose();
            obj.geometry = new THREE.BoxGeometry(
              dims.width,
              dims.height,
              dims.depth
            );
            obj.children.forEach((c) => {
              if (c.isLineSegments) {
                c.geometry.dispose();
                c.geometry = new THREE.EdgesGeometry(obj.geometry, 20);
              }
            });
          }

          /* ---- 六面信息 & label 高度 ---- */
          obj.userData.faceBBox = getFaceBBox(obj);
          if (obj.userData.label) {
            obj.userData.label.position.set(0, dims.height * 0.55 + 10, 0);
          }
        });
      });

      /* 3. 刷新连接比例（仅同轴 ratio） */
      this.connections.forEach((c) => {
        if (c.axis && c.axis === axis && c.pathA && c.pathB) {
          const mA = this.threeCtx?.meshMap.get(c.pathA);
          const mB = this.threeCtx?.meshMap.get(c.pathB);
          if (mA && mB) {
            const vec = new THREE.Vector3();
            const ctrA = new THREE.Box3()
              .setFromObject(mA)
              .getCenter(new THREE.Vector3())[axis];
            const ctrB = new THREE.Box3()
              .setFromObject(mB)
              .getCenter(new THREE.Vector3())[axis];
            const lenA = new THREE.Box3().setFromObject(mA).getSize(vec)[axis];
            const lenB = new THREE.Box3().setFromObject(mB).getSize(vec)[axis];
            const minOff = -(lenA * 0.5 + lenB * 0.5);
            const axisRange = lenA + lenB;
            const dec = (ctrA - ctrB - minOff) / axisRange;
            c.ratio = +dec.toFixed(3);
          }
        }
      });

      /* 4. 重建无向图 & 通知 UI 刷新 */
      this.threeCtx?.updateConnections(this.connections);

      /* ========= 5. 写入历史 & 清空状态 ========= */
      this.constraintHistory.unshift({
        time: Date.now(),
        axis,
        targets: JSON.parse(JSON.stringify(this.constraintTargets)),
        ref: [...this.constraintRefPath],
        ratios: [...this.constraintRatios],
      });
      /* 仅保留最近 20 条 */
      if (this.constraintHistory.length > 20)
        this.constraintHistory.length = 20;

      /* 清空当前 selection，准备下一次操作 */
      this.constraintTargets = [];
      this.constraintRatios = [];
      this.constraintRefPath = [];
      this.threeCtx?.highlightPath([]);
    },

    setConnectPick(info) {
      this.connectPick = info;
    },
    clearConnectPick() {
      this.connectPick = { meshA: "", faceA: "", meshB: "", faceB: "" };
    },

    startConnectSession() {
      this.connectSessionActive = true;
      this._connectSnapshotTaken = false;
    },
    endConnectSession() {
      this.connectSessionActive = false;
      this._connectSnapshotTaken = false;
    },

    setHint(msg) {
      // 赋新提示文字
      this.hintMessage = msg;
      if (msg) this.showHint = true; // 有新内容时自动显示
    },
    clearHint() {
      // 清空
      this.hintMessage = "";
    },
    toggleHint() {
      // 用户点击 ×
      this.showHint = !this.showHint;
    },

    setCurrentSlidingComp(list) {
      this.currentSlidingComp = list;
    },
    clearCurrentSlidingComp() {
      this.currentSlidingComp = [];
    },

    setPendingConnectionKey(key) {
      this.pendingConnKey = key;
    },
    clearPendingConnectionKey() {
      this.pendingConnKey = "";
    },

    /* ---------- ratio 编辑后 → 即时移动组件 ---------- */
    /* ---------- 连接面板手动编辑后 → 立即移动 meshA ---------- */
    applyRatioChange(connObj) {
      //   console.log("111graph:", ctx.graph);
      /* ===== 帮助函数：在单轴上重算 CA 位置 ===== */
      const adjustAxis = (axis, ratioKey) => {
        const r = this._parseRatio(connObj[ratioKey]);
        if (r === null) return;

        /* —— 1. 找到 meshA / meshB —— */
        const [nameA, nameB] = Object.keys(connObj).filter(
          (k) => !RESERVED.has(k)
        );
        const pathA = this.threeCtx?.nameIndex[nameA]?.[0];
        const pathB = this.threeCtx?.nameIndex[nameB]?.[0];
        const meshA = this.threeCtx?.meshMap.get(pathA);
        const meshB = this.threeCtx?.meshMap.get(pathB);
        if (!meshA || !meshB) return;

        /* —— 2. 当前中心-中心 offset（世界坐标） —— */
        const ctrA = new THREE.Box3()
          .setFromObject(meshA)
          .getCenter(new THREE.Vector3());
        const ctrB = new THREE.Box3()
          .setFromObject(meshB)
          .getCenter(new THREE.Vector3());
        const curOff = ctrA[axis] - ctrB[axis];

        /* —— 3. 目标 offset ← ratio —— */
        const vec = new THREE.Vector3();
        const lenA = new THREE.Box3().setFromObject(meshA).getSize(vec)[axis];
        const lenB = new THREE.Box3().setFromObject(meshB).getSize(vec)[axis];
        const halfA = lenA * 0.5,
          halfB = lenB * 0.5;
        const axisRange = lenA + lenB;
        const minOff = -(halfA + halfB); // ratio = 0
        const desired = r * axisRange + minOff;

        /* —— 4. 平移 **meshA 所在连通分量** —— */
        const delta = desired - curOff;
        if (Math.abs(delta) < 1e-4) return;

        /* 找到 meshA 所在连通分量 (pathStr[]) */
        // const compPa
        /* ======== 只移动「第三段的 slidingComp」或仅 meshA ======== */
        let moveList = this.currentSlidingComp?.length
          ? this.currentSlidingComp
          : [pathA]; // 回退只动 A

        moveList.forEach((p) => {
          if (p === pathB) return; // 保证 B 不动
          const m = this.threeCtx.meshMap.get(p);
          if (!m) return;
          m.position[axis] += delta;
          m.updateMatrixWorld(true);
          m.userData.faceBBox = getFaceBBox(m);
        });
      };

      /* 单轴连接 */
      if (connObj.axis && "ratio" in connObj) {
        adjustAxis(connObj.axis, "ratio");
        return;
      }

      /* 双轴连接 */
      if (connObj.axisU && connObj.axisV) {
        adjustAxis(connObj.axisU, "ratioU");
        adjustAxis(connObj.axisV, "ratioV");
      }
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

      /* ---- 连接事务：仅首次入栈 ---- */
      if (this.connectSessionActive) {
        if (this._connectSnapshotTaken) return; // 后续调用全部跳过
        this._connectSnapshotTaken = true;
      }

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
        /* 【进入 Step-1】
         *   1) 先清空全部连接
         *   2) 立即重新组装标准抽屉，恢复其 8 条内部连接
         */
        this.updateConnections([], true); // 清空
        if (this.threeCtx) {
          assembleAllDrawers(
            this.furnitureTree,
            this.threeCtx.meshMap,
            this.threeCtx.removeMesh, // 回调可安全传入
            this.threeCtx.addMesh
          );
        }

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

        // /* 2.收集所有 Atomic Group，并横向排布 */
        // const atomicPaths = collectAtomicGroups(this.furnitureTree);
        // this.threeCtx?.layoutPathsLine(atomicPaths);
        /* 2. 收集所有 *非空* Atomic Group，并横向排布 */
        const atomicPaths = collectAtomicGroups(this.furnitureTree).filter(
          (p) => {
            const node = findByPath(this.furnitureTree, p);
            return node?.children?.some((c) => c.isLeaf);
          }
        );
        if (atomicPaths.length) {
          this.threeCtx?.layoutPathsLine(atomicPaths);
        } else {
          /* 若真的一个都没有（极端情况），直接让相机保持现状 */
          console.warn("[Step-2] 未找到可排布的子结构，保持当前视图。");
        }

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

    /* ---------- Step-2 面板三视图切换 ---------- */
    setStep2View(view) {
      if (["inter", "internal", "tree"].includes(view)) {
        this.step2View = view;
      }
    },

    /** 删除整个子结构（非 leaf 节点） */
    deleteGroup(pathArr) {
      this.recordSnapshot(); // 撤销快照

      // 1) 收集其所有 leaf-pathStr
      const prefix = pathArr.join("/");
      const toRemove = [];
      this.threeCtx?.meshMap?.forEach((_, p) => {
        if (p.startsWith(prefix + "/")) toRemove.push(p);
      });

      // 2) 删除 mesh
      toRemove.forEach((p) => this.threeCtx?.removeMesh(p));

      // 3) 从 meta 树移除节点
      removeNodeByPath(this.furnitureTree, pathArr);

      // 4) 清理所有相关连接
      this.connections = this.connections.filter((c) => {
        const ks = Object.keys(c).filter((k) => !RESERVED.has(k));
        return !ks.some((name) => toRemove.some((p) => p.endsWith("/" + name)));
      });
      this.threeCtx?.updateConnections(this.connections);
      this.meshRevision++;
    },
  },
});
