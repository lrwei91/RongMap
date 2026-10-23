import CoreLocation
import Foundation
import Observation

/// 定位能力的唯一入口：地图「定位」与新增地点「使用当前位置」共用同一实例。
/// 只做一次性取点，不申请常驻定位，也不在后台持续更新。
///
/// 坐标一律以 WGS-84 返回；写入服务端前由调用方转成 GCJ-02（见 CoordinateTransform）。
@MainActor
@Observable
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    /// 一次定位的坐标快照。用 Equatable 结构承载，便于视图 observe 变化。
    struct Fix: Equatable {
        var latitude: Double
        var longitude: Double
        var accuracy: Double

        var coordinate: CLLocationCoordinate2D {
            CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }
    }

    enum Status: Equatable {
        case idle
        case requesting
        case ready
        case denied
        case failed(String)
    }

    private(set) var status: Status = .idle
    private(set) var fix: Fix?

    private let manager = CLLocationManager()
    private var timeout: DispatchWorkItem?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }

    /// 权限被拒时 request() 不会产生状态变化，视图需要先判断再给提示。
    var isDenied: Bool {
        authorizationStatus == .denied || authorizationStatus == .restricted
    }

    /// 已知可用位置时直接复用，避免每次都要等一次 GPS。
    var cachedFix: Fix? {
        guard authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways else { return nil }
        return fix
    }

    /// 发起一次取点：未授权先弹系统授权，已授权直接请求位置。
    func request() {
        guard status != .requesting else { return }
        switch authorizationStatus {
        case .denied, .restricted:
            status = .denied
        case .notDetermined:
            // 系统授权弹窗期间不计超时，等用户选择后再进入实际取点。
            status = .requesting
            manager.requestWhenInUseAuthorization()
        default:
            status = .requesting
            manager.requestLocation()
            armTimeout()
        }
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let authorization = manager.authorizationStatus
        Task { @MainActor in self.handleAuthorization(authorization) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let latitude = last.coordinate.latitude
        let longitude = last.coordinate.longitude
        let accuracy = last.horizontalAccuracy
        Task { @MainActor in
            self.settle(Fix(latitude: latitude, longitude: longitude, accuracy: accuracy))
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in self.fail(message) }
    }

    // MARK: - 状态机

    private func handleAuthorization(_ authorization: CLAuthorizationStatus) {
        switch authorization {
        case .authorizedWhenInUse, .authorizedAlways:
            if status == .requesting {
                manager.requestLocation()
                armTimeout()
            }
            if status == .denied { status = .idle }
        case .denied, .restricted:
            cancelTimeout()
            status = .denied
        case .notDetermined:
            // 系统弹窗仍在等待用户选择，保持 requesting 让 UI 继续转圈。
            break
        @unknown default:
            break
        }
    }

    private func settle(_ fix: Fix) {
        cancelTimeout()
        self.fix = fix
        status = .ready
    }

    private func fail(_ message: String) {
        cancelTimeout()
        status = .failed(message.isEmpty ? "定位失败，请稍后重试" : message)
    }

    private func armTimeout() {
        cancelTimeout()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.status == .requesting else { return }
            self.status = .failed("定位超时，请确认已开启定位服务")
        }
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: work)
    }

    private func cancelTimeout() {
        timeout?.cancel()
        timeout = nil
    }
}
