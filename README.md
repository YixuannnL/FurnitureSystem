# Vue 3 + Vite

This template should help get you started developing with Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about IDE Support for Vue in the [Vue Docs Scaling up Guide](https://vuejs.org/guide/scaling-up/tooling.html#ide-support).


## 操作：
npm i
npm run dev

## 说明：

1. 四种操作模式
    * Toolbar.vue 中切换 store.mode → threeScene.setMode()
    * threeScene.js 对应使用 TransformControls 实现基本 translate / scale；
    * “连接”/“拖动” → translate；
    * “共面伸缩”/“XYZ 伸缩” → scale（后者附带键盘 x/y/z 可以限制轴向；可在 TransformControls 上调用 showX/showY/showZ）。
2. 连接逻辑
    * “使两个 mesh 的世界坐标重合”。可以在 threeScene.js 里监听两次点击后，对第二个 mesh 调 mesh.position.copy(first.position) 完成。
    * 更精确的“选点对齐”可用 THREE.MeshBVH 或自写射线夹点算法；核心思路是把选中点转换到世界坐标再设给另一点。 @TODO
3. 共面伸缩
    * planar 模式下，TransformControls 设置为 scale 并在拖拽开始时锁定 XZ 两轴，只放开面法线对应的一轴；当前示例中留作 TODO，你可以读取所选面法线（通过 Raycaster 点击交点的 face.normal）后设置 tc.showX/Y/Z = false/true。
4. 逐步工作流
    Pinia scene.step 驱动：
    0 = 总览；
    1 = 遍历子结构内部（PartTree 中非叶子节点）；
    2 = 子结构间连接；
    3 = 全部完成 & 导出。
    StepperBar 允许用户在顶部跳转回任一步。
5. 尺寸修改
    右侧 SizeAdjustPanel 读取当前选中节点维度，对应修改 mesh 几何体即刻生效；之后导出时写回 meta_data.json。
6. 导出数据
    exportUtils.exportJson() 把内存中的树 & 连接数组转成 Blob 后下载。
    同级不重名、跨级可重名
    每个节点用 路径 (path.join('/')) 作为唯一键；所有组件都用它来定位 mesh/节点，可安全区分同名不同层级对象。

当前版本目标：
    初始化加载示例家具并渲染 3D 视图
    使用 OrbitControls 浏览
    点击部件高亮并在树状面板中同步
    切换四大操作／步骤
    编辑连接列表、实时删除／增加
    基于 TransformControls 拖动 / 缩放
    手动输入尺寸即时更新几何
    一键导出修改后的 meta_data.json & conn_data.json


改进1:当前mesh全部是灰块不好区分
    1. 自动配色	根据 path 哈希为每个 leaf-mesh 生成稳定且对比度足够的颜色；同一子结构色系相近，跨结构差异明显。	src/utils/colorUtils.js (新增) + src/utils/threeScene.js
    2. 描边线 (Edges)	为每个 mesh 再生成一层 EdgesGeometry＋LineSegments，在实体色块外勾勒轮廓，低配机器也能流畅。	src/utils/threeScene.js
    3. 名字标签 (可选)	使用 CSS2DRenderer 给所有叶子节点挂一枚可隐藏/显示的文字标签，默认显示；按 L 键可快速切换。	src/utils/threeScene.js


重新定义“子结构” —— 取 最底层的非叶子 group（它的孩子全是叶节点/板件），我们称之为 Atomic Group。
drawer_left / drawer_middle / … 属于 Atomic Group；
sideboard_drawers 本身不是（因为它的孩子还是 group）。
进入 step 2 时，收集所有 Atomic Group 的路径，然后调用 layoutPathsLine 把它们一字排开。