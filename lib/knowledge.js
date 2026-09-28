'use strict';

// Original, concise guidance. Official documentation is referenced, not bundled.
const base = 'https://docs.cocos.com/creator/3.8/manual/zh/';
const componentDoc = (name) => `${base}ui-system/components/editor/${name}.html`;
const prefix = 'cocos://knowledge/';
const metadata = {
  knowledgeVersion: '1.0.0',
  appliesTo: 'Cocos Creator 3.8.x',
  sourceReviewedAt: '2026-09-28',
  language: 'zh-CN',
  scope: '独立编写的静态知识摘要，不读取工程、不执行检查或修复；来源复核不等于目标项目运行验收。其他版本须重新核对。',
};
const topics = [
  {
    id: 'ui-transform', title: 'UI 尺寸、坐标与锚点', components: ['cc.UITransform', 'cc.Node', 'cc.Canvas', 'cc.Camera'],
    summary: '区分父节点本地、世界、UI 矩形和屏幕坐标，先确认尺寸与锚点再判断布局。',
    guidance: [
      'Node.position 相对于父节点；父级旋转、缩放会影响子节点的世界位置。不能把本地坐标直接当作屏幕像素。',
      'UITransform.contentSize 定义矩形尺寸，anchorPoint 定义矩形相对节点原点的位置。宽高与节点缩放是不同属性。',
      '由锚点定义可得未变换局部矩形：左=-anchorX×width，右=(1-anchorX)×width，下=-anchorY×height，上=(1-anchorY)×height。换算世界边界须变换四角，不能只加位置。',
      '改变锚点不等于移动 Node.position，但会改变矩形相对节点原点的分布。维护视觉位置时应明确所需坐标空间和补偿。',
      '节点排序使用 Node.setSiblingIndex；UITransform.priority 已弃用，不应继续作为绘制排序入口。',
      'Canvas 继承 RenderRoot2D，并参与屏幕适配。cameraComponent 配合 alignCanvasWithScreen 对齐关联相机，但关联不保证该相机渲染 UI；还须核对节点 layer 和相机可见层。设计分辨率在项目设置中配置。',
    ],
    projectNotes: [
      'get_ui_viewport 的 inside 只描述受支持的关联编辑态相机几何范围，不证明 Game View 可见、无遮挡或按钮可点。',
      'build_ui 的 position 是指定父节点的本地坐标；不自动修复 Canvas、相机或跨屏幕适配。参见 docs/UI_VIEWPORT.md、docs/UI_BUILDER.md。',
    ],
    sources: [componentDoc('ui-transform'), `${base}concepts/scene/coord.html`, componentDoc('canvas')],
  },
  {
    id: 'widget-layout', title: '自动布局与动画冲突', components: ['cc.Widget', 'cc.Layout'],
    summary: '识别 Widget 对齐和 Layout 排列对位置、尺寸的控制，避免与动画争用。',
    guidance: [
      'Widget 的对齐边和边距决定节点相对对齐目标的位置；同时启用两侧约束可能拉伸该轴尺寸。检查 target 和绝对/百分比边距后再改坐标。',
      'AlignMode.ALWAYS 会在运行时持续对齐，可能覆盖动画或代码对位置、尺寸的修改。需要一次初始化对齐时考虑 ONCE；需要保持约束的动画可改对应边距。切换模式会改变适配行为，不能盲目关闭。',
      'ON_WINDOW_RESIZE 只在相关窗口尺寸更新时重新对齐，不等同于每帧跟随动画。',
      'Layout 的 HORIZONTAL、VERTICAL、GRID 控制子节点排列；ResizeMode.CHILDREN 调整子尺寸，CONTAINER 调整容器尺寸，NONE 不通过该模式调整双方尺寸。',
      'Layout 的间距、方向、网格约束及 affectedByScale 会影响最终排布。修改通常在后续帧生效；确需同步布局可使用 updateLayout，再检查实际结果。',
    ],
    projectNotes: [
      '本知识入口不检测真实 Widget/动画冲突，也不自动调用 updateLayout。阶段 3 的结构验证工具另行实现。',
      'UI 模板采用固定局部布局，没有自动添加 Widget/Layout；不要把生成成功当作所有宽高比适配通过。',
    ],
    sources: [componentDoc('widget'), componentDoc('layout')],
  },
  {
    id: 'label-fonts', title: '文字、字体与缓存限制', components: ['cc.Label'],
    summary: '综合内容尺寸、换行、溢出策略和字体缓存判断可读性，逐种语言观察。',
    guidance: [
      'Label 支持系统字体、TTF 和位图字体；useSystemFont 与 font 的选择需一致，系统字体的实际字形依赖运行环境。',
      'CLAMP 裁掉容器外文字，SHRINK 在需要时缩小字号，RESIZE_HEIGHT 根据排版改变高度。开启换行仍可能超出垂直空间，不能只检查字符串是否存在。',
      'cacheMode 主要针对系统字体和 TTF。BITMAP 适合较少变化的文本；CHAR 复用字符缓存，更适合固定样式、频繁变化的文本。',
      '3.8 手册列出的 CHAR 限制包括不支持 SHRINK、粗体/斜体/下划线，并存在字符缓存容量约束。不要对任意字体、样式和字符集合承诺兼容。',
    ],
    projectNotes: [
      '自动尺寸或结构检查不能替代中文、长文本和各目标语言的实际渲染；字体资源还须独立核查商用许可。',
      '本条不提供 RichText 标记规则，也不宣称所有字体模式的描边/阴影可用；应按具体组件、缓存模式和版本另行核验。',
    ],
    sources: [componentDoc('label')],
  },
  {
    id: 'sprite-assets', title: 'Sprite 与资源引用', components: ['cc.Sprite', 'cc.SpriteFrame'],
    summary: 'Sprite 引用的是 SpriteFrame；尺寸模式与图片裁剪会影响最终显示。',
    guidance: [
      'Sprite.spriteFrame 接收 SpriteFrame，不是 ImageAsset 或 Texture2D。图片导入类型及图集配置影响可用的 SpriteFrame 子资源。',
      'SizeMode.RAW 使用原图尺寸，TRIMMED 使用裁剪后尺寸，CUSTOM 使用自定义尺寸。替换图像时应核对尺寸模式，避免布局意外改变。',
      'SIMPLE、SLICED、TILED、FILLED 是不同渲染方式；九宫格依赖边框设置，填充模式还需检查填充参数。',
    ],
    projectNotes: [
      '通过 asset-db 查询真实子资源身份，不猜测 @ 后缀；路径与 UUID 的解析规则以具体工具契约为准。',
      '引用写入后需保存、重开并确认实际 SpriteFrame；图片存在或工具成功不代表引用已持久化、渲染正确。',
      'build_ui 使用已导入的工程 SpriteFrame；不自动下载图片，不修改原素材或导入设置。',
    ],
    sources: [componentDoc('sprite')],
  },
  {
    id: 'button-events', title: '按钮事件与交互状态', components: ['cc.Button'],
    summary: '区分按钮外观 target 与事件接收节点，核对组件、方法和自定义参数。',
    guidance: [
      'Button.target 用于状态转换的视觉目标；clickEvents 中的 target 是挂载回调脚本的节点，两者含义不同。',
      '事件绑定包含目标节点、组件名称、handler 和 customEventData；自定义字符串作为回调最后一个参数传入。',
      'interactable=false 禁止按钮交互；NONE、COLOR、SPRITE、SCALE 控制状态外观。禁用功能与禁用视觉表现需要分别核验。',
    ],
    projectNotes: [
      '本项目事件写入限定显式可调用的项目方法，拒绝生命周期、引擎继承方法等；实际允许范围见 docs/UI_BUILDER.md。',
      '保存重开后用 list_button_click_events 核对注册类与事件，不仅查看旧 component 字符串；Creator 可采用内部组件 ID 序列化。',
      'EventHandler 程序派发不等于真实鼠标/触摸命中；需观察实际预览点击后的可见反馈。当前模板未绑定按钮禁用，但默认外观未区分，见 docs/verification/UI_VISUAL_CLICK_2026-09-28.md。',
    ],
    sources: [componentDoc('button')],
  },
  {
    id: 'editor-runtime', title: '脚本、编辑态与运行态', components: ['cc.Component'],
    summary: '区分脚本注册、序列化属性、编辑态生命周期和预览运行结果。',
    guidance: [
      'ccclass 提供组件注册及序列化所需的类信息；属性装饰器控制可序列化内容与 Inspector 展示，复杂引用需要正确声明类型。',
      '组件生命周期默认在运行时执行；executeInEditMode 允许编辑态执行，可能产生编辑态副作用。添加组件前应审查脚本行为。',
    ],
    projectNotes: [
      '本项目实测 dirty=false 仍可能存在未保存序列化差异。切换前应核对真实内容；不要自动保存或丢弃用户修改。',
      '预览启动成功、结构查询成功、引用保存成功和真实画面/输入成功是不同证据；分别记录，不互相替代。',
      '新建节点清理不保证撤销脚本的外部文件、网络、业务状态等副作用。本知识查询只返回文本，不执行生命周期或运行测试。',
    ],
    sources: [`${base}scripting/decorator.html`],
  },
];

function summary(topic) {
  const { id, title, components, summary: description } = topic;
  return { id, title, components, summary: description, uri: `${prefix}topic/${id}` };
}

function readKnowledge(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(prefix)) return null;
  const invalid = () => {
    const error = new Error('Invalid or unknown knowledge resource; read cocos://knowledge/index for supported topics and components.');
    error.code = -32602;
    throw error;
  };
  if (uri.length > 256) return invalid();
  if (uri === `${prefix}index`) return JSON.stringify({ ...metadata, topics: topics.map(summary) }, null, 2);
  let route;
  try { route = decodeURIComponent(uri.slice(prefix.length)); } catch { return invalid(); }
  const match = /^(topic|component)\/([A-Za-z0-9_.-]+)$/.exec(route);
  if (!match) return invalid();
  if (match[1] === 'topic') {
    const topic = topics.find(item => item.id === match[2]);
    if (!topic) return invalid();
    return JSON.stringify({ ...metadata, topic }, null, 2);
  }
  const component = match[2].startsWith('cc.') ? match[2] : `cc.${match[2]}`;
  const related = topics.filter(topic => topic.components.includes(component));
  if (!related.length) return invalid();
  return JSON.stringify({ ...metadata, component, topics: related.map(summary) }, null, 2);
}

module.exports = { readKnowledge };
