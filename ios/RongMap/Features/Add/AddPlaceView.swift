import SwiftUI
import CoreLocation

/// 新增地点：地址必填（服务端要求），名称留空时取地址；
/// 坐标可选，可一键取当前位置（自动 WGS-84 → GCJ-02）。
struct AddPlaceView: View {
    @Environment(SessionStore.self) private var session
    @Environment(PlacesStore.self) private var store
    @Environment(LocationProvider.self) private var location
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var address = ""
    @State private var category: PlaceCategory = .food
    @State private var reason = ""
    @State private var latitudeText = ""
    @State private var longitudeText = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var awaitingFix = false

    private var locating: Bool { awaitingFix && location.status == .requesting }
    private var canSave: Bool {
        !address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    TextField("名称（留空取地址）", text: $name)
                    TextField("地址（必填）", text: $address)
                    Picker("分类", selection: $category) {
                        ForEach(PlaceCategory.allCases) { item in
                            Label(item.label, systemImage: item.icon).tag(item)
                        }
                    }
                }
                Section("推荐理由") {
                    TextField("为什么值得去（可空）", text: $reason, axis: .vertical)
                        .lineLimit(2...6)
                }
                Section {
                    TextField("纬度（可空）", text: $latitudeText)
                        .keyboardType(.decimalPad)
                    TextField("经度（可空）", text: $longitudeText)
                        .keyboardType(.decimalPad)
                    Button {
                        useCurrentLocation()
                    } label: {
                        HStack {
                            if locating {
                                ProgressView()
                            } else {
                                Image(systemName: "location.circle")
                            }
                            Text("使用当前位置")
                        }
                    }
                    .disabled(locating)
                } header: {
                    Text("坐标（可空）")
                } footer: {
                    Text("留空时仅出现在列表中，不上地图。坐标为高德 GCJ-02，「使用当前位置」会自动换算。")
                }

                if let errorMessage {
                    Section {
                        ErrorBanner(text: errorMessage)
                            .listRowBackground(Color.clear)
                    }
                }
            }
            .navigationTitle("新增地点")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving { ProgressView() } else { Text("保存").fontWeight(.semibold) }
                    }
                    .disabled(!canSave)
                }
            }
            .onChange(of: location.fix) { _, fix in
                guard awaitingFix, let fix else { return }
                apply(fix)
            }
            .onChange(of: location.status) { _, status in
                guard awaitingFix else { return }
                switch status {
                case .ready:
                    if let fix = location.fix { apply(fix) }
                case .denied:
                    awaitingFix = false
                    Haptics.warning()
                    errorMessage = "定位权限被关闭，请在「设置 → 隐私与安全性 → 定位服务」里允许 RongMap，或手动填写坐标。"
                case .failed(let message):
                    awaitingFix = false
                    Haptics.warning()
                    errorMessage = "\(message)，可手动填写坐标"
                default:
                    break
                }
            }
        }
    }

    /// 系统定位是 WGS-84，服务端与网页按高德 GCJ-02 存储，写入前必须换算。
    private func apply(_ fix: LocationProvider.Fix) {
        awaitingFix = false
        let gcj = CoordinateTransform.wgs2gcj(lat: fix.latitude, lng: fix.longitude)
        latitudeText = String(format: "%.6f", gcj.lat)
        longitudeText = String(format: "%.6f", gcj.lng)
        Haptics.success()
    }

    private func useCurrentLocation() {
        errorMessage = nil
        if location.isDenied {
            Haptics.warning()
            errorMessage = "定位权限被关闭，请在「设置 → 隐私与安全性 → 定位服务」里允许 RongMap，或手动填写坐标。"
            return
        }
        if let fix = location.cachedFix {
            apply(fix)
            return
        }
        awaitingFix = true
        location.request()
    }

    private func save() async {
        let trimmedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedAddress.isEmpty else {
            errorMessage = "地址不能为空"
            return
        }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        errorMessage = nil
        var payload: [String: Any] = [
            "name": trimmedName.isEmpty ? String(trimmedAddress.prefix(120)) : trimmedName,
            "address": trimmedAddress,
            "category": category.rawValue,
            "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
            "sourceType": "manual",
            "sourcePlatform": "ios"
        ]
        let lat = latitudeText.trimmingCharacters(in: .whitespaces)
        let lng = longitudeText.trimmingCharacters(in: .whitespaces)
        if !lat.isEmpty && !lng.isEmpty {
            guard let latValue = Double(lat), let lngValue = Double(lng) else {
                errorMessage = "坐标格式不对，应为数字"
                return
            }
            payload["latitude"] = latValue
            payload["longitude"] = lngValue
        }
        isSaving = true
        defer { isSaving = false }
        if await store.create(session: session, payload: payload) != nil {
            Haptics.success()
            dismiss()
        } else {
            Haptics.warning()
            errorMessage = store.errorMessage ?? "保存失败"
        }
    }
}
