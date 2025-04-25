<template>
    <div class="panel">
      <h4>本组板件 ({{ leafs.length }})</h4>
      <ul>
        <li v-for="n in leafs" :key="n">{{ n }}</li>
      </ul>
  
      <h4 style="margin-top:8px">内部连接 ({{ conns.length }})</h4>
      <div v-for="(c,i) in conns" :key="i" class="conn">
        <code>{{ Object.keys(c)[0] }} ↔ {{ Object.keys(c)[1] }}</code>
      </div>
    </div>
  </template>
  
  <script setup>
  import { computed } from "vue";
  import { useSceneStore } from "../store";
  const store = useSceneStore();
  const leafs = computed(() => store.currentGroupLeafNames);
  const conns = computed(() => store.currentGroupConns);
  </script>
  
  <style scoped>
  .panel {
    padding: 6px;
    overflow: auto;
  }
  .conn {
    font-size: 12px;
  }
  ul {
    padding-left: 18px;
    margin: 0;
  }
  li {
    font-size: 12px;
  }
  </style>
  