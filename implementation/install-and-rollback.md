# 安装与回退

当前整包版本 `3.3.0-scanned.4`，基于上游 v3.3.0；可选检索仍使用已有 `.3`，本轮无需改动检索服务。用户于2026-10-12明确授权部署到日常 Desktop。原生安装器升级及重启界面检查通过，6处安装源码哈希匹配，升级前后旧库和当前教材库状态哈希保持一致；原快捷方式及启动脚本不变。`.3`安装包与原生 generation 保留供回退。

## 安装目标

- 快捷方式：`C:/Users/Lenovo/Desktop/DSH Desktop.lnk`，实际启动 `D:/studyhub/start-dsh-desktop.cmd`。
- Desktop executable：`C:/Users/Lenovo/AppData/Local/Programs/DSH Desktop/DSH Desktop.exe`。
- 原生 profile：`C:/Users/Lenovo/AppData/Roaming/dsh-desktop/harness/profiles/web`。
- 原学习库：`D:/studyhub/.dsh-study`。先备份，保留旧资料、引用、题目、练习和复习调度。
- 整包：`@ericwang1358/dsh-daily-flashcard`；可选检索：`@ericwang1358/studyhub-retrieval`。名字保持不变，仅替换版本。

## 安装顺序

1. 查看 DSH 是否存在进行中的任务，待任务结束后退出 Desktop。备份原 profile 的清单、锁文件、patch、配置，学习库及所有附件；凭据使用宿主原有服务，不读取或复制 Key。本轮备份位于 `D:/studyhub/implementation/private-backups/desktop-before-cloud-20261012`，2945文件逐项核验。
2. 核对交付目录的 `SHA256SUMS-3.3.0-scanned.4.txt`。使用 DSH 原生插件管理把本地定制 TGZ 安装到 web profile。已经由Desktop登记为generation的整包须走Desktop版本升级流程，不能用普通CLI覆盖其投影链接；本机实际复现与恢复脚本为源码仓库`scripts/qa/desktop-generation-install.mjs`，由Desktop Node runtime执行并调用宿主自带安装器。脚本允许保留的 `.2`、`.3` 和当前 `.4`，安装证据通过 `--evidence-dir` 指定以保留历史结果。可选检索依赖构建脚本只允许必要的 `onnxruntime-node`、`sharp`、`protobufjs`；不要全局放开所有脚本。Node 需要 >=22.19。
3. 整包模式只启用原整包；六个独立组件是另一种部署方式，不能同时叠加启用。原生 installer 返回需要重启后，再从原快捷方式启动 Desktop。
4. 本轮按用户授权直接使用日常 Desktop 和当前学习库验证小样本，不迁移或覆盖旧资料/题组。不要把单教材 ZIP 当全库备份。
5. 确认界面显示定制版本、原生附件/Jobs/模型可用，开启图文开关后导入原书并核对原页。模型密钥经宿主原生凭据/启动环境提供，不写入插件 patch 或学习库。
6. 关闭 StudyHub 自动更新检查，并避免市场或上游一键升级。保留本地定制 TGZ、校验值与源码提交；只有经测试的新定制包才替换此包。

## 仅回退插件

仅撤回本轮云解析升级时，先备份并退出Desktop，通过相同原生版本升级机制安装保留的 `3.3.0-scanned.3` 整包，指定 `--version=3.3.0-scanned.3`。无需回退未改动的检索扩展；保留学习库和新资源，不覆盖数据。云解析暂停任务不能由旧版继续，回退前结束当前任务。更早的原版回退按下面步骤操作。

先导出当前含附件完整 ZIP，结束任务、退出 Desktop。通过同一 DSH 原生 installer 将两个原包重新安装到同一个 web profile，替换同名定制版，再重启核对实际生效版本为3.3.0。若原生插件管理仍选择定制 generation，通过原生管理移除/替换该 generation；不要手工删除 node_modules。需要恢复配置时使用安装前备份，依赖交给原生安装器校验，不单独覆盖锁文件制造不一致。

该操作不删除当前学习库或教材附件。旧版保留读取真实 OCR sources 的能力，但不显示新图文、图解和带图题界面。回退前保留完整附件备份，避免用旧 JSON 覆盖它。

## 回退数据

先关闭使用该库的所有会话/任务，把当前库完整复制到另一个本机目录留存，再将安装前的完整备份恢复到原位置。备份必须包含 `study-workspace.json`、附件、历史版本、用量与其它库文件。恢复后核对源文字/ID、题组、练习记录和 SM-2 状态。

如果只希望返回原学习库，可用 DSH/StudyHub 原生学习库选择切回 `D:/studyhub/.dsh-study`，不要覆盖或删除新教材库。删除正式数据不是默认回退步骤。

## 实际证据

`.3`升级前当前用户教材库2495文件、旧库40文件已复制并逐项SHA核验，位于`D:/studyhub/implementation/private-backups/desktop-before-mos-fix-1791639312818`；包含当前MOS题组、作答及附件，不应以最早只有4题的ZIP覆盖当前学习库。升级后两库完整状态SHA、脚本、快捷方式保持一致。MOS30题实测在隔离库进行，未覆盖用户题库。

安装前完整备份位于 `D:/studyhub/implementation/private-backups/desktop-before-scanned-20261010`，包含旧库、文件哈希清单、profile/插件管理记录、宿主配置、原脚本/快捷方式、原绑定和原版包，只留本机。旧库40文件与备份SHA一致；当前选择的新书库为 `D:/studyhub/libraries/数字集成电路-图文`，没有合并或覆盖旧库。

正式 Desktop 整包通过原生管理安装；检索包因 Desktop 的依赖闭包校验未接受宿主/Node内置模块，实际关闭宿主后使用 DSH 原生 CLI 安装成功。CLI 应使用与目标 profile 匹配的 pnpm：本机 Desktop 为10.34.5。仅允许检索必需构建脚本；离线元数据缺失时正常在线安装，不关闭供应链检查。

原快捷方式正常重启、图5.1带图题与原PDF149/印刷131页对照通过。临时调试参数已移除，脚本/快捷方式SHA与原版一致。模型密钥通过原生 credentials 服务持久保存，正常启动ready=true，不在学习库或插件patch里。图文模型任务必须使用界面内有效的「学习模式 · StudyHub」会话；仅创建离线会话记录不能代替运行中的原生 Agent。

独立组件卸载测试按原配置约定对generation/study设置 `independent:true`；默认单组件会保留依赖，不应误判。禁用图文、卸载材料、重启再安装实际通过，完整旧库状态SHA不变。

隔离环境实际通过真实3.3.0安装回退：1142条教材OCR来源及所选原文SHA保持一致，再安装定制版恢复图5.1图片访问。正式 Desktop 未执行降级；正式数据未执行覆盖回退。

`数字集成电路-图文与反相器题组.zip` 是含附件整库备份，在空的新库通过「设置 → 导入、计划与备份 → 含附件整库备份」恢复。`full-textbook.zip` 为可离线打开index.html阅读的教材包。题组JSON不携带图片，跨库导入需重新核验和独立审阅，不能替代完整ZIP。

原PDF上限800MiB、单图片8MiB、ZIP2GiB、展开4GiB、库元数据64MiB。详细实测范围和残余限制见 `测试报告.md`。
