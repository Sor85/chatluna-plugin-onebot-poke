# AGENTS.md — OneBot Poke

## 项目

ChatLuna v2 / Cordis 4 的独立扩展插件。接收 OneBot v11 戳一戳事件，按相对权重选择预设消息或框架指令。响应列表默认为空，不注入示例；用户配置有效响应后才执行动作。协议适配、冷却和权限行为属于本插件；不得改动 ChatLuna 核心或适配器来实现功能。许可证为 MIT。

## 开发与验证

- 修改前阅读本机的 ChatLuna 插件规范（如 `~/.claude/docs/CHATLUNA.md`，若存在），实际 API 以开发副本源码为准，不使用旧版 ChatLuna v1 示例代替 v2 API。
- 当前目录是唯一源码来源，不安装依赖、不生成锁文件或构建产物。通过 `node scripts/dev.mjs` 单向同步到 v2 的 `external/onebot-poke`，在该 workspace 中执行 Yarn、TypeScript 和 Vitest。
- 在源码目录执行 `node scripts/dev.mjs install` 完成首次同步及依赖安装；修改后执行 `node scripts/dev.mjs check`，依次同步、构建前后端、检查类型及运行测试。也支持单独执行 `sync`、`build`、`typecheck`、`test`。
- 开发副本默认位于相对源码目录的 `../../chatluna-v2-mirror`，可用 `--mirror <路径>` 或 `CHATLUNA_V2_ROOT` 覆盖；需要 Node.js ≥24 和 Yarn 4。同步只管理自身标记的文件，保留副本依赖和构建产物，拒绝覆盖未归属的已有目录。
- 结束前至少运行插件测试、类型检查和构建；不把协议夹具测试描述为三端真实 QQ 联调。发布使用临时隔离 workspace，从空产物目录定向构建、测试及打包，不清理运行副本的 `lib`、`dist` 或 `tsconfig.tsbuildinfo`。
- README 面向插件使用者，不标注 ChatLuna 的开发分支版本，不包含本地开发与加载步骤；开发命令和环境约定放在本文件。
- 不提交、发布、创建分支或更改宿主运行配置，除非用户明确授权。

## 数据与安全

- 未经用户授权，不读取或修改宿主 `chatluna.yml`、密钥、真实数据库或其他插件源码。用户明确授权宿主集成验证后，只定向查看和调整所需插件条目，不输出凭证；沙盒操作必须限定在本任务独立测试空间，保留主场景与真实 QQ 数据。自动测试使用独立的内存数据库和模拟发送端，不向真实 QQ 发消息。
- 预设“指令”仅指 ChatLuna/Koishi 兼容层的指令，不执行操作系统 shell。
- 指令必须使用戳人者的真实会话身份和权限，不提升 authority，不伪造管理员。原始通知会话不可原地修改。
- 仅处理戳向当前机器人的通知，忽略机器人自身发起的事件。数字 ID 在协议边界验证，模板不插入昵称等不可信命令文本。
- 监听器、定时器和冷却状态必须绑定插件生命周期。并发响应需在首次异步操作前预留冷却，同一作用域的动作不得重叠。

## 子目录说明清单

- `scripts/AGENTS.md`：源码同步、双端构建、npm 发布与演练的安全约定。
- `client/AGENTS.md`：原插件设置页的响应表格、原生控件与客户端构建约定。
- `tests/AGENTS.md`：协议、权限、冷却及表格 DOM 集成测试约定。
