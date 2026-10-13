# 交接摘要：StudyHub 学习 + 数集教材 PDF 完整提取

> 给下一个会话用。环境状态、结论、脚本、待办都在这里；细节见 `STUDYHUB-DEPLOY.md`。

## 一、我的需求

1. 用 **StudyHub** 学《数字集成电路 电路、系统与设计 第 2 版》（**572 页扫描版**，188.9 MB，无文字层）并**出题复习**。
2. 判断它能不能处理**图很多的大教材**；能不能**完整提取 PDF 里的信息**（文字/公式/表格/**图**/原页）。
3. 顺带把被吃满的 **C 盘 / 内存**隐患处理掉。

## 二、评估结论：两套方案是**上下游**，不是二选一

**关键事实**：两者**文字同源**——都是 MinerU 的解析结果（我给的就是 StudyHub 驱动 MinerU 产生的缓存）。
所以 **OCR 文字质量完全相同**；差异只在「**保留什么**」和「**给谁用**」。
而且 StudyHub 的损失发生在**"导入"这一步，不是"解析"这一步**——图它拿得到，是导入时**主动丢掉**的。

| 维度 | StudyHub 内置 | 我的流水线（MinerU 缓存 + bbox 裁图） | 谁更好 |
|---|---|---|---|
| OCR 文字 | 同源 | 同源 | 平 |
| 公式 LaTeX | 保留 | 保留，**连 `\tag{3.4}` 编号**都在 | 我略胜 |
| 表格 | HTML 文本 | HTML **＋ 300 dpi 表格图** | 我 |
| 图 / 图表 | **只留"图片说明"文字** | **全部裁出**（实测 20 页 → 30 区域） | **我** |
| 页眉/页脚/页码 | **丢弃** | 全保留 | 存档我赢；**喂模型出题 StudyHub 去噪反而更优** |
| 原 PDF | 转换书**不留** | 可无损导出 571 张原页 JPEG | 我 |
| 出题/SM-2/错题/掌握度/覆盖/引用回页 | ✅ **独家** | ❌ 完全没有 | **StudyHub** |
| 可再加工 | 弱（困在应用内） | ✅ 纯 md + png + manifest | 我 |
| 工程成本/可维护 | 点几下，有进度/重试/校验 | 需脚本、依赖**未文档化**的缓存路径 | **StudyHub** |
| 前提 | 无 | **必须先有 MinerU 缓存**（否则仍要跑 MinerU，耗时同它） | **StudyHub** |
| 图的可出题性 | — | 位图裁切、**无语义**（要出题得再加 VLM 说明） | 平（都缺语义） |

**决策规则**
- 目的是**学**（出题→复习→错题→掌握度→引用回页）→ **用 StudyHub**。
- 目的是**把书的信息完整拿到手**（所有图、公式编号、页眉页码、原页、可再加工）→ **用我的流水线**；StudyHub 是**结构性做不到**。
- **最佳组合**：我提取 → 文字（去噪后）喂 StudyHub 出题复习 → 图/原页留在本地看与存档。这正好补上 StudyHub 唯一的硬缺口（图）。

## 三、当前环境状态（新会话可直接复用）

- **DSH Desktop 0.11.1 / harness 0.2.0-rc.2**（机器上**只剩这一份**；旧 0.10.0 已删）。快捷方式指向
  `D:\studyhub\start-dsh-desktop.cmd`（它会先把 `TEMP` 指到 harness 下可写目录再启动）。
- **StudyHub 3.3.0 + 检索扩展**已装进桌面端 profile（`%APPDATA%\dsh-desktop\harness\profiles\web`），左栏可用。
- **MinerU 4.0.11**（`C:\Users\Lenovo\.local\bin`，uv 装的）+ 模型 2 GB（`~\.mineru\models`）；
  **Marker 2.0.0** 已成功装好（`harness\studyhub\marker\venv`，1.2 GB）。
- **MinerU 服务由 StudyHub 托管运行**（TCP 15980）。
- 教材**已解析并缓存**：`~\.mineru\doclib\parsed\1bee28d3…\standard\`（**32 段，覆盖 1–572 页**，
  每块带 `type/bbox/content`：`text/paragraph_title/equation/image/chart/table/…`）。
- **检索索引已清空**（`hasIndex=false`；`lancedb` 已删，`models` 86.9 MB 保留）。需要时在
  「设置 › 检索扩展 › 为这门课建立检索索引」重建（**学习者动作**，助手 API 不放行）。
- 磁盘/内存：C 盘 ≈32 GB 空闲；**页面文件仍 34.7 GB（未处理，需管理员）**；提交量约 40/50 GB。
- 教材资料在 StudyHub 里**已归档**（可恢复，题目/引用不受影响）。

## 四、我的流水线（脚本 + 已产出）

脚本在 `D:\studyhub\deploy\`：
- `pdf-survey.py` — PDF 体检（文字层/位图/矢量/字体）
- `crop-figures.py` — 按缓存里的归一化 bbox，**从扫描页 300 dpi 裁出图/图表/表格**
- `make-gallery.py` — 生成"图 + 全文"总览页 `index.html`

已产出试用（p75–94）：`D:\studyhub\extract\pilot\`（`index.html`、`p075-094.md`、`figures\` 30 张、`_manifest.json`）
实测：文字 20 页 **3.5 秒**（命中缓存）；图 30 区域 / 4.4 MB；**全书推算 ≈870 区域 / ≈130 MB / ≈10 分钟**。

**已知坑**
- `mineru parse -o` 是**文件路径**，不是目录（给目录会报 `Permission denied`）。
- MinerU 的 `-o` 导出走**托管服务**，写到新目录可能受限；导出到 `~\.mineru\...` 下再复制最稳。
- StudyHub 导入**不认** `<!-- page N of TOTAL -->`，要 `<!-- page: N -->`。
- 助手不能代做：`marker.install.*`、`marker.settings.*`、`mineru` 安装、检索索引建立——都是**学习者在设置页**的动作。

## 五、待办（新会话可直接开始）

1. **跑完整本 572 页提取** → `D:\studyhub\extract\数字集成电路\`（全文 md + ≈870 图/表 + 总览页）。
2. （可选）把结果转成 StudyHub 能导入的 `<!-- page: N -->` markdown，作为"更完整的转换书"重新导入。
3. （可选）用 VLM 给每张图写说明，并入文字导入 —— 这是目前唯一能让**图也能出题**的办法。
4. **管理员 PowerShell** 跑 `D:\studyhub\set-pagefile.ps1 -Mode MoveToD -MaxGb 24`（关休眠 + 页面文件搬到 D 盘，
   回收 C 盘约 34.7 GB；脚本自带提交量安全闸门）；顺带删 `C:\ProgramData\Lenovo\LeAppStore\AEmuCache`（557 MB）。
5. 大书日常走「**按章选择**」或「**分步出题**」（一步 ≈20 页、≤15 题），别整本建索引。

## 六、关键路径速查

| 用途 | 路径 |
|---|---|
| 教材原始 PDF | `C:\Users\Lenovo\Desktop\杂物\大三上\数集\数字集成电路 …第2版….pdf`（Downloads 也有一份） |
| MinerU 解析缓存（全书） | `%USERPROFILE%\.mineru\doclib\parsed\1bee28d3…\standard\*.json` |
| MinerU 模型 / 服务数据 | `%USERPROFILE%\.mineru\models`、`.mineru\doclib` |
| StudyHub harness（profile/密钥/学习库索引） | `%APPDATA%\dsh-desktop\harness`（profile：`profiles\web`） |
| 部署文档与脚本 | `D:\studyhub\STUDYHUB-DEPLOY.md`、`set-pagefile.ps1`、`start-dsh-desktop.cmd` |
| 提取脚本与产出 | `D:\studyhub\deploy\*.py`、`D:\studyhub\extract\pilot\` |
| 学习库位置（桌面端） | `D:\studyhub\.dsh-study`（可在 StudyHub 设置里改） |
