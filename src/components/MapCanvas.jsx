import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORIES, hasCoordinates } from '../lib/location';

const FUZHOU_CENTER = [119.296531, 26.061473];
const DEFAULT_AMAP_WEB_KEY = '806754933c281cf11a95842b5f9cef59';
const DEFAULT_AMAP_SECURITY_CODE = 'db67e6113b81508f33ae7b14dbc42358';
let amapPromise;

function loadAmap() {
  if (window.AMap?.Map) return Promise.resolve(window.AMap);
  if (amapPromise) return amapPromise;
  const key = import.meta.env.VITE_AMAP_WEB_KEY || DEFAULT_AMAP_WEB_KEY;
  const securityJsCode = import.meta.env.VITE_AMAP_SECURITY_CODE || DEFAULT_AMAP_SECURITY_CODE;
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
  return `<button class="amap-location-marker ${active ? 'is-active' : ''}" aria-label="${location.name}" type="button"><span>${category.short}</span></button>`;
}

export default function MapCanvas({ locations, activeId, focusRequest, onSelect, publicMode = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('正在连接高德地图。');
  const [locating, setLocating] = useState(false);

  const init = useCallback(async () => {
    setStatus('loading');
    setMessage('正在连接高德地图。');
    try {
      const AMap = await loadAmap();
      if (!containerRef.current || mapRef.current) return;
      mapRef.current = new AMap.Map(containerRef.current, {
        center: FUZHOU_CENTER,
        zoom: 12,
        viewMode: '2D',
        resizeEnable: true
      });
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(`${error.message}。地点列表仍可正常使用。`);
    }
  }, []);

  useEffect(() => {
    init();
    return () => {
      markersRef.current.forEach((marker) => marker.setMap?.(null));
      markersRef.current.clear();
      mapRef.current?.destroy?.();
      mapRef.current = null;
    };
  }, [init]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = window.AMap;
    if (!map || !AMap?.Marker || status !== 'ready') return;
    const nextIds = new Set(locations.filter(hasCoordinates).map((item) => item.id));
    markersRef.current.forEach((marker, id) => {
      if (!nextIds.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    });
    locations.filter(hasCoordinates).forEach((location) => {
      let marker = markersRef.current.get(location.id);
      if (!marker) {
        marker = new AMap.Marker({
          position: [Number(location.longitude), Number(location.latitude)],
          anchor: 'bottom-center',
          content: markerContent(location, location.id === activeId),
          title: location.name,
          map
        });
        marker.on('click', () => onSelect(location));
        markersRef.current.set(location.id, marker);
      } else {
        marker.setContent?.(markerContent(location, location.id === activeId));
        marker.setPosition?.([Number(location.longitude), Number(location.latitude)]);
      }
      marker.setzIndex?.(location.id === activeId ? 120 : 100);
    });
  }, [locations, activeId, onSelect, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusRequest || !hasCoordinates(focusRequest)) return;
    map.setZoomAndCenter?.(17, [Number(focusRequest.longitude), Number(focusRequest.latitude)]);
  }, [focusRequest]);

  function locate() {
    if (!navigator.geolocation || !mapRef.current) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        mapRef.current.setZoomAndCenter?.(16, [coords.longitude, coords.latitude]);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setStatus('ready');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <section className="map-card" aria-label={publicMode ? '共享地点地图' : '地点地图'}>
      <div ref={containerRef} className="map-canvas" />
      {status !== 'ready' ? (
        <div className="map-state" role="status">
          <div className="map-state__card">
            <span className="map-state__mark" aria-hidden="true">⌖</span>
            <h2>{status === 'loading' ? '地图加载中' : '地图暂未加载'}</h2>
            <p>{message}</p>
            {status === 'error' ? <button type="button" className="button button--primary" onClick={init}>重新加载地图</button> : null}
          </div>
        </div>
      ) : null}
      <div className="map-toolbar">
        <span>{locations.filter(hasCoordinates).length} 个已定位</span>
        {!publicMode ? <button type="button" className="icon-button" onClick={locate} aria-label="定位我的位置">{locating ? '…' : '◎'}</button> : null}
      </div>
    </section>
  );
}
