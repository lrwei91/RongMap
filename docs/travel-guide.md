# 旅行攻略 tab

## 用户流程

原路书四步向导已移除。桌面侧栏、移动底栏提供“攻略”，路径为 `/app/travel`，保存后为 `/app/travel/:id`。旧路书路径自动转到新路径，不删除既有行程数据。

填写国内目的地城市、日期、1–14 天天数、同行人、人均预算、出行方式、住宿和硬约束，然后搜集景点与餐饮候选。用户核对名称、地址和分店后，最多选择 24 个地点生成逐日攻略。生成只返回预览，保存时创建或版本化更新共享行程；发生版本冲突时保留草稿。路线核验、网页导出和分享针对已保存的行程。

攻略包含总览、逐日安排、美食候选、住宿动线、雨天备选、避坑提醒、预约清单与来源说明。每个地点说明地址／坐标来自地图，活动时间与建议未经核验；未知价格不等于免费。路线只连接相邻已定位站，不跨越缺少坐标的站点。

## 存储与运行

复用既有 `trips.roadbook` JSONB，新增 `guide` 子对象；服务端 `normalizeRoadbook` 校验并保留该对象，继续使用 `save_roadbook_trip_plan` 事务 RPC。未新增表、修改认证或增加数据库迁移。旧路书字段和旧分享继续兼容。

`POST /api/v2/travel-guide` 经现有 v2 分发器提供，不新增 Vercel 函数数量，所有动作先验证登录身份：

- `collect`：输入旅行需求、来源链接与摘录。高德地理编码确定城市，再查询景点和餐饮候选。返回短期研究凭证、候选和来源状态。
- `source`：接收研究凭证、固定平台名和 `search`／`detail` 动作；调用可选 MCP，只暴露搜索和读取，不暴露登录、评论、点赞或发布动作。
- `generate`：接收研究凭证及候选 ID。服务端恢复原始查询快照，调用现有 AI Provider，严格校验地点 ID 与逐日结构。用户人数、交通和预算保持原值。

研究凭证使用 AES-256-GCM，密钥按用途从服务端高德 Key 派生，绑定用户和空间，有效期 30 分钟。小红书读取详情需要的临时访问字段只在加密凭证中传递，不作为明文字段返回、不发送给模型、不落入已保存攻略。轮换高德 Key 会使已有凭证失效，需要重新搜集。

路线核验继续使用 `POST /api/v2/roadbook`，按 `car`、`walk`、`transit` 调用各自高德接口。天气仅匹配预报覆盖的出行日期。核验结果留在当前页面，重载后重新查询；导出 HTML 可包含当页核验快照，分享页不将临时查询结果冒充实时数据。

## 可选小红书与点评服务

地址仅通过服务端环境变量配置：

```dotenv
XHS_MCP_URL=http://127.0.0.1:18060/mcp
CN_SCRAPER_URL=http://127.0.0.1:8001/mcp
```

留空时显示未接入，并跳过相关调用。本次按用户要求跳过服务安装和扫码，因此连接器仅以协议 fixtures 验证，未宣称真实采集成功。

小红书调用 `search_feeds` 和 `get_feed_detail`。查询与最多两篇详情逐次执行，不并行读取；每次详情是独立 API 请求，工具请求上限 220 秒。点评调用 `dianping_search` 与最多两次 `dianping_shop`，不依赖上游已不可用的评论接口，工具请求上限 100 秒。平台登录态由各 MCP 服务本机管理，RongMap 不存平台 Cookie。若远程网关需要认证，可设置 `XHS_MCP_TOKEN` / `CN_SCRAPER_TOKEN`，只放服务端。

Vercel 的 localhost 是云端容器，不是用户的 Mac。若要在线上启用，需提供 Vercel 可访问并受认证保护的 MCP 网关；本文中的本地地址仅适合本地 API 运行。用户尚未授权或完成这部分部署。

不同来源搜索可能命中不同分店。搜索标题不等于全文；摘录不等于全评论。界面展示实际查询的范围，模型不得将未配置／失败来源写成已采集，不以同名或单一评分声称三源交叉验证完成。

## 参考与限制

工作流参考 [huahuanao/travel-agent](https://github.com/huahuanao/travel-agent)，本次读取版本 `3ed18b4c57444df843580ae94ad9297e1ebf4959`。借鉴需求澄清、串行游记采集、商户与地图核验、逐日攻略及优雅降级方式；未引入其 pi 宿主、安装脚本或凭据读取机制。原项目采用 MIT License，其小红书服务来自 [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)，点评服务来自 [goesByhc/cn-scraper-mcp](https://github.com/goesByhc/cn-scraper-mcp)。

候选是高德查询快照，不保证覆盖所有景点或餐馆。AI 输出属于建议，不保证约束或时间可行性；实际路线、预约、票价、开放时间、临时管控与天气需在出发前核实。后端使用 DeepSeek 官方 Chat Completions API，默认 `deepseek-flash`，通过 `DEEPSEEK_API_KEY`、`DEEPSEEK_API_BASE_URL` 和 `DEEPSEEK_MODEL` 配置。请求关闭思考模式并启用 JSON 输出，密钥仅保存在服务端私有环境中。参见 [DeepSeek API 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。真实请求若返回 401/403，界面提示服务端鉴权失败，需要维护有效凭据后再生成，不会换用未经配置的 Provider。
