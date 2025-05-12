<template>
  <div class="switcher">
    <div class="tabs">
      <button
        v-for="v in views"
        :key="v.key"
        :class="{ active: cur === v.key }"
        @click="set(v.key)"
      >
        {{ v.text }}
      </button>
    </div>

    <!-- 动态视图 -->
    <component :is="compOf[cur]" />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useSceneStore } from "../store";
import ConnectionPanel from "./ConnectionPanel.vue";
import InternalConnOverview from "./InternalConnOverview.vue";
import SubStructureTreePanel from "./SubStructureTreePanel.vue";

const store = useSceneStore();
const cur = computed(() => store.step2View);

const views = [
  { key: "internal", text: "子结构内部连接" },
  { key: "inter", text: "子结构间连接" },
  { key: "tree", text: "子结构树信息" },
];

const compOf = {
  internal: InternalConnOverview,
  inter: ConnectionPanel,
  tree: SubStructureTreePanel,
};

function set(k) {
  store.setStep2View(k);
}
</script>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}
button {
  padding: 2px 8px;
  font-size: 12px;
  border-radius: 4px;
}
button.active {
  background: #42b983;
  color: #fff;
}
.switcher {
  padding: 6px;
  overflow: auto;
  font-size: 13px;
}
</style>
