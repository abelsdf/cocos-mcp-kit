# 游戏 UI 模板 v1（FR-08）

`get_ui_template`（full）是**只读 JSON 生成器**，不访问场景或 asset-db。它独立生成本项目的 [UI schema v1](UI_BUILDER.md)，不是 Creator 序列化数据，也不包含第三方模板、图片或脚本。检查/修改返回的 `ui` 后，明确调用已有 `build_ui`，复用其资源检查、失败清理、重复拒绝、视口报告和 Creator 3.8.8 单次 Undo。

## 三种模板

| template | 默认根名称 | 支持的按钮 action / 同名文案键 |
| --- | --- | --- |
| `pause_menu` | `PauseMenu` | `resume`（继续游戏）、`restart`（重新开始）、`quit`（返回菜单） |
| `settings_dialog` | `SettingsDialog` | `music`（音乐设置）、`sound`（音效设置）、`close`（关闭） |
| `result_dialog` | `ResultDialog` | `retry`（再玩一次）、`continue`（继续） |

每个模板有一个面板、标题、说明和纵向按钮。按钮图片与文字位于不同节点；全部为可继续编辑的普通节点，不生成预制体或业务脚本。没有账号、认证、登录模板。

## 参数

| 参数 | 契约 |
| --- | --- |
| `template` | 必填，上表三个值之一。 |
| `spriteFrame` | 必填，工程 SpriteFrame 的准确 canonical UUID（可含子资源后缀）或 `db://assets/...` URL。不接受图片路径自动猜测、internal 资源。建议使用自有白色图片的 SpriteFrame，实现纯色面板和按钮；彩色图片会与颜色相乘，不能视作纯色。 |
| `name` | 可选根名称，默认见上表；1—128 字符，无首尾空白、斜杠或反斜杠。 |
| `size` | 可选完整 `{width,height}`；默认 480×480，宽 240—2048、高 400—2048，均须有限数值。不是屏幕像素，而是父节点局部 UI 单位。 |
| `texts` | 可选部分覆盖 `title`、`message` 和所选模板的 action 键；每项字符串最多 512 字符，允许空字符串。不接受其他模板的 action 键。 |
| `colors` | 可选部分覆盖 `panel`、`button`、`text`；每种颜色须提供完整整数 `{r,g,b,a}`，范围 0—255。 |
| `controller` | 可选 `{scriptUuid,bindings}`；在面板上挂载一个已有工程脚本，`bindings` 至少包含一个本模板 action，值为 `{handler,customEventData?}`。每个 action 至多一条绑定，不接受外部目标。 |

`customEventData` 是最多 1024 字符的字符串，默认对应 action ID，显式 `""` 不会被替换。`handler`/工程脚本必须满足现有批次构建器的校验：真正构建时才确认已导入、类已注册、组件方法可用且不是保留生命周期方法。

未绑定的按钮 `interactable=false`，并且没有 clickEvents。绑定时仅启用对应按钮；后续若手动追加事件，应明确启用该按钮。暂停/重新开始/菜单导航、音乐音效偏好、关闭面板、计分奖励等业务逻辑全部由调用方脚本负责。设置模板提供动作按钮，不是自动工作的 Toggle/Slider 或音量持久化系统；面板也不提供全屏输入拦截、焦点管理或弹窗调度。

## 调用示例

先调用 `get_ui_template`（替换两个资源占位符）：

```json
{
  "template": "pause_menu",
  "spriteFrame": "<已导入的工程 SpriteFrame UUID>",
  "name": "LevelPauseMenu",
  "size": { "width": 480, "height": 480 },
  "texts": { "title": "暂停菜单", "message": "请选择操作", "resume": "继续" },
  "colors": { "panel": { "r": 25, "g": 32, "b": 48, "a": 255 } },
  "controller": {
    "scriptUuid": "<已导入工程脚本的 canonical UUID>",
    "bindings": {
      "resume": { "handler": "onResume", "customEventData": "level-1" },
      "restart": { "handler": "onRestart" },
      "quit": { "handler": "onQuit" }
    }
  }
}
```

结果包含 `ui`、`actions:[{id,nodeId,bound}]` 和 `validation:{schema:"passed",resources:"not_checked",scene:"not_checked"}`。这是结构校验，不代表资源存在、脚本方法可用、场景满足构建条件或 UI 可见。

接着检查/编辑 `ui`，例如将 `ui.roots[0].position` 设置为 `{x:100,y:0}`，再调用：

```text
build_ui({ sceneUuid: <当前场景资源 UUID>,
           parentUuid: <已有 Canvas/UI 父节点 UUID>,
           ui: <get_ui_template 返回的 ui 对象> })
```

需要新场景时，先单独执行 `create_scene(mode="ui")` 并处理其打开/needsSave 结果。模板工具本身不创建/切换场景。

设置模板示例覆盖 `texts:{title:"偏好设置",music:"音乐",sound:"音效",close:"完成"}`，并给 music/sound/close 绑定工程方法；结果模板可覆盖 `texts:{title:"关卡完成",message:"得分：1200",retry:"重试",continue:"下一关"}`，给 retry/continue 绑定方法。不要把未计算的示例分数或默认文案当作真实游戏状态。

## 重复、修改与验证

- 相同参数生成相同 JSON，不产生节点或文件。每次生成的数据互不共享可修改状态。
- 将相同根名称再次交给同一父节点下的 `build_ui`，会在预检拒绝，不自动重复、更新、覆盖或改名。明确选择不同根名才表示新建第二份；不同模板的局部 ID 可相同，不要直接拼接成同一批 DTO。
- 构建后仍可使用 Inspector、组件/节点工具编辑，然后显式保存。创建失败的清理仅限本次新节点；脚本外部副作用与跨资源操作不回滚。
- 固定边距/按钮高度，文案采用受限高度 Label；超长文案可能换行/裁切，不承诺所有尺寸、语言和素材的视觉适配。需要真正查看运行画面和命中测试，不能以 `viewport=inside` 当作视觉或点击证明。
- Creator 3.8.8 已验证三个模板的构建、事件引用、保存重开、编辑与完整重启，见[验证记录](verification/UI_TEMPLATES_2026-09-28.md)。真实鼠标/触摸点击与 Game View 视觉仍待阶段 2 完整验收。
