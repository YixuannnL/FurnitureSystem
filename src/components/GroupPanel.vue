<template>
    <div class="panel">
      <h4>子结构：{{ groupName }}</h4>
  
      <h5>部件列表</h5>
      <ul>
        <li v-for="n in meshNames" :key="n">{{ n }}</li>
      </ul>
  
      <h5 class="mt">内部连接 ({{ localConns.length }})</h5>
      <div v-for="(c,i) in localConns" :key="i" class="conn">
        <code>{{ keys(c)[0] }} ↔ {{ keys(c)[1] }}</code>
        <button @click="del(i)">删</button>
      </div>
  
      <button @click="adding = !adding">{{ adding?'取消':'新增连接' }}</button>
      <div v-if="adding" class="add-ui">
        <input v-model="left" placeholder="meshA" />
        <input v-model="right" placeholder="meshB" />
        <button @click="add">确认</button>
      </div>
    </div>
  </template>
  
  <script setup>
  import { computed, ref } from "vue";
  import { useSceneStore } from "../store";
  const store = useSceneStore();
  
//   const groupName = computed(() => store.currentGroupPath.at(-1) || "");
const groupName = computed(() => {
  const arr = store.currentNodePath;
  return arr && arr.length ? arr[arr.length - 1] : "";
});
  
  const meshNames = computed(() => {
    /* 收集当前 group 内叶子 mesh 名字 */
    const names = [];
    const prefix = store.currentNodePath.join("/");
      store.threeCtx?.meshMap.forEach((_, key) => {
    if (key.startsWith(prefix)) {
      const parts = key.split("/");
      names.push(parts[parts.length - 1]);
    }
  });

    return names;
  });
  
  /* 内部连接：两端都在 meshNames 集合内 */
  const keys = o => Object.keys(o);
  const localConns = computed(() => {
    const set = new Set(meshNames.value);
    return store.connections.filter(c=>{
      const [a,b]=keys(c);
      return set.has(a)&&set.has(b);
    });
  });
  
  const adding = ref(false);
  const left = ref(""), right = ref("");
  function add() {
  if (!left.value || !right.value) return;
  store.updateConnections([...store.connections, { [left.value]: "", [right.value]: "" }]);
  left.value = right.value = "";
  adding.value = false;
}
function del(i) {
      const idx = store.connections.indexOf(conn);
  if (idx > -1) {
    const next = store.connections.slice();
    next.splice(idx, 1);
    store.updateConnections(next);
  }
}
  </script>
  
  <style scoped>
  .panel{padding:6px;overflow:auto}
  h5{margin:6px 0 2px}
  .mt{margin-top:10px}
  .conn{display:flex;align-items:center;gap:6px}
  .add-ui{display:flex;gap:4px;margin-top:4px}
  input{width:80px}
  </style>
  