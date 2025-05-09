<template>
  <transition name="fade">
    <div v-if="show && msg" class="hint">
      <button class="close" @click="hide">×</button>
      <p>{{ msg }}</p>
    </div>
  </transition>
</template>

<script setup>
import { useSceneStore } from "../store";
import { computed } from "vue";
const store = useSceneStore();
const msg = computed(() => store.hintMessage);
const show = computed(() => store.showHint);
function hide() {
  store.toggleHint();
}
</script>

<style scoped>
.hint {
  position: absolute;
  top: 12px;
  right: 12px;
  max-width: 240px;
  background: #fffbe6;
  border: 1px solid #ffd666;
  border-radius: 6px;
  padding: 10px 12px 10px 14px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  font-size: 13px;
  line-height: 1.45;
  color: #333;
}
.close {
  position: absolute;
  right: 4px;
  top: 2px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
