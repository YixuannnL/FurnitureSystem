<template>
    <!-- 仅 Step-1 时挂载，由父层 v-if 控制 -->
    <div class="desc-overlay">
      <!-- 开关按钮始终可见 -->
      <button class="switch-btn" @click="toggle">
        {{ show ? "隐藏描述" : "显示描述" }}
      </button>
  
      <!-- 内容区域：有句子就列句子，没有则给占位提示 -->
      <transition name="fade">
        <div v-show="show" class="content">
          <template v-if="sentences.length">
            <p v-for="(s, i) in sentences" :key="i">{{ s }}</p>
          </template>
          <p v-else class="empty">未找到描述</p>
        </div>
      </transition>
    </div>
  </template>
  
  <script setup>
  import { computed } from "vue";
  import { useSceneStore } from "../store";
  const store = useSceneStore();
  
  const show = computed(() => store.showDescription);
  const sentences = computed(() => store.currentDescSentences);
  console.log("sentences here", sentences)

  function toggle() {
    store.toggleDescription();
  }
  </script>
  
  <style scoped>
  .desc-overlay {
    position: absolute;
    top: 36px;                       /* 避开 group-label */
    left: 50%;
    transform: translateX(-50%);
    max-width: 70%;
    font-size: 13px;
    pointer-events: none;            /* 不阻挡 3D 交互 */
  }
  
  .switch-btn {
    pointer-events: auto;            /* 恢复可点击 */
    padding: 2px 6px;
    font-size: 12px;
    border-radius: 4px;
    background: #42b983;
    color: #fff;
    border: none;
    cursor: pointer;
    margin-bottom: 4px;
  }
  
  .content {
    background: rgba(255, 255, 255, 0.9);
    color: #333;
    padding: 6px 10px;
    border-radius: 6px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }
  
  .empty {
    font-style: italic;
    color: #666;
    margin: 0;
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
  