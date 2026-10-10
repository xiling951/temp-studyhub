# 安装与回退

目标：Windows 本机 DSH Desktop 0.11.1 / DSH 0.2.0-rc.2，`3.3.0-scanned.2` 定制包。正式安装和真实桌面验收记录尚待补充；此文件目前描述准备好的流程，不冒称已执行。

## 安装目标

- 快捷方式：`C:/Users/Lenovo/Desktop/DSH Desktop.lnk`，实际启动 `D:/studyhub/start-dsh-desktop.cmd`。
- Desktop executable：`C:/Users/Lenovo/AppData/Local/Programs/DSH Desktop/DSH Desktop.exe`。
- 原生 profile：`C:/Users/Lenovo/AppData/Roaming/dsh-desktop/harness/profiles/web`。
- 原学习库：`D:/studyhub/.dsh-study`。先备份，保留旧资料、引用、题目、练习和复习调度。
- 整包：`@ericwang1358/dsh-daily-flashcard`；可选检索：`@ericwang1358/studyhub-retrieval`。名字保持不变，仅替换版本。

## 安装顺序

1. 查看 DSH 是否存在进行中的任务，待任务结束或确认取消后从 Desktop 菜单「退出」关闭。备份原 profile 的清单、锁文件、patch、配置，原学习库及所有附件；原包保留 `D:/studyhub/deploy/studyhub-3.3.0.tgz` 和 `studyhub-retrieval-3.3.0.tgz`。备份中的凭据只留本机，不上传仓库。
2. 核对交付目录的 `SHA256SUMS-3.3.0-scanned.2.txt`。使用 DSH 原生插件管理把本地定制 TGZ 安装到 web profile。可选检索依赖构建脚本只允许必要的 `onnxruntime-node`、`sharp`、`protobufjs`；不要全局放开所有脚本。Node 需要 >=22.19。
3. 整包模式只启用原整包；六个独立组件是另一种部署方式，不能同时叠加启用。原生 installer 返回需要重启后，再从原快捷方式启动 Desktop。
4. 在新教材验收时先使用独立学习库。原库保持原始数据；必要时通过完整 ZIP 备份/恢复转移经过验证的教材及题组。不要把单教材 ZIP 当全库备份。
5. 确认界面显示定制版本、原生附件/Jobs/模型可用，开启图文开关后导入原书并核对原页。模型密钥经宿主原生凭据/启动环境提供，不写入插件 patch 或学习库。
6. 关闭 StudyHub 自动更新检查，并避免市场或上游一键升级。保留本地定制 TGZ、校验值与源码提交；只有经测试的新定制包才替换此包。

## 仅回退插件

关闭 Desktop 后，通过同一 DSH 原生 installer 将两个原包重新安装到同一个 web profile，再恢复安装前的 profile 配置和锁文件（恢复锁文件后按原生安装流程校验依赖）。从原快捷方式重启并核对旧版本。

该操作不删除当前学习库或教材附件。旧版保留读取真实 OCR sources 的能力，但不显示新图文、图解和带图题界面。回退前保留完整附件备份，避免用旧 JSON 覆盖它。

## 回退数据

先关闭使用该库的所有会话/任务，把当前库完整复制到另一个本机目录留存，再将安装前的完整备份恢复到原位置。备份必须包含 `study-workspace.json`、附件、历史版本、用量与其它库文件。恢复后核对源文字/ID、题组、练习记录和 SM-2 状态。

如果只希望返回原学习库，可用 DSH/StudyHub 原生学习库选择切回 `D:/studyhub/.dsh-study`，不要覆盖或删除新教材库。删除正式数据不是默认回退步骤。

## 实际证据

安装前备份路径、定制包 SHA、真实 Desktop 启动/题组结果和回退验证将在验收后追加。隔离 harness 的通过不代表正式 Desktop 已通过。
