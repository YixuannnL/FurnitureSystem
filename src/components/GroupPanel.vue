<template>
  <div class="panel">
    <h4>当前子结构：{{ groupName }}</h4>

    <h5>内部部件 ({{ meshes.length }})</h5>

    <ul>
      <!-- ============== 新增部件 ============== -->
      <button class="add-mesh-btn" @click="showAdd = !showAdd">
        {{ showAdd ? "取消新增" : "新增部件" }}
      </button>

      <div v-if="showAdd" class="add-mesh-ui">
        <label>
          <select v-model="addMode">
            <option value="copy">复制已有</option>
            <option value="new">新建默认</option>
          </select>
        </label>

        <!-- ---- 复制已有 ---- -->
        <div v-if="addMode === 'copy'" class="copy-ui">
          <select v-model="copySrc">
            <option disabled value="">选择源部件</option>
            <option v-for="m in meshes" :value="m.pathStr" :key="m.pathStr">
              {{ m.name }}
            </option>
          </select>
          <input v-model="newName" placeholder="新名字" />
          <button @click="confirmAdd">确定</button>
        </div>

        <!-- ---- 新建默认 ---- -->
        <div v-else class="new-ui">
          <input v-model="newName" placeholder="新名字" />
          <button @click="confirmAdd">确定</button>
        </div>
      </div>

      <li
        v-for="m in meshes"
        :key="m.pathStr"
        :class="{ hsel: highlighted === m.pathStr }"
        @click="toggleHighlight(m)"
      >
        {{ m.name }}
        <button class="del" @click.stop="delMesh(m.pathStr)">删除</button>
      </li>
    </ul>

    <h5 class="mt">内部连接 ({{ localConns.length }})</h5>
    <div v-for="(c, i) in localConns" :key="i" class="conn-row">
      <code>{{ keys(c)[0] }} ↔ {{ keys(c)[1] }}</code>
      <button @click="del(i)">删</button>
    </div>

    <!-- <button class="add-btn" @click="adding = !adding">
        {{ adding ? "取消" : "新增连接" }}
      </button>
      <div v-if="adding" class="add-ui">
        <input v-model="left" placeholder="meshA 名称" />
        <input v-model="right" placeholder="meshB 名称" />
        <button @click="add">确认</button>
      </div> -->
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useSceneStore } from "../store";
const store = useSceneStore();

function delMesh(p) {
  store.deleteMesh(p);
}

const groupName = computed(() => store.currentNodePath.at(-1) ?? ""); // 最末节点名

/** 收集当前 group 内全部 leaf（含唯一 pathStr） */
const meshVer = computed(() => store.meshRevision); // 依赖刷新
const meshes = computed(() => {
  meshVer.value; // 触发
  if (!store.threeCtx) return [];
  const prefix = store.currentNodePath.join("/");
  const arr = [];
  store.threeCtx.meshMap.forEach((_, path) => {
    if (path.startsWith(prefix)) {
      arr.push({ name: path.split("/").at(-1), pathStr: path });
    }
  });
  return arr.sort((a, b) => a.name.localeCompare(b.name));
});

const meshNames = computed(() => meshes.value.map((m) => m.name));

const keys = (o) => Object.keys(o);
const localConns = computed(() => {
  const set = new Set(meshNames.value);
  return store.connections.filter((c) => {
    const [a, b] = keys(c);
    return set.has(a) && set.has(b);
  });
});

function del(idx) {
  const conn = localConns.value[idx];
  const i = store.connections.indexOf(conn);
  if (i > -1) {
    const next = store.connections.slice();
    next.splice(i, 1);
    store.updateConnections(next);
  }
}

/* ======== mesh 高亮逻辑 ======== */
const highlighted = ref(""); // 记住高亮的 pathStr

function toggleHighlight(m) {
  // 如果已经高亮 → 取消
  if (highlighted.value === m.pathStr) {
    store.threeCtx?.highlightPath([]);
    highlighted.value = "";
    return;
  }
  // 否则高亮新的 mesh
  store.threeCtx?.highlightPath(m.pathStr.split("/"));
  highlighted.value = m.pathStr;
}

/* ========== 新增部件状态 & 方法 ========== */
const showAdd = ref(false);
const addMode = ref("copy"); // 'copy' | 'new'
const copySrc = ref("");
const newName = ref("");

function confirmAdd() {
  if (!newName.value.trim()) return;
  if (addMode.value === "copy") {
    if (!copySrc.value) return;
    store.copyMesh(store.currentNodePath, copySrc.value, newName.value.trim());
  } else {
    store.createDefaultMesh(store.currentNodePath, newName.value.trim());
  }
  // 清空 UI
  newName.value = "";
  copySrc.value = "";
  showAdd.value = false;
}
</script>

<style scoped>
.panel {
  padding: 6px;
  overflow: auto;
  font-size: 13px;
}
ul {
  margin: 0 0 4px 18px;
  padding: 0;
}
li {
  list-style: disc;
}
.mt {
  margin-top: 10px;
}
.conn-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
input {
  width: 90px;
}
.del {
  margin-left: 6px;
}
/* -------- 高亮项样式 -------- */
.hsel {
  background: #f6facc;
}

.add-mesh-btn {
  margin-top: 6px;
}
.add-mesh-ui {
  margin: 4px 0;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.add-mesh-ui input,
.add-mesh-ui select {
  width: 120px;
}
</style>
