import SwiftUI
import MapKit

/// 地点详情：信息、地图预览、导航与软删除。
struct PlaceDetailView: View {
    let place: Place
    @Environment(SessionStore.self) private var session
    @Environment(PlacesStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var showDeleteConfirm = false
    @State private var showDeleteError = false

    private var live: Place {
        store.place(id: place.id) ?? place
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if !live.reason.isEmpty {
                    reasonCard
                }
                if live.hasCoordinates {
                    mapPreview
                }
                metaCard
                actions
            }
            .padding(16)
        }
        .background(PaperBackground())
        .navigationTitle(live.name)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("删除「\(live.name)」？", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("删除地点", role: .destructive) {
                Task {
                    let ok = await store.softDelete(session: session, id: live.id)
                    if ok {
                        Haptics.success()
                        dismiss()
                    } else {
                        Haptics.warning()
                        showDeleteError = true
                    }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("进入回收站，可在网页端恢复。")
        }
        .alert("删除失败", isPresented: $showDeleteError) {
            Button("知道了", role: .cancel) {}
        } message: {
            Text(store.errorMessage ?? "请检查网络后重试")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                CategoryChip(category: live.categoryValue)
                Spacer()
            }
            Text(live.name)
                .font(MapTheme.heading(22))
                .foregroundStyle(MapTheme.ink)
            Label(live.address.isEmpty ? "地址待补充" : live.address, systemImage: "mappin.and.ellipse")
                .font(MapTheme.body(14))
                .foregroundStyle(MapTheme.inkMuted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MapTheme.paper, in: RoundedRectangle(cornerRadius: MapTheme.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: MapTheme.cardRadius)
                .strokeBorder(MapTheme.line, lineWidth: 0.75)
        )
    }

    private var reasonCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("推荐理由")
                .font(MapTheme.fixed(12, weight: .semibold))
                .foregroundStyle(MapTheme.inkMuted)
            Text(live.reason)
                .font(MapTheme.body(15))
                .foregroundStyle(MapTheme.ink)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(MapTheme.accentSoft.opacity(0.55), in: RoundedRectangle(cornerRadius: MapTheme.cardRadius))
    }

    private var mapPreview: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("位置")
                .font(MapTheme.fixed(12, weight: .semibold))
                .foregroundStyle(MapTheme.inkMuted)
            if let coordinate = live.wgsCoordinate {
                Map(initialPosition: .region(
                    MKCoordinateRegion(
                        center: coordinate,
                        span: MKCoordinateSpan(latitudeDelta: 0.008, longitudeDelta: 0.008)
                    )
                )) {
                    Marker(live.name, systemImage: live.categoryValue?.icon ?? "mappin", coordinate: coordinate)
                        .tint(live.categoryValue?.tint ?? MapTheme.ink)
                }
                .frame(height: 190)
                .clipShape(RoundedRectangle(cornerRadius: MapTheme.cardRadius))
                .allowsHitTesting(false)
            }
        }
    }

    private var metaCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            metaRow("添加人", live.createdByName ?? live.createdBy ?? "—")
            Divider().overlay(MapTheme.line)
            metaRow("添加时间", DateFormats.day(live.createdAt).isEmpty ? "—" : DateFormats.day(live.createdAt))
            Divider().overlay(MapTheme.line)
            metaRow("来源", sourceLabel)
            if live.hasCoordinates, let lat = live.latitude, let lng = live.longitude {
                Divider().overlay(MapTheme.line)
                metaRow("坐标（GCJ-02）", String(format: "%.5f, %.5f", lat, lng))
            }
        }
        .padding(16)
        .background(MapTheme.paper, in: RoundedRectangle(cornerRadius: MapTheme.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: MapTheme.cardRadius)
                .strokeBorder(MapTheme.line, lineWidth: 0.75)
        )
    }

    private var sourceLabel: String {
        switch live.sourceType {
        case "manual": return "手动添加"
        case "import": return "导入"
        case "poi": return "地图选点"
        case let value?: return value
        case nil: return "—"
        }
    }

    private func metaRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
                .font(MapTheme.body(13))
                .foregroundStyle(MapTheme.inkMuted)
            Spacer()
            Text(value)
                .font(MapTheme.body(13, weight: .medium))
                .foregroundStyle(MapTheme.ink)
                .multilineTextAlignment(.trailing)
        }
    }

    private var actions: some View {
        VStack(spacing: 12) {
            if let coordinate = live.wgsCoordinate {
                Link(destination: mapsURL(coordinate: coordinate)) {
                    HStack(spacing: 8) {
                        Image(systemName: "location.fill")
                        Text("用 Apple 地图导航")
                            .font(MapTheme.body(15, weight: .semibold))
                    }
                    .foregroundStyle(MapTheme.ink)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(MapTheme.accent, in: RoundedRectangle(cornerRadius: MapTheme.controlRadius))
                }
            }
            Button(role: .destructive) {
                showDeleteConfirm = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "trash")
                    Text("删除地点")
                        .font(MapTheme.body(15, weight: .medium))
                }
                .foregroundStyle(MapTheme.danger)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(MapTheme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: MapTheme.controlRadius))
            }
            .buttonStyle(PressableStyle())
        }
    }

    private func mapsURL(coordinate: CLLocationCoordinate2D) -> URL {
        let name = live.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "http://maps.apple.com/?daddr=\(coordinate.latitude),\(coordinate.longitude)&q=\(name)")!
    }
}
