# scripts 说明

适用范围：`scripts/`。同时遵守根 `../AGENTS.md`；脚本回归测试约定见 `../tests/AGENTS.md`。

- 源码目录无依赖，开发及发布入口用 `node` 直接执行，不经 Yarn 启动。`build-client.mjs` 由 `dev.mjs` 在副本 workspace 执行，使用宿主构建助手，不在源码目录执行。
- 同步复用 `dev.mjs` 的目录归属标记与符号链接检查，目标固定为所选副本的 `external/onebot-poke`。不覆盖或清理其他插件、宿主配置、数据库。
- 发布使用 `node scripts/publish.mjs`；`--dry-run` 完整执行清理、构建、测试、打包与 npm 演练，但不上传、不创建或推送标签。演练允许未提交状态，便于新仓库验证流程。
- 支持 `--otp=<验证码>`、`--mirror <目录>` 和 `--help`。副本位置与开发脚本一致，也读取 `CHATLUNA_V2_ROOT`；所有输出及失败信息须隐藏 OTP。
- 发布 package.json 中的现有版本，不自动更新版本、安装依赖、提交、创建仓库或推送分支。正式运行前必须已有提交、工作区干净、非 detached HEAD、HEAD 与 origin 同名分支完全一致；本地和远端无同名 Git 标签，npm 已登录且目标版本不存在。
- 正式发布与演练都必须使用闲置副本。同步前和清理前检查引用该副本的 launcher/worker 命令行，发现活动进程即拒绝操作，不自动停止宿主；相关进程可能使用独立数据目录，不能只检查副本根 PID 文件。无法检查进程时同样失败，不输出进程命令行或凭证。清理正在运行的副本会令 HMR 缓存入口缺失错误。
- 发布流程：安全同步 → 只清理副本 `lib`、`dist`、`tsconfig.tsbuildinfo` → 复用 `dev.mjs check` → `yarn pack` → 解压到新的临时目录 → 校验包名、版本、入口、声明、客户端清单、README、LICENSE、本地依赖及敏感文件 → 从解压目录执行 `npm publish --ignore-scripts`。不可用 npm pack 代替 Yarn pack，也不可直接发布 tgz，否则 workspace 依赖或 README 元数据会不正确。
- 稳定版本使用 `latest`；alpha/beta/rc/next 使用对应标签，其他预发布版本使用 `next`。发布后确认 npm 版本列表与目标 dist-tag 都指向预期版本，再给固定的发布提交创建并推送 `v<版本>` 标签。确认失败或发布后 Git 操作失败时明确提示不得盲目重发。
- 构建和打包后重新检查源码及 HEAD；发布包与对应提交必须一致。产物保留在系统临时目录，不进入源码仓库。npm 的预发布生命周期关闭，避免归档里的脚本触发额外操作。
