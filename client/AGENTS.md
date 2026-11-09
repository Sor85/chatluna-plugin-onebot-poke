# client 说明

适用范围：`client/`。同时遵守根 `../AGENTS.md`；配置契约见 `../src/config.ts`，回归测试约定见 `../tests/AGENTS.md`。

- 仅为原插件设置页注册 `onebot-poke:actions` 数组角色，不新增独立设置页、保存接口或全局表格角色。
- 沿用 meme-generator 的 SchemaForm 扩展方式：通过 `registerReactFormExtension` 注册，使用 `ctx.effect` 注销；服务端可选注入 `chatluna_webui`，后端响应功能不依赖 WebUI。
- 表格、按钮使用宿主 `@chatluna/ui-kit`，图标使用宿主 Lucide；单元格交给 `props.render(..., { embedded: true })`，外层 `extensionProps` 保留恢复默认、撤销与 JSON 编辑。
- 保留数组顺序、重复项、零权重、空内容、空数组及未知字段。新增行用 `inferFallback` 真正写入子字段默认值；增删后重置单元格本地草稿，避免输入值串行。行操作只保留删除，不提供上移、下移或拖动排序，已有数组顺序保持不变。
- 根容器显式指定字号与行高。表格横向溢出沿用宿主 Table；不覆盖宿主滚动条、指针、模态或原生控件行为。字段说明集中保留在表格下方，不删减。
- `@chatluna/ui-client` 是客户端构建发现标记，即使没有直接导入也保留为开发依赖；构建产物位于副本 `dist`。新增 Tailwind 类后须完整重启宿主再验证。
