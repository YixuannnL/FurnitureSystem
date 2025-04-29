<template>
    <div class="panel">
      <!-- ——— Mesh 基本信息 ——— -->
      <h4 v-if="meshName">当前&nbsp;mesh：{{ meshName }}</h4>
  
      <!-- 尺寸 -->
      <section v-if="dims" class="section">
        <h5>尺寸 (mm)</h5>
        <ul class="dims">
          <li>W：{{ dims.width }}</li>
          <li>H：{{ dims.height }}</li>
          <li>D：{{ dims.depth }}</li>
        </ul>
      </section>
  
      <!-- 连接 -->
      <section v-if="conns.length" class="section">
        <h5>相关连接 ({{ conns.length }})</h5>
        <div v-for="(c,i) in conns" :key="i" class="conn-row">
          <code>{{ keys(c)[0] }} ↔ {{ keys(c)[1] }}</code>
          <button class="del-btn" @click="del(c)">删除</button>
        </div>
      </section>
  
      <!-- 没有尺寸 & 连接时 -->
      <EmptyState
        v-if="!dims && !conns.length"
        text="该 mesh 暂无尺寸或连接数据"
      />
    </div>
  </template>
  
  <script setup>
  import { computed } from "vue";
  import { useSceneStore } from "../store";
  import { findByPath } from "../utils/geometryUtils";
  import EmptyState from "./EmptyState.vue";
  
  const store = useSceneStore();
  
  /* 当前节点 */
  const curNode = computed(() =>
    findByPath(store.furnitureTree, store.currentNodePath)
  );
  
  const meshName = computed(() =>
    curNode.value?.isLeaf ? curNode.value.name : ""
  );
  
  const dims = computed(() => curNode.value?.dims ?? null);
  
  /* 与当前 mesh 有关的连接 */
  const conns = computed(() =>
    store.connections.filter((c) => Object.keys(c).includes(meshName.value))
  );
  
  const keys = (o) => Object.keys(o);
  
  /* —— 删除某条连接 —— */
  function del(target) {
    const idx = store.connections.findIndex(
      (c) => {
        const a = keys(c), b = keys(target);
        return a.includes(b[0]) && a.includes(b[1]);
      }
    );
    if (idx > -1) {
      const next = store.connections.slice();
      next.splice(idx, 1);
      store.updateConnections(next);
    }
  }
  </script>
  
  <style scoped>
  .panel {
    padding: 6px;
    font-size: 13px;
  }
  
  /* 小节统一样式 */
  .section {
    margin-top: 8px;
  }
  
  /* 尺寸列表 */
  .dims {
    margin: 4px 0 0 18px;
    padding: 0;
  }
  .dims li {
    list-style: disc;
  }
  
  /* 连接行 */
  .conn-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    margin-top: 2px;
  }
  .del-btn {
    padding: 0 6px;
    font-size: 12px;
    border-radius: 3px;
  }
  </style>
  