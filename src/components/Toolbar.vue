<template>
    <div class="toolbar">
      <!-- 操作模式按钮 -->
      <button
        v-for="b in btns"
        :key="b.mode"
        :class="{ active: mode === b.mode }"
        @click="set(b.mode)"
      >
        {{ b.label }}
      </button>
  
      <!-- 第 1 步：遍历子结构 -->
      <button
        v-if="step === 1"
        @click="nextGroup"
        :disabled="!hasMoreGroup"
      >
        下一个子结构
      </button>
  
      <!-- 主要步骤切换 -->
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
  
  const btns = [
    { mode: "connect", label: "连接" },
    { mode: "planar", label: "共面伸缩" },
    { mode: "axis", label: "XYZ 伸缩" },
    { mode: "drag", label: "拖动" }
  ];
  
  function set(m) {
    store.setMode(m);
  }
  function next() {
    store.nextStep();
  }
  function prev() {
    store.prevStep();
  }
  function nextGroup() {
    store.nextGroup();
  }
  function exportData() {
    exportJson(store.furnitureTree, store.connections);
  }
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
    opacity: 0.4;
    cursor: default;
  }
  </style>
  