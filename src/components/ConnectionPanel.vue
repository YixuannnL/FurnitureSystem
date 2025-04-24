<template>
    <div class="panel">
      <h4>连接关系 ({{ conns.length }})</h4>
      <div v-for="(c, i) in conns" :key="i" class="conn">
        <code>{{ Object.keys(c)[0] }} ↔ {{ Object.keys(c)[1] }}</code>
        <button @click="del(i)">删除</button>
      </div>
      <button class="add" @click="adding = !adding">{{ adding ? "取消" : "增加连接" }}</button>
      <div v-if="adding" class="add-ui">
        <input v-model="left" placeholder="meshA 路径" />
        <input v-model="right" placeholder="meshB 路径" />
        <button @click="add">确认</button>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref, computed } from "vue";
  import { useSceneStore } from "../store";
  const store = useSceneStore();
  const conns = computed(() => store.connections);
  
  const adding = ref(false);
  const left = ref("");
  const right = ref("");
  
  function del(i) {
    const arr = conns.value.slice();
    arr.splice(i, 1);
    store.updateConnections(arr);
  }
  function add() {
    if (!left.value || !right.value) return;
    const arr = conns.value.slice();
    arr.push({ [left.value]: "", [right.value]: "" });
    store.updateConnections(arr);
    left.value = right.value = "";
    adding.value = false;
  }
  </script>
  
  <style scoped>
  .panel {
    padding: 6px;
    overflow: auto;
  }
  .conn {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .add-ui {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }
  .add {
    margin-top: 4px;
  }
  </style>
  