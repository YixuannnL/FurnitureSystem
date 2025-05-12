<template>
  <li>
    <!-- 行 -->
    <div class="row">
      <!-- 非叶子才有折叠箭头 -->
      <span class="arrow" v-if="!node.isLeaf" @click.stop="open = !open">
        {{ open ? "▼" : "▶" }}
      </span>
      <!-- 占位，用来与有箭头时对齐 -->
      <span v-else class="placeholder" />

      <span>{{ node.name }}</span>

      <!-- 删除按钮：叶 / 组 调用不同 action -->
      <button class="del" @click.stop="handleDelete">删</button>
    </div>

    <!-- 递归渲染子 group -->
    <ul v-if="!node.isLeaf" v-show="open">
      <TreeNodeX
        v-for="child in node.children"
        :key="child.path.join('/')"
        :node="child"
      />
    </ul>
  </li>
</template>

<script setup>
import { ref } from "vue";
import { useSceneStore } from "../store";

const props = defineProps({ node: Object });
const open = ref(true);
const store = useSceneStore();

/* 删除：组 ↔ deleteGroup；叶 ↔ deleteMesh */
function handleDelete() {
  if (props.node.isLeaf) {
    if (confirm(`删除板件「${props.node.name}」？`)) {
      store.deleteMesh(props.node.path.join("/"));
    }
  } else {
    if (confirm(`删除子结构「${props.node.name}」及其内部所有板件？`)) {
      store.deleteGroup(props.node.path); // 见下面 B
    }
  }
}
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.arrow,
.placeholder {
  width: 14px;
  cursor: pointer;
  display: inline-block;
  text-align: center;
}
.del {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
}
</style>
