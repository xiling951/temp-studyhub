# StudyHub 扫描教材图文最终测试报告

2026-10-10，定制版 `3.3.0-scanned.2`。T01–T11的阶段证据及提交见 `../progress.md`；T12的最终恢复和交付检查以对应JSON/日志为准。本报告区分真实宿主/模型验收、合成测试和原版已存在的失败。

## 环境及安装范围

独立源码：`D:/studyhub/implementation/source`，基于真实v3.3.0提交 `daa4df7b3045df14290e10a43d72e0e751e0f72d`。最终生产代码提交 `b8010dca`，其后提交为验收脚本、证据和交付文档。Windows、Node24.13、Python3.11/PyMuPDF1.28.2；DSH0.2.0-rc.2、Desktop0.11.1、公共MinerU4.0.11接口。

开发使用隔离profile与测试库。用户后续明确授权本机Desktop安装/运行后，先备份，再通过原生插件管理/CLI安装；未直接改已安装源码。当前实际运行定制整包和检索扩展，原快捷方式和启动脚本已恢复原SHA。模型通过原生凭据和Jobs/gateway；没有绕过宿主直接调用模型完成接口。

## 全书实际结果

- 原书572页、198094368字节，SHA256：`1bee28d307564671e604d8a85860aecc53099221044046e16ad264b21fb8c358`。解析前后原件哈希与修改时间相同。
- 首次实际原生导入耗时2329814ms，约38分50秒。之后的6.4秒导入为逐项验证后的缓存复用，不代表冷解析速度。
- 每10秒采样235次：宿主进程树最大工作集382509056字节（约365MiB），解析进程树2330980352字节（约2.17GiB）。这是采样观测，不是绝对瞬时峰值或GPU显存。一个后验阶段库文件逻辑字节总量305021391，不能当物理占用磁盘数。
- 当前版本572页、1321项引用资产逐一SHA核验，包含原PDF；1321不是独立插图数量。571页有真实OCR source，PDF292空白/未识别不伪造source。两历史版本共1142条source；图注归属修复不改原OCR。
- 实际发现PDF149的图5.2图注被原解析器挂在图5.1上。适配器仅在图号明确不同且另一图更近时纠正关联，保留原始块归属与旧清单。新版本 `visual1-eadf9e35e97d57c70945ae7257c70f6568ddb45b36924f3365997cec481d85b6`。
- 全书/样例实际检查混排、公式、表格、多个子图、书末页、空白页及PDF149/印刷131反相器。原书没有识别出明确的旋转/纯图片测试页，这两类通过明确合成fixture验证，不能冒称真实原书包含此样本。

证据：`t12-fullbook/verified-after-store-fix.json`、`t12-fullbook/summary.json`、`t12-restore/summary.json`及本机截图。

## 原生图像调用、解释和检索

T08真实direct/subagent均读对控制图内的随机代码和形状数；用量670/1722tokens有原生记录。真实取消释放已接纳子代理，取消调用未返回用量，不推断零计费。offload/429/超时等错误分支由明确模拟测试覆盖，未冒称触发真实官方错误。

T09真实电路/表格/曲面图解释调用3992/4499/4475tokens，解释单独保存并标为待核对，不写入OCR。无视觉模型环境真实导入/阅读保留，解释显示unavailable。暂停/重启恢复能力按原生接口明确unsupported/none，不伪造支持。

T11真实原生MCP索引8页、检索命中映射回真实图片哈希；只更新一页已明确选择的核对图解后，仅重索引1页，另7页及源OCR不变。未安装检索扩展时阅读/导入/图解/带图题通过；检索明确降级。搜索进程只继承既有代理路由变量，不携带模型密钥。

证据：`t08-real-vision.json`、`t08-native-gateway.json`、`t08-native-cancel.json`、`t09-native/summary.json`、`t09-no-model/summary.json`、`t11-native-result.json`。

## 本机Desktop反相器题组

当前独立库 `D:/studyhub/libraries/数字集成电路-图文`，课程「数字集成电路」，题组「第5章 CMOS反相器 · 器件作用与去除」，4道开放题。图5.1来自PDF149/印刷131，块p149-b8，图片SHA `9dfb5424ca0255cbb0840cf42b922eeb77019a6488041c3983bbbeb27549b6a1`。

内容涵盖上方器件开路去除、下方器件开路去除、互补工作与功耗、电容负载与分析目标。初始模型草稿缺评分标准并含无效文字ID，被真实校验拒绝。实施代理直接对照原图修订条件/答案/评分标准，4次真实独立图片审阅通过；之后把泄露作用的标题改成中性标题，再执行4次新审阅并发布。未手写审核通过标记，没有替用户作答、评分或推进SM-2。

上述实际Desktop过程共11次模型调用、80828tokens，全部accounting=recorded，实际使用DeepSeek-V41-Flash、最低可用推理off。最终4题有新审阅收据；用户本人尚未逐题核对。通过审阅不是对所有模型输出正确性的保证。

原快捷方式正常重启、原生文件凭据ready=true；最终Windows UI Automation及实际窗口截图核对中性标题、答题前原图和PDF149原页。初次学习preset缺原生Job控制器导致接纳被拒，已仅加入原生job_list/output/kill组件及quiet通知，未放宽原生live-Agent边界。

证据：`t12-desktop-result.json`、`t12-study-native-result.json`、`t12-desktop/neutral-front-desktop.png`、`t12-desktop/neutral-original-desktop.png`。截图和教材内容只留本机。

## 备份、兼容与回退

单教材ZIP实际离线HTML阅读：外部请求0，公式/表格/图片可见。完整ZIP通过实际DSH设置页恢复到另一隔离profile/新库，572页、两版本、1142sources、1321当前资产SHA及原图/原页通过。最终含4题ZIP亦实际恢复通过：四题中性标题、图像证据及独立审阅收据保留，全部当前资产SHA及PDF149原页验证，console/pageerror=0，付费调用0。结果见 `t12-final-backup-restore/summary.json` 和 `t12-final-backup-restore-result.json`。

最终恢复脚本修正了发行包路径、版本变量遮蔽，以及空题库首页布局假设；此前数据已恢复成功但旧首页locator超时，再启动同一隔离宿主读回与界面核验通过。没有把失败的旧脚本记录覆盖成成功。

原正式旧库40文件SHA与安装前完整备份一致。独立组件实际禁用图文入口、卸载材料并重启后相关能力消失，其它模块和3个旧题组保留，重新安装后能力恢复；完整旧库状态SHA前后相同。generation/study使用原配置约定independent:true，默认依赖保留不是失败。

隔离环境实际安装原版3.3.0后1142条OCR仍读到且选定原文SHA一致，再升级定制版恢复图片访问。正式Desktop未降级，正式数据未执行覆盖恢复。旧JSON资料/引用/SM-2、五种带图题型、闪卡/考试/口试/错题界面、损坏ZIP/缺资源/跨库访问拒绝等由相关自动化及浏览器fixture验证；明确fixture不冒充用户真实学习记录。

证据：`t12-original-state-preserved.json`、`t12-modular-result.json`、`t12-native-rollback.json`、`t12-legacy-book-read.json`、T07/T10相关测试和浏览器证据。

## 完整回归结果及残余限制

最终完整verify：8101项，8079通过、9失败、13跳过，实际退出失败；不得写“全量全绿”。其中8项在未修改v3.3.0的Chrome/Windows对照复现：science-settings、follow-label-fit、nav-groups、nav-layout、wave5c-estimate、两项Windows Jev关闭断言及generate-flow停止后的旧locator超时。剩余mineru-history-service旧历史时序失败在当前/原版各20项定向重跑均通过，记为间歇问题。generate-flow失败后两边均遗留测试服务，仅停止已报错的测试子进程。

新增key冲突、模块所有权、原文发布读取时序已修复并通过相关测试；最终study-preset修复后36项及真实无模型学习preset流程通过。完整verify在最终preset修复前执行，此后没有生产代码改动；不冒称新版再跑一次全量。最终lint/build/release:check通过，lint仅有原DocumentViewer initialMode依赖警告。新图文关键路径没有保留未解决的新增失败。

真实Desktop原有宠物组件 `/api/pet/pets`、`/api/pet/state`返回404；未扩大范围修改。因此不声称整个Desktop控制台零错误；隔离图文QA控制台/页面错误为0。

PDF上限800MiB，图片8MiB，图像上下文每次1–4张；ZIP2GiB、展开4GiB、元数据64MiB。OCR/图解需对照原件，自动答案需审阅；没有自动资源GC，优先保留旧资料/版本/题目引用。全书冷解析依赖实际MinerU服务与本机计算资源，不承诺其它机器速度。

## 交付

`../packages/3.3.0-scanned.2`含8个可安装TGZ、两份安装页、包哈希、安装/回退、使用说明、测试报告及交付校验清单。8包的名称、版本、exports、依赖、入口和SHA通过release:check。源码及最小脱敏证据提交到用户指定公开仓库；原教材、扫描图、题组内容、完整库ZIP及密钥不上传公开仓库。

最终整库ZIP：263448464字节，SHA256 `bec330e3ceff786bcd4cefda5b667784b6d7c3d1b412a166fb04d33a4657127c`，仅留本机。临时操作脚本已清理，阶段日志/缓存按隔离目录保留供复核。清理两份失败测试上传副本被自动审批拒绝（仅返回策略阻止），因此保留，未绕过；与原教材或已提交资源无关。
