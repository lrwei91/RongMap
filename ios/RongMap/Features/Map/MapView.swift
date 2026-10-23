import SwiftUI
import MapKit
import UIKit

/// 地图页：所有带坐标的地点上图（GCJ-02 → WGS-84 已换算），
/// 点图钉出摘要卡，可下钻详情；支持定位到当前位置与回到福州。
struct MapView: View {
    @Binding var path: NavigationPath
    @Environment(SessionStore.self) private var session
    @Environment(PlacesStore.self) private var store
    @Environment(LocationProvider.self) private var location
    @Environment(\.openURL) private var openURL

    private static let homeRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 26.0745, longitude: 119.2965), // 福州
        span: MKCoordinateSpan(latitudeDelta: 0.16, longitudeDelta: 0.16)
    )

    @State private var camera: MapCameraPosition = .region(MapView.homeRegion)
    @State private var selected: Place?
    @State private var showLocationAlert = false
    @State private var locationAlertMessage = ""

    private struct MarkerItem: Identifiable {
        let place: Place
        let coordinate: CLLocationCoordinate2D
        var id: String { place.id }
    }

    private var markers: [MarkerItem] {
        store.places.compactMap { place in
            guard let coordinate = place.wgsCoordinate else { return nil }
            return MarkerItem(place: place, coordinate: coordinate)
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            ZStack(alignment: .top) {
                mapLayer
                header
                if let selected {
                    summaryCard(for: selected)
                }
            }
            .background(MapTheme.mapPaper)
            .navigationDestination(for: Place.self) { place in
                PlaceDetailView(place: place)
            }
        }
    }

    private var mapLayer: some View {
        Map(position: $camera) {
            ForEach(markers) { item in
                Annotation(item.place.name, coordinate: item.coordinate) {
                    Button {
                        Haptics.tap()
                        withAnimation(MapMotion.smooth) { selected = item.place }
                    } label: {
                        pin(for: item.place)
                    }
                    .buttonStyle(PressableStyle())
                }
                .annotationTitles(.hidden)
            }
            UserAnnotation()
        }
        .mapControls {
            MapCompass()
        }
        .ignoresSafeArea(edges: .bottom)
        .overlay(alignment: .bottomTrailing) {
            VStack(spacing: 10) {
                locateButton
                recenterButton
            }
            .padding(.trailing, 16)
            .padding(.bottom, 110)
        }
        .onChange(of: location.fix) { _, fix in
            guard let fix else { return }
            center(on: fix.coordinate)
        }
        .onChange(of: location.status) { _, status in
            switch status {
            case .denied:
                locationAlertMessage = "定位权限未开启。到「设置 → 隐私与安全性 → 定位服务」允许 RongMap 使用位置后再试。"
                showLocationAlert = true
            case .failed(let message):
                locationAlertMessage = message
                showLocationAlert = true
            default:
                break
            }
        }
        .alert("无法定位", isPresented: $showLocationAlert) {
            Button("打开设置") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            Button("知道了", role: .cancel) {}
        } message: {
            Text(locationAlertMessage)
        }
        .onTapGesture {
            withAnimation(MapMotion.smooth) { selected = nil }
        }
    }

    private func center(on coordinate: CLLocationCoordinate2D, span: Double = 0.012) {
        withAnimation(MapMotion.smooth) {
            camera = .region(
                MKCoordinateRegion(
                    center: coordinate,
                    span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)
                )
            )
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 8) {
                MapMark(size: 28)
                Text("共 \(markers.count) 个地点上图")
                    .font(MapTheme.fixed(13, weight: .medium))
                    .foregroundStyle(MapTheme.ink)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .modifier(GlassSurface())
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private func pin(for place: Place) -> some View {
        VStack(spacing: 2) {
            Image(systemName: place.categoryValue?.icon ?? "mappin")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background((place.categoryValue?.tint ?? MapTheme.ink).gradient, in: Circle())
                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                .shadow(color: MapTheme.ink.opacity(0.25), radius: 3, y: 1)
        }
        .accessibilityLabel(place.name)
    }

    private func summaryCard(for place: Place) -> some View {
        VStack {
            Spacer()
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(place.name)
                        .font(MapTheme.body(16, weight: .semibold))
                        .foregroundStyle(MapTheme.ink)
                        .lineLimit(1)
                    Text(place.address.isEmpty ? "地址待补充" : place.address)
                        .font(MapTheme.body(13))
                        .foregroundStyle(MapTheme.inkMuted)
                        .lineLimit(2)
                    CategoryChip(category: place.categoryValue, compact: true)
                }
                Spacer(minLength: 8)
                VStack(spacing: 8) {
                    Button {
                        Haptics.tap()
                        path.append(place)
                        selected = nil
                    } label: {
                        Text("详情")
                            .font(MapTheme.fixed(13, weight: .semibold))
                            .foregroundStyle(MapTheme.ink)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(MapTheme.accent, in: Capsule())
                    }
                    .buttonStyle(PressableStyle())
                    Button {
                        withAnimation(MapMotion.smooth) { selected = nil }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(MapTheme.inkMuted)
                            .frame(width: 30, height: 30)
                            .background(MapTheme.surfaceSubtle, in: Circle())
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(16)
            .modifier(GlassSurface(cornerRadius: 18))
            .padding(.horizontal, 16)
            .padding(.bottom, 118)
        }
    }

    private var locateButton: some View {
        Button {
            Haptics.tap()
            if location.isDenied {
                locationAlertMessage = "定位权限未开启。到「设置 → 隐私与安全性 → 定位服务」允许 RongMap 使用位置后再试。"
                showLocationAlert = true
                return
            }
            if let fix = location.cachedFix {
                center(on: fix.coordinate)
            } else {
                location.request()
            }
        } label: {
            Image(systemName: "location.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(MapTheme.ink)
                .frame(width: 44, height: 44)
                .modifier(GlassSurface(cornerRadius: 22))
                .opacity(location.status == .requesting ? 0.55 : 1)
        }
        .buttonStyle(PressableStyle())
        .disabled(location.status == .requesting)
        .accessibilityLabel("定位到当前位置")
    }

    private var recenterButton: some View {
        Button {
            Haptics.tap()
            withAnimation(MapMotion.smooth) { camera = .region(MapView.homeRegion) }
        } label: {
            Image(systemName: "scope")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(MapTheme.ink)
                .frame(width: 44, height: 44)
                .modifier(GlassSurface(cornerRadius: 22))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("回到福州")
    }
}
