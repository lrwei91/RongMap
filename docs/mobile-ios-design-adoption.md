# 移动端与 iOS 图标规范采用记录

核验日期：2026-10-08（Asia/Shanghai）。规范依据为相邻 `project-standards` 仓库当前 `d0313b8` 版本的 `design/responsive-design.md`、`design/ux-interaction.md`、`design/accessibility.md` 和 `design/assets-and-naming.md`；适用范围为 RongMap 的移动端布局、详情与表单弹层、主屏安装资源。

## 当前实现

- 保持现有浅色地图工作台与四个底栏页面入口，添加动作独立显示；当前页面增加底边标记，移动端地点页移除重复添加按钮，保留底栏添加入口。
- 手机控件命中区域至少 44 × 44 CSS px，保留小尺寸复选框图形并扩大关联标签；筛选区按内容空间换行。输入字号不低于 16px，并随根字号放大；底栏占位随字号增长，长地点名称和地址可以换行。
- 固定导航与弹层避让安全区。表单和详情弹层通过 Visual Viewport 的高度与偏移适配键盘造成的可视区域变化，标题、关闭及底部操作不参与内容滚动。抽屉与确认框支持叠加，背景使用 `inert` 隔离，关闭后恢复焦点与滚动锁定状态。
- 手机页面使用 `touch-action: pan-x pan-y` 声明页面平移边界；只有 `.map-canvas` 使用 `touch-action: none` 交由高德 SDK 处理局部拖动与双指缩放。没有设置 `user-scalable=no`、缩放上限或全局触摸拦截，没有新增滑动返回手势。
- 地点列表、发现结果及弹层内容提供可聚焦的滚动区域。固定浅色及减弱动效规则延续现有实现，高对比模式保留焦点与底栏选中边界。
- 交互边框 `--line-strong` 调整为 `#82827c`，与白色表面对比度为 3.87:1，与浅黄色表面为 3.57:1；焦点蓝与白色表面为 5.09:1。

## 图标与安装元数据

浏览器标签页仍使用原来的 `/favicon.svg`。主屏安装图标使用独立的不透明满幅 PNG，背景为项目现有浅黄色，地图定位标识沿用原图形；不预烘焙外部圆角、阴影或边框。

- `/apple-touch-icon.png`：180 × 180。
- `/icons/app-192.png`、`/icons/app-512.png`：普通安装图标。
- `/icons/app-maskable-512.png`：单独的可遮罩变体，标识缩入中央安全区域。
- `/manifest.webmanifest`：独立安装名称 `RongMap`，从 `/app/map` 启动，使用 `standalone` 显示模式。

所有声明放在静态首屏 `index.html` 中，资源均使用根相对路径并由 Vite / Vercel 静态文件链路提供；未扩大业务 API 的公开范围。图标 SVG 真源为 `public/icons/app-source.svg`，运行 `node scripts/generate-icons.js` 可重新生成 PNG，复用现有 Playwright Chromium，不增加依赖。

平台机制参考：[Apple 的 Web 应用配置文档](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)、[MDN 的 Manifest 图标说明](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)、[MDN 的 touch-action 说明](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)。

## 验证与边界

已执行生产构建、服务器与脚本语法检查、86 项单元测试和本地 Chromium 浏览器回归。浏览器回归使用测试空间与模拟业务 API，覆盖 320 / 390 / 768 / 1024 / 1440px、手机横屏、放大文字、详情焦点循环、嵌套确认框关闭、图标免会话响应及 PNG 尺寸。图标文件额外核对所有像素 alpha 为 255。

旅行攻略改动完成并更新相应回归用例后，提交前重新执行全量界面回归，43 项通过、2 项真实高德检查跳过，覆盖移动端适配、发现小馆、旅行攻略及登录与注册交互。当前工作区生产构建通过，仍有主包超过 500 kB 的体积警告。

本地手机模拟检查了 200% 根字号无页面横向溢出，以及 360px 可视高度下表单操作仍在视口内；这是布局模拟，不能替代 iOS 真实软键盘。未安装 WebKit 测试二进制；未执行真实 iPhone 主屏安装、系统字体与读屏验收、真实高德双指手势或线上部署验证。浏览器或系统的辅助缩放覆盖不能由 CSS 保证禁用。

上线后的真机验收应确认部署加载了新资源，未登录获取 PNG / Manifest 的状态码与内容类型正确，再移除旧主屏图标重新添加，分别验证缓存、安装名称、图标裁切、横屏安全区、软键盘、页面与地图缩放边界。安装声明不提供离线使用能力，仓库推送不代表已完成部署或真机验收。
