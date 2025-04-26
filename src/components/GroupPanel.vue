<template>
    <div class="panel">
      <h4>当前子结构：{{ groupName }}</h4>
  
      <h5>内部部件 ({{ meshes.length }})</h5>
<ul>
  <li v-for="m in meshes" :key="m.pathStr">
    {{ m.name }}
    <button class="del" @click="delMesh(m.pathStr)">删除</button>
  </li>
 </ul>
  
      <h5 class="mt">内部连接 ({{ localConns.length }})</h5>
      <div
        v-for="(c, i) in localConns"
        :key="i"
        class="conn-row"
      >
        <code>{{ keys(c)[0] }} ↔ {{ keys(c)[1] }}</code>
        <button @click="del(i)">删</button>
      </div>
  
      <button class="add-btn" @click="adding = !adding">
        {{ adding ? "取消" : "新增连接" }}
      </button>
      <div v-if="adding" class="add-ui">
        <input v-model="left" placeholder="meshA 名称" />
        <input v-model="right" placeholder="meshB 名称" />
        <button @click="add">确认</button>
      </div>
    </div>
  </template>
  
  <script setup>
  import { computed, ref } from "vue";
  import { useSceneStore } from "../store";
  const store = useSceneStore();

  function delMesh(p) {
  store.deleteMesh(p);
}
  
  const groupName = computed(() => store.currentNodePath.at(-1) ?? ""); // 最末节点名
  
/** 收集当前 group 内全部 leaf（含唯一 pathStr） */
const meshVer = computed(() => store.meshRevision);        // 依赖刷新
const meshes = computed(() => {
  meshVer.value;                                           // 触发
  if (!store.threeCtx) return [];
  const prefix = store.currentNodePath.join("/");
  const arr = [];
  store.threeCtx.meshMap.forEach((_, path) => {
    if (path.startsWith(prefix)) {
      arr.push({ name: path.split("/").at(-1), pathStr: path });
    }
  });
  return arr.sort((a, b) => a.name.localeCompare(b.name));
});
  
const meshNames = computed(() => meshes.value.map(m => m.name));

  const keys = (o) => Object.keys(o);
  const localConns = computed(() => {
    const set = new Set(meshNames.value);
    return store.connections.filter((c) => {
      const [a, b] = keys(c);
      return set.has(a) && set.has(b);
    });
  });
  
  /* --- 手动增删连接（仍保留原功能） --- */
  const adding = ref(false);
  const left = ref("");
  const right = ref("");
  
  function add() {
    if (!left.value || !right.value) return;
    if (left.value === right.value) return;
    const exists = store.connections.some((c) => {
      const k = keys(c);
      return k.includes(left.value) && k.includes(right.value);
    });
    if (!exists) {
      store.updateConnections([
        ...store.connections,
        { [left.value]: "", [right.value]: "" },
      ]);
    }
    left.value = right.value = "";
    adding.value = false;
  }
  
  function del(idx) {
    const conn = localConns.value[idx];
    const i = store.connections.indexOf(conn);
    if (i > -1) {
      const next = store.connections.slice();
      next.splice(i, 1);
      store.updateConnections(next);
    }
  }
  </script>
  
  <style scoped>
  .panel {
    padding: 6px;
    overflow: auto;
    font-size: 13px;
  }
  ul {
    margin: 0 0 4px 18px;
    padding: 0;
  }
  li {
    list-style: disc;
  }
  .mt {
    margin-top: 10px;
  }
  .conn-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .add-ui {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }
  .add-btn {
    margin-top: 4px;
  }
  input {
    width: 90px;
  }
  .del { margin-left: 6px; }
  </style>
  