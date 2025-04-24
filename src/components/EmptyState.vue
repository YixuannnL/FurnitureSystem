<template>
    <div class="empty">{{ text }}</div>
  </template>
  <script setup>
  defineProps({ text: String });
  </script>
  <style scoped>
  .empty {
    color: #777;
    font-size: 12px;
  }
  </style>
  