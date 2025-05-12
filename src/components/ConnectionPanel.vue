<template>
  <div class="panel">
    <h4>连接关系 ({{ conns.length }})</h4>
    <!-- ★ 点击贴面提示区 -->
    <div v-if="pick.meshA && !pendingKey" class="pick-info">
      <p>
        已选择 A 面：<strong>{{ pick.meshA }}</strong> ({{ pick.faceA }})
      </p>
      <p v-if="pick.meshB">
        已选择 B 面：<strong>{{ pick.meshB }}</strong> ({{ pick.faceB }})
      </p>
      <p v-else style="color: #888">请再点选另一个板件的对应面…</p>
    </div>
    <div v-for="(c, i) in conns" :key="i" class="conn">
      <code class="code">
        {{ objKeys(c)[0] }} ↔ {{ objKeys(c)[1] }}

        <template v-if="c.axis">
          : {{ axisLabel(c.axis) }}_
          <input
            v-model="ratioStrs[i]"
            @blur="commit(i, 'ratio')"
            class="ratio-input"
            :disabled="!isEditable(c)"
          />
        </template>

        <template v-else-if="c.axisU && c.axisV">
          : {{ axisLabel(c.axisU) }}_
          <input
            v-model="ratioStrs[i].u"
            @blur="commit(i, 'ratioU')"
            class="ratio-input"
            :disabled="!isEditable(c)"
          />
          &nbsp;
          {{ axisLabel(c.axisV) }}_
          <input
            v-model="ratioStrs[i].v"
            @blur="commit(i, 'ratioV')"
            class="ratio-input"
            :disabled="!isEditable(c)"
          />
        </template>

        <span v-else class="ok"> 自动对齐 ✓</span>
      </code>
      <div class="btn-area">
        <button @click="del(i)">删除</button>
        <!-- 只有在连接处于“待确认”状态才出现 -->
        <button
          v-if="pairKey(c) === pendingKey"
          @click="confirmConn"
          class="confirm-btn"
        >
          确认
        </button>
      </div>
      <!-- {{ pairKey(c) }} -->
    </div>
    <!-- {{ pendingKey }} -->
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useSceneStore } from "../store";
import { findByPath } from "../utils/geometryUtils";
import { RESERVED } from "../utils/connectionUtils";

const pick = computed(() => store.connectPick);

const pairKey = (o) =>
  Object.keys(o)
    .filter((k) => !RESERVED.has(k))
    .sort()
    .join("#");

const pendingKey = computed(() => store.pendingConnKey);

/* —— 判定某条连接是否仍可编辑 —— */
function isEditable(conn) {
  return pairKey(conn) === pendingKey.value; // 仅待确认那一条
}

/* ---------- 新增工具：判定连接是否完全落在某一 group 前缀 ---------- */
function connInGroup(conn, prefix, nameSet) {
  /* 新格式：直接看 path 前缀 */
  if (conn.pathA && conn.pathB) {
    return conn.pathA.startsWith(prefix) && conn.pathB.startsWith(prefix);
  }
  /* 旧格式：退回名字集合 */
  const ks = Object.keys(conn).filter((k) => !RESERVED.has(k));
  return ks.length >= 2 && nameSet.has(ks[0]) && nameSet.has(ks[1]);
}

const curNode = computed(() =>
  findByPath(store.furnitureTree, store.currentNodePath)
);
const isLeafNode = computed(() => !!curNode.value?.isLeaf);
const store = useSceneStore();
const conns = computed(() => {
  /* —— 仅 Step-1 做过滤 —— */
  if (store.step === 1 && store.currentNodePath.length) {
    /* ------------ A. 当前节点是 Leaf ------------ */
    if (isLeafNode.value) {
      // const leafName = store.currentNodePath.at(-1);
      // return store.connections.filter((c) => {
      //   const ks = Object.keys(c);
      //   return ks.includes(leafName);
      // });
      const leafName = store.currentNodePath.at(-1);
      const pathStr = store.currentNodePath.join("/");
      return store.connections.filter((c) => {
        if (c.pathA && c.pathB) {
          return c.pathA === pathStr || c.pathB === pathStr;
        }
        return Object.keys(c).includes(leafName);
      });
    }

    /* ------------ B. 当前节点是 Group ------------ */
    const prefix = store.currentNodePath.join("/");
    // const nameSet = new Set();
    // store.threeCtx?.meshMap?.forEach((_, pathStr) => {
    //   if (pathStr.startsWith(prefix)) {
    //     nameSet.add(pathStr.split("/").at(-1));
    //   }
    // });
    // return store.connections.filter((c) => {
    //   const ks = Object.keys(c).filter((k) => !RESERVED.has(k));
    //   return ks.length >= 2 && nameSet.has(ks[0]) && nameSet.has(ks[1]);
    // });
    /* 组内 leaf-name 集合（旧格式备用） */
    const nameSet = new Set();
    store.threeCtx?.meshMap?.forEach((_, p) => {
      if (p.startsWith(prefix)) nameSet.add(p.split("/").at(-1));
    });
    return store.connections.filter((c) => connInGroup(c, prefix, nameSet));
  }

  /* ---------- Step-2 : 若选中了某个 leaf Mesh，仅显示它的连接 ---------- */
  if (
    store.step === 2 &&
    store.currentNodePath.length && // 选中了东西
    isLeafNode.value // 且确实是 leaf
  ) {
    // const leafName = store.currentNodePath.at(-1);
    // return store.connections.filter((c) => Object.keys(c).includes(leafName));
    const leafName = store.currentNodePath.at(-1);
    const pathStr = store.currentNodePath.join("/");
    return store.connections.filter((c) => {
      if (c.pathA && c.pathB) {
        return c.pathA === pathStr || c.pathB === pathStr;
      }
      return Object.keys(c).includes(leafName);
    });
  }

  /* ---------- Step-2：未选节点 ⇒ 只保留“子结构间”连接 ---------- */
  if (store.step === 2 && store.currentNodePath.length === 0) {
    return store.connections.filter((c) => {
      /* 新格式：优先用 pathA / pathB */
      if (c.pathA && c.pathB) {
        const parentA = c.pathA.substring(0, c.pathA.lastIndexOf("/"));
        const parentB = c.pathB.substring(0, c.pathB.lastIndexOf("/"));
        return parentA !== parentB; // 不属于同一子结构
      }

      /* 旧格式：退回名字→路径映射的第一条 */
      const ks = Object.keys(c).filter((k) => !RESERVED.has(k));
      if (ks.length < 2) return false;

      const pathsA = store.threeCtx?.nameIndex[ks[0]] ?? [];
      const pathsB = store.threeCtx?.nameIndex[ks[1]] ?? [];
      if (!pathsA.length || !pathsB.length) return true; // 无法判断 ⇒ 保留

      const parentA = pathsA[0].substring(0, pathsA[0].lastIndexOf("/"));
      const parentB = pathsB[0].substring(0, pathsB[0].lastIndexOf("/"));
      return parentA !== parentB;
    });
  }

  /* 其它情况：原样返回 */
  return store.connections;
});

const ratioStrs = ref(
  conns.value.map((c) =>
    c.axis
      ? c.ratio ?? ""
      : c.axisU
      ? { u: c.ratioU ?? "", v: c.ratioV ?? "" }
      : ""
  )
);

const objKeys = (o) => Object.keys(o);
/* x/y/z → Width/Height/Depth */
const axisLabel = (a) => {
  if (a === "x") return "Width";
  if (a === "y") return "Height";
  return "Depth";
};

watch(
  conns,
  (n) => {
    ratioStrs.value = n.map((c) =>
      c.axis
        ? c.ratio ?? ""
        : c.axisU
        ? { u: c.ratioU ?? "", v: c.ratioV ?? "" }
        : ""
    );
  },
  { deep: true }
);

function del(i) {
  const arr = conns.value.slice();
  arr.splice(i, 1);
  store.updateConnections(arr);
}

function confirmConn() {
  store.threeCtx?.finalizePendingConnection?.();
}

function commit(i, which) {
  if (!isEditable(conns.value[i])) return; // 已确认后直接无视
  const arr = store.connections.slice();

  /* 2. 找到同一对板件的那条连接 */
  const key = pairKey(conns.value[i]);
  const idx = arr.findIndex((c) => pairKey(c) === key);
  if (idx === -1) return; // 不存在就直接返回，更安全

  /* 取新字符串 */
  const newRaw =
    which === "ratio"
      ? ratioStrs.value[i]
      : which === "ratioU"
      ? ratioStrs.value[i].u
      : ratioStrs.value[i].v;

  /* 分数 / 小数 → 十进制 */
  const toDec = (str) => {
    if (typeof str === "number") return str;
    if (/^\d+\/\d+$/.test(str)) {
      const [n, d] = str.split("/").map(Number);
      return d ? n / d : 0;
    }
    const f = parseFloat(str);
    return isNaN(f) ? null : f;
  };

  const newR = toDec(newRaw);
  if (newR === null) return; // 非数字 → 忽略

  // target[which] = newRaw; // 写入新的 ratio / ratioU / ratioV
  /* 3. 生成更新后的新对象（保持纯函数风格） */
  const newConn = { ...arr[idx] }; // 浅拷贝
  newConn[which] = newRaw; // ratio / ratioU / ratioV

  arr[idx] = newConn;

  store.recordSnapshot();
  store.updateConnections(arr, true); // true=skipUndo 重用上面的快照
  console.log("newConn:", newConn);
  store.applyRatioChange(newConn); // 依据最新 ratio 立即移动
}
</script>

<style scoped>
.panel {
  padding: 6px;
  overflow: auto;
}
.conn {
  display: flex;
  align-items: center;
  gap: 6px;
}
.code {
  flex-grow: 1;
  flex-basis: 0;
  overflow: hidden;
}
.btn-area {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ratio-input {
  width: 50px;
}
.confirm-btn {
  background: #42b983;
  color: #fff;
}
.ratio-input:disabled {
  background: #f3f3f3;
  color: #666;
  cursor: not-allowed;
}
.pick-info {
  margin: 4px 0 6px;
  font-size: 12px;
  line-height: 1.4;
}
</style>
