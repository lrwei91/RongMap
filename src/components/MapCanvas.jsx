import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, hasCoordinates } from '../lib/location';
import { locateOnAmap } from '../lib/geolocation';

const FUZHOU_CENTER = [119.296531, 26.061473];
let amapPromise;

function loadAmap() {
  if (window.AMap?.Map) return Promise.resolve(window.AMap);
  if (amapPromise) return amapPromise;
  const key = import.meta.env.VITE_AMAP_WEB_KEY;
  const securityJsCode = import.meta.env.VITE_AMAP_SECURITY_CODE;
  if (!key) { amapPromise = Promise.reject(new Error('缺少 VITE_AMAP_WEB_KEY 配置')); return amapPromise; }
  if (securityJsCode) window._AMapSecurityConfig = { securityJsCode };
  amapPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => window.AMap?.Map ? resolve(window.AMap) : reject(new Error('地图组件未就绪'));
    script.onerror = () => reject(new Error('地图服务连接失败'));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('地图加载超时')), 9000);
  });
  return amapPromise;
}

function markerContent(location, active) {
  const category = CATEGORIES[location.category] || CATEGORIES.food;
  const label = location.routeOrder || category.short;
  const safeName = String(location.name).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return `<button class="amap-location-marker ${location.routeOrder ? 'is-route' : ''} ${active ? 'is-active' : ''}" aria-label="${safeName}" type="button"><span>${label}</span></button>`;
}

const EMPTY_ROUTE_DAYS = [];
const ROUTE_COLORS = ['#1a1a1a', '#28704b', '#8a6410', '#315efb', '#a33d36', '#7653a6'];

export default function MapCanvas({ locations, activeId, focusRequest, onSelect, publicMode = false, routeDays = EMPTY_ROUTE_DAYS, activeDayIndex = 0, onViewportChange, discovery = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const polylinesRef = useRef([]);
  const userMarkerRef = useRef(null);
  const accuracyCircleRef = useRef(null);
  const locationRequestRef = useRef(0);
  const locationPendingRef = useRef(false);
  const autoFitRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const locatedLocations = useMemo(() => locations.filter(hasCoordinates), [locations]);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('正在连接高德地图。');
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  const init = useCallback(async () => {
    setStatus('loading');
    setMessage('正在连接高德地图。');
    try {
      const AMap = await loadAmap();
      if (!containerRef.current || mapRef.current) return;
      mapRef.current = new AMap.Map(containerRef.current, {
        center: FUZHOU_CENTER,
        zoom: discovery ? 15 : 12,
        viewMode: '2D',
        resizeEnable: true
      });
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(`${error.message}。地点列表仍可正常使用。`);
    }
  }, [discovery]);

  useEffect(() => {
    init();
    return () => {
      locationRequestRef.current++;
      locationPendingRef.current = false;
      userMarkerRef.current?.setMap(null);
      userMarkerRef.current = null;
      accuracyCircleRef.current?.setMap(null);
      accuracyCircleRef.current = null;
      markersRef.current.forEach((marker) => marker.setMap?.(null));
      markersRef.current.clear();
      polylinesRef.current.forEach((line) => line.setMap?.(null));
      polylinesRef.current = [];
      mapRef.current?.destroy?.();
      mapRef.current = null;
      autoFitRef.current = false;
    };
  }, [init]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !onViewportChange) return;
    function report() {
      const bounds = map.getBounds?.();
      if (!bounds) return;
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      onViewportChange({ west: sw.getLng(), south: sw.getLat(), east: ne.getLng(), north: ne.getLat() });
    }
    map.on('moveend', report);
    map.on('zoomend', report);
    map.on('resize', report);
    report();
    return () => {
      map.off?.('moveend', report);
      map.off?.('zoomend', report);
      map.off?.('resize', report);
    };
  }, [status, onViewportChange]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = window.AMap;
    if (!map || !AMap?.Marker || status !== 'ready') return;
    const nextIds = new Set(locatedLocations.map((item) => item.id));
    markersRef.current.forEach((marker, id) => {
      if (!nextIds.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    });
    locatedLocations.forEach((location) => {
      let marker = markersRef.current.get(location.id);
      const position = [Number(location.longitude), Number(location.latitude)];
      const content = markerContent(location, location.id === activeId);
      const zIndex = location.id === activeId ? 120 : 100;
      if (!marker) {
        marker = new AMap.Marker({
          position,
          anchor: 'bottom-center',
          content,
          zIndex,
          title: location.name,
          map
        });
        marker.on('click', () => onSelectRef.current?.(marker.__rongmapLocation));
        markersRef.current.set(location.id, marker);
      } else {
        if (marker.__rongmapContent !== content) marker.setContent?.(content);
        if (marker.__rongmapPosition[0] !== position[0] || marker.__rongmapPosition[1] !== position[1]) marker.setPosition?.(position);
        if (marker.__rongmapZIndex !== zIndex) marker.setzIndex?.(zIndex);
        if (marker.__rongmapLocation.name !== location.name) marker.setTitle?.(location.name);
      }
      marker.__rongmapLocation = location;
      marker.__rongmapContent = content;
      marker.__rongmapPosition = position;
      marker.__rongmapZIndex = zIndex;
    });
  }, [locatedLocations, activeId, status]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = window.AMap;
    if (!map || !AMap?.Polyline || status !== 'ready') return;
    polylinesRef.current.forEach((line) => line.setMap?.(null));
    polylinesRef.current = routeDays.map((day, index) => {
      const path = (day.items || []).filter(hasCoordinates).map((item) => [Number(item.longitude), Number(item.latitude)]);
      if (path.length < 2) return null;
      return new AMap.Polyline({
        path,
        strokeColor: ROUTE_COLORS[index % ROUTE_COLORS.length],
        strokeWeight: day.dayIndex === activeDayIndex ? 6 : 3,
        strokeOpacity: day.dayIndex === activeDayIndex ? 0.9 : 0.5,
        lineJoin: 'round',
        lineCap: 'round',
        showDir: true,
        map
      });
    }).filter(Boolean);
    return () => {
      polylinesRef.current.forEach((line) => line.setMap?.(null));
      polylinesRef.current = [];
    };
  }, [routeDays, activeDayIndex, status]);

  // 首次进入：有已定位地点且没有显式聚焦请求时，把视野适配到数据范围。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || discovery || autoFitRef.current) return;
    if (focusRequest) { autoFitRef.current = true; return; }
    const overlays = [...markersRef.current.values(), ...polylinesRef.current];
    if (!overlays.length) return;
    map.setFitView?.(overlays, true, [64, 64, 64, 64], 15);
    autoFitRef.current = true;
  }, [status, locatedLocations, routeDays, focusRequest, discovery]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusRequest || !hasCoordinates(focusRequest)) return;
    map.setZoomAndCenter?.(17, [Number(focusRequest.longitude), Number(focusRequest.latitude)]);
  }, [focusRequest]);

  async function locate() {
    const map = mapRef.current;
    if (!map || status !== 'ready' || locationPendingRef.current) return;
    const requestId = ++locationRequestRef.current;
    locationPendingRef.current = true;
    setLocating(true);
    setLocationMessage('正在获取你的位置…');
    try {
      const AMap = window.AMap;
      const { position, accuracy } = await locateOnAmap(AMap);
      if (requestId !== locationRequestRef.current || map !== mapRef.current) return;
      if (!userMarkerRef.current) {
        userMarkerRef.current = new AMap.Marker({
          position, anchor: 'center', zIndex: 200, title: '我的位置',
          content: '<span class="amap-user-marker" role="img" aria-label="我的位置"></span>',
          map
        });
      } else {
        userMarkerRef.current.setPosition(position);
      }
      accuracyCircleRef.current?.setMap(null);
      accuracyCircleRef.current = Number.isFinite(accuracy) && accuracy > 0 && AMap.Circle ? new AMap.Circle({
        center: position, radius: accuracy, strokeColor: '#315efb', strokeOpacity: 0.4,
        strokeWeight: 1, fillColor: '#315efb', fillOpacity: 0.1, zIndex: 50, bubble: true, map
      }) : null;
      map.setZoomAndCenter?.(16, position);
      setLocationMessage(Number.isFinite(accuracy) && accuracy > 0 ?
        `已定位，精度约 ${Math.ceil(accuracy)} 米${accuracy > 100 ? '；当前信号较弱，位置可能有偏差' : ''}` : '已定位');
    } catch (error) {
      if (requestId === locationRequestRef.current && map === mapRef.current) {
        setLocationMessage(`${error.message}${userMarkerRef.current ? '；地图保留上次位置' : ''}`);
      }
    } finally {
      if (requestId === locationRequestRef.current) {
        locationPendingRef.current = false;
        setLocating(false);
      }
    }
  }

  return (
    <section className="map-card" aria-label={discovery ? '发现小馆地图' : publicMode ? '共享地点地图' : '地点地图'}>
      <div ref={containerRef} className="map-canvas" />
      {status !== 'ready' ? (
        <div className="map-state" role="status">
          <div className="map-state__card">
            <span className="map-state__mark" aria-hidden="true">⌖</span>
            <h2>{status === 'loading' ? '地图加载中' : '地图暂未加载'}</h2>
            <p>{discovery && status === 'error' ? '地图暂时不可用，请重试后搜索餐馆。' : message}</p>
            {status === 'error' ? <button type="button" className="button button--primary" onClick={init}>重新加载地图</button> : null}
          </div>
        </div>
      ) : null}
      <div className="map-toolbar">
        <span>{locatedLocations.length} {discovery ? '家候选' : '个已定位'}</span>
        {!publicMode ? <button type="button" className="icon-button" onClick={locate} disabled={status !== 'ready' || locating} aria-busy={locating} aria-label="定位我的位置">{locating ? '…' : '◎'}</button> : null}
      </div>
      {!publicMode && locationMessage ? <div className="map-location-status" role="status">{locationMessage}</div> : null}
    </section>
  );
}
