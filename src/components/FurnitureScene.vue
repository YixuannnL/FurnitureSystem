<template>
    <canvas ref="canvasEl" class="canvas"></canvas>
  </template>
  
  <script setup>
  import { onMounted, ref } from "vue";
  import { useSceneStore } from "../store";
  import { createThreeContext } from "../utils/threeScene";
  
  const store = useSceneStore();
  const canvasEl = ref(null);
  
  onMounted(() => {
    const ctx = createThreeContext(canvasEl.value, store.furnitureTree, (path) => {
      store.currentNodePath = path;
    });
    store.setThreeCtx(ctx);
  });
  </script>
  
  <style scoped>
  .canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  </style>
  