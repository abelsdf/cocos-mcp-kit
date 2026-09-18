# Pro v1.8.1 运行时操作目录

日期：2026-09-12。来源：已激活插件的正常 tools/list 接口。项目：D:\Game\arrow-puzzle-cocos；端点：http://127.0.0.1:3000/mcp。

安装包版本为1.8.1；initialize 返回的 serverInfo.version 为0.1.0，存在版本元数据不一致。目录无 nextCursor，共16个工具。224个action + 8个知识topic = 232个枚举条目，不等于已验证232项功能。原始schema见 pro-tools-list.json，仅作接口需求参考，不含实现源码。

| 工具 | 枚举条目数 | 操作/主题 |
| --- | ---: | --- |
| cocos_scene | 24 | get_info, list, open, save, create, close, hierarchy, is_ready, is_dirty, snapshot, snapshot_abort, undo_begin, undo_end, undo_cancel, execute_method, execute_script, soft_reload, list_classes, list_components, check_script, find_nodes_by_asset, restore_prefab, query_mode, validate_scene |
| cocos_node | 18 | find, info, list, tree, create, delete, modify, move, reorder, duplicate, copy, paste, cut, mount_script, remove_script, reset, detect_type, batch_modify |
| cocos_component | 8 | add, remove, list, info, set_property, available_types, click_event, batch_click_event |
| cocos_prefab | 13 | list, info, validate, create, delete, instantiate, unlink, apply, revert, edit_enter, edit_save, edit_exit, edit_test |
| cocos_asset | 19 | query_info, search, find_by_name, details, create, copy, move, delete, save, reimport, import, import_folder, refresh, dependencies, manifest, check_ready, query_path, query_uuid, query_url |
| cocos_editor | 34 | project_info, project_settings, run, stop, refresh_preview, build, build_settings, open_build_panel, builder_status, start_preview, stop_preview, console_logs, console_clear, log_read, log_search, log_info, mcp_log_read, mcp_log_clear, editor_info, performance, pref_open, pref_get, pref_set, pref_reset, pref_all, pref_categories, pref_search, pref_export, server_ips, server_port, server_status, server_test, server_interfaces, reload |
| cocos_view | 32 | gizmo_tool, gizmo_tool_query, gizmo_pivot, gizmo_pivot_query, gizmo_coordinate, gizmo_coordinate_query, gizmo_view_mode, mode_2d_3d, mode_query, grid_set, grid_query, icon_3d_mode, icon_3d_query, icon_size, icon_size_query, camera_focus, camera_align_view, camera_align_node, status, reset_view, ref_add, ref_remove, ref_switch, ref_clear, ref_config, ref_current, ref_list, ref_position, ref_scale, ref_opacity, ref_data, ref_refresh |
| cocos_composite | 10 | create_button, create_label, create_image, create_ui, mount_and_bind, setup_widget, batch, batch_create_button, batch_create_label, batch_create_image |
| cocos_knowledge | 8 | component_properties, ui_design_rules, layout_patterns, widget_strategy, node_structure, animation_patterns, best_practices, tool_guide |
| cocos_validate | 3 | layout, references, hierarchy |
| cocos_template | 2 | list, apply |
| cocos_capture | 3 | scene_snapshot, node_snapshot, screenshot |
| cocos_builder | 1 | build |
| cocos_animation | 39 | play, pause, resume, stop, change_sample, change_speed, change_wrap_mode, create_prop, remove_prop, create_key, update_key, remove_key, move_keys, copy_keys_to, spacing_keys, clear_keys, modify_curve, add_event, delete_event, update_event, move_events, copy_events_to, remove_node, change_node_path, query_clips_info, query_clip, query_clip_dump, query_value_at_frame, query_properties, query_state, query_edit_info, enter_edit, exit_edit, save_clip, create_clip, batch, batch_file, preset_list, preset |
| cocos_spine | 9 | info, list_animations, list_skins, set_animation, set_skin, set_property, set_data, add_socket, remove_socket |
| cocos_label | 9 | info, list, set_text, set_font, set_style, set_outline, set_shadow, batch_set_font, batch_set_style |

## 验证状态

- 已确认：接口连接、项目路径、完整目录返回、工具schema及公开描述。
- 未确认：所有操作执行成功、持久化、失败恢复、各平台支持及视觉表现。
- 逐项测试应在独立测试工程和合法授权运行环境进行，准备脚本、预制体、字体、动画和Spine样例；删除、保存、构建、设置修改等不在当前游戏工程盲测。
- 截图描述提供window与content两模式；content宣称读取已构建场景、可自动构建与强制重建，这些是接口描述，尚未运行验证。
