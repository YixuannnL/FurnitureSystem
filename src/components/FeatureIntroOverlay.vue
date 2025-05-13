<template>
  <!-- 只负责内容的显隐，挂载与否由父层控制 -->
  <div class="intro">
    <!-- 切换按钮始终可点 -->
    <button class="switch" @click="toggle">
      {{ show ? "隐藏功能介绍" : "显示功能介绍" }}
    </button>

    <transition name="fade">
      <div v-show="show" class="content">
        <h4>工具栏功能速览</h4>
        <ul>
          <li>
            <strong>连接</strong>：选中板件 → 拖动贴面，或点击两面建立连接。
          </li>
          <li>
            <strong>共面伸缩</strong>：点击 A、B
            两面，A面会伸缩到B面所处的位置。
          </li>
          <li><strong>XYZ 伸缩</strong>：选中板件后拖动三轴手柄调整尺寸。</li>
          <li><strong>拖动</strong>：自由拖拽板件或子结构位置。</li>
          <li>
            <strong>约束缩放</strong>（Step 2 专有）：按比例批量缩放多个子结构。
          </li>
          <li><strong>上/下一步</strong>：切换主流程步骤。</li>
          <li>
            <strong>导出数据</strong>：在步骤 3 完成全部操作后导出最终 JSON。
          </li>
          <li><strong>撤销</strong>：通过ctrl/cmd+z 可以撤销动作</li>
        </ul>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useSceneStore } from "../store";
const store = useSceneStore();

const show = computed(() => store.showFeatureIntro);
function toggle() {
  store.toggleFeatureIntro();
}
</script>

<style scoped>
.intro {
  position: absolute;
  top: 12px;
  left: 12px;
  max-width: 300px;
  font-size: 13px;
  line-height: 1.45;
  pointer-events: none; /* 不阻挡 3D 交互 */
}

.switch {
  pointer-events: auto; /* 恢复可点击 */
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
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #ffd666;
  border-radius: 6px;
  padding: 8px 10px;
  color: #333;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

ul {
  margin: 4px 0 0 16px;
  padding: 0;
}
li {
  list-style: disc;
  margin-bottom: 2px;
}

/* 淡入淡出动画复用现有规则 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
