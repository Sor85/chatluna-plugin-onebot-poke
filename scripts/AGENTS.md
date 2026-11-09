# scripts 说明

适用范围：`scripts/`。同时遵守根 `../AGENTS.md`；脚本回归测试约定见 `../tests/AGENTS.md`。

- 源码目录无依赖，开发及发布入口用 `node` 直接执行，不经 Yarn 启动。`build-client.mjs` 由 `dev.mjs` 在副本 workspace 执行，使用宿主构建助手，不在源码目录执行。
- 开发同步继续使用 `dev.mjs` 的目录归属标记与符号链接检查。发布时只读取 `--mirror` 指定副本的已安装依赖和 workspace 元数据，`dev.mjs sync/check` 的目标必须是本次新建的临时 workspace，不得指向运行副本。
- 发布使用 `node scripts/publish.mjs`；`--dry-run` 在全新的临时目录执行构建、测试、打包与 npm 演练，但不上传、不创建或推送标签。演练允许未提交状态，便于新仓库验证流程。
- 支持 `--otp=<验证码>`、`--mirror <目录>` 和 `--help`。副本位置与开发脚本一致，也读取 `CHATLUNA_V2_ROOT`；所有输出及失败信息须隐藏 OTP。
- 发布 package.json 中的现有版本，不自动更新版本、安装依赖、提交、创建仓库或推送分支。正式运行前必须已有提交、工作区干净、非 detached HEAD、HEAD 与 origin 同名分支完全一致；本地和远端无同名 Git 标签，npm 已登录且目标版本不存在。
- 正式发布与演练不检查或停止宿主进程，不修改原副本任何 workspace 的源码、产物或安装状态。`release-workspace.mjs` 复制根配置、锁文件、安装状态和 workspace 的 package.json；仅本插件在临时 workspace 内复制完整源码。临时 node_modules 是独立目录，依赖包逐个链接到现有安装，缓存目录留在临时根；不得链接整个 node_modules 或 .yarn，也不得运行 install 或全仓构建。链接不是文件系统只读权限，构建命令必须始终限定临时插件，不得写入依赖链接目标。
- 发布流程：创建隔离 workspace → 在其中同步本插件源码（初始无 lib/dist/tsbuildinfo）→ 复用 `dev.mjs check` 定向构建 → `yarn pack` → 解压到独立 package 目录 → 校验包名、版本、入口、声明、客户端清单、README、LICENSE、本地依赖及敏感文件 → 从解压目录执行 `npm publish --ignore-scripts`。不复制宿主 .yarnrc.yml 中的凭证，拒绝目标包的 prepack/postpack hooks；不可用 npm pack 代替 Yarn pack，也不可直接发布 tgz。
- 稳定版本使用 `latest`；alpha/beta/rc/next 使用对应标签，其他预发布版本使用 `next`。发布后确认 npm 版本列表与目标 dist-tag 都指向预期版本，再给固定的发布提交创建并推送 `v<版本>` 标签。确认失败或发布后 Git 操作失败时明确提示不得盲目重发。
- 构建和打包后重新检查源码及 HEAD；发布包与对应提交必须一致。产物保留在系统临时目录，不进入源码仓库。npm 的预发布生命周期关闭，避免归档里的脚本触发额外操作。
