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
        <GroupPanel        v-if="step === 1" />
        <ConnectionPanel   v-else-if="step !== 3" />
        <SizeAdjustPanel   v-else />
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
