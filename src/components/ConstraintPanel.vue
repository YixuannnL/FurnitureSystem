<template>
  <div class="panel">
    <h4>约束缩放</h4>

    <!-- 0. 历史记录 -->
    <section v-if="history.length" class="history">
      <h5>最近记录</h5>
      <ul>
        <!-- 最新的一条显示编号 1，依次递增 -->
        <li v-for="(h, i) in history" :key="i">
          #{{ i + 1 }} :
          <span class="axis">({{ h.axis.toUpperCase() }})</span>
          <span class="tg">{{
            h.targets.map((p) => p.at(-1)).join(", ")
          }}</span>
          →
          <span class="ref">{{ h.ref.at(-1) }}</span>
          <span class="ratio">[{{ h.ratios.join(":") }}]</span>
        </li>
      </ul>
    </section>

    <!-- 1. 已选子结构 -->
    <!--  目标对象（子结构或板件）-->
    <section>
      <h5>
        目标对象 ({{ targets.length }})
        <button
          class="pick-btn"
          :class="{ active: selMode === 'target' }"
          @click="pickTarget"
        >
          {{ selMode === "target" ? "正在选择…" : "选择" }}
        </button>
      </h5>
      <ul>
        <li v-for="(p, i) in targets" :key="i">
          {{ p.at(-1) }}
          <input
            v-model.number="ratios[i]"
            @input="setRatio(i, $event.target.value)"
            type="number"
            step="0.1"
            min="0.01"
          />
          :
          <button @click="toggle(p)">×</button>
        </li>
      </ul>
      <p v-if="!targets.length" class="hint">请在树或 3D 里点击/框选子结构…</p>
    </section>

    <!-- 2. 参考板 -->
    <!--  参考板件 -->
    <section>
      <h5>
        参考板件
        <button
          class="pick-btn"
          :class="{ active: selMode === 'ref' }"
          @click="pickRef"
        >
          {{ selMode === "ref" ? "正在选择…" : "选择" }}
        </button>
      </h5>

      <p v-if="ref.length">
        {{ ref.at(-1) }}
        <button @click="clearRef">×</button>
      </p>
      <p v-else class="hint">请点击树或 3D 选择参考板…</p>
    </section>

    <!-- 3. 轴向 -->
    <section style="margin-top: 6px">
      <label><input type="radio" value="x" v-model="axis" /> Width (X)</label>
      <label><input type="radio" value="y" v-model="axis" /> Height (Y)</label>
      <label><input type="radio" value="z" v-model="axis" /> Depth (Z)</label>
    </section>

    <!-- 4. 执行 -->
    <button class="apply" :disabled="!canApply" @click="apply">执行缩放</button>

    <button class="exit" @click="exit">退出该模式</button>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useSceneStore } from "../store";
const store = useSceneStore();

/*  当前选取模式 */
const selMode = computed(() => store.constraintSelectMode);

const targets = computed(() => store.constraintTargets);
const ref = computed(() => store.constraintRefPath);
const axis = computed({
  get: () => store.constraintAxis,
  set: (v) => store.setConstraintAxis(v),
});
const ratios = computed(() => store.constraintRatios);
const history = computed(() => store.constraintHistory);

function pickTarget() {
  store.setConstraintSelectMode("target");
}
function pickRef() {
  store.setConstraintSelectMode("ref");
}

function toggle(p) {
  store.toggleConstraintTarget(p);
}
function clearRef() {
  store.setConstraintRef([]);
}
function setRatio(i, v) {
  store.setConstraintRatio(i, v);
}
const canApply = computed(
  () =>
    targets.value.length > 0 &&
    ref.value.length &&
    ratios.value.every((r) => r > 0)
);
function apply() {
  store.applyConstraintResize();
}
function exit() {
  store.exitConstraintMode();
}
</script>

<style scoped>
.panel {
  padding: 6px;
  font-size: 13px;
  overflow: auto;
}
ul {
  margin-left: 16px;
  padding-left: 0;
}
li {
  list-style: disc;
  font-size: 12px;
}
input {
  width: 40px;
}
.hint {
  font-size: 12px;
  color: #777;
}
.apply {
  margin-top: 8px;
  background: #42b983;
  color: #fff;
}
.exit {
  margin-left: 6px;
}
.ratio {
  color: #888;
  font-size: 12px;
}
.history ul {
  margin-left: 16px;
  padding-left: 0;
  font-size: 12px;
}
.history li {
  list-style: disc;
  margin-bottom: 2px;
}
/*  按钮视觉 */
.pick-btn {
  margin-left: 6px;
  font-size: 11px;
  padding: 0 6px;
  border-radius: 4px;
}
.pick-btn.active {
  background: #42b983;
  color: #fff;
}
</style>
