<template>
    <div
      :class="['node', { selected }]"
      @click.stop="selectNode"
      :style="{ paddingLeft: depth * 12 + 'px' }"
    >
      <span v-if="hasChildren" @click.stop="toggle">
        {{ open ? '▼' : '▶' }}
      </span>
      <span v-else style="display:inline-block;width:14px"></span>
      {{ node.name }}
    </div>
    <div v-show="open">
      <TreeNode
        v-for="child in node.children"
        :key="child.path.join('/')"
        :node="child"
        :depth="depth + 1"
      />
    </div>
  </template>
  
  <script setup>
  import { ref, computed } from "vue";
  import { useSceneStore } from "../store";
  import TreeNode from "./TreeNode.vue";
  
  const props = defineProps({ node: Object, depth: { type: Number, default: 0 } });
  const open = ref(true);
  const hasChildren = computed(() => props.node.children.length);
  const store = useSceneStore();
  
  const selected = computed(
    () => store.currentNodePath.join("/") === props.node.path.join("/")
  );
  
  function selectNode() {
    store.currentNodePath = props.node.path;
    // 高亮对应 mesh / 组
    store.threeCtx?.highlightPath(props.node.path);
  }
  
  function toggle() {
    open.value = !open.value;
  }
  </script>
  
  <style scoped>
  .node {
    cursor: pointer;
    padding: 2px 4px;
  }
  .node.selected {
    background: #d8f3dc;
  }
  </style>
  