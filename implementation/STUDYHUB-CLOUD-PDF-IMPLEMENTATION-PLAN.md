# StudyHub 云端 PDF 图文解析与电子书资源包实施计划（架构审查修订版）

修订日期：2026-10-12。状态：**日常 Desktop 已部署 `.21` 并通过重启、源码和旧库核验；整书资源、阅读与索引已验证，DSH + Qwen 自主流程已通过真实两页材料和六题样本验收**。572页教材已通过 MinerU API 完整提取，保留原件及1321个资源，跨页段落/续表、公式后精确选区、原书对照和三个MOS基准题组共30题可用。云解析新增逐页独立原图核验、一次差异修复及复审；普通图文出题新增逐题检查点、盲图观察及最多两轮自动修订。真实样本中题干引导造成的原图输入端数误读，已由Qwen盲观察、独立拒绝、自动修订和复审修正，未人工改题。MOS基准含开发期人工校正，不作为自动出题达标证据；以未经人工改题的新样本验收。未执行572页逐页Qwen重解析，也未完成10,000字人工真值集或新版正式降级演练。

本文件供新会话直接开始开发。删除上一版的成本、价格、整书 Token 估算与预算情景；保留防止无限调用、任务失控所需的运行限制和真实用量记录。

## 1. 新会话接手与项目位置

### 1.1 仓库、源码及当前版本

- 工作目录：`D:/studyhub`。
- 唯一开发源码：`D:/studyhub/implementation/source`。它是完整源码 Git 仓库；不要修改 Desktop 安装目录中的运行副本，也不要直接修改生成的 `lib/client*.js`。
- 交付仓库：[xiling951/temp-studyhub](https://github.com/xiling951/temp-studyhub)。Git remote 为 `delivery`，交付分支为 `main`。
- 上游仓库：[EricWang1358/dsh-web-studyhub](https://github.com/EricWang1358/dsh-web-studyhub)。Git remote 为 `origin`；不向上游推送本轮改动。
- 当前开发分支：`feat/scanned-textbook-visual`；实际交付提交以 Git HEAD/工作树为准，代码是当前状态的依据。
- 当前日常 Desktop 整包：`3.3.0-scanned.21`；已安装检索服务为 `.5`，短页入索引修复已生效。整包、拆分插件和检索交付包由现有脚本构建到 `D:/studyhub/implementation/packages/3.3.0-scanned.21`，8包和2安装页已核验；不覆盖已有发布或回退包，不上传教材资源包。
- 已验证的宿主基线：DSH Desktop `0.11.1`，原生接口 `0.2.0-rc.2`；PDF.js 依赖 `6.3.289`。新会话核对实际安装状态，不把这些历史值当作自动保证。
- 桌面快捷方式：`C:/Users/Lenovo/Desktop/DSH Desktop.lnk`，现有启动链经 `D:/studyhub/start-dsh-desktop.cmd`。本轮开发和测试不修改此启动链。

本文件中 `lib/`、`ui/`、`tests/`、`scripts/`、`packages/`、`implementation/` 相对路径，均相对于上述源码根目录。其他路径明确给出绝对地址。

### 1.2 接手顺序与授权范围

1. 阅读本文件，按需读取 `D:/studyhub/implementation/progress.md` 的最新状态；本文件是源码仓库中同名计划的工作区镜像，二者应一致。
2. 阅读用户提供的 `C:/Users/Lenovo/Desktop/临时/会话约束.md`。若项目后来新增 AGENTS.md，按实际位置读取；本轮已查工作区、implementation、源码根目录，未发现这些位置存在 AGENTS.md。
3. 检查工作树并保留已有未提交变更，记录实际 HEAD/版本；只读取当前任务及直接依赖，不扫描整个仓库。
4. 从当前状态的未完成验收继续，不重新执行已完成的整书解析、已付费检查点或原 T01–T12。
5. 每个阶段通过相关验证后继续，在现有 progress.md 记录源码提交和实际测试证据。只把本轮源码、必要文档和脱敏证据提交到 delivery；常规推送为 `git push delivery HEAD:main`，分支分歧先正常整合，禁止强推覆盖他人工作。

执行范围已包含日常 Desktop 原生部署、已配置 Qwen 的真实 API 调用、正式教材导入/资源包导出及题组保存。升级前备份，核验后继续，不使用隔离开发环境，也不覆盖旧题、历史来源或复习调度。凭据沿用原生服务，缺少外部能力时说明具体缺口，不用模拟调用冒称真实验收。

旧根目录 `STUDYHUB-SCANNED-PDF-IMPLEMENTATION.md`、`STUDYHUB-SCANNED-PDF-PLAN.md`、`STUDYHUB-SCANNED-PDF-HANDOFF.md` 仅作为必要的历史参考；其中“应用代码尚未修改”等内容已经过时。实际代码、最新 progress 和验证证据优先。

## 2. 项目需求与完成范围

### R01：导入与云端解析

用户沿用“资料 → 导入资料”，选择 PDF，选择“保留图文”以及解析方式和 DSH 可用视觉模型，然后启动原生后台任务。支持大扫描书、工整论文、混合文字/扫描页 PDF。原件完整保留，显示阶段和可恢复进度；无模型、认证错误、本地渲染错误有准确原因。

云端方式使用 DSH 桌面中配置的 provider/model 及 API 路由；本地只承担文件处理、渲染/裁图、校验和打包，不要求新部署重型 OCR/视觉模型。已有本地 MinerU、普通文本提取、转换资料导入继续可用，不能因开启云解析而自动切换旧默认或强制下载大型模型。

### R02：完整资源包

生成可核验的结构化正文、真实图片/曲线图、表格、公式、图注、章节和原页映射；导出按章 HTML 电子书、MD 全文、JSON 和原 PDF。正文是忠实转写，不是总结；不明确内容标记为待核对，不能用模型编造来补齐。

### R03：阅读、原貌与对照

解析后从现有资料列表点击“阅读”，进入当前阅读窗口；获得原书近似的图文阅读，以及原 PDF 分页原貌。电子书可以调整字号/行宽和搜索；对照能够按页、图、表、公式和文字块互相定位。

原貌由不可变原 PDF 保证。重排电子书追求内容及顺序忠实，不承诺像素级复刻字体和换行；单纯把整页截图展示出来不算电子书与 MD 全文完成。

### R04：复用原有学习工具

现有目录、选区、批注、翻译、提问、阅读位置、阅读后练习、从资料出题及题目回链在新图文资料上获得明确支持。纯图区域使用图像证据操作，不伪装成文字选区；暂未支持的操作须明确禁用并给出原因，不能显示可点击按钮却静默失效。

### R05：图像辅助出题

原有“创建题组”“从这份资料出题”“做这几页的题/补题”等入口能够选取相关原图和表格，并贯通规划、求解、编题、审阅。保留已有单图/选图出题入口。题目有真实原图、准确引用、充分条件和独立审阅；支持 MOS 主题 30 题的真实验收，不以无关参考文献题凑数。

### R06：兼容、恢复及交付

旧资料、文字引用、原图引用、版本、批注、备份、题目、答案、复习调度和其他资料入口保持可用。新解析和原页纠错新增不可变版本，不静默覆盖旧数据。按已授权范围部署日常 Desktop，交付安装包、使用说明、实测证据和回退步骤。

### R07：DSH 与 Qwen 自主完成

运行流程不依赖 GPT 逐本或逐题人工复核。已配置视觉模型完成忠实转写、独立原页核验、明确差异的有界修复与复审；资源导出和阅读由现有本地模块完成。主题题经过规划、求解、编题及独立原图审阅；审阅前先仅凭原图和身份观察可见事实，排除题目、答案、OCR及图注的诱导，观察按原图哈希、资料清单、实际模型和提示版本保存；观察不是原文或批准。新发布要求当前审核标准，已发表旧题保持历史阅读兼容。拒绝题自动修订最多两轮，成功题及实际收据立即保存；恢复不重付相同内容和路线的已完成审核，合法拒绝不能通过反复重问变成批准。仍不确定的资料保留疑点和原页，仍不通过的题阻止发布；这类状态不伪称已确认。开发基准可人工抽检，最终自动流程必须使用未被人工改写的新样本验收。

不在本轮重写全应用、换技术栈、重构音频或复习调度，不建立第二套任务平台/模型凭据系统；不把额外专用服务、独立电子书首页或新顶级导航菜单作为默认方案。

## 3. 架构审核结论及必须修正的接点

整体方向与现有架构相容，但上一版有以下遗漏；按本节修正后实施。兼容性最终仍以回归和真实运行证明，不能仅凭计划声称已保证。

### A01：格式版本不能笼统承诺自动兼容

`visual-storage.js` 的 locateVisual/loadManifest/saveManifest，以及归档恢复，明确只接受 `schema === 1`。本轮保留 visual 核心 schema=1、当前页/块/资产字段与 Store version=4，新增可选 `reading: { schema: 1, ... }` 扩展，旧版本没有 reading 时回退现有页阅读。不要直接改成 visual schema=2 或引入不同含义的 schemaVersion 后假称旧读者自动支持。

新增阅读字段只引用已有页/块/资产，不能在同一修订内重新编号或改原 text。若实现发现确实必须升级核心 schema，应先补齐全部读取器、恢复/导出/检索/引用的双版本适配，再写新格式；不默认实施全库迁移。旧程序能忽略新阅读扩展，只能说明基础可读，不代表它能保全所有新功能。

### A02：新增参数必须通过封闭 DTO 和权限注册

当前 `materials.visual.import` input 为 additionalProperties=false，仅接受 uploadId/title/courses/pageOffset/tier/explain；直接从页面传 parser/model 会被拒绝。需要同步扩展 `visual-contracts.js`、操作实现、runtime/builtins 和 domain-contracts。未传新字段时保持旧 MinerU 行为；`modelRequired: false` 只适用于本地保存/解析，不应成为云端无需模型的提示。

### A03：阅读融合不能停留在嵌入独立 HTML

`DocumentViewer.jsx` 已承载目录、查找、阅读设置、选区、批注、翻译、学习侧栏、阅读练习循环。当前 visual 是其内部的一种视图，独立 VisualReader 不完全参与这些功能。改造共享阅读内容层及视图适配，不复制一整套阅读器，也不把导出 HTML 放进 iframe 作为应用内主正文。

图文资料目前隐藏“原始 PDF”标签，view=original 还依赖 fileUrl；只增加标签不会生效。需要一起修改模式判定、原书载入方式、下载动作与对照布局。

### A04：选择范围不能沿用重排后的 DOM 偏移

现有 captureSelection 依赖 data-study-text/data-study-page/data-study-source，服务端解析引用依赖确实存在的 source.text 范围。新 HTML 合并跨页段落、去页眉或显示 KaTeX 后，DOM 字符偏移不等于原 source 偏移。必须建立块→source 范围映射与选择适配；重复句必须消歧，公式和表格不能靠可见字符串猜位置。

跨 source 选区默认拆为可验证的单 source 范围；尚未实现多范围协议时，提示缩小选区，不能拼成一个假的连续引用。图像控件、题目、解释、页工具按钮不参与正文选择。

### A05：纯图资料不能制造虚假 source

`ScannedOnly.jsx` 已对没有正文 sources 的文档单独显示并打开 VisualReader。保留该入口，将它接入共享阅读外壳的 documentId-only 适配；DocumentViewer 现默认需要 source，不能强塞假 sourceId。普通 generation 当前要求文字 sources，支持纯图普通出题需要新增明确的 visualTargets 参数/分支和证据校验，不能删除所有文字入口的 assertMaterials。

### A06：普通出题的模型切换规则必须保持

`job-model.js` 和任务即时控制已允许仅对当前出题任务切换模型，下一次调用生效。固定路由仅用于云解析的版本与缓存身份。普通出题保留 live model control；每个图片阶段验证当时路由的视觉能力，跨模型复用要失效，已审核题和已发生调用保留实际路由。旧任务控制与全局生成模型设置不能被云解析改写。

### A07：暂停/恢复必须接入现有持久化协议

当前本地图文 import 为 recoveryMode=none；`jobs/registry.js` 要求可恢复任务有 persistence.open，`jobs/durability.js` 还检查输入、检查点、提交协调和用量回放。复用这些协议以及 generation/audio 的实现模式，为云解析定义独立持久化适配，不增加轮询进程、第二任务表或自制守护程序。

### A08：资源和备份需区分正文、附件与导出

当前 `visual-archive.js` 把非 original 的 manifest.assets 当图像命名导出；不能把任意 JSON/日志资产加入该列表而不改 exporter。阅读结构优先放在有界 manifest 的可选 reading 扩展中。若确需独立 sidecar，须同步资产读取、导出、库备份、恢复、完整性和保留策略，不能留下“备份成功但丢失新结构”。教材导出 ZIP 与完整库备份 ZIP 是两种不同格式，不互相冒充。

### A09：大 PDF 已有受控读取通道，应先复用

现有 `materials.visual.asset/chunk` 已按库/文档/版本校验归属，单块最多 256 KiB；原件上限 800 MiB。优先用它接入原书分段读取；Range 只是宿主能力允许时的优化，不默认开放未鉴权 HTTP 服务。旧 `materials.document.bytes` 整件 base64 通道和共享小文件上限保持。

### A10：安装器本身尚不能直接安装新版本/隔离目标

`scripts/qa/desktop-generation-install.mjs` 目前只允许 scanned.2/.3，且默认指向正式 APPDATA。C12 需要先增加新版本校验、显式隔离 home、包哈希检查和目标目录保护，验证后再用于隔离 Desktop generation。禁止对正式目录直接试跑现有脚本，禁止使用曾破坏 Desktop generation 投影的普通 CLI 覆盖正式插件。

## 4. 当前可复用模块与待实现项

### 4.1 已有基础

- 导入页面：`ui/ImportHub.jsx` → `ui/scanned/ScannedImport.jsx`，已复用 uploadInChunks 和 materials.visual 上传。
- 资料与阅读：`ui/Sources.jsx`、`ui/scanned/ScannedOnly.jsx`、`ui/document-preview/DocumentViewer.jsx`、`ui/scanned/VisualReader.jsx`。
- 解析/资源：`lib/contexts/materials/scanned/visual-import.js`、`visual-parser.js`、`visual-raster.js`、`visual-storage.js`、`visual-operations.js`、`visual-contracts.js`。
- 图表/原页：`ui/scanned/VisualTable.jsx`、`QuestionImages.jsx`、`asset.js`；后端 `visual-preview.js`、`visual-captions.js`。
- 模型与权限：`lib/visual-model-content.js`、`lib/index.js`、`lib/runtime/models.js`、`lib/jobs/gateway.js`、`lib/runtime/domain-contracts.js`、`lib/runtime/builtins.js`。
- 带图题及普通出题：`lib/contexts/generation/scanned/visual-questions.js`、`lib/contexts/generation/operations.js`、`lib/contexts/generation/jobs/gateway-model.js`、`lib/job-model.js`。
- 证据与发布：`lib/contexts/materials/visual-card-evidence.js`、`lib/visual-citations.js`、`lib/contexts/authoring/publication.js`；保留现有草稿、独立审核和事务发布门禁。
- 检索与归档：`lib/contexts/materials/visual-retrieval.js`、`visual-archive.js`、`visual-export-html.js`；已支持原书、图像、MD/HTML/JSON 和库归档。
- 任务生命周期：`lib/jobs/registry.js`、`durability.js`、`store.js`、`executor.js`；已存在原生恢复机制的其他任务可参考，勿直接复写它们。

上一轮只读 Desktop 证据显示 `.3` 正常运行、默认 DeepSeek V4.1 Flash、四个相关安装文件与源码一致；这不是本轮新增能力验证。当前无 GPT-6 Luna 本机路由的成功探针；不能把它设为唯一模型后阻断全部开发。

### 4.2 待完成部分

云端页解析、稳定段落/跨页表格/章节重建、阅读扩展、共享阅读外壳接线、完整原书对照、普通出题的实际图片全阶段接入、云解析持久化和新版交付均待实现。当前独立带图题已有功能继续保留，不把它当作普通批量自动带图已经完成。

本轮审查运行 8 个现有测试文件，58 项通过，覆盖存储、图像引用、视觉模型内容、任务契约/模型选择、阅读基础和权限事务。见 `implementation/evidence/cloud-pdf-plan-audit-tests.log`；它们包含合成接口测试，不是云端模型或新页面的真实验收。完整历史回归曾有 9 项失败，新会话需复核具体基线，不得自动忽略任何新增失败。

## 5. 页面融合与具体实现设计

### 5.1 导入、资料列表与任务页

在现有“扫描教材：保留图文”区域增添解析方式：本地 MinerU/云端视觉模型。沿用 scannedTextbooks opt-in，不新建顶级菜单。云端模式显示真实视觉模型选项与“需模型”状态，本地模式维持现有无需视觉模型说明；“同时解释关键图”是独立可选后处理，不混同识别正文。

沿用宿主模型目录/现有模型 key 编码与显示分组，新增的是任务参数，不另建 API Key 表单或 provider。StudyHub 只使用 DSH 凭据服务，不从插件代码读取私有密钥文件，不直接 HTTP 调用厂商绕过宿主。

资料列表继续按文档聚合，显示解析方式、版本、完成/待核对状态和正常阅读动作；重解析新增 revision，旧题仍绑定历史版本。纯图资料保留现有专用列表且使用相同阅读外壳。

任务仍显示在现有“任务”页面，阶段分别为上传、保留原件、渲染、识别、局部精修、整编、核验、提交。复用现有任务详情、日志、模型调用时间线、控制和结束通知。不同任务按自身类型显示“重试解析”或“补题”；本地 renderer 失败不能显示为云模型调用失败。

### 5.2 后端操作与原生任务

以下是**拟新增/扩展的契约**，不是当前已有 API：

- 扩展 `materials.visual.import`：可选 `parser: 'mineru'|'cloud'` 和 `modelKey`；不传 parser 时维持旧 MinerU，tier 仅作用于本地方式。复用既有 uploadId，拒绝任意客户端文件路径。
- 独立注册 `cloud-textbook-import` 原生 Job definition；本地 scanned-textbook-import 的 kind、输入和历史重试维持原行为。
- 拟新增 `materials.visual.reading`，按文档/版本/章或有界页范围获取阅读节点与 anchor；不一次把整本 HTML/JSON塞进 snapshot。
- 必要内部操作只经 materials 公共端口向 generation 提供证据准备/解析/审阅提交；复用现有 visual.cards.prepare/resolve/review.commit，不暴露可伪造的审核写入接口。

所有新参数、响应字段、读写集合、actionGrants、模型需求和类型注册需同步。实际命名如与已有 API 冲突可最小调整，但更新契约测试和计划状态，不能仅实现 handler 而漏 runtime 注册。

新增云解析任务 binding 要显式取得当前服务的 jobModelHost/路由、材料状态端口与 uploads；不能继续传仅支持本地 parse 的旧 binding 后直接调用未注入模型。每一页模型请求走 gateway.step(...).completeContent 与 DSH attachments.saveImages/readImage；实际 image 附件必须可读，文本路径、占位说明或图解摘要不能代替图片。当前单次边界 4 图/8 MiB，遵守既有上限。

云解析 route 在任务启动时固定并记录，变更模型/提示/渲染配置会创建不同 fingerprint/revision。所选模型不支持图片/不可用时不暗中换模型；可继续本地方式或仅查看原书，但状态不得是云端识别成功。任务参数使用已验证的最低推理档和输出上限，不继承全局高推理设置。

### 5.3 逐页识别、坐标与质量

1. 流式保存 PDF，复核 SHA/页数/旋转/CropBox/原像素和文字层；纯扫描不依赖原文字提取。保留原书与导入状态后允许查看预览，正式可引用版本仍须校验并原子发布。
2. 一页一组结构识别，返回忠实文字、块类型、阅读顺序、候选 bbox、标题、页码、图注与未知区域；禁止自动补写缺失内容或生成知识解释。
3. 密集小字、公式、续表和复杂电路采用整页结构 + 有重叠局部切片。记录原像素→渲染/去倾斜/旋转/切片映射及逆映射；模型 bbox 是候选，不未经核对即裁成正式图。
4. 复用 PyMuPDF 轻量 helper 与已有栅格机制；提高 DPI 不能创造原扫描没有的细节。固定可复现渲染配置，验证实际 DSH/provider 是否缩小图。detail、JSON Schema 和推理参数仅在宿主真正支持后使用，不假定厂商接口能力已透传。
5. 从原 PDF/原扫描图按真实坐标裁图，保留边距、图号与子图；公式同时保存原区域、LaTeX、编号；表格保存原区域、结构化行列与净化 HTML。支持 chart，不沿用只选择 image/table 的遗漏。
6. 相邻页和章节骨架恢复段落/续表，阅读层去页眉页脚，原页层完整保留。图解单独保存版本，不混入原文。
7. 检测漏页、无内容但原页不空、阅读顺序错误、重复块/正文、裁图截断、公式/表格疑点。自动检查无法证明全文正确；人工核对与真实原图复审有独立记录。

默认并发 1–2 页，复用 pdfConvertGate/原生资源准入。输出截断时拆区；429/短暂网络故障有界重试；认证/权限/不支持图片不无限重试。每次请求限制输出、图片和重试次数，记录真实用量，不在计划内预估费用。

### 5.4 数据与文本投影

- 保留 visual schema=1、Store version=4、现有 visualCitations schema=1。新文档仍采用原件身份规则；旧文档和已发布页/块/资产 ID 不重命名。
- 云解析 revision fingerprint 区别于 MinerU，包含原件、精确 provider/model、可取得的模型版本、配置、prompt/adapter、渲染/切片与上下文。模型版本不可获知时明确限制并允许强制重解。
- 每页保留规范化原始识别块和真实 page.text；只为有真实文字的页生成 source。**保持恢复检查要求 `source.text === page.text`**。已有 source.text 不覆盖，新识别创建新 revision/source IDs。
- `reading: {schema:1,...}` 包含 chapter、flowNode、正文引用及原页 anchor。每个阅读节点可映射到一个或多个 `{sourceId,start,end,page,blockId}`，图像继续引用 assetId/哈希/bbox。阅读顺序与段落合并不改变原页块。
- 手工修订和图解保持独立历史，修订正文需要新版本或明确的阅读修订记录及映射，不在旧版本原地修改。重复句、公式渲染和单元格文本均需要可验证定位。
- manifest 保持现有 32 MiB 限制；规范化状态不包含重复 HTML/MD或大量 base64。模型原始响应/诊断可放任务私有检查点，保留策略明确；若它成为文档永久资产，须按 A08 接入所有归档路径。

### 5.5 共享阅读外壳与引用

`DocumentViewer` 维持现有外壳、目录和学习侧栏；图文内容通过适配层给现有阅读功能提供 heading、章节范围、selection、位置与原页信息。对只有 documentId 的资料，提供文档入口适配，纯图情况下禁用文字选区按钮并保留选图提问/出题。

图文正文优先复用现有“阅读”模式；“原文”继续显示实际保存的页文字；“原始 PDF”走图文原件通道；“对照”优先作为阅读窗口的布局开关。原“图文教材”模式在兼容期保留或映射到新阅读模式，旧调用中的 initialMode、页定位与返回位置不失效。

不要把目录切换、AI 分段/目录、翻译和覆盖率各做一套。保留现有人工/AI目录，新增提取章节作为可选择的基础目录；应用目录/重新分段继续走既有材料操作，映射无法放置时显示 stale，不能 silently 替换用户目录。章节范围、阅读后的练习范围与普通出题选材共用同一映射。

正文节点渲染使用现有 React/Markdown/KaTeX/净化表格；为 data-study-* 设置真实 anchor，并排除控制、图解、翻译块等非原文内容。captureSelection 的扩展通过独立适配接回当前 materials.selection.resolve/提问/批注协议，不放宽旧引用校验。需要跨页翻译时复用现有翻译任务，未经证据验证的模型译文不当教材原文引用。

原书采用现有受控 chunk，视宿主可用能力接入 PDF.js 分段读取；不把整本转 base64，也不改变原小文件 API。视图卸载/换库/换版本立即取消读取、释放 URL/位图/worker缓存，过期异步响应不得覆盖新文档。

先完成点击同步定位，再完成滚动时按页/块 anchor 同步；跨页段落/续表映射多个原区域，不按滚动百分比猜。PDF 页号与印刷页号分开，未知印刷页显示未知；保留已有人工 pageOffset 的本地行为，不把它当全书页码识别结果。

### 5.6 普通出题与证据复用

保持现有 generation 请求、topicScope/sectionWeights、范围过滤、coverage、题型、草稿、补题、任务控制和发布。主题相关正文/图注/原图共同选材，目录/参考文献在默认技术题中排除。

普通执行链中逐步建立证据包，采用已有 prepare/resolve 获取真实字节和 visualCitations；规划、求解、编题、独立审阅及编辑后复审均实际传图。只给 JSON 增加 visualCitations 字段或只在规划阶段传图均不算完成。无图题维持文字通道，有图请求必须显式满足视觉路由。

纯图资料使用明确 visualTargets 分支；普通文字请求的 sourceIds 必填规则保持。复用独立带图 Job 的真实四阶段能力，必要时在现有原生任务内分批委派，不能新建自制队列或把独立入口的 1–6 题限制直接改成任意大数。

模型 schema、parse/normalize、裁剪、草稿保存、修题、补题、去重、审核指纹、发布和各练习导出必须保留图片证据。题干/选项改变后旧视觉审阅失效；客户端 pending/verified 标记不能直接决定发布。普通 live model control 继续支持；切换到非视觉模型的图题阶段显式失败并保留草稿，不能退化成假看图。

模型审核检查主题、证据、条件、评分/唯一答案、图像事实、关键器件/连线/单位、重复与学习价值。30 题以内容分布为目标，输出数量以实际接受题数为准；没有足够通过题时给出缺口和原因。练习/考试/口试/错题/复习显示必要原图，并沿用现有答题前不泄露答案/图解的规则。

### 5.7 检查点、暂停与恢复

为云解析提供 persistence.open，复用 createManifestJobStore/createDurability 模式与 validateInput、validateCheckpoint、reconcileCommit 等钩子。输入保留原件哈希/大小/任务配置；检查点记录完成页及已验证输出哈希；模型回包通过校验并存盘后才算完成页。

使用 context.saveCheckpoint、context.commitArtifact 和原生控制协议实现阶段安全点。先维持 unsupported/none，实际暂停与重启恢复通过后才声明 checkpoint/resume-checkpoint。恢复固定 route/config，身份变更显式冲突，不能混入新模型结果。

物理任务 owner/执行准入仍由 DSH executor 管理。重启恢复不重新提交已完成页；最后提交版本采用幂等 receipt，崩溃窗口实际测试“不重复版本/不重复 sources”。进程在未保存响应时退出可能需要重新调用该页，这点不承诺绝对只计费一次。

检查点作为任务状态与文档版本区分。完整库备份若不带可续跑检查点，必须标明仅恢复已发布资料，恢复任务为不可续跑/需重新提交；禁止恢复后假显示进行中。需要携带检查点时同步更新归档和权限，不能偷偷扩大旧格式。

### 5.8 资源包、安全与回退

资源包从 canonical visual manifest + reading 扩展确定性生成；共享阅读节点及排版逻辑，导出 HTML 和应用 React 渲染可以不同，但内容/映射必须一致。不要求模型分别输出整本 JSON、HTML、MD。

```text
book-package/
  manifest.json        # 资源包格式、文档版本、能力和每文件 SHA
  original.pdf         # 不变原书
  document.json        # schema=1 原页/块/资产 + 可选 reading 扩展
  textbook.md          # 完整阅读正文、真实相对图片、公式、原页锚点
  index.html           # 章节入口
  chapters/            # 按章 HTML
  figures/             # 实际原图、图表、公式区域
  styles/              # 本地 CSS、公式字体
  viewer/              # 项目提供的受信任阅读/对照资源（能力可选）
  mappings.json        # 与 document.json 同源的阅读→原页映射
  quality-report.json  # 页覆盖、待核对内容、检查及失败原因
  figure-notes.json    # 独立图解与核对记录
```

沿用现有 textbook ZIP format 与全库 backup format；扩展 metadata/capabilities，不擅自让教材包进入库恢复 API。旧普通 JSON 备份照旧，不能携带新增大附件时明确提示使用完整 ZIP。各资产全部校验，sidecar 如有也纳入全库归档，不按图片扩展名误导出。

禁止模型可执行 HTML/JS、任意资源路径和外链；继续 Markdown html=false、净化表格、KaTeX trust=false。所有资产访问校验库、文档、版本和归属；库切换使 transfer/缓存失效。上传、解包、导出临时文件按既有边界处理路径穿越、哈希不符和超限。

本地渲染/打包需要 Python/PyMuPDF时，交付提供检测与安装方法或合法可分发的运行时；不要依赖开发机隐含环境。复用当前 PDF.js 资产优先于新增大依赖，新增分发检查许可。

应用内离线阅读/对照必须实测；直接双击 HTML 的基础阅读单独验收。若 file:// 不支持某些对照/加载操作，说明实际限制，不为完成导出而部署额外永久服务。

回退以旧包+升级前独立库备份为单位：停止新任务、导出/校验现库、保留新格式库副本、通过 Desktop 原生 generation 切回旧包、打开旧库副本并核对旧引用/复习。不能要求旧程序反向迁移新库或覆盖不理解的新字段。

## 6. 分阶段实施 C01–C12

每项产出包含最小源码改动、相关测试、证据路径与实际状态。禁止按“代码看起来完成”跳过验收；独立任务可继续推进，依赖未通过的阶段不得标完整。下列拟新增文件名属于实施建议，允许保持语义的最小调整，实际路径在 progress 记录。

### C01：接手基线与宿主能力（R01、R06）

- 基线子任务：检查 Git/版本/现有源码与安装版、当前已授权日常 Desktop 与学习库、备份/数据哈希和相关测试；新增测试 fixture 可使用临时隔离库。核对旧 9 项失败的历史报告及当前表现。
- 能力子任务：从宿主目录选真实可用云视觉 route，测试一张正文、一张 PMOS 电路、一张表格；核对附件真实收到、结构响应、取消、最大输出、推理选项和 usage。指定 GPT-6 Luna 时单独记录实际模型身份，不用另一个模型冒称。
- 2026-10-11 模型验证安排微调：用户已在 Desktop 配置 Qwen 凭据。原生 `session/modelCatalog` 只读查询发现 qwen 提供方及 175 个目录条目，包含 `qwen3-vl-plus`、`qwen-vl-ocr` 和新版通用模型；目录可见不等于真实图片调用成功。优先探测宿主明确声明 image 输入的 `qwen3-vl-plus`，再比较正文/电路/表格质量及实际用量。OCR 专用、图片生成、音频及实时模型不因名字含 Qwen 就进入通用 JSON 解析候选。官方能力参考：https://docs.modelstudio.console.alibabacloud.com/zh/model-studio/qwen3-vl-plus 。
- 早期探针曾使用隔离 home/库；当前依用户授权在日常 Desktop 实施和验证，并通过原生设置选择 Qwen 与任务上限。沿用 DSH 原生 credentials 服务；不读取或复制密钥到项目代码/环境变量。云解析固定精确 route/config，普通出题继续保留任务内模型切换。Qwen 验收与 GPT-6 Luna 验收分别标识，成功前不启动 572 页首次无缓存运行。
- 实测补充：Desktop 当前 Qwen profile 默认 input 为 text，目录条目没有单独 input；隔离探针对精确模型声明 image 后，`qwen3-vl-plus` 的真实原生调用被 Key 权限拒绝（HTTP 403 `access_denied`，宿主报告 usage=0）。保留该失败证据，可继续按官方视觉能力说明测试目录中的 `qwen3.8-max`/`qwen3.8-flash`；不得把全部 175 个目录条目当成账号可用视觉模型。能力参考：https://www.alibabacloud.com/help/zh/model-studio/vision-model 。
- 当前能力证据：`qwen3.8-max` 曾保存第一页检查点，随后宿主连接中断；另一次调用四分钟超时，稳定性尚未通过。`qwen3.8-flash` 已通过三页真实附件/结构候选保存和原生暂停→退出→重启继续，适合作为后续分层校对的已验证候选；仍不将账号目录、转写候选或宿主 usage 当作内容准确率或账单。`implementation/evidence/cloud-pdf/native-acceptance.json` 保存脱敏计数/哈希；未执行 572 页首次云解析。
- 只用已有 DSH provider/凭据机制；无 route 时保留能力缺口，不阻塞 C02/C03 的独立开发。云模型真实任务验收须等能力子任务通过。
- 通过：原生可重复启动、已授权的日常部署/备份/旧库保全有证据；真实视觉模型、实际调用路线及缺口分别记录，不读取凭据。

### C02：Schema、API、权限与测试契约（R01、R02、R04、R06；依赖 C01 基线）

- 改动接点：visual-contracts/visual-operations/visual-storage、runtime/domain-contracts、runtime/builtins；新增 reading 契约与封闭解析参数。
- 明确 reading 节点、chapter/flow/anchor、source.text/page.text 一致性；旧 schema=1 和 visualCitations DTO 不变。
- 通过：旧参数仍走 MinerU；未知 parser、错误 modelKey、越界坐标/范围、失效资产/跨库访问拒绝；旧清单读写/恢复不损失内容。未实现模型处理可用明确 fixture 验证契约，不能标云解析已完成。

### C03：轻量分页、真实裁图与原件读取（R01、R02、R03；依赖 C02）

- 复用 visual-raster/pdfHelper、uploads、visual.chunk，按需扩展分页/切片 helper；仅增加必要依赖检测。
- 对旋转页、非默认 CropBox、去倾斜、切片重叠和图注裁取建立变换/逆变换；测试原件大于普通小文件边界。
- 通过：原 PDF SHA 不变，572 页可有界读取，原始 PMOS 圆圈不截断；纯图/空白/混合页保留身份，资源超限和取消无半成品引用。

### C04：云端原生 Job 与持久化（R01、R06；依赖 C02/C03，真实验证另依赖 C01 能力）

- 建议新增 `lib/contexts/materials/scanned/cloud-import.js` 与同域 persistence 适配；不替换本地 Job definition。
- 准入、逐页 gateway、清晰错误阶段、有限重试、检查点与版本幂等提交；分别绑定渲染和真正模型调用，不误记 modelRequest。
- 通过：原生任务页有真实阶段；安全点暂停、取消、retry 和宿主退出/重启恢复实际测试；保存、模型返回、检查点、版本提交各崩溃窗口无重复版本/丢历史。能力声明与实测相符。

### C05：正文/图表识别与阅读结构（R02；依赖 C04）

- 建议新增同域 cloud-result adapter，复用现有解析块类型、caption、assets、质量字段；建立 reading 扩展与稳定映射。
- 运行分层 20–30 页，忠实正文、公式、表格、chart/子图、跨页段落/续表、章节、待核对回退。
- 通过：按第 7 节校对集核验，无静默漏识和伪造图片；模型未知内容保留原图；词句/公式/表格可定位原页且不能污染已有 OCR。

### C06：大文件原貌及区域对照（R03；依赖 C03，阅读结构接线依赖 C05）

- 改造 DocumentViewer/原页组件，优先原生 chunk + PDF.js 按需载入；Range能力作为可选优化。
- 原貌/区域定位、页码输入、缩放、切换页、URL/位图/缓存释放、跨库取消；旧小 PDF 入口保持。
- 通过：真实本书首/中/末页、连续翻页、换文档/版本/库；不请求整书 base64，不通过未鉴权路径读 PDF，未出现过期页面覆盖新页面。

### C07：资源包及备份扩展（R02、R06；依赖 C05）

- 扩展 textbookOutputs/visual-archive/visual-zip 既有机制，按阅读节点生成 HTML/MD及映射；不改变全库 ZIP 与教材 ZIP 的职责。
- 校验所有资产和可选扩展的导出/备份/恢复；无 API网络情况下阅读本地 HTML基础内容。
- 通过：JSON/HTML/MD 内容一致、相对图片存在、公式/续表不遗漏；新旧资料全库备份往返SHA一致，误将教材 ZIP 作为库备份时明确拒绝；恶意 HTML/路径/超限归档被拒绝。

### C08：现有阅读页面的完整融合（R03、R04；依赖 C05–C07）

- DocumentViewer 与 VisualReader 共享外壳/内容适配，ScannedOnly走文档入口；沿用目录、查找、字号、学习侧栏和阅读循环。
- 选区映射接入现有提问、批注、翻译；目录/分段的人工选择和 stale 状态保留，阅读位置和章节练习映射不漂移。
- 通过：第 7 节全部阅读用户路径；重排正文及重复句引用准确，跨页不可支持的选区明确提示；小窗口对照/侧栏可用，无孤立按钮、重复顶级页面或文字图解泄漏。

### C09：检索、普通出题和各阶段原图接线（R05；依赖 C05/C08）

- 从普通 generation operations 追到实际执行/协议/草稿/补题链，复用 gateway-model、visual retrieval/cards 及现有题型；覆盖纯图 explicit visualTargets。
- 保留 topicScope、coverage 与 per-job 模型切换；所有带图阶段解析真实附件，改题后重审，发布保持事务门禁。
- 当前实现：普通 generate/supplement 的严格 visualTargets 和创建题组图片选择已接通；分步生成只继承该步资料页的原图。规划、答案、编题、审阅、补题及修题真实传图；逐题实际收据、引用邻域、模型条件、同行目标检查和两轮自动修订已实现。修题的图卡只作一次独立真实图片审阅，不再重复文字审阅。MOS30基准已保存；未经人工改题的Qwen自动专题另行验收。纯图请求不制造 source，原任务换模型及旧文字默认流程保持。
- 通过：无图旧请求不变；非视觉路由不能假出图题；实际模型规划/求解/编题/审阅/补题收到必要原图；真实 MOS 30 题逐题审阅并人工抽检，不混入参考文献或重复凑数。

### C10：历史与其他功能兼容（R04–R06；依赖 C07–C09）

- 题目回链、改题、题组/JSON导入导出、练习、笔试/口试、错题、复习显示与证据保留；普通资料/音频/课程/笔记/检索入口不被云模式误接管。
- 同一 PDF 重解析的新旧 revision 可并存；历史图片/选区仍可定位；快照核对旧引用、答案、调度和批注。
- 通过：相关旧测试不新增失败；隔离备份恢复逐资源SHA和Store一致；失败新版本不替换旧可读版本，旧程序/旧库回退实际验证。

### C11：整书真实运行与用户流程验收（R01–R06；依赖 C04–C10）

- 本书572页首次无缓存转换，另做缓存复用；记录使用机器、模型/参数、各阶段时间、usage、失败/精修页和内存/磁盘。不能把旧缓存导入约6秒当云端首次解析成绩。
- 完成导入→任务→阅读→原书对照→MOS题组→做题→回原书→复习完整流程；检查质量范围与缺口。
- 通过：第 7 节硬门槛和抽检目标；尚有正文缺失/关键识图错误的“待核对”与真正完整结果分开。没有可用真实模型/不能人工校对则如实保留未验收项。

### C12：构建、交付与已授权桌面部署（R06；依赖 C10/C11）

- lint/build、相关测试及因本轮跨域范围而需要的完整回归；记录每个失败是否可在未改基线复现，不笼统借“历史9失败”豁免。
- 按现有 release:pack/release:check 生成新版整包/拆包和检索扩展，不覆盖 .3；包内 entrypoints/locales/依赖/文档/资源正确，校验SHA。
- 使用 Desktop 原生 generation 安装器部署日常使用版本，升级前核验备份，重启后比对源码、所有客户端分块、旧两库及启动链。回退使用保留旧包和对应旧库备份，不反向覆盖新格式资料。
- 通过：可安装包及每文件哈希、真实测试证据、中文使用说明和回退步骤齐全。日常部署已授权；未实际执行新版降级时明确标作未验证。只提交授权源码与脱敏证据，不上传教材资源。

## 7. 验收计划与证据标准

### 7.1 固定素材与校对集

本书路径：

`C:/Users/Lenovo/Desktop/杂物/大三上/数集/数字集成电路 电路、系统与设计 第2版 (（美）拉贝艾，（美）钱德卡桑，（美）尼克里克著, (美)Jan M. Rabaey etc.) (z-library.sk, 1lib.sk, z-lib.sk).pdf`

原件572页、198,094,368字节，SHA-256：`1bee28d307564671e604d8a85860aecc53099221044046e16ad264b21fb8c358`。现有解析资产计数仅作基线，不作原书真值或新方案完整性的分母。

- 必含第149页/印刷131页：图5.1 PMOS/NMOS反相器、图5.2多子图，核对栅极圆圈、端口和连线。
- 第200–201页：多图、公式6.5/6.6、表6.4及表6.5跨页内容；第206页波形；第292页本次目视为空白，保持页号。
- 增加目录、MOS正文、密集文字、脚注、参考文献、低清/倾斜页、首末页和随机未用于调提示的保留页；如该书无双栏/旋转实例，再用隔离的自建真实 PDF fixture验证这些布局。
- 开发期质量基准规划至少10,000字符人工真值及30个区域标注；未完成不得声称已完成。运行时逐份导入不要求 GPT/人工复核，改由有实际原图输入、检查点和有界修复的模型流程处理。开发调试样本和未改写保留样本分开，公开证据仅写统计，不上传教材正文。
- 追加短中文论文、既有英文论文、普通小PDF、纯图PDF、混合文字层PDF；用户素材不足的类别用明确标识的合成文件，不伪称真实教材结果。

### 7.2 端到端用户操作验收

必须在真实隔离 DSH + 浏览器执行，录入截图/日志及结果，不只看函数返回：

1. 导入云解析资料，切到其他页面再回来，任务持续并正确呈现阶段；故障/暂停/重试不会重复创建文档。
2. 从现有资料列表进入阅读，目录定位、字号/行宽、查找、放大图片、下一节、关闭再打开恢复位置。
3. 在段落/公式/表格中操作选区提问、批注和翻译，题目回链到真实页；重复句和跨页选区不误指第一处。
4. 原书/对照视图缩放和跳页，电子书点击图/公式/文字定位区域，并排滚动同步；窄窗口展开目录/学习侧栏不遮住不可关闭内容。
5. 在现有从资料出题、创建题组、章节/页补题入口请求MOS30题，记录真实选材/图像/各阶段审核；正文或图像不足时正确显示缺口。
6. 草稿编辑、重新审阅、正式发布到隔离题库、练习/考试/错题/复习，原图可见且答题前无答案泄漏；回到原资料仍定位正确版本。
7. 导出教材资源包并离线打开基础HTML/MD；导出完整库ZIP、恢复到另一隔离库核对；旧JSON与旧资料仍可读。
8. 重启宿主后续跑、失败后继续、同书换解析模型创建新版本、任务中切换普通出题模型、换库、回退旧包/旧库均实际走通。

### 7.3 通过门槛

- 完整性：572/572页记录；原PDF SHA不变；正式引用的资产100%可读/哈希有效；无静默漏页/缺图/假全文；无法转写正文明确列入未完成或待核对，不能据“有原页”标全文识别完成。
- 抽检准确性：校对集字符准确率目标≥99%，阅读顺序正确率≥98%，图区域与图注对应率≥95%。字符准确率用明确文本标准化后的插入/删除/替换编辑距离计算；阅读顺序以人工标注的块先后关系为分母；图像对应率用人工区域/图注标注为分母，漏检也计错误。
- 关键知识：负号/上下标/单位、PMOS/NMOS、交点与连线、表格合并单元格单独报告。固定反相器验收案例关键器件与连接必须正确；未知时不通过，不能靠平均准确率掩盖关键错误。
- 题目：30/30只有真实通过逐题独立审阅才显示；对30题做逐题人工核对或保留人工未验收状态，独立模型自评不等于全部正确。按概念、器件分析、图表、公式/计算、设计变化分布记录，禁止无关题和同题改写凑数。
- 兼容：受测旧库的资料/版本/引用/批注/答案/调度快照不变，资源归档完整；新代码不新增相关测试失败，出现失败有基线对照。任何必要迁移先在隔离副本验证。
- 性能：默认正文页/图像虚拟化与请求窗口有界；图像仍遵守4图/8MiB、清单32MiB、chunk256KiB、渲染12MP等现有边界，不能为了通过而全局放大常量。记录冷启动和重复阅读的页延迟/内存；C06真测后冻结可复现的性能阈值并在C11按同一机器/配置复测，最终报告不得只写“流畅”。

目标达不到时，有限精修、原图回退与待核对状态如实展示；不下调阈值、删样本或把纯图显示算转写成功。人工确实未执行的项目不标通过。

### 7.4 现有测试入口与执行方法

在源码根目录运行现有 runner，它隔离 DSH_HOME并清除继承凭据。以下是已存在文件，新增行为还需补充有意义的测试：

```powershell
# 合约、存储、视觉模型及图像证据
node scripts/test.mjs tests/scanned-visual-storage.test.mjs tests/scanned-visual-import.test.mjs tests/scanned-visual-model.test.mjs tests/scanned-visual-citations.test.mjs tests/runtime-contracts.test.mjs tests/runtime-transaction-isolation.test.mjs

# 阅读与新旧资料、映射及归档
node scripts/test.mjs tests/document-preview.test.mjs tests/materials-outline.test.mjs tests/materials-annotation.test.mjs tests/materials-segmentation.test.mjs tests/page-peek.test.mjs tests/original-attach.test.mjs tests/scanned-visual-preview.test.mjs tests/scanned-visual-browser.test.mjs tests/scanned-visual-archive.test.mjs

# 出题、模型控制、恢复及发布证据
node scripts/test.mjs tests/scanned-visual-questions.test.mjs tests/scanned-visual-retrieval.test.mjs tests/job-contract.test.mjs tests/job-model-choice.test.mjs tests/generation-lifecycle.test.mjs tests/generation-restart.test.mjs tests/generation-stage-effort.test.mjs tests/review-integrity.test.mjs tests/json-import.test.mjs tests/oral-exam.test.mjs

npm run lint
npm run build
# 最终完整回归：本轮实际更改跨越材料、阅读、出题和生命周期后执行
npm test
# release:pack后核对相同输出目录，不能检查旧包冒充新版
npm run release:pack -- --outdir=D:/studyhub/implementation/delivery-cloud
npm run release:check -- --outdir=D:/studyhub/implementation/delivery-cloud
```

真实模型、native runtime、Desktop安装和人工校对单独执行并单独记录；mock/fake/provider fixture通过只证明相应协议。不要用带凭据的真实端点替换测试 runner 的受控网络规则。

## 8. 源码、文件、证据与交付管理

### 8.1 权威文件与隔离位置

- 权威计划：`D:/studyhub/implementation/source/implementation/STUDYHUB-CLOUD-PDF-IMPLEMENTATION-PLAN.md`；工作区入口镜像：`D:/studyhub/STUDYHUB-CLOUD-PDF-IMPLEMENTATION-PLAN.md`。只维护同一正文，不创建第二份交接方案。
- 进度：源码中的 `implementation/progress.md`，同步到 `D:/studyhub/implementation/progress.md`；每阶段写状态/提交/验证结果，保持已有历史，不改AGENTS/README成流水账。
- 推荐本轮隔离home：`D:/studyhub/implementation/test-harness/cloud-pdf`，隔离profile/workspace在其下创建；使用显式 DSH_HOME/库根，不继承正式APPDATA。隔离Desktop generation按宿主能力设置独立home并验证，不假称CLIprofile就是Desktop隔离。
- 推荐测试库：`D:/studyhub/implementation/test-libraries/cloud-pdf`；恢复测试用同目录下独立 restore 库。正式 `D:/studyhub/libraries/数字集成电路-图文` 和其他已有库只读。
- 私有备份：`D:/studyhub/implementation/private-backups/desktop-before-fullbook*`；新版包：`D:/studyhub/implementation/packages/3.3.0-scanned.21`。整书、API原始回包、截图和题目验收内容保存在源码目录外的 `D:/studyhub/implementation/evidence/fullbook-20261012`；不要覆盖已有回退包或提交私有教材内容。
- 私有模型回包、全书图像/全文、截图和题目内容保存在Git源码目录之外的隔离库/证据目录；提交仓库的证据在 `implementation/evidence/cloud-pdf/`，仅含脱敏汇总、测试日志、哈希及公开自建fixture。

### 8.2 提交和证据要求

每项完成一次或多次小提交，写明实际行为与验证；提交前仅暂存本轮文件，检查diff和凭据/教材泄漏。不要提交 API key、会话URLtoken、完整provider配置、DSH_HOME、用户PDF/图片/全文、正式库、私有备份、node_modules、缓存、生成包和编译前端。公开发布包不包含用户教材资源包。

每阶段证据至少包含：实际HEAD/安装源码哈希、时间、机器/宿主/模型配置（无密钥）、素材哈希和页范围、测试命令/退出码/通过失败数、真实/合成标记、原件与旧库前后快照、限制及失败原因。云调用记录实际 provider/model、输入图片哈希、阶段、接受/拒绝与可取得的usage；缺失用量写unknown，不能用假估值补账。

检查并清理本轮自身临时脚本/渲染图/失败副本；保留必要验收证据与可重现fixture，不清理未知历史文件。包和日志用现有忽略规则或保存在源码外，不扩大无关目录结构。

### 8.3 最终交付与结束条件

交付可安装新版包/拆包/检索扩展、每文件SHA、中文使用说明（导入/选模型/阅读/对照/出题/备份/依赖）、实际测试与限制报告、隔离升级/回退步骤。资源包在用户本机生成，公开仓库只保存实现和脱敏证据。

只有目标流程有实际通过证据才标已验证；外部能力缺口、未确认正文、关键识图错误、尚未完成的开发基准或降级演练分别说明。日常部署按已授权范围执行；继续当前未完成验收，不重做已完成解析或已付费检查点。
