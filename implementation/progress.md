# 扫描教材实施进度

## 当前状态
- 当前任务：T12；T01–T12 已完成开发、实际验收与最终交付发布。完整回归的基线失败/间歇问题如实保留，见 evidence/final-validation.md。
- 基线：上游 v3.3.0，daa4df7b3045df14290e10a43d72e0e751e0f72d。
- 独立源码：D:/studyhub/implementation/source，分支 feat/scanned-textbook-visual。
- 隔离环境：D:/studyhub/implementation/test-harness；测试库：implementation/test-libraries。
- 已按追加授权安装到正式 Desktop web profile，运行 3.3.0-scanned.2；旧 .dsh-study 的 40 个文件与安装前备份哈希一致。新教材和题组使用独立库 D:/studyhub/libraries/数字集成电路-图文。
- T01：依赖/lint/build/release:check/隔离 DSH smoke 通过；原版完整测试 7891 通过、2 个已复现基线失败、153 跳过，详见 evidence/baseline-results.md。
- T02：7 页公共 MinerU API 实际成功取得 JSON/ZIP；DSH 原生附件保存/读回及模型目录实测通过，evidence/mineru-contract.md、dsh-capabilities.md。
- T01/T02 证据提交：实施记录仓库 32363c5；源码基线未改动。
- T03/T04：默认关闭开关/严格 DTO/跨库隔离/历史版本/取消/去重/完整清单验证，相关 32 项测试与 lint 通过，evidence/t03-t04-tests.log、t03-t04-lint.log；源码提交 4d2dd6ef。
- T04：188.9 MiB 原书流式保存成功，SHA-256 与原件一致，原件修改时间未变；此次保存进程峰值 RSS 99282944 字节，evidence/t04-full-retain.json。此数值不代表解析/宿主总内存。
- T05：7 页样例实际公共 API 导入成功，35 个图/公式/表资源，重复导入校验复用，首个样例页对应原书第 200 页；evidence/t05-sample-result.json、t05-sample/manifest.json。
- T05 视觉检查：已直接查看本次保存的图 6.14、6.15(a)/(b)、6.16，核对原页，四张图清晰、图注对应、6.15 子图共享父组。页码齐全不等于 OCR 无误，所有结果仍待核对。
- T05：17 项相关测试通过（含原版 native PDF Job 测试），evidence/t05-tests.log；本地解析使用既有 Jobs/gateway，cancel/retry，暂停/重启恢复明确 unsupported/none。
- T05/T06 native 验证：实际隔离 DSH 0.2.0-rc.2 上传样例、运行原生 Job、提交、打开图文、原页对照、翻页成功；未认证请求 HTTP 401，console/pageerror 均为 0。evidence/t06-native/summary.json 与三张截图。
- T06：相关 29 项测试、lint/build 通过；包括无模型旋转页预览、纯图文档不伪造 source、资产篡改拒绝、历史版本及旧材料兼容。evidence/t06-tests.log、t06-lint.log、t06-build.log。
- T06 截图核对：原图与公式实际渲染；纠正旧阅读器误报“没有原文件”，大原件只能沿新分块通道，不扩大旧 document.bytes。
- T06 源码提交：0062b616。
- T07：实际 7 页教材 ZIP 导出并恢复新测试库，逐页资产哈希验证通过，源文字不变。evidence/t07-roundtrip.json；packages/sample-textbook.zip 为可离线阅读的样例产物。
- T07：离线 HTML 原图/公式/表格浏览通过，外部请求 0、页面错误 0，evidence/t07-offline-result.json、t07-offline/page200.png、page201.png。
- T07：7 项相关测试通过，涵盖旧 JSON 材料、旧题 SM-2 状态、跨库 transfer 拒绝、坏 ZIP/路径穿越/缺资源拒绝且原库不变；evidence/t07-tests.log。样例库本身没有旧题，SM-2 验证来自明确的合成测试，不冒充真实练习。
- ZIP 上限 2 GiB、展开 4 GiB、库元数据 64 MiB；新文件不走旧整包 JSON 通道。旧库 JSON 导出/恢复继续使用原逻辑；含图文版本时旧导出明确拒绝缺附件备份。外部引用原件仍保留引用语义，不冒称已复制进 ZIP。
- 当前实际 native profile/library 路径以 evidence/t06-native/summary.json 为准，每次 QA 使用唯一隔离后缀，不复用正式库。
- 尚待验证：新 ZIP 按钮的完整宿主界面往返、真实视觉模型、带图题、检索、572 页全书与最终打包。正式 Desktop 安装/测试尚未执行。
- 调试纠正：一次样例脚本漏设 DSH_HOME，产生默认 .dsh 下该样例 hash 对应的 visual-render 临时目录；后续固定为 test-harness/home。对该空临时目录的清理命令被系统策略拒绝，未继续绕过；不涉及正式 profile/学习库安装或数据写入。
- T08：新增显式原生 image 附件入口，保留旧 complete 文本清理；真实 DSH direct/subagent 均准确回答仅存在于控制图内的随机代码与形状数量。evidence/t08-real-vision.json、t08-native-gateway.json。
- T08：真实 native Job 两次调用分别记账 670/1722 tokens，accounting=recorded，子代理释放；真实已接纳子代理取消成功并释放，evidence/t08-native-cancel.json。取消调用未获得 provider 用量，明确为 null，不能推断未计费。
- T08：43 项相关测试及 lint 通过，evidence/t08-tests.log、t08-lint.log；请求组装测试证明 image 块保留，覆盖模型能力未知/不支持、超限、占位 offload 拒绝、附件不可读、429、超时、取消、旧文本入口。offload/429 错误为显式模拟的 provider finish，未冒称触发真实官方服务的这些错误。
- T08：密钥仅从用户授权文件读取到隔离启动环境，经 DSH credentials/provider 使用；未写入插件配置、证据、聊天或提交。
- T08 源码提交：4c1a9ae2。T05 源码提交：2e017a44；T07 源码提交：9b1d1b66、5044cf59。
- T08 实施证据提交：a7d1751。
- T09：图解通过原生 Jobs/gateway，逐组保存独立版本、上下文/清单指纹、图片哈希、路由及待核对状态。公开操作支持页范围补解、重解留痕、人工修正/否决和明确选择索引；解析源文字不接收图解内容。
- T09：真实隔离 DSH 安装当前开发包并经浏览器调用，电路图 p1-b2、表格 p2-b9、曲面图 p7-b9 分别得到待核对解释；3 次 subagent 调用用量 3992/4499/4475 tokens 均 recorded，匹配任务全部复用，OCR 未改，console/pageerror=0。evidence/t09-native/summary.json、explanation-pending.png。
- T09：真实无视觉模型环境尝试“同时解释”，图解明确 unavailable、没有虚构解释，图文导入/原页/翻页继续成功。evidence/t09-no-model/summary.json、import-retained-no-vision.png。
- T09：63 项相关测试及 lint/build 通过，evidence/t09-tests.log、t09-lint.log、t09-build.log。覆盖分组预算、模型/上下文改版、人工历史和拒绝缓存、取消保留已完成组、强制重解的 native retry 复用、失败无无限重试、备份恢复解释历史及旧 SM-2。取消/人工作品修正为明示的合成测试，实际教材解释仍 pending，尚未证明所有技术叙述准确。
- T09：真实默认推理首次达到输出上限，失败未存为解释；最终使用宿主实际最低可用等级（Flash 为 off），说明长度限制和 4000 输出 token 预算。调用成功不等于解释已被人工核对。
- T09 源码提交：36f504ad。
- 下一步：T10 visualCitations、独立图片审阅和带图题全链路，再继续 T11/T12；开发与隔离验收通过后进行获授权的正式 Desktop 实测。
- GitHub 交付目标：https://github.com/xiling951/temp-studyhub；仓库公开，已包含阶段提交，仅提交源码、进度和必要测试记录，教材 PDF/扫描图/凭据留在本机。
- GitHub 已推送 main：c827109e（包含截至 T09 的源码历史与证据）。Desktop 快捷方式已确认指向 D:/studyhub/start-dsh-desktop.cmd；此步仅只读检查，未重启/替换 Desktop。
- T10 进行中：已增加严格 visualCitations DTO、实际文档/页/块/区域/资产校验、独立复审记录绑定与 publicCard 原图投影；普通原文引用不放宽，JSON 标记不能豁免视觉证据。14 项新增相关测试及 100 项引用/题库/发布回归通过，evidence/t10-citations-tests.log、t10-citations-regression.log。模型生成/发布接线及全部练习显示尚未完成，不能标记 T10 通过。
- T10 证据校验源码提交并推送：8aa8e080。
- T10 发布边界接线：常规/快速/计划发布重新核验真实资产，事务内检查文档拥有的独立审核记录；bank.append 在协调锁内核验。带图 JSON 保留引用并成为待复审草稿，不信任导入的已核对标记，也不静默丢弃错误文字引用。104 项相关测试通过，evidence/t10-publication-tests.log；批准发布与审核记录均采用明确的合成测试，真实带图模型出题/审阅和练习界面尚未验收。
- T10 原生带图出题和界面接入：四阶段均走原生图片附件；审核未通过保留草稿，改题后旧审核失效，可重新独立审阅。阅读器可选图出题，草稿/练习/考试/口头模拟/错题详情显示原图并可定位原页。49 项相关测试及 lint/build 通过，evidence/t10-questions-tests.log、t10-questions-lint.log、t10-questions-build.log；模型返回仍为明确合成测试，真实付费模型和界面验证接下来执行，T10 尚未通过。
- T10 浏览器界面验证通过：明确合成的图像/题目 fixture，五种题型答题前原图可见且无答案/图解泄漏，闪卡翻面保留图片，放大/原页定位、笔试、口试、错题详情通过；evidence/t10-ui-fixtures、t10-browser-tests.log。50 项相关测试通过，不能据此冒称真实模型答案准确。
- T10 真实模型发现并阻止错误草稿：首次规划格式不满足要求，后续模型把 NMOS 尺寸关系读反，独立图片审阅实际拒绝。人工对原图修订后的复审又暴露普通 draft.save 清理新拒绝记录的问题；已添加受授权内部复审保存通道，内部审核操作从外部 action/能力目录排除，保持原公共保存行为。20 项相关审核测试及 8 项 runtime 权限/事务/快照回归、lint/build 通过；真实复审重测进行中，尚不标记 T10 通过。

- T10 阶段通过：真实教材两题（纯图证据，不伪造文字引用）经人工对原图修订及新原生独立图片审阅，2 题正式发布成功；2 次 final subagent 审阅 5376/17101 tokens 均 recorded。答题前原图显示并定位原页、JSON 往返保留哈希且重置为 pending/拒绝直接发布、OCR 不变，console/pageerror=0。evidence/t10-native-result.json、t10-native/summary.json 与截图。初始自动答案实际被拒绝，不冒称无需审阅即可正确。
- T10 最终相关 27 项测试及 lint/build 通过（evidence/t10-final-tests.log）。复审前先验证草稿必填字段，错误状态不派发模型调用；安装 QA 采用独立 tgz 路径并校验 4 个关键文件 SHA，防止同版本同路径的宿主包缓存冒充当前源码。T11 继续实施，T12 全书、最终回归/定制版本与 Desktop 实测未完成。
- T11 进行中：通过材料权限域从 sourceId/当前不可变清单恢复原图映射，检索命中优先匹配图注/附近图像或已选图解的块；排除旧版，旧题历史图片仍可读。索引内容/哈希包含图文版本、明确选择的已核对图解及其版本；源 OCR 不接收这些文字。纯图片页仅生成私有索引记录，不写入旧 sources，也不能作为普通文字引用或文字出题页面。检索预览可查看原图、原页并提交原生带图出题。81 项相关检索/生命周期回归及 lint/build 通过，evidence/t11-tests.log、t11-lint.log、t11-build.log。
- T11 真实检索环境调试：原生 CLI 的同版本包缓存已用独立路径与代码哈希校验规避；真实扩展须应用官方 bundle patch 才会启用。pnpm 11 的必要构建脚本已仅在隔离 profile 对 onnxruntime-node/sharp/protobufjs 配置允许，依赖缓存后离线安装成功，未改全局/正式环境。首次真实索引失败于搜索进程未使用现有代理；已仅在搜索子进程开启 Node 环境代理，22 项 companion/安装测试通过，native 实际索引与搜索重测进行中，不能标记 T11 通过。

- T11 阶段通过：真实原生 MCP 索引 8 页完成，命中映射图片 SHA 与原页核验成功；只修改一页经实施代理对原图修订并明确选择的图解后，实际仅重新索引 1 页，其余 7 页不变，源 OCR 未变，console/pageerror=0。evidence/t11-native-result.json、t11-native/summary.json。此核对不是用户人工批准。
- T11 网络修复：Undici 8 会替换 Node dispatcher，单独开启 Node 代理开关不足；搜索子进程使用已打包的 EnvHttpProxyAgent preload，只转发既有代理路由变量，不传模型密钥。8 项 companion/打包测试通过，evidence/t11-proxy-tests.log。正式环境未修改；继续 T12。
- T11 真实检索/网络修复已提交并推送 a2910951。T12 定制版本为 3.3.0-scanned.1；8 个 TGZ 和两份本地定制安装页已打包，release:check 全部入口/依赖名称/哈希/文档链接通过，evidence/t12-release-pack.log、t12-release-check.log。全书原生导入与完整回归仍在运行，尚不标记 T12 通过。
- T12 全书实际 native Job 完成：572 页、1321 个资源（含原 PDF），首次解析耗时 2329814 ms；每 10 秒采样的宿主进程树峰值 382509056 字节、解析进程树峰值 2330980352 字节（不是绝对瞬时峰值）。初次后验脚本误把 v4 分片清单当完整 state，已改用 Store.read，并逐项核验资源哈希，evidence/t12-fullbook/verified-after-store-fix.json。
- T12 实测修复：原 parser 在 PDF149 把图5.2图注挂到图5.1；adapter2 只在明确不同图号且另一图片更近时重新关联，保留原始所属块、原 OCR 和旧清单。真实新 native Job 从已重新核验的 v1 窗口派生 572 页新版本，1321 资源不变，OCR 不变。64 项 caption/导入/模型/UI 守卫及 49 项英文回归、66 项运行时/发布/图片浏览器验证通过。源码修复还覆盖原文题发布的额外读取时序（3 项资源租约测试重新通过）。T12 完整 verify 重跑与 ZIP/原页验收仍进行中。
- T12 完整 Chrome 回归第二次：8077 通过、11 失败、13 跳过（evidence/t12-verify-final.log）。其中 5 个浏览器问题已在未修改 v3.3.0 对照复现，2 个为已知 Windows Jev 基线；练习页超时在当前/原版单独复测均通过。新增重复 key 已修复（first-run + 新图片浏览器 2 项实测通过）；新增 Job 定义改放到各自 scanned 子目录，保持既有目录所有权守卫，34 项边界/文档/导入/图解/出题测试通过。还需最终 verify 当前源码、原生整库恢复、更新打包与 Desktop 实测，T12 仍未通过。
- T12 最终完整 verify：8101 项，8079 通过、9 失败、13 跳过（evidence/t12-verify-release.log）；8 项失败已在原版 Chrome/Windows 对照复现，剩余旧转换历史时序失败在当前/原版各 20 项定向重跑均通过。停止草稿后测试断言存在等待已移除元素的原版问题，两边相同超时并遗留测试服务，已仅结束报错后测试子进程。build/release:check 实际通过，不冒称 verify 退出码为 0。
- T12 整库原生界面恢复通过：另一隔离 profile 通过设置页上传/确认完整 ZIP，572 页、2 个历史版本、1142 真实 sources、1321 当前资源全部哈希核验，PDF149/印刷131反相器原图及原页显示通过，console/pageerror=0。evidence/t12-restore/summary.json、inverter-p149.png、inverter-original-p149.png；UI 成功后跳转首页，验收脚本已改为检查跳转与恢复数据。正式旧库40文件备份校验完成，Desktop 主包实际运行定制版本，检索扩展/真实题组仍待完成。
- T12 Desktop 实测发现学习模式缺少原生 Job 控制器，拒绝任务接纳；已在 study preset 加载 DSH 原生 job_output/job_list/job_kill 管理组件（无命令启动能力），quiet 完成通知避免额外唤醒，未修改 executor 的控制器准入边界。36 项预设/模块/生命周期/图文导入与出题回归通过，真实隔离 study preset 无视觉模型导入/原页/不可用提示通过，console/pageerror=0，evidence/t12-study-native.log 与 t12-study-native-result.json。最终包版本递增为 3.3.0-scanned.2，lint/build/release:check 通过；正式旧库仍保持原路径和数据，新书位于独立库 libraries/数字集成电路-图文。

- T12 Desktop 真实验收通过：572 页/1321 当前资源读回；原 PDF 原生导入复用已验证完整解析；图5.1（PDF149/印刷131）生成4道开放题。初次模型草稿因缺评分标准及无效文字ID被拒绝，实施代理对原图修订后4次原生独立图片复审均通过，4题正式发布，答题前图片/无答案泄漏/定位原页在实际 Desktop 验证通过。7次真实模型调用共50957 tokens，均 recorded，最低可用推理off。evidence/t12-desktop-result.json；用户本人尚未逐题核对，不冒称自动答案无误。
- T12 正常快捷方式重启通过：临时调试启动参数已移除，脚本和快捷方式哈希与原版一致；密钥经原生 credentials 服务保存，配置来源file，正常启动模型ready=true。StudyHub自动更新检查已关闭；既有宠物组件 /api/pet/pets、/api/pet/state 出现404，未扩大范围修改。
- T12 独立组件原生安装/卸载/重载通过：按项目约定为generation/study显式设置independent:true，禁用图文入口拒绝导入，卸载材料后相关能力消失、其它模块和3个旧题组保留，重装后能力恢复；完整旧库状态SHA前后一致。默认单组件会自动保留依赖，不能把该设计误判为卸载失败。evidence/t12-modular-result.json。
- T12 隔离原生插件回退/再升级通过：真实 v3.3.0 包安装后仍读到1142条原书OCR来源，所选真实原文SHA一致；再安装3.3.0-scanned.2后图5.1原图访问恢复。evidence/t12-native-rollback.json；正式环境未降级，保留定制包。

- T12 最终题面复核：中性标题修订后4题全部经过新真实独立图片审阅并重新发布，累计11次模型调用80828tokens，全为recorded。正常原快捷方式窗口核验图片、标题、PDF149/印刷131原页；旧库最终40文件SHA再次一致。evidence/t12-desktop-result.json。
- T12 最终题组附件备份恢复通过：独立新库实际上传/确认恢复572页、2版本、1142sources、1321当前资源、4题及审阅收据，原图与原页通过，console/pageerror=0，付费模型调用0。evidence/t12-final-backup-restore-result.json；脚本首页判断/包路径/版本遮蔽修正均以本次真实运行验证。
- T12 最终交付：8 TGZ、安装页、使用说明、测试报告、插件/数据回退及两份SHA清单齐全；release:check当前交付目录通过（evidence/t12-delivery-release-check.log）。最终生产代码完整提交：b8010dca0478666b27b7be9c3c988df4456913ac。源码根目录本轮临时操作脚本已删除；隔离日志缓存保留。清理两份失败上传副本被自动审批策略阻止，未绕过，副本留在宿主临时上传目录。

- 最终验收/题组备份/说明提交并推送：d18ae26f2c266425a873f2bee22c7885b274e1de。
- T12 已完成：GitHub正式发行 v3.3.0-scanned.2 已公开发布，19个交付资产均uploaded，GitHub服务端SHA256与本机逐项一致。evidence/t12-release-assets.json；https://github.com/xiling951/temp-studyhub/releases/tag/v3.3.0-scanned.2 。整合安装ZIP为34753986字节，SHA256 7ac1d5ebeb48a4111cb1cabc40187d128cc811be289330f3bb4290feee59c56e，包含17个交付文件（不含教材）。
- 最终已验证而不夸大的边界：完整verify仍为8079通过/9失败/13跳过；原版问题、间歇时序、合成fixture范围和正式未执行破坏性数据回退均见final-validation.md。正式Desktop保持定制版，原PDF及旧库不变，新教材库完整可恢复。没有待实施的本轮核心功能。

## 后续：MOS主题出题质量修复（已开发并真实验证）
- 真实问题：MOS请求保存了focus，但覆盖571页/635496字符，长度优先配额只选MOS正文80–111中的86页，参考文献564进入题组；24/30题，全部无图像证据。旧MOS题组和12题练习记录保持原样。
- 修复：复用原生规划模型和已有sectionWeights，在配额前核验topic relevance，不完整/无模型/无相关页拒绝退回整书；新草稿引用范围、inputRef与覆盖分母跟随实际选材。每题独立复审新增topicRelevance硬检查；证据不足不再作为sourceSupport可选建议。无主题的既有长度回退保持原行为。
- 7项新增测试及178项相关回归通过，lint仅原DocumentViewer警告；evidence/mos-focused-tests.log、mos-fix-regression.log、mos-fix-lint.log。合成模型测试不冒称真实答案已验证；实际教材/模型验收待执行。新版本3.3.0-scanned.3，正式环境仍为已交付.2，尚未替换。
- 已提交并推送 f2c5f2cf（主题筛选/证据门禁）与338677a3（编辑后发布继续执行主题门禁及原生验收脚本）。真实DeepSeek Flash低推理原生任务选材571→163页，排除408页，参考文献112/564不再进入选材；第一轮保留29道经审阅题，达到400000软预算后停止（实际累计1312671tokens，预算按调用边界检查，不能保证不超出）。证据evidence/mos-quality-1791638043353/summary.json；未手改答案或审核标记。
- 原生验收发现个别审阅遗漏topicRelevance，已复用原有有界协议重试，仅重问漏填的题，保留明确fail。新增回归现为9项；最终51项发布/协议/主题测试和14项真实文件名的运行时/严重性回归通过，另54项兼容回归通过（与178项存在重叠，不相加）。lint仍0错误/1原警告，证据mos-fix-final-tests.log、mos-fix-final-runtime-tests.log、mos-topic-protocol.log、mos-fix-compatibility.log。补题继续在同一隔离草稿进行，正式旧MOS题组及作答记录未修改。
- 协议重试修复提交707f30bc已推送。相同隔离草稿真实原生续补1题成功，共30题、30份逐题主题/证据pass；累计86调用/1337868tokens，OCR SHA不变、pageerror=0。验收题保留在隔离草稿，未覆盖正式题库；不保证模型所有答案正确，不自动给普通文字题附图。证据mos-quality-1791639029755/summary.json和脱敏mos-quality-validation.json。
- `.3`已安装到正常Desktop web profile，整包和检索均为3.3.0-scanned.3，原快捷方式正常启动。升级前私有备份desktop-before-mos-fix-1791639312818逐项核验2495个教材库文件/40个旧库文件；升级后两库整个Store状态SHA、脚本和快捷方式SHA完全一致。原生StudyHub接口及宿主网页界面实际通过，四个关键源码SHA匹配当前源码，pageerror=0；证据mos-desktop-upgrade/after.json。
- 安装实测修复记录：普通CLI曾覆盖Desktop的generation投影，导致恢复模式；改用宿主自带upgradePluginToGeneration流程的版本安装器、登记锁及事务投影后正常web启动。额外的迁移peer静态扫描因宿主React闭包未通过，保留失败记录而非写通过；官方升级路径不要求此迁移扫描，实际运行另行验证。宿主agent-preset缺失警告在2026-09-30起已有，未扩展修复；恢复模式将一条不可用router-standard预设迁移为standard，正常预设列表仍无该旧ID，未伪造恢复。StudyHub数据保持原样。
- 本轮lint/build/release:check通过（lint 1原警告）；未重跑8101项完整套件，历史9失败仍如原报告记录。`.2`交付目录和发行保持不变；新`.3`使用说明明确需重新生成旧偏题题组，图像题使用原图入口，报告记录软预算会超出及选材300字符开头的局限。正在完成新交付校验与推送。
- 验收及正常Desktop安装证据提交19409a59已推送。`.3`正式发行发布：https://github.com/xiling951/temp-studyhub/releases/tag/v3.3.0-scanned.3 ，19个资产uploaded，GitHub服务端SHA256/字节数与本地全部一致，非draft。整合ZIP17文件、34776419字节、SHA256 8eda656dbe7a651cca2fa6c8bb3405bf282c594cd9625e19b93c69990c0da138，CRC和逐文件哈希实际核验；mos-release-assets.json、mos-delivery-package.json、mos-delivery-release-check.log。原PDF198094368字节及原SHA保持一致。开发、真实验收、安装和新交付均完成；普通批量自动附图及硬预算未实施，不冒称完成。


## 后续：Dennard论文图文导入失败诊断与恢复
- 2026-10-10 22:43/22:46两次失败的真实任务类型为scanned-textbook-import，调用为mineru-visual、boundary=local-process、modelRequest=false；并未调用DeepSeek。错误fetch failed；本机127.0.0.1:16580连接实测ECONNREFUSED，MinerU服务停止。界面把本地任务误称模型调用，并显示不适用的补题提示，该文案问题尚未改动。
- 通过现有DSH mineru.local.start启动服务：MinerU4.0.11、standard、managed、ready，原生健康接口HTTP200。通过原生job.control retry继续同一任务，11/11页complete，26个资源（含原PDF）、13个chart、4个image、2个table、6个equation；全部资源SHA核验通过，旧文字sources逐条SHA不变。未直接调用外部模型API，未改模型/密钥/正式包。
- 浏览器实际打开新图文版本第8页，3幅图像按需加载成功（657×911、647×405、652×525），pageErrors=0。第一遍探针选取未挂载的懒加载img等待超时，第二遍按原界面figure滚动后通过；不将探针超时记成应用错误。脱敏证据implementation/evidence/dennard-parser-recovery.json；论文截图仅私有本地保留，不提交公开仓库。


## 后续：云端 PDF 解析与电子书资源包计划（2026-10-11）
- 本轮交付计划，不实施新的云解析功能：implementation/STUDYHUB-CLOUD-PDF-IMPLEMENTATION-PLAN.md，覆盖 C01–C12 原生 DSH 模型/附件/任务、轻量分页、JSON→HTML/MD、原页对照、普通批量全阶段传图、兼容与回退。C01–C12 尚未完成，GPT-6 Luna 本机路由及真实识别用量未验证。
- 只读原生 Desktop snapshot 成功，当前3.3.0-scanned.3、DeepSeek V4.1 Flash，四个相关安装文件 SHA 匹配源码，pageerror=0；模型预设列表探针失败不推断 Luna 不存在。本轮付费模型调用0。evidence/cloud-pdf-plan-native.json。
- 原教材重新核验572页/198094368字节/原SHA不变，原生文字1079字符；当前版本595111块文字字符/1321资产。原页149、201、292已目视查看电路、公式/续表和空白页。只提交计数、哈希与抽查结论，不提交扫描图片/全文；evidence/cloud-pdf-plan-book.json、cloud-pdf-plan-structure.json。
- 官方 GPT-6 Luna 文档核对支持图像与当前价格；专用图像换算系数未明确，估算普通方案300万–800万tokens、充分精修600万–1500万，假设中间场景5818080tokens/约$1.17，不冒称真实账单。计划要求分层20–30页实测后外推。
- 文档验证：12项任务编号、引用源码路径、JSON证据、预算算术和根目录/仓库副本哈希核验；仅修改计划、现有进度和脱敏证据，未改程序/正式库/桌面配置。文档修改未重跑程序测试；历史9项完整套件失败仍按旧报告保留。
