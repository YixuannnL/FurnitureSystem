<template>
    <div class="panel">
      <h4>共面伸缩</h4>
  
      <p>
        <strong>Mesh A:</strong>
        {{ info.meshA || "未选择" }}
        <span v-if="info.faceA">({{ info.faceA }})</span>
      </p>
  
      <p>
        <strong>Mesh B:</strong>
        {{ info.meshB || "未选择" }}
        <span v-if="info.faceB">({{ info.faceB }})</span>
      </p>
    </div>
  </template>
  
  <script setup>
  import { useSceneStore } from "../store";
  import { computed } from "vue";
  const store = useSceneStore();
  const info = computed(() => store.planarInfo);
  </script>
  
  <style scoped>
  .panel { padding: 6px; font-size: 13px; }
  p { margin: 4px 0; }
  </style>
  