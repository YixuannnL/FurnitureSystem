<template>
    <div class="toolbar">
    <!-- ★ 操作模式按钮：Step0 仅留 drag，其他步骤保留全部 -->
    <button
      v-for="b in visibleBtns"
      :key="b.mode"
      :class="{ active: mode === b.mode }"
      @click="set(b.mode)"
    >
      {{ b.label }}
    </button>
  
    <!-- Step 1 子结构遍历 -->
    <template v-if="step === 1">
      <button @click="prevGroup" :disabled="!hasPrevGroup">上一个子结构</button>
      <button @click="nextGroup" :disabled="!hasMoreGroup">下一个子结构</button>
    </template>
  
      <!-- 主步骤切换 -->
      <button @click="prev" :disabled="step === 0">上一步</button>
      <button @click="next" :disabled="step === 3">下一步</button>
  
      <!-- 完成导出 -->
      <button v-if="step === 3" @click="exportData">导出数据</button>
    </div>
  </template>
  
  <script setup>
  import { computed } from "vue";
  import { useSceneStore } from "../store";
  import { exportJson } from "../utils/exportUtils";
  
  const store = useSceneStore();
  const mode = computed(() => store.mode);
  const step = computed(() => store.step);
  const hasMoreGroup = computed(() => store.hasMoreGroup);
  const hasPrevGroup = computed(() => store.hasPrevGroup);   
  
/* --- 所有模式按钮 --- */
const allBtns = [
  { mode: "connect", label: "连接" },
  { mode: "planar",  label: "共面伸缩" },
  { mode: "axis",    label: "XYZ 伸缩" },
  { mode: "drag",    label: "拖动" }
];

/* ★ Step 0 只显示 drag */
const visibleBtns = computed(() =>
  step.value === 0 ? allBtns.filter(b => b.mode === "drag") : allBtns
);
  
  function set(m)        { store.setMode(m); }
  function next()        { store.nextStep(); }
  function prev()        { store.prevStep(); }
  function nextGroup()   { store.nextGroup(); }
  function prevGroup()   { store.prevGroup(); }              // ★ 新增
  function exportData()  { exportJson(store.furnitureTree, store.connections); }
  </script>
  
  <style scoped>
  .toolbar {
    display: flex;
    gap: 6px;
    padding: 4px;
    background: #eee;
  }
  button {
    padding: 4px 8px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  button.active {
    background: #42b983;
    color: #fff;
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  </style>
  