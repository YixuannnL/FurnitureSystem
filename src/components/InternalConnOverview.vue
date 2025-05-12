<template>
  <div>
    <template v-for="grp in groups" :key="grp.key">
      <h5>{{ grp.name }} ({{ grp.conns.length }})</h5>
      <div v-for="(c, i) in grp.conns" :key="i" class="row">
        <code>{{ Object.keys(c)[0] }} ↔ {{ Object.keys(c)[1] }}</code>
      </div>
      <hr v-if="!$last" />
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useSceneStore } from "../store";
import { collectAtomicGroups, findByPath } from "../utils/geometryUtils";
import { RESERVED } from "../utils/connectionUtils";

const store = useSceneStore();

const groups = computed(() => {
  // 收集所有“原子子结构”
  const paths = collectAtomicGroups(store.furnitureTree);
  return paths
    .map((p) => {
      const node = findByPath(store.furnitureTree, p);
      const leafSet = new Set(
        node.children.filter((c) => c.isLeaf).map((c) => c.name)
      );
      const conns = store.connections.filter((c) => {
        // const ks = Object.keys(c).filter((k) => !RESERVED.has(k));
        // return ks.length >= 2 && leafSet.has(ks[0]) && leafSet.has(ks[1]);
        const prefix = p.join("/");

        /* ---- 新格式：pathA / pathB 存在 ---- */
        if (c.pathA && c.pathB) {
          return c.pathA.startsWith(prefix) && c.pathB.startsWith(prefix);
        }

        /* ---- 旧格式：退回到名字集合判断 ---- */
        const ks = Object.keys(c).filter((k) => !RESERVED.has(k));
        return ks.length >= 2 && leafSet.has(ks[0]) && leafSet.has(ks[1]);
      });
      return { key: p.join("/"), name: node.name, conns };
    })
    .filter((g) => g.conns.length);
});
</script>

<style scoped>
.row {
  font-size: 12px;
}
hr {
  border: none;
  border-top: 1px dashed #ddd;
  margin: 6px 0;
}
</style>
