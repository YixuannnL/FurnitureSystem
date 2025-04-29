<template>
  <div class="app">
    <header><StepperBar /></header>

    <main>
      <!-- —— 左侧面板 —— -->
      <aside class="left" :style="{ width: leftWidth + 'px' }">
        <PartTree />
      </aside>

      <!-- 左侧拖拽条 -->
      <div
        class="resizer"
        @mousedown="startResize('left', $event)"
      ></div>

      <!-- —— 中央 3D 场景 —— -->
      <section class="center">
        <FurnitureScene />
      </section>

      <!-- 右侧拖拽条 -->
        <div
        class="resizer"
        @mousedown="startResize('right', $event)"
      ></div>

      <!-- —— 右侧面板 —— -->
      <aside class="right" :style="{ width: rightWidth + 'px' }">
        <!-- 数值尺寸模式优先 -->
        <SizeAdjustPanel   v-if="mode === 'numeric'" />
        <!-- Step-1：根据是否叶子决定面板 -->
        <template v-else-if="step === 1">
        <MeshPanel  v-if="isLeaf" />
        <GroupPanel v-else      />
        </template>
        <!-- 其它步骤统一用连接面板 -->
        <ConnectionPanel   v-else /> <!-- Step 0 / 2 / 3 均显示连接面板 -->
      </aside>
    </main>

    <footer><Toolbar /></footer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'  
import StepperBar from "./components/StepperBar.vue";
import PartTree from "./components/PartTree.vue";
import FurnitureScene from "./components/FurnitureScene.vue";
import ConnectionPanel from "./components/ConnectionPanel.vue";
import SizeAdjustPanel from "./components/SizeAdjustPanel.vue";
import Toolbar from "./components/Toolbar.vue";
import GroupPanel from "./components/GroupPanel.vue";
import MeshPanel from './components/MeshPanel.vue';
import { findByPath } from './utils/geometryUtils';
import { useSceneStore } from "./store";

/* ---------- Pinia 状态 ----------- */
const store = useSceneStore();
const step = computed(() => store.step);
const mode = computed(() => store.mode);

/* 判断当前选中的是否叶子节点 */
const isLeaf = computed(() => {
  const node = findByPath(store.furnitureTree, store.currentNodePath);
  return !!node?.isLeaf;
});

/* -------- 可拖拽宽度状态 --------- */
const MIN = 160;              // 面板最小宽度 (px)
const leftWidth  = ref(260);  // 默认 宽度
const rightWidth = ref(260);

let draggingSide = "";        // 'left' | 'right'
let startX = 0;               // pointerdown 位置
let startW = 0;               // 起始宽度

function startResize(side, ev) {
  draggingSide = side;
  startX = ev.clientX;
  startW = side === "left" ? leftWidth.value : rightWidth.value;

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", stopResize);
}

function onMove(ev) {
  if (!draggingSide) return;
  const dx = ev.clientX - startX;

  if (draggingSide === "left") {
    leftWidth.value = Math.max(MIN, startW + dx);
  } else if (draggingSide === "right") {
    /* 右侧拖拽条在右面板左边 → 鼠标左移(+宽), 右移(-宽) */
    rightWidth.value = Math.max(MIN, startW - dx);
  }
}

function stopResize() {
  draggingSide = "";
  window.removeEventListener("mousemove", onMove);
  window.removeEventListener("mouseup", stopResize);
}

</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
header {
  flex: 0 0 auto;
  background: #fff;
  border-bottom: 1px solid #e2e2e2;
  padding: 4px 0;
}
main {
  flex: 1 1 auto;
  display: flex;
  overflow: hidden;
}
/* 左右侧边栏（宽度通过内联 style 动态控制） */
aside.left,
aside.right {
  overflow: auto;
  border: 1px solid #e2e2e2;
  border-top: none;
}
aside.left  { border-left: none;  }
aside.right { border-right: none; }

/* 中央场景自适应填充 */
section.center {
  flex: 1 1 auto;
  position: relative;
  overflow: hidden;
}
footer {
  flex: 0 0 auto;
}

/* -------- 拖拽条样式 -------- */
.resizer {
  width: 6px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
}
.resizer:hover {
  background: rgba(0, 0, 0, 0.08);
}
.resizer:active {
  background: rgba(0, 0, 0, 0.15);
}
</style>
