<template>
    <div class="tree">
      <template v-for="node in [root]" :key="node.path.join('/')">
        <TreeNode :node="node" />
      </template>
    </div>
  </template>
  
  <script setup>
  import { useSceneStore } from "../store";
  import TreeNode from "./TreeNode.vue";
  const store = useSceneStore();
  const root = store.furnitureTree;
  </script>
  
  <style scoped>
  .tree {
    overflow: auto;
    font-size: 13px;
    line-height: 1.3;
    user-select: none;
  }
  </style>
  