# 已实现契约与边界

- 基线固定 v3.3.0；全库版本保持 4。
- 已实现：settings.scannedTextbooks===true 为图文导入开关，缺失/false 默认关闭；旧导入入口未改。
- 已实现：materials.visual.status/upload.start/upload.append/upload.finish/upload.cancel/page/asset/chunk，严格 DTO 不接受路径。
- 已注册：materials.visual.import，执行器将在 T05 接通；当前不可执行时明确返回 executor-unavailable。
- 已实现：documents.versions[].visual 为可选 schema=1 描述符，manifestHash 指向不可变 JSON；无新增集合。sources 和 documents 仍由 materials 注册/事务拥有。
- 已实现：库内 attachments/textbooks/objects/<sha256>，由服务端生成；assetId=asset-<hash> 为资源标识。共享对象去重但页/块归属由每个版本清单单独保存。
- 已实现：先落盘/校验资产及清单，再写 Store 文档事务。保守保留历史资源，暂不提供自动 GC。
- 已实现：原文件存储上限 800 MiB，读取块 256 KiB；旧 40 MiB API 不改。Manifest 32 MiB、解析窗口 10 页、模型输入最多 4 张/8 MiB（仍取宿主更小限制）。
- 已确认：本机 MinerU 4.0.11 公共 Parse Server 的 middle_json/structured_content/zip 结果；不读内部缓存作为协议。
- 已确认：ctx.attachments.saveImage/readImage 在隔离宿主实际成功；真实 deepseek-official/deepseek-flash 目录支持 text/image，模型往返留待 T08。
- 不使用新增未鉴权 HTTP 服务；资源沿现有认证消息桥读取。
- 只启用 materials 时不依赖 audio/generation/retrieval；没有模型仍可查询保存后的图文。
