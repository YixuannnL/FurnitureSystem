<template>
    <!-- 只有 text 非空才渲染 -->
    <transition name="fade">
      <div v-if="text" class="indicator" :class="'step-' + step">
        {{ text }}
      </div>
    </transition>
  </template>
  
  <script setup>
  import { computed } from 'vue';
  import { useSceneStore } from '../store';
  import { findByPath } from '../utils/geometryUtils';
  
  const store = useSceneStore();
  const step  = computed(() => store.step);
  
  /* —— Step-1: 取当前子结构节点 —— */
  const curGroupNode = computed(() => {
    if (step.value !== 1) return null;
    const path =
      store.groupIdx >= 0
        ? store.groupPaths[store.groupIdx]
        : store.currentNodePath;
    return findByPath(store.furnitureTree, path);
  });
  
  /* —— 生成指示文字 —— */
  const text = computed(() => {
    switch (step.value) {
      case 0:
        return '当前步骤是预览步骤，你可以大致拖动一下各个部件，左侧为家具结构树面板，右侧为现存连接（很大概率为错误）';
      case 1: {
        const n = curGroupNode.value;
        if (!n) return '';
        if (n.isAutoDrawer)
          return '当前子结构为标准件：抽屉，已经默认拼装好';
        return `当前你需要完成 ${n.name} 子结构的连接，下方是有关该子结构的描述，左侧可以对该子结构增删部件`;
      }
      case 2:
        return '你已经完成所有子结构的拼装，现在请你把子结构之间的连接完成';
      case 3:
        return '恭喜你！你已经完成所有的连接，请导出数据！';
      default:
        return '';
    }
  });
  </script>
  
  <style scoped>
.indicator {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  padding: 10px 14px 10px 14px;  /* 给左侧标签留出空间 */
  background: #fffbe6;
  border: 2px solid #ffcf40;
  border-radius: 8px;
  font-size: 14px;
  color: #333;
  line-height: 1.45;
  box-shadow: 0 3px 8px rgba(0,0,0,0.12);
  pointer-events: none;
}

/* —— 左侧竖条标签 —— */
.indicator::before {
  content: '指示';
  position: absolute;
  left: -2px;                   /* 黏在外侧边缘 */
  top: 50%;
  transform: translate(-100%, -50%);  /* 完全在外部 */
  background: #ffcf40;
  color: #fff;
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 6px 0 0 6px;
  box-shadow: 0 3px 6px rgba(0,0,0,0.15);
}
  
/* —— 不同步骤调整垂直距离 —— */
.step-0,
.step-2,
.step-3 { top: 10px; }
.step-1  { top: 40px; }   /* group-label 下方 */

  
  /* 简单淡入淡出动画 */
  .fade-enter-active,
  .fade-leave-active {
    transition: opacity 0.2s;
  }
  .fade-enter-from,
  .fade-leave-to {
    opacity: 0;
  }
  </style>
  