import Foundation

/// 高德坐标系（GCJ-02，俗称火星坐标）与 WGS-84 的互转。
/// 服务端与小程序都用高德，存的是 GCJ-02；MapKit 与 Apple 地图导航用 WGS-84，
/// 直接把 GCJ-02 丢给 MapKit 在福州会偏出几百米。
/// 算法为公开的等价偏移近似（百米级误差，对选点与导航足够）。
enum CoordinateTransform {
    struct Pair {
        var lat: Double
        var lng: Double
    }

    private static let a: Double = 6378245.0
    private static let ee: Double = 0.00669342162296594323

    /// WGS-84 → GCJ-02（写回高德语境时用）
    static func wgs2gcj(lat: Double, lng: Double) -> Pair {
        guard outOfChina(lat: lat, lng: lng) else { return Pair(lat: lat, lng: lng) }
        let offset = offsets(lat: lat, lng: lng)
        return Pair(lat: lat + offset.dLat, lng: lng + offset.dLng)
    }

    /// GCJ-02 → WGS-84（MapKit / Apple 地图用）
    static func gcj2wgs(lat: Double, lng: Double) -> Pair {
        guard outOfChina(lat: lat, lng: lng) else { return Pair(lat: lat, lng: lng) }
        let gcj = wgs2gcj(lat: lat, lng: lng)
        // 反向迭代一次即可把误差压到米级
        return Pair(lat: lat * 2 - gcj.lat, lng: lng * 2 - gcj.lng)
    }

    private static func outOfChina(lat: Double, lng: Double) -> Bool {
        !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55)
    }

    private static func offsets(lat: Double, lng: Double) -> (dLat: Double, dLng: Double) {
        var dLat = transformLat(x: lng - 105.0, y: lat - 35.0)
        var dLng = transformLng(x: lng - 105.0, y: lat - 35.0)
        let radLat = lat / 180.0 * .pi
        var magic = sin(radLat)
        magic = 1 - ee * magic * magic
        let sqrtMagic = sqrt(magic)
        dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * .pi)
        dLng = (dLng * 180.0) / (a / sqrtMagic * cos(radLat) * .pi)
        return (dLat, dLng)
    }

    private static func transformLat(x: Double, y: Double) -> Double {
        var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
        ret += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
        ret += (20.0 * sin(y * .pi) + 40.0 * sin(y / 3.0 * .pi)) * 2.0 / 3.0
        ret += (160.0 * sin(y / 12.0 * .pi) + 320.0 * sin(y * .pi / 30.0)) * 2.0 / 3.0
        return ret
    }

    private static func transformLng(x: Double, y: Double) -> Double {
        var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
        ret += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
        ret += (20.0 * sin(x * .pi) + 40.0 * sin(x / 3.0 * .pi)) * 2.0 / 3.0
        ret += (150.0 * sin(x / 12.0 * .pi) + 300.0 * sin(x / 30.0 * .pi)) * 2.0 / 3.0
        return ret
    }
}
