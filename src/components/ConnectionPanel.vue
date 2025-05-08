<template>
  <div class="panel">
    <h4>连接关系 ({{ conns.length }})</h4>
    <div v-for="(c, i) in conns" :key="i" class="conn">
      <code>
        {{ objKeys(c)[0] }} ↔ {{ objKeys(c)[1] }}

        <template v-if="c.axis">
          : {{ axisLabel(c.axis) }}_
          <input
            v-model="ratioStrs[i]"
            @blur="commit(i, 'ratio')"
            class="ratio-input"
          />
        </template>

        <template v-else-if="c.axisU && c.axisV">
          : {{ axisLabel(c.axisU) }}_
          <input
            v-model="ratioStrs[i].u"
            @blur="commit(i, 'ratioU')"
            class="ratio-input"
          />
          &nbsp;
          {{ axisLabel(c.axisV) }}_
          <input
            v-model="ratioStrs[i].v"
            @blur="commit(i, 'ratioV')"
            class="ratio-input"
          />
        </template>

        <span v-else class="ok"> 自动对齐 ✓</span>
      </code>
      <button @click="del(i)">删除</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useSceneStore } from "../store";
import { findByPath } from "../utils/geometryUtils";

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
      const leafName = store.currentNodePath.at(-1);
      return store.connections.filter((c) => {
        const ks = Object.keys(c);
        return ks.includes(leafName);
      });
    }

    /* ------------ B. 当前节点是 Group ------------ */
    const prefix = store.currentNodePath.join("/");
    const nameSet = new Set();
    store.threeCtx?.meshMap?.forEach((_, pathStr) => {
      if (pathStr.startsWith(prefix)) {
        nameSet.add(pathStr.split("/").at(-1));
      }
    });

    const RESERVED = new Set([
      "faceA",
      "faceB",
      "axis",
      "ratio",
      "axisU",
      "axisV",
      "ratioU",
      "ratioV",
    ]);
    return store.connections.filter((c) => {
      const ks = Object.keys(c).filter((k) => !RESERVED.has(k));
      return ks.length >= 2 && nameSet.has(ks[0]) && nameSet.has(ks[1]);
    });
  }

  /* 其它步骤：不做过滤 */
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

function commit(i, which) {
  const arr = conns.value.slice();
  const target = { ...arr[i] }; // 拷贝避免直接改引用

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

  target[which] = newRaw; // 写入新的 ratio / ratioU / ratioV
  arr[i] = target;

  store.recordSnapshot();
  store.updateConnections(arr, true); // true=skipUndo 重用上面的快照
  store.applyRatioChange(target); // 依据最新 ratio 立即移动
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
.ratio-input {
  width: 50px;
}
</style>
