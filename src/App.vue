<template>
  <div class="app">
    <header><StepperBar /></header>
    <main>
      <aside class="left">
        <PartTree />
      </aside>

      <section class="center">
        <FurnitureScene />
      </section>

      <aside class="right">
        <!-- 数值尺寸模式优先 -->
        <SizeAdjustPanel   v-if="mode === 'numeric'" />
         <!-- 其它模式下：按步骤切换 -->
        <GroupPanel        v-else-if="step === 1" />
        <ConnectionPanel   v-else /> <!-- Step 0 / 2 / 3 均显示连接面板 -->
      </aside>

    </main>
    <footer><Toolbar /></footer>
  </div>
</template>

<script setup>
import { computed } from 'vue'  
import StepperBar from "./components/StepperBar.vue";
import PartTree from "./components/PartTree.vue";
import FurnitureScene from "./components/FurnitureScene.vue";
import ConnectionPanel from "./components/ConnectionPanel.vue";
import SizeAdjustPanel from "./components/SizeAdjustPanel.vue";
import Toolbar from "./components/Toolbar.vue";
import GroupPanel from "./components/GroupPanel.vue";
import { useSceneStore } from "./store";
const store = useSceneStore();
const step = computed(() => store.step);
const mode = computed(() => store.mode);
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
aside.left {
  width: 260px;
  border-right: 1px solid #e2e2e2;
  overflow: auto;
}
aside.right {
  width: 260px;
  border-left: 1px solid #e2e2e2;
  overflow: auto;
}
section.center {
  flex: 1 1 auto;
  position: relative;
}
footer {
  flex: 0 0 auto;
}
</style>
