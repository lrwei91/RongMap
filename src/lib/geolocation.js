// Browser geolocation uses WGS84; AMap overlays use GCJ-02.
export function locateOnAmap(AMap, geolocation = navigator.geolocation) {
  if (!geolocation) return Promise.reject(new Error('当前浏览器不支持定位'));
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(({ coords }) => {
      if (typeof AMap?.convertFrom !== 'function') {
        reject(new Error('地图坐标转换暂不可用，请稍后重试'));
        return;
      }
      const timer = setTimeout(() => reject(new Error('坐标转换超时，请重试')), 10000);
      try {
        AMap.convertFrom([coords.longitude, coords.latitude], 'gps', (status, result) => {
          clearTimeout(timer);
          const position = result?.locations?.[0];
          if (status !== 'complete' || !position) {
            reject(new Error('地图坐标转换失败，请重试'));
            return;
          }
          resolve({ position, accuracy: coords.accuracy });
        });
      } catch {
        clearTimeout(timer);
        reject(new Error('地图坐标转换失败，请重试'));
      }
    }, (error) => {
      reject(new Error(error.code === 1 ? '定位权限被拒绝，请在浏览器设置中允许位置访问' :
        error.code === 3 ? '定位超时，请到信号较好的位置重试' : '暂时无法获取位置，请检查系统定位服务后重试'));
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}
