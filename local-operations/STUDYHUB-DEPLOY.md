# StudyHub 3.3.0 本地部署说明

本目录（`D:\studyhub`）现在承载一份**独立运行的 StudyHub 3.3.0**。它跑在自己的
DSH 0.2 harness 里，与你的 DSH Desktop（harness 0.2.0-rc.2，端口 43129）**完全隔离**：
两边各自的 harness home、profile 与端口互不影响。

## 一句话现状

| 项 | 值 |
| --- | --- |
| StudyHub | **3.3.0**（2026-10-09），包 `@ericwang1358/dsh-daily-flashcard` |
| 运行宿主 | **DSH harness 0.2.0-rc.2**（StudyHub 要求 `>=0.2.0-rc.2 <0.3`） |
| 入口地址 | **http://127.0.0.1:43130**（带一次性 token 的完整 URL 在启动时打印） |
| harness home | `D:\studyhub\dsh-home`（profile：`web`；密钥、会话、存储都在这） |
| harness 程序 | `D:\studyhub\dsh-0.2`（自包含，538 个包） |
| 启动脚本 | `D:\studyhub\start-studyhub.ps1` |

## 启动 / 停止

```powershell
# 启动（会自动打开浏览器；窗口保持打开就是服务器在跑）
powershell -ExecutionPolicy Bypass -File D:\studyhub\start-studyhub.ps1

# 停止：在该窗口按 Ctrl+C；或
Get-NetTCPConnection -LocalPort 43130 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## 首次使用

1. 打开启动时打印的 `http://127.0.0.1:43130/?token=...`。
2. 新建会话时选择 agent 预设 **「学习模式 · StudyHub」**（英文界面为 study preset）。
3. 模型：默认模型已配好（`deepseek-official` / `deepseek-flash`），密钥已复制到本 harness，
   在 **Settings › Models** 里可确认或换模型。
4. 需要录音转文字时，在 StudyHub **「设置 › 音频转写」** 里填一个转写密钥
   （推荐硅基流动 SenseVoice；Gemini / Groq 也可）。
5. 打开左侧栏的 **StudyHub**，按欢迎页的示例导览走一遍（不调用模型），
   再点「添加资料」导入你自己的 PDF / PPT / 笔记 / 录音。

学习库默认落在会话工作区（即 `D:\studyhub`）下的文件夹里，可在
StudyHub「设置 › 学习库与模型」改成别处。

## 这次部署具体做了什么

1. **下载并校验发布包**：`deploy\studyhub-3.3.0.tgz`（4.9 MB），SHA-256
   `bcbcbdee80c63a6ba6280c676c3c08439c93bb072f59f741f0d0cf144353ff2c`，
   与发布页 `SHA256SUMS-3.3.0.txt` 一致。解包副本在 `deploy\pkg\package`。
2. **建立独立 harness home** `dsh-home`，并在 `profiles\web` 里用官方 CLI
   安装插件：
   ```
   dsh plugin --profile web add D:\studyhub\deploy\studyhub-3.3.0.tgz
   ```
   该命令同时把 `@ericwang1358/dsh-daily-flashcard` 写进了
   `profiles\web\package.json` 的 `dsh.profile.bundles`，于是它的
   `cordis.patch.yml` 与 `presets\study.patch.yml` 生效——组合出的插件树里有
   `daily-flashcard` + 6 个 `study-suite-*` 组件 + `preset-study` 预设。
   > 注意：`deploy\studyhub-3.3.0.tgz` 是 profile 里 `file:` 依赖的指向目标，
   > 不要删除；要删就先把该依赖移除。
3. **补齐 Desktop 独有的宿主模块 fallback**：DSH Desktop 通过
   `resources\harness-node-entry.mjs` + `host-module-fallback.mjs` 让 profile 插件
   能 `import '@deepseek-ai/cordis'` 等宿主包；发布的 `dsh` CLI **没有**这个 hook，
   所以直接 `dsh --profile web` 起会因 `@deepseek-ai/cordis` 解析失败而载入不了
   StudyHub 的宿主半边。本部署把 Desktop 的做法原样搬了过来：
   - `dsh-0.2\host-module-fallback.mjs`（Desktop 原文件副本）
   - `dsh-0.2\harness-entry.mjs`（等价于 Desktop 的 harness-node-entry，
     先注册 fallback 再加载 `dsh` 入口）
4. **复制凭据**：`C:\Users\Lenovo\AppData\Roaming\dsh-desktop\harness\.credentials.yaml`
   → `D:\studyhub\dsh-home\.credentials.yaml`（含 DEEPSEEK / OPENAI / GPT 三个 key 记录）。
   这是为了免去重新填 key；不想共享就直接删除该文件，然后在 Settings › Models 重填。

## 检索扩展（`@ericwang1358/studyhub-retrieval` 3.3.0）

已安装并**实地跑通**：

- 安装：`dsh plugin --profile web add D:\studyhub\deploy\studyhub-retrieval-3.3.0.tgz`
  （SHA-256 与发布页 `SHA256SUMS-3.3.0.txt` 一致），它同时写进了
  `profiles\web\package.json` 的 bundles。
- 该扩展挂载 DSH 自带的 MCP 客户端，用 DSH 自己的 Node 启动
  `mcp-local-rag` 本地检索服务；启动日志：
  `RAG MCP Server started successfully`，数据在 `dsh-home\study\retrieval`。
- StudyHub「设置 › 检索扩展」显示：**「检索扩展已安装并在运行」**；
  已为示例课程建好索引：**「新增 2 页，移除 0 页，0 页无需更新」**，
  LanceDB 里 `chunks.lance` 已写入（2 份资料 → 5 + 1 个 chunk）。
- 嵌入模型 `Xenova/all-MiniLM-L6-v2`（约 87 MB，384 维）已缓存到
  `dsh-home\study\retrieval\models`，实测 embedding 计算成功 —— 这也说明
  pnpm 跳过的 `onnxruntime-node` / `sharp` 构建脚本**不影响推理**。

### 三个必须知道的坑（都已解决，写在这里免得重踩）

1. **harness 的子进程拿不到系统代理。** 本机靠 WinINET 代理 `127.0.0.1:7890`
   出网；Node 自身不读系统代理，而 DSH 的 `scrubbedParentEnv()` 会按自己的
   代理策略重写（并删掉）子进程的 `HTTP(S)_PROXY`，所以 MCP 子进程直连
   huggingface.co 必然 10s 超时。`start-studyhub.ps1` 里已设置
   `HTTP_PROXY/HTTPS_PROXY/NO_PROXY` + `NODE_USE_ENV_PROXY=1`（作用于 harness
   自身）；子进程这一层用下面的"预热"绕过。
2. **模型预热（子进程无代理时的标准解法）**：
   ```powershell
   $env:HTTPS_PROXY='http://127.0.0.1:7890'; $env:HTTP_PROXY='http://127.0.0.1:7890'
   $env:NO_PROXY='localhost,127.0.0.1,::1'; $env:NODE_USE_ENV_PROXY='1'
   node D:\studyhub\dsh-0.2\warm-retrieval-model.mjs
   ```
   跑一次（约 30 s）把模型写进 StudyHub 的缓存目录，之后建索引完全离线。
3. **`study/retrieval.json` 不能带 BOM。** 该文件是 JSON，
   用 PowerShell 5.1 的 `Set-Content -Encoding UTF8` 写会带 UTF-8 BOM，
   `JSON.parse` 直接抛错、设置静默失效（我就是这么踩了一次）。要用
   `[System.IO.File]::WriteAllText($p,$json,(New-Object System.Text.UTF8Encoding($false)))`。
   另外：`hf-mirror.com` 在**经代理**时反而不通（直连也不通），所以本部署
   最终保持默认 `huggingface.co` + 代理 + 预热缓存。
   **更正**：本文档早先写的"`retrieval.json` 写 `{}`"与现场不符。复核到的真实内容：
   独立 home 是 `{"provider":"mcp:mcp__studyhub__query_documents"}`，桌面端 home 多一个
   `"explicit": true`。也就是说这个文件里放的是**检索来源选择**，不是 `hfEndpoint`；
   BOM 那条教训仍然成立——当年把它写坏的正是这个文件。

## 界面验证（Playwright + 本机 Chrome）

本机**已有**浏览器自动化能力，因此没有从插件市场另装：

- Playwright 存在于 npx 缓存 `_npx\31e32ef8478fbf80`（`playwright` / `playwright-core`），
  `%LOCALAPPDATA%\ms-playwright` 里还有历史浏览器目录与
  `study-acceptance`、`studymate-stage1` 会话记录；Chrome 154 与 Edge 均已安装。
- 本部署另装了轻量的 `playwright-core`（`D:\studyhub\verify`）并用 `channel: 'chrome'`
  驱动，无需下载 Chromium。脚本：`verify\lib.mjs` + `01…15-*.mjs`，截图在 `verify\shots`。

实测结果（每次运行都收集 console / pageerror）：

| 页面 / 流程 | 结果 |
| --- | --- |
| 首次进入（欢迎页 + 侧栏 16 个入口） | 正常，0 报错 |
| **备考补习**（3.1+） | 正常渲染「还没有考点清单」空态、课程范围、新建考点清单 |
| **新建考点清单**表单 | 正常打开；资料默认「不用」、空态写「先选至少一份课件（或大纲）」（含 3.2.1 的诚实文案修复） |
| 载入示例 + 功能导览 | 正常；导览为 **8 步**（印证 3.2.0 的 21→8 步） |
| **总纲**（3.3.0 新增） | 正常：「总纲 · 示例课程 · 设计模式」、全部题组筛选、`掌握 39% · 11 题 / 2 份资料`、按资料/章节成树、每行「练这一节」 |
| **检索扩展 + 建索引** | 正常：「已安装并在运行」→ 建索引成功 →「索引已是最新」 |

未验证（诚实边界，2026-10-09 复核后重写）：

- **录音转写**：未实测（需要先填一个转写密钥才能试）。
- **MinerU / Marker**：MinerU **没装**——`study\mineru.json` 里只有 `{"version":1}`。
  Marker **装好并自检过了**：`marker-pdf 2.0.0` 装进 venv
  （`%APPDATA%\dsh-desktop\harness\studyhub\marker`，清华镜像，2026-10-09 11:25 完成），
  自检结论 `marker_single --help: ready`，证据是 `study\marker-install.json`。
  但**真实 PDF 转换仍未实测**——"装好了"不等于"转换跑通了"。
- **真实模型出题**：已在独立部署上跑通一次，见下文「真实模型出题验证」。
- 3.3.0 发布说明本身也声明：最终包只过了压缩包检查，作者的改动没有在真实资料库上跑过。
- 示例数据已载入学习库（占 2 份资料 / 11 题），不需要时用「移除示例数据」一键清掉。

## 升级 / 卸载

```powershell
# 升级到新版本（例：3.4.0）
# 先下好新的 .tgz，然后：
$env:DSH_HOME='D:\studyhub\dsh-home'
node D:\studyhub\dsh-0.2\harness-entry.mjs D:\studyhub\dsh-0.2\node_modules\@deepseek-ai\dsh\lib\bin.js plugin --profile web add <新tgz路径>
# 再改 profiles\web\package.json 的 dependencies 指向新 tgz（或保留旧条目也行，bundles 决定加载）

# 卸载 StudyHub：删除 profile 依赖并重启
$env:DSH_HOME='D:\studyhub\dsh-home'
... plugin --profile web remove @ericwang1358/dsh-daily-flashcard

# 彻底删除整个部署：停掉 43130 进程，然后删 D:\studyhub\dsh-home 与 D:\studyhub\dsh-0.2
```

DSH Desktop（43129）不受任何影响：本部署没有改动它的 profile、package.json、
cordis.patch.yml 或插件清单。

## 真实模型出题验证（已完成）

用示例课程跑了一次**真实模型**出题（覆盖强度「精简」，`选择当前范围` 选中 2 份资料）：

- 结果：草稿已生成，里面是一道由示例讲义推出的真题（"报表类型 × 渲染后端"→ 策略模式），
  首页待发布由 1 变 2。
- 任务控制台硬数据：`出题 · 已完成` · **49 秒** · **首 token 平均（TTFT）0.5 秒** ·
  `共 1 轮 · 覆盖 50% · 共用 31.5K tok` · `每轮运行时限 20 分钟`。
- 全程 console / pageerror 为 0。
- 这同时验证了：复制的 DeepSeek 凭据可用、provider 路由正确、网络可达
  （`NO_PROXY` 里放了 deepseek.com 走直连）、StudyHub 的多阶段出题链路
  （规划 → 写题 → 独立审阅 → 草稿）与 2.7.1 的 TTFT/TPS 记账都能工作。

脚本：`verify\14-generate-deck.mjs`（出题）、`verify\15-draft-and-usage.mjs`（草稿 + 用量），
截图 `verify\shots\14c-final.png`、`15a-draft.png`、`15b-job-console.png`。

## 桌面端（DSH Desktop）升级经过（历史，已完成）

> 现状见后面「桌面端落地结果（最终态）」：桌面端 **0.11.1**、内置 harness **0.2.0-rc.2**。
> 下面这张表是**升级前**的快照，留作对照。

| 项 | 升级前（已过去） | 现在 |
| --- | --- | --- |
| 桌面端 | 0.10.0（`%LOCALAPPDATA%\Programs\DSH Desktop`，用户级安装） | **0.11.1** |
| 内置 harness | 0.1.7-rc.2 → **装不了 StudyHub 3.3.0**（要求 `>=0.2.0-rc.2 <0.3`） | **0.2.0-rc.2** |
| 官方最新 | 0.11.1（2026-10-09） | 同左 |
| 0.11.1 内置 harness | 0.2.0-rc.2（与 StudyHub 要求、与本部署完全一致） | 同左 |

0.11.1 的内置 harness 版本是**实测出来的**，不是猜的：下载官方安装包 → 校验
sha512 与 `latest.yml` 一致（签名有效：Beijing Shuju Xiangsu）→ 用 7zr 切出 NSIS 里的
`app-64.7z` 载荷 → 解出内层 `resources\app.asar` → 从 asar 目录里读
`node_modules/@deepseek-ai/dsh/package.json`，得到 `2.0.0-rc.2`
（`dsh-tools` / `dsh-mcp-client` / `dsh-client-store` 同为 0.2.0-rc.2）。

**桌面端无法"换 harness"**：它的入口是写死的
`runtimePackageRoot()/node_modules/@deepseek-ai/dsh/lib/bin.js`（`app.asar` 内），
所以要让桌面端跑 StudyHub，只能升级桌面端到 0.11.x。

当时准备了两条路（**都已成为历史，不要再照着做**）：

1. ~~便携副本（推荐先试，零风险）~~：曾把 0.11.1 从官方安装包载荷解到
   `D:\DSH-Desktop-0.11.1`（exe 0.11.1.0，1.0 GB / 8930 文件，内含 harness 0.2.0-rc.2）。
   它和 0.10.0 共用同一个 harness home（`%APPDATA%\dsh-desktop\harness`），
   所以设置、会话、插件都还在。**该副本已在升级成功后彻底删除**——
   那个路径现在不存在，不要再去点它。
2. 官方安装包（就地升级）：`D:\studyhub\deploy\DSH-Desktop-0.11.1-setup.exe`
   （已下载并校验）。**这条路已经走过了**，而且实际不是手工双击，是桌面端自己的
   自动更新完成的（见下节）。注意：静默/普通安装都会**强制关闭正在运行的桌面端**，
   若本会话就跑在里面，务必自己选好时机。

切到 0.11.x **之后**，运行下面这条把 StudyHub 装进桌面端 profile（**已于 2026-10-09
执行成功**；脚本随后已改成优先读取"正在运行"的桌面端版本，磁盘上已无第二份候选）：

```powershell
powershell -ExecutionPolicy Bypass -File D:\studyhub\install-studyhub-into-desktop.ps1
```

它会先核对桌面端版本（< 0.11 直接拒绝，避免把 StudyHub 塞进 0.1.7 的 profile 导致
桌面端起不来），再用本部署的 0.2.0-rc.2 harness 把两个 tgz 装进
`%APPDATA%\dsh-desktop\harness\profiles\web` 并写入 `dsh.profile.bundles`，
最后打印重启步骤。重启桌面端后，左栏就会出现 StudyHub。
检索扩展的模型缓存**已经复制到位**：
`%APPDATA%\dsh-desktop\harness\study\retrieval\models\Xenova\all-MiniLM-L6-v2`（含
`onnx\model.onnx`）现在存在，所以桌面端首次建索引不需要再下那 90 MB。

**风险与结局**：桌面端原有插件
（`dshmarket` 1.65.1、`@linxin666/dsh-web-all` 0.4.3、`@nanmicoder/dsh-agent-teams` 0.1.22、
`dsh-office-tools` 1.0.4、`dsh-super-injector`、`dsh-completion-alert`）都是按 0.1.7 构建的，
换到 0.2 harness 后确实有两个被判为不兼容，已按官方机制做版本豁免（见下节"最终态"）。
**更正**：这一段原本写"旧 0.10.0 仍在，随时可回退"——那是升级前的判断，**现在是错的**：
0.10.0 与便携副本都已清除，**本机没有现成的回退副本**，要回退只能重新装回 0.10.0。
同时"先用便携副本验证再做就地升级"的建议也已无意义（副本不存在了）。

### 桌面端落地结果（最终态）

- **系统上现在只有一份 DSH Desktop**：`%LOCALAPPDATA%\Programs\DSH Desktop`，
  版本 **0.11.1**、内置 harness **0.2.0-rc.2**（其 `resources\app.asar` 与当初解出的
  便携副本 SHA-256 完全一致）。运行中的 7 个进程全部来自这里。
- 升级是**程序自己的自动更新**完成的（updater 缓存里 248.2 MB 的 `installer.exe`
  就是官方 0.11.1 包）；它顺手在 `%LOCALAPPDATA%` 就地安装，并重建了
  `DSH Desktop` 快捷方式与卸载项。
- 我之前解出的便携副本 `D:\DSH-Desktop-0.11.1` **已彻底删除**（D 盘回收约 1 GB），
  指向它的两条重复快捷方式也删了。现在只剩 `DSH Desktop`
  （桌面 + 开始菜单）→ `%LOCALAPPDATA%\Programs\DSH Desktop\DSH Desktop.exe`。
- StudyHub 3.3.0 + 检索扩展已装进桌面端 profile
  （`%APPDATA%\dsh-desktop\harness\profiles\web`；bundles 共 11 项，
  `@ericwang1358/dsh-daily-flashcard` 与 `@ericwang1358/studyhub-retrieval` 是第 6、7 项——
  不在末尾，顺序只由安装先后决定，不影响加载），
  实测**可用**：`study_workspace library.context` 正常、检索扩展 MCP 服务在跑，
  学习库 = `D:\studyhub\.dsh-study`。安装前的 profile 清单备份在
  `deploy\desktop-profile-backup-20261009-182735\`。
- 升级副作用已处理：`dsh` 判定 `dshmarket@1.65.1`、`dsh-office-tools@1.0.4`
  与 0.2.0-rc.2 不兼容（默认会在启动时拒绝加载）。已按官方机制给这两个**精确版本**授予豁免：
  ```
  dsh plugin --profile web allow-version dshmarket@1.65.1 --dsh-version 0.2.0-rc.2 --accept-risk
  dsh plugin --profile web allow-version dsh-office-tools@1.0.4 --dsh-version 0.2.0-rc.2 --accept-risk
  ```
  查看：`… plugin --profile web version-exemptions`；撤回：把 `allow-version` 换成 `revoke-version`。
- `install-studyhub-into-desktop.ps1` 已修正为**优先读取"正在运行"的桌面端版本**
  （之前会误取磁盘上残留的 0.10.0 而拒绝执行），并写成 UTF-8 BOM，PowerShell 5.1 下中文提示不再乱码。
- ⚠️ **这个脚本必须保持 UTF-8 BOM。** 本机跑的是 Windows PowerShell 5.1
  （`5.1.26100.9549`）；没有 BOM 时它按 GBK 解码，脚本里的中文会变乱码并直接**报语法错误**
  （实测：去掉 BOM 后 `Parser::ParseFile` 报 3 个错误——"字符串缺少终止符" + 两处"缺少右 }"；
  同一份内容按 UTF-8 解码后 `ParseInput` 是 0 错，说明问题只在编码、不在代码）。
  用文本编辑器重写这个文件会**静默丢掉 BOM**——本次清理就在这里栽过一次，已修复；
  备份副本也一并补了 BOM，否则"可回退"是假的。
  复查两行：`[System.IO.File]::ReadAllBytes()` 看前三字节是否 `EF BB BF`，
  再用 `[System.Management.Automation.Language.Parser]::ParseFile()` 确认 0 错误。

#### 踩坑记录：删一半的便携副本为什么起不来

有一次点 `D:\DSH-Desktop-0.11.1` 的快捷方式弹出
`Desktop host plugin source resolution failed for dsh-ppt-composer … Cannot find module 'dsh-ppt-composer'`。
原因不是版本，而是**那份副本被删了一半**：

- 它当时只剩 7032/8933 个文件（724/1011 MB），关键的
  `resources\app.asar.unpacked\` **整目录丢失**；
- Electron 对 asar 里标记 `unpacked: true` 的文件是去
  `resources\app.asar.unpacked\…` 读实际字节的（正式安装里这一份有 1600 个文件 / 265.5 MB，
  包含 `dsh-ppt-composer`、`dsh-ppt`、`node-pty`、`pnpm`、`sherpa-onnx-*`、`libreoffice-kit-*` 等）；
- 目录一丢，Desktop 主进程在 `prepareHostPluginSourcesPatch` 阶段解析这些宿主插件就必然失败，
  于是弹出上面那个错误框。

结论：**半删的副本不可启动也不该再启动**；要么完整保留，要么彻底删除。
（删 DSH Desktop 时不要在它运行期间删——文件被占用会删一半，这也正是当时的情况。）

### 旧安装（DSH Desktop 0.10.0）已清除

**没有运行它的卸载器**：electron-builder 的 NSIS 卸载器会先杀掉名为 `DSH Desktop.exe`
的进程，而当时正在跑的是便携版（进程名一模一样），跑卸载器会连带杀掉本会话。
改为等价的**手工清除**（先确认没有任何进程在用旧目录）：

- 删除目录 `%LOCALAPPDATA%\Programs\DSH Desktop\`（21,253 个文件 / 933.9 MB）
- 删除注册表项 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\63aba052-5613-58ee-9049-667734229a73`
  →「设置 › 应用」里的 `DSH Desktop 0.10.0` 条目随之消失
- 删除 electron-updater 缓存 `%LOCALAPPDATA%\dsh-desktop-updater\`（487 MB，旧程序自动更新
  留下的 `installer.exe` / `dsh-desktop-windows-x64-setup.exe` 与 blockmap）

清除后**结论**：该目录随后被 0.11.1 的就地安装重建（那是升级成功，不是残留）；
目录内产品版本为 `0.10*` 的文件 **0 个**，卸载项已变成 `DSH Desktop 0.11.1`。

**保留**：`%APPDATA%\dsh-desktop\harness`（设置、会话历史、StudyHub 学习库）
与 `D:\studyhub` 下整套独立部署。

## 复核补充（本次通读时新查到的现状）

上面正文写完之后又跑过一些东西，以下是复核补记，免得把正文当成最新状态：

- **桌面端 harness home 里已有 Marker 的安装痕迹**：`study\marker-install.json`
  （见上文"未验证"一节）、`study\marker.json`、`study\jev.json`、`study\experimental.json`、
  `study\update.json`、`study\board.json`。
- **检索模型缓存两处都在**：独立 home 与桌面端 home 各有一份
  `study\retrieval\models\Xenova\all-MiniLM-L6-v2`（`config.json` / `tokenizer.json` /
  `onnx\model.onnx`）。
- **学习库已经长过示例数据**：`D:\studyhub\.dsh-study` 的 `study-workspace.json` 现在是
  `revision 40`，含 **2 门课程、3 个 deck、4 个 run、1 个 workflow session、1 个 attempt**，
  另有 `model-usage.json`、`job-archive.json`、`coach-daily.json`。示例课程仍是
  `示例课程 · 设计模式`（`sampleLibrary.status = ready`，载入时间 2026-10-09T11:39:43Z）。
  也就是说"2 份资料 / 11 题"只是示例数据本身的量，库里另外还有后续跑出来的东西——
  清示例之前先看一眼。
- 独立部署的 LanceDB 已有 5 个版本的 `chunks.lance` manifest 与 3 份 `raw-data`
  （对应"新增 2 页"那次建索引及其后续）。

### 本次对文档做的修正

正文里凡标「**更正**」的段落，都是本次通读时发现与现场不符、已就地改写的：
桌面端 harness 版本（0.1.7-rc.2 → 0.2.0-rc.2）、`retrieval.json` 的实际内容、
"旧 0.10.0 仍在可回退"、便携副本仍可用、"两条路"的操作建议、bundles 在末尾、
脚本清单 `01…10` → `01…15`、以及 MinerU / Marker 的"未验证"表述。

原文件的整份备份：`deploy\backup-before-stale-cleanup\install-studyhub-into-desktop.ps1`（脚本）。
本说明文档**没有留整份副本**——改法是逐段字面替换、每处都在正文注明了原文说法，
原文也可在这条会话记录里找到。
