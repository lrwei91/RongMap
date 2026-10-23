# Web 交互调整与 iOS 主屏图标排查

核验日期：2026-10-23（Asia/Shanghai）。仅修改 Web 界面、安装资源与相关测试；工作区既有 iOS、小程序和包配置改动未改动、未提交。

## 页面与交互

- 手机地点页移除整组导入、JSON / CSV 导出操作，保留底栏添加地点及已有的地点管理；桌面导入导出保留。
- 攻略默认进入已保存列表，新建单独进入三步流程：旅行需求、候选地点、预览与保存。已保存攻略打开后直接阅读，不显示创建步骤条。
- 基本安排先展示，偏好、住宿、参考来源按需展开。候选支持搜索、分类、数量反馈、清空选择及空态恢复，来源详情折叠展示。返回步骤保留输入；修改需求或候选会使旧预览失效，避免保存不匹配的安排。
- 保留 AI 规划、参考摘录、失败重试、保存、路线核验、分享和网页导出。离开未保存草稿和冲突后载入最新版本都有确认，异步加载与保存结果避免污染已切换的攻略。
- 发现小馆沿用地点列表的搜索、筛选、分类标识与卡片结构，共用地点详情抽屉。点击卡片或地图标记打开详情，聚焦、导航、分享与已收藏一致，未收藏地点提供收藏操作。手机用地图／列表切换保留完整地图与结果空间，搜索成功后进入列表，聚焦后回到地图。
- 搜索失败保留上次餐馆结果并明确提示；部分结果、查询时间、地图范围变化、价格未知仍可见，收藏请求防止重复提交。
- 修复地点菜单外部点击和 Escape 关闭，搜索建议失焦关闭；攻略及其他非地点页面不再出现无关的顶栏导入按钮与地点计数。未填预算不显示空的人民币金额，规划警告使用警告样式。

## iOS Chrome 图标：事实与边界

用户确认从 **iOS Chrome** 添加到主屏幕；名称保持原样。

线上只读核验目标为 `https://map.lrwei91.cn`。Vercel 生产版本处于 READY，Git SHA 为 `ea60a65ec9caa47d65e456162f793a5ffeedb2d7`。源码与线上均保留了此前 `229c305` 加入的安装元数据，并没有被后续提交移除。

| 资源 | 本轮修改前的线上响应 |
| --- | --- |
| `/app/map`、`/auth/login` | 200 HTML，包含 `apple-mobile-web-app-title=RongMap` 和 Apple PNG 图标声明 |
| `/manifest.webmanifest` | 200，正确的 manifest MIME；启动路径 `/app/map`、standalone 模式及安装图标声明正常 |
| `/apple-touch-icon.png` | 200 `image/png`，文件内容与仓库 PNG 一致 |
| `/favicon.ico` | 404 |
| `/apple-touch-icon-precomposed.png` | 404 |

原先普通 favicon 只有 SVG，Apple PNG 与 Manifest 图标使用固定 URL。当前 HTTP 缓存策略为 `public, max-age=0, must-revalidate`，未发现项目注册 Service Worker 的代码。因此不能把本次现象断言为服务器仍提供旧版本，也不能直接认定为某个 Service Worker 缓存问题。

本轮的兼容修正：

- 补充 32px PNG、ICO 和 192px PNG favicon 声明。
- Apple 显式入口改为 `/icons/apple-touch-icon-180.png`，保留根目录 PNG，并补充旧式 precomposed 回退文件。
- HTML 与 Manifest 的相关资源 URL 使用文件内容 SHA-256 前 12 位作版本，资源变更后自动更新引用。
- 所有新图标由现有 `public/icons/app-source.svg` 和 `node scripts/generate-icons.js` 生成，未引入图像依赖。品牌名称与应用标识保持不变。

这些是对已证实缺口的兼容修正，**尚未在真实 iPhone Chrome 上复现和确认最终安装图标**，不能声称已查明唯一根因。发布后应在 Chrome 打开正式地址，确认新版图标可访问，再重新添加主屏入口；同时观察系统添加面板中的预览图标。若仍异常，需记录 iOS / Chrome 版本、访问地址以及面板预览与最终图标的差异。

参考：[Apple 的图标和安装名称声明](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)、[WebKit 对第三方浏览器添加主屏幕的说明](https://webkit.org/blog/13878/)。第三方浏览器有自己的系统分享流程，不能仅靠桌面浏览器读取 PNG 成功就当作安装验收。

## 验证

- `npm test`：93 项通过。
- `npm run check`：43 个脚本／服务器文件检查、3 个 Vercel Function 检查及生产构建通过；`git diff --check` 通过。
- `RONGMAP_LIVE_DISCOVERY=1 RONGMAP_LIVE_GEOLOCATION=1 npm run test:e2e -- --workers=4`：61 项全部通过，无跳过。
- 包含 390 / 1440px 的真实高德餐馆查询、地图渲染、详情回到地图、选中标记，以及真实 SDK 对模拟 GPS 的转换和定位。业务空间使用测试数据，没有向真实共享空间写入地点或行程。
- 界面回归覆盖 320 / 390 / 768 / 1024 / 1440px、手机横屏、放大文字、浅色固定主题在系统深色偏好下的布局、减弱动效、详情焦点与嵌套弹层、手机导入导出移除、桌面功能保留，以及攻略创建／失败／冲突／保存／导出。检查了实际浏览器截图与横向溢出。
- 静态资源回归覆盖根路径、地图、地点、攻略、登录和分享入口，无需会话即可获取相同安装元数据；验证 PNG 尺寸、ICO 内容、引用内容哈希和名称未变。
- 定位用例原有 30ms 回调存在竞争：改为由测试显式释放回调后检查结果，保留加载中禁用的断言，没有因此改变产品定位逻辑。

未完成：真实 iPhone Chrome / Safari 安装、系统手势与软键盘、真实 AI 和外部内容来源端到端生成、新代码线上部署。构建、模拟界面与真实地图只读检查不能替代这些验收。此次未 commit、push 或 deploy。
