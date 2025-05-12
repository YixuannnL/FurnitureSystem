<template>
  <div class="panel">
    <h4>全部子结构 (可删)</h4>
    <ul class="tree">
      <!-- 从根节点开始递归 -->
      <TreeNodeX :node="root" />
    </ul>
  </div>
</template>

<script setup>
import { useSceneStore } from "../store";
import TreeNodeX from "./TreeNodeX.vue";

const store = useSceneStore();
const root = store.furnitureTree;
</script>

<style scoped>
.panel {
  padding: 6px;
  font-size: 13px;
  overflow: auto;
}
.tree {
  list-style: none;
  padding-left: 0;
}
</style>
