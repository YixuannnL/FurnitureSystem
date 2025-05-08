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
const store = useSceneStore();
const conns = computed(() => store.connections);
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

watch(conns, (n) => {
  /* —— 根据连接对象结构，生成与 ratioStrs 同步的数组 —— */
  ratioStrs.value = n.map((c) => {
    /* 单自由轴：直接取 c.ratio */
    if (c.axis) {
      return c.ratio ?? "";
    }
    /* 双自由轴：返回 {u:…, v:…}，供两个输入框使用 */
    if (c.axisU && c.axisV) {
      return {
        u: c.ratioU ?? "",
        v: c.ratioV ?? "",
      };
    }
    /* 其它（完全对齐） */
    return "";
  });
});

function del(i) {
  const arr = conns.value.slice();
  arr.splice(i, 1);
  store.updateConnections(arr);
}

function commit(i, which) {
  const c = conns.value[i];
  const arr = conns.value.slice();

  /* 取旧/新字符串 */
  const oldRaw =
    which === "ratio"
      ? c.ratio ?? "0"
      : which === "ratioU"
      ? c.ratioU ?? "0"
      : c.ratioV ?? "0";

  const newRaw =
    which === "ratio"
      ? ratioStrs.value[i]
      : which === "ratioU"
      ? ratioStrs.value[i].u
      : ratioStrs.value[i].v;

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

  /* 写入连接对象 */
  arr[i] = { ...arr[i], [which]: newRaw };

  store.recordSnapshot();
  store.updateConnections(arr, true);
  store.applyRatioChange(arr[i], oldR, newR);
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
