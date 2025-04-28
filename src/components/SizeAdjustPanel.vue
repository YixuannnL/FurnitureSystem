<template>
    <div class="panel">
      <h4>尺寸调整</h4>
      <template v-if="dims">
        <label v-for="k in ['width','height','depth']" :key="k">
          {{ k }}:
          <input type="number" v-model.number="localDims[k]" @change="apply" />
        </label>
      </template>
      <EmptyState v-else text="未选中具有尺寸的部件" />
    </div>
  </template>
  
  <script setup>
  import { reactive, watch, computed } from "vue";
  import * as THREE from "three";
  import { useSceneStore } from "../store";
  import { findByPath } from "../utils/geometryUtils";
  import EmptyState from "./EmptyState.vue";
  const store = useSceneStore();
  const dims = computed(() => {
    const node = findByPath(store.furnitureTree, store.currentNodePath);
    return node?.dims ?? null;
  });
  const localDims = reactive({ width: 0, height: 0, depth: 0 });
  watch(
    () => dims.value,
    (d) => {
      if (d) Object.assign(localDims, d);
    },
    { immediate: true }
  );
  function apply() {
    if (!dims.value) return;
    Object.assign(dims.value, localDims);
    // 更新对应 mesh 缩放
    const mesh = store.threeCtx?.meshMap.get(store.currentNodePath.join("/"));
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.BoxGeometry(
        localDims.width,
        localDims.height,
        localDims.depth
      );
    }
  }
  </script>
  
  <style scoped>
  .panel {
    padding: 6px;
  }
  label {
    display: block;
    font-size: 12px;
    margin-bottom: 4px;
  }
  input {
    width: 80px;
  }
  </style>
  