<template>
  <div class="panel">
    <h4>全部子结构 (可删)</h4>
    <ul class="tree">
      <!-- 从顶层根节点开始递归 -->
      <TreeNodeX :node="root" />
    </ul>
  </div>
</template>

<script>
import { ref } from "vue";
import { useSceneStore } from "../store";

/* 递归节点组件（只渲染非 leaf 子结构） */
const TreeNodeX = {
  name: "TreeNodeX",
  props: { node: Object },
  setup(props) {
    const store = useSceneStore();
    const open = ref(true);

    /** 展开 / 收起 */
    const toggle = () => (open.value = !open.value);

    /** 删除整个子结构 */
    const del = () => {
      if (confirm(`删除子结构「${props.node.name}」及其内部所有板件？`)) {
        store.deleteGroup(props.node.path);
      }
    };

    return { store, open, toggle, del };
  },
  /* 这里用普通 <template> 写法而非 JSX */
  template: `
      <li v-if="!node.isLeaf">
        <div class="row">
          <span class="arrow" @click.stop="toggle">
            {{ open ? "▼" : "▶" }}
          </span>
          <span>{{ node.name }}</span>
          <button class="del" @click.stop="del">删</button>
        </div>
  
        <!-- 递归渲染子 group -->
        <ul v-show="open">
          <TreeNodeX
            v-for="child in node.children"
            :key="child.path.join('/')"
            :node="child"
          />
        </ul>
      </li>
    `,
};

export default {
  name: "SubStructureTreePanel",
  components: { TreeNodeX },
  setup() {
    const store = useSceneStore();
    const root = store.furnitureTree; // 整棵 meta 树

    return { root };
  },
};
</script>

<style scoped>
.panel {
  padding: 6px;
  font-size: 13px;
  overflow: auto;
}
.tree {
  list-style: none;
  padding-left: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.arrow {
  cursor: pointer;
}
.del {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
}
</style>
