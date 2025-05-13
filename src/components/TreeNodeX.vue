<!-- src/components/TreeNodeX.vue  (完整覆盖) -->
<template>
  <li>
    <!-- ────────────── 行内容 ────────────── -->
    <div class="row">
      <!-- 折叠箭头（仅非叶子） -->
      <span class="arrow" v-if="!node.isLeaf" @click.stop="open = !open">
        {{ open ? "▼" : "▶" }}
      </span>
      <span v-else class="placeholder" />

      <!-- 节点名称 -->
      <span>{{ node.name }}</span>

      <!-- 删除按钮（仍保留原有功能） -->
      <button class="del" @click.stop="handleDelete">删</button>

      <!-- 新增板件按钮：仅非叶子 -->
      <button v-if="!node.isLeaf" class="add" @click.stop="showAdd = !showAdd">
        {{ showAdd ? "取消" : "新增板件" }}
      </button>
    </div>

    <!-- ────────────── 新增板件 UI ────────────── -->
    <div v-if="showAdd" class="add-ui">
      <select v-model="addMode">
        <option value="copy">复制已有</option>
        <option value="new">新建默认</option>
      </select>

      <!-- 复制已有 -->
      <div v-if="addMode === 'copy'" class="copy-ui">
        <select v-model="copySrc">
          <option disabled value="">选择源板件</option>
          <option v-for="m in leafMeshes" :key="m.pathStr" :value="m.pathStr">
            {{ m.name }}
          </option>
        </select>
        <input v-model="newName" placeholder="新名字" />
      </div>

      <!-- 新建默认 -->
      <div v-else class="new-ui">
        <input v-model="newName" placeholder="新名字" />
      </div>

      <button @click="confirmAdd">确定</button>
    </div>

    <!-- 子节点递归 -->
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
import { ref, computed } from "vue";
import { useSceneStore } from "../store";
import { findByPath } from "../utils/geometryUtils";

const props = defineProps({ node: Object });
const open = ref(true);
const store = useSceneStore();

/* ---------- 删除功能（原逻辑保持不变） ---------- */
function handleDelete() {
  if (props.node.isLeaf) {
    if (confirm(`删除板件「${props.node.name}」？`)) {
      store.deleteMesh(props.node.path.join("/"));
    }
  } else {
    if (confirm(`删除子结构「${props.node.name}」及其内部所有板件？`)) {
      store.deleteGroup(props.node.path);
    }
  }
}

/* ────────────── 新增板件逻辑 ────────────── */
const showAdd = ref(false); // UI 显隐
const addMode = ref("copy"); // 'copy' | 'new'
const copySrc = ref(""); // 复制源 pathStr
const newName = ref(""); // 目标名字

/* 当前子结构下全部 leaf-mesh 列表（供 copy 选择） */
const leafMeshes = computed(() => {
  if (props.node.isLeaf) return [];
  const arr = [];
  store.threeCtx?.meshMap.forEach((_, pathStr) => {
    if (pathStr.startsWith(props.node.path.join("/") + "/")) {
      const name = pathStr.split("/").at(-1);
      const node = findByPath(store.furnitureTree, pathStr.split("/"));
      if (node?.isLeaf) arr.push({ name, pathStr });
    }
  });
  return arr.sort((a, b) => a.name.localeCompare(b.name));
});

/* 执行新增 */
function confirmAdd() {
  const tgtName = newName.value.trim();
  if (!tgtName) return;

  if (addMode.value === "copy") {
    if (!copySrc.value) return;
    store.copyMesh(props.node.path, copySrc.value, tgtName);
  } else {
    store.createDefaultMesh(props.node.path, tgtName);
  }

  /* 清 UI */
  newName.value = "";
  copySrc.value = "";
  showAdd.value = false;
}
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.arrow,
.placeholder {
  width: 14px;
  text-align: center;
  cursor: pointer;
}
.del {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
}
.add {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
  background: #42b983;
  color: #fff;
}

/* —— 新增板件 UI —— */
.add-ui {
  margin: 4px 0 4px 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 12px;
}
.add-ui input,
.add-ui select {
  width: 110px;
}
</style>
