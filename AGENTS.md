# Power Island 协作入口

## 开始工作

阅读 README.md、core_game_spec.md（唯一当前规则，v0.8）及 outputs/development_status.md；检查 git status，保留已有改动。文档索引见 outputs/README.md。

## 结构与产品约束

- src/shared：类型、地图、规则、试验参数；src/server：权威服务；src/client：React、Canvas 和输入。玩家界面保持英文。
- 只实现 1v1/2v2。中立建筑不产出，初始 Power 为 seed 均匀整数 10–50；低值加权尚未实施。
- 部署阶段只发送本人分区的中立建筑，不发送 Power；队友分区不扩大披露范围。Core 首次点击预览，再点同位置确认。
- 满队交换需要对方同意；保持 200 ms tick。玩法变更同步更新当前规则及验证状态，避免规则副本。

## 验证

Node.js 22+；安装依赖后按变更选择 npm run check、npm test、npm run build 和 npm run test:browser。网络测试需要能监听本机端口；浏览器安装方法见 README。

本地服务仅按测试需要启动，结束后停止并核对端口。不要将 Chromium 手机模拟当作真实设备验收。纯文档整理无需启动服务。

## 发布与文件管理

- 发布按本次用户授权执行，先检查在线对局；重启会结束内存中的房间和 session。
- 已有发布 checkout 如存在于 .sites/frontend，保留其 .git、站点 manifest 和历史，复用原站点身份；不要当缓存删除。主仓库和发布仓库分别管理。
- local/ 为不提交的私有操作记录；需要部署时再读其中当前说明。线上地址、身份、连接命令和凭据不写入可提交文件。
- 提交或推送前检查整个提交树及历史；不提交本地路径、环境配置、截图或个人操作记录。outputs/optimization_backlog.md 仅本地保留。
- GitHub 前两次不干净的旧历史已清理。后续检查以当前主分支及待推送提交为准，不重复处理已清理的旧历史或 Codex 本地检查点，也不推送本地检查点引用。
- 只删除确认可再生成的产物，不对整个仓库清除 ignored 文件。node_modules 无需日常删除。
