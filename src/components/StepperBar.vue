<template>
    <div class="stepper">
      <div
        v-for="(s, i) in steps"
        :key="i"
        class="step"
        :class="{ active: i === step }"
        @click="store.goStep(i)"
      >
        {{ i }}.{{ s }}
      </div>
    </div>
  </template>
  
  <script setup>
  import { computed } from "vue";
  import { useSceneStore } from "../store";
  const store = useSceneStore();
  const step = computed(() => store.step);
  const steps = ["初始预览", "子结构内部", "子结构间", "完成"];
  </script>
  
  <style scoped>
  .stepper {
    display: flex;
    justify-content: center;
    gap: 8px;
    user-select: none;
  }
  .step {
    padding: 4px 10px;
    border-radius: 4px;
    background: #ccc;
    cursor: pointer;
  }
  .step.active {
    background: #42b983;
    color: #fff;
  }
  </style>
  