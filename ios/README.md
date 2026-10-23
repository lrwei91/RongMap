# RongMap iOS

RongMap（亲友共享的地点地图）的原生 iOS 客户端。列表、地图、详情、新增与登录由 SwiftUI + MapKit 实现，数据走网页端同一套 `/api/v2` 接口，没有第三方地图 SDK。

实现约定沿用 [Atlas iOS 实践](../../Atlas/docs/ios-app-playbook.md)（与 CineScope iOS 同源）：原生负责「怎么到达、怎么操作」，Web 只负责必须由网页承载的内容。

## 前置条件

- macOS + Xcode（本机为 27.1，iOS 17 及以上）
- 真机或模拟器运行时；本机当前没有安装 Simulator runtime，命令行只做编译与静态分析
- 免费 Personal Team 即可签名（Team ID `RWWGW4S7G6`），7 天有效

本机 `xcode-select` 仍指向 Command Line Tools，命令行构建需显式指定开发者目录：

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

## 打开与运行

```sh
open ios/RongMap.xcodeproj
```

首次打开需要：

1. **选择签名团队**：Targets → RongMap → Signing & Capabilities → Team 选自己的 Apple ID（已预置 `RWWGW4S7G6`）。
2. **改 Bundle Identifier**（可选）：默认 `cn.lrwei91.rongmap.ios`。

然后选中真机，⌘R。首次安装需在手机上打开开发者模式（设置 → 隐私与安全性 → 开发者模式），安装后在 设置 → 通用 → VPN 与设备管理 信任开发者证书。

### 命令行构建

Swift 宏（`@Observable`、`@State`）需要插件进程，在受限环境里会因 `sandbox-exec` 不可用而失败，命令行构建要加：

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -project ios/RongMap.xcodeproj -scheme RongMap \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -configuration Debug CODE_SIGNING_ALLOWED=NO \
  OTHER_SWIFT_FLAGS="-disable-sandbox" build
```

真机包（需要设备已注册）：

```sh
xcodebuild -project ios/RongMap.xcodeproj -scheme RongMap \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -configuration Debug -allowProvisioningUpdates \
  -derivedDataPath /tmp/rongmap-dd \
  OTHER_SWIFT_FLAGS="-disable-sandbox" build
```

产物目录要放在 iCloud / FileProvider 同步范围之外（例如 `/tmp`）。放在 `~/Documents` 下时，`RongMap.app` 会带上 `com.apple.FinderInfo`、`com.apple.fileprovider.fpfs#P` 扩展属性，codesign 直接报 `resource fork, Finder information, or similar detritus not allowed`。

## 架构

```
SwiftUI 外壳                     MapKit 地图
┌──────────────────────┐        ┌───────────────────────┐
│ LoginView   用户名登录 │        │ MapView      图钉/摘要卡 │
│ PlacesView  列表/搜索  │  ───▶  │ DetailView   导航/删除   │
│ AddPlaceView 新增      │        │ （GCJ-02 → WGS-84 换算）│
│ SettingsView 我的      │        └───────────────────────┘
└──────────────────────┘
           │
           ▼
  https://map-sigma-swart.vercel.app/api/v2（与网页端同源）
```

- **认证**：用户名免密登录（`POST /api/v2/session`），令牌存 Keychain，401 自动静默重登（`SessionStore.withAuth`）。
- **坐标系**：服务端存高德 GCJ-02，MapKit 与 Apple 地图导航用 WGS-84，`CoordinateTransform` 双向换算（米级精度）。
- **深链**：`rongmap://place?id=<uuid>`（或 `?name=<名称>`）、`rongmap://tab?name=places|settings|map`、`rongmap://locate`。`--payload-url` 可直达页面，也是 devicectl 无法模拟点击时验证界面的手段。
- **定位**：`LocationProvider` 统一持有 `CLLocationManager`（地图与新增共用），只在用户触发时申请「使用 App 期间」权限；被拒时给出去设置的引导，不静默失败。
- **数据口径**：列表查询（关键词/分类/排序）与 `lib/api-v2/locations.js` 完全对齐；小程序端是 WorkBuddy 云库的另一套数据，与本 App 无关（如需两边同步见 `npm run sync:miniprogram`）。

## 功能

- **地图**：全部带坐标地点上图，分类配色图钉，点选出摘要卡下钻详情；右下角「定位」请求权限并居中到当前位置，下面一枚是回到福州。
- **地点**：搜索（名称/地址/理由）、分类筛选、排序（最近添加/最近更新/按名称）、下拉刷新、新增。
- **详情**：推荐理由、位置预览、元信息，Apple 地图导航，软删除（进回收站，网页端可恢复）。
- **新增**：地址必填（服务端校验），名称留空时取地址；分类/理由可选；坐标可空，一键取当前位置时按 WGS-84 → GCJ-02 换算后写入。
- **我的**：账号信息、刷新数据、退出登录。

## 部署与验证

`devicectl` 三件套（真机连接后）：

```sh
xcrun devicectl device install app --device <UDID> <RongMap.app>
xcrun devicectl device process launch --device <UDID> --terminate-existing cn.lrwei91.rongmap.ios
xcrun devicectl device capture screenshot --device <UDID> --destination /tmp/shot.png
```

验证详情页走 URL Scheme（devicectl 不能模拟点击）：

```sh
xcrun devicectl device process launch --device <UDID> --terminate-existing \
  --payload-url 'rongmap://place?id=<UUID>' cn.lrwei91.rongmap.ios
```

取构建产物按修改时间取最新的，别 `find | head -1`（见 playbook 第 5 节）；本项目已用 `-derivedDataPath` 固定输出目录规避。

## 坑

- **坐标系是双向的**：服务端存 GCJ-02。读出来要 `gcj2wgs` 再上 MapKit；写回去（含「使用当前位置」）必须 `wgs2gcj`，否则网页端与小程序里会偏几百米。
- **`@Bindable` 不能修饰计算属性**，从 `@Environment` 拿的 observable 要在 body / 子视图里局部转 `@Bindable var store = store`。
- **`-disable-sandbox`**：命令行构建不加会因 Swift 宏插件被沙箱拦截而报 `produced malformed response`。
- **标签页要按需入列**：`RootView` 用 `visitedTabs` 懒加载三个页面，切换 tab 时必须写入，否则「地点」「我的」会是空白页。
- **`.searchable` 在 iOS 26 默认不展开**：`NavigationStack` 里要显式给 `.navigationBarDrawer(displayMode: .always)`，否则搜索框不显示。
- **冷启动深链早于数据**：`rongmap://place?name=…` 在列表加载前查不到 ID，待跳转条件要保留到加载完成（`PlacesStore.consumeDeepLink`）。
- 免费签名 7 天过期，到期在 Xcode 里重新 Run 即可，App 数据保留。
