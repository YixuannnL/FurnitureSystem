<template>
  <div class="panel">
    <h4>连接关系 ({{ conns.length }})</h4>
    <div v-for="(c, i) in conns" :key="i" class="conn">
      <!-- <code>
        {{ Object.keys(c)[0] }}.<span>{{ c.faceA || '?' }}</span>
        ↔
        {{ Object.keys(c)[1] }}.<span>{{ c.faceB || '?' }}</span>
      </code>
      <template v-if="c.axis">
        <span class="axis">沿 {{ c.axis.toUpperCase() }} 轴</span>
        <input v-model="ratioStrs[i]" @blur="commit(i)" />
      </template>
      <span v-else class="ok">自动对齐 ✓</span> -->
      <code>
        {{ objKeys(c)[0] }} ↔ {{ objKeys(c)[1] }}
        <template v-if="c.axis">
          : {{ axisLabel(c.axis) }}_
          <input v-model="ratioStrs[i]" @blur="commit(i)" class="ratio-input" />
        </template>
        <span v-else class="ok"> 自动对齐 ✓</span>
      </code>
      <button @click="del(i)">删除</button>
    </div>
    <button class="add" @click="adding = !adding">
      {{ adding ? "取消" : "增加连接" }}
    </button>
    <div v-if="adding" class="add-ui">
      <input v-model="left" placeholder="meshA 路径" />
      <input v-model="right" placeholder="meshB 路径" />
      <button @click="add">确认</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useSceneStore } from "../store";
const store = useSceneStore();
const conns = computed(() => store.connections);
const ratioStrs = ref(conns.value.map((c) => c.ratio ?? ""));
const parseRatio = store._parseRatio; // 便捷引用

const objKeys = (o) => Object.keys(o);
/* x/y/z → Width/Height/Depth */
const axisLabel = (a) => {
  if (a === "x") return "Width";
  if (a === "y") return "Height";
  return "Depth";
};

const adding = ref(false);
const left = ref("");
const right = ref("");

watch(conns, (n) => {
  ratioStrs.value = n.map((c) => c.ratio ?? "");
});

function del(i) {
  const arr = conns.value.slice();
  arr.splice(i, 1);
  store.updateConnections(arr);
}

function commit(i) {
  const arr = conns.value.slice();
  // const oldRaw = arr[i].ratio ?? 0; // 旧值（number）
  // const newRaw = ratioStrs.value[i]; // 输入框内容

  // /* 解析为十进制数；若解析失败则维持原状 */
  // const oldR = typeof oldRaw === "number" ? oldRaw : parseRatio(oldRaw);
  // const newR = parseRatio(newRaw);
  // if (newR === null || oldR === null) return;

  const oldRaw = arr[i].ratio ?? "0";
  const newRaw = ratioStrs.value[i];

  /* -------- 工具：分数/小数 → 十进制 -------- */
  const toDec = (str) => {
    if (typeof str === "number") return str;
    if (/^\d+\/\d+$/.test(str)) {
      const [n, d] = str.split("/").map(Number);
      return d ? n / d : 0;
    }
    const f = parseFloat(str);
    return isNaN(f) ? null : f;
  };

  const oldR = toDec(oldRaw);
  const newR = toDec(newRaw);
  if (oldR === null || newR === null || Math.abs(newR - oldR) < 1e-6) return;

  /* 写入连接对象（字符串形式，交给 updateConnections 再解析） */
  arr[i] = { ...arr[i], ratio: newRaw };

  store.recordSnapshot(); // 撤销点
  store.updateConnections(arr, true); // skipUndo => 不重复入栈
  store.applyRatioChange(arr[i], oldR, newR);
  console.log("oldR, newR:", oldR, newR);
}

function add() {
  if (!left.value || !right.value) return;
  const arr = conns.value.slice();
  arr.push({ [left.value]: "", [right.value]: "" });
  store.updateConnections(arr);
  left.value = right.value = "";
  adding.value = false;
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
.add-ui {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.add {
  margin-top: 4px;
}
.ratio-input {
  width: 50px;
}
</style>
