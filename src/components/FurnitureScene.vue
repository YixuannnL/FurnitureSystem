<template>
    <div class="scene-wrapper">
      <canvas ref="canvasEl" class="canvas"></canvas>
      <!-- ★ Step 1 时显示当前子结构名称 -->
      <div v-if="step === 1" class="group-label">{{ groupName }}</div>
    </div>
  </template>
  
  <script setup>
  import { onMounted, ref, computed } from "vue";
  import { useSceneStore } from "../store";
  import { createThreeContext } from "../utils/threeScene";
  
  const store = useSceneStore();
  const canvasEl = ref(null);
  const step = computed(() => store.step);
  const groupName = computed(() => {
  const arr = store.currentNodePath;
  return arr && arr.length ? arr[arr.length - 1] : "";
});
  
  onMounted(() => {
    const ctx = createThreeContext(
      canvasEl.value,
      store.furnitureTree,
      store.connections,      // ← 传入当前连接数据
            (path) => {
        if (store.step === 1) {
          if (path.length === 0) {
            // 空白点击：恢复到当前子结构
            const grp = store.groupPaths[store.groupIdx] || [];
            store.currentNodePath = grp;
            return;
          }
          // 点中了某个 mesh：切到它，但若它不属于当前 group，依然保留 group 层级
          store.currentNodePath = path;
          return;
        }
        // 非第 1 步：正常清空或切换
        store.currentNodePath = path;
      }
    );
    store.setThreeCtx(ctx);
  });
  </script>
  
  <style scoped>
  .scene-wrapper { position: relative; width: 100%; height: 100%; }
  .canvas        { width: 100%; height: 100%; display: block; }
  .group-label   {
    position: absolute;
    top: 8px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.6);
    color: #fff; font-size: 14px;
    padding: 2px 8px; border-radius: 4px;
    pointer-events: none;
  }
  </style>
  