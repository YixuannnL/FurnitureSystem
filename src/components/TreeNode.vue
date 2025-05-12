<template>
  <div
    :class="['node', { selected, completed }]"
    @click.stop="selectNode"
    :style="{ paddingLeft: depth * 12 + 'px' }"
  >
    <span v-if="hasChildren" @click.stop="toggle">
      {{ open ? "▼" : "▶" }}
    </span>
    <span v-else style="display: inline-block; width: 14px"></span>
    {{ node.name }}
    <!-- 已完成标记 -->
    <span v-if="completed" class="check">✓</span>
  </div>
  <div v-show="open">
    <TreeNode
      v-for="child in node.children"
      :key="child.path.join('/')"
      :node="child"
      :depth="depth + 1"
    />
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useSceneStore } from "../store";
import TreeNode from "./TreeNode.vue";

const props = defineProps({
  node: Object,
  depth: { type: Number, default: 0 },
});
const open = ref(true);
const hasChildren = computed(() => props.node.children.length);
const store = useSceneStore();

const selected = computed(
  () => store.currentNodePath.join("/") === props.node.path.join("/")
);

/* —— 是否已完成 —— */
const completed = computed(
  () => !props.node.isLeaf && store.isGroupCompleted(props.node.path)
);

function selectNode() {
  // store.currentNodePath = props.node.path;
  if (store.constraintMode && props.node.isLeaf === false) {
    // 只允许对子结构(非 leaf)做 toggle
    store.toggleConstraintTarget(props.node.path);
    return;
  }
  store.currentNodePath = props.node.path;

  if (store.step === 1) {
    // 第 1 步：隔离显示
    store.threeCtx?.isolatePath(props.node.path);
  } else {
    // 其它步骤：半透明高亮
    store.threeCtx?.highlightPath(props.node.path);
  }
}

function toggle() {
  open.value = !open.value;
}
</script>

<style scoped>
.node {
  cursor: pointer;
  padding: 2px 4px;
}
.node.selected {
  background: #d8f3dc;
}

/* —— 已完成视觉 —— */
.node.completed {
  color: #42b983; /* 整行文字变绿，也可以只改箭头 */
}
.check {
  margin-left: 4px;
  font-size: 12px;
}
</style>
