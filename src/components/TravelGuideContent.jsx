import React from 'react';
import { dayDate, navigationUrl, MODES } from '../lib/roadbook';

const STATUS = { pending: '待采集', queried: '已查询', not_configured: '未接入', user_provided: '用户补充 · 未自动核验', failed: '查询失败' };
export function SourceList({ sources = [] }) {
  return <div className="guide-sources">{sources.map((source) => <article key={source.id} className={`guide-source guide-source--${source.status}`}><div><strong>{source.name}</strong><small>{STATUS[source.status] || '待核实'}</small></div>{source.excerpt ? <p>{source.excerpt}</p> : null}{source.url ? <a href={source.url} target="_blank" rel="noreferrer">查看来源 ↗</a> : null}{source.checkedAt ? <small>查询于 {new Date(source.checkedAt).toLocaleString('zh-CN')}</small> : null}</article>)}</div>;
}
export default function TravelGuideContent({ trip, inspections = {}, onInspect, inspecting }) {
  const guide = trip.roadbook?.guide;
  const request = guide?.request || {};
  const places = guide?.places || [];
  const budget = request.budget ?? trip.roadbook?.budget;
  return <div className="guide-reading">
    <section className="guide-section"><h3>行程概览</h3><p>{guide?.overview || trip.description || '按逐日安排出发，临行前确认开放时间与预约要求。'}</p><div className="guide-facts"><span>{trip.days.length} 天</span><span>{trip.roadbook?.travelers || 1} 人同行</span><span>{MODES[trip.roadbook?.mode || 'car']}</span><span>{budget == null ? '预算待补充' : `人均预算 ¥${budget}`}</span></div><p className="guide-caution">AI 时间与建议待核实；不同来源的数据需要核对分店、查询时间和适用范围。</p><div className="guide-overview">{trip.days.map((day) => <a href={`#guide-day-${day.dayIndex}`} key={day.dayIndex}><strong>第 {day.dayIndex} 天 · {day.title || '自由探索'}</strong><small>{dayDate(trip, day) || '日期待定'}</small><span>{day.items.map((item) => item.name).join(' → ') || '预留休息或机动安排'}</span></a>)}</div></section>
    {trip.days.map((day) => {
      const inspection = inspections[day.dayIndex];
      const date = dayDate(trip, day);
      return <section className="guide-section guide-day" id={`guide-day-${day.dayIndex}`} key={day.dayIndex}><header><div><p className="eyebrow">DAY {String(day.dayIndex).padStart(2, '0')} · {date || '日期待定'}</p><h3>{day.title || `第 ${day.dayIndex} 天`}</h3></div>{onInspect ? <button className="button button--quiet" disabled={Boolean(inspecting)} onClick={() => onInspect(day.dayIndex)}>{inspecting === day.dayIndex ? '正在核验…' : '核验当天路线'}</button> : null}</header><ol className="guide-timeline">{day.items.map((item, index) => {
        const place = places.find((poi) => poi.name === item.name && poi.address === item.address);
        const segment = inspection?.segments.find((row) => row.index === index);
        const navigation = index ? navigationUrl(day.items[index - 1], item, trip.roadbook?.mode) : null;
        return <li key={item.id || index}><time>{item.startTime || '时间待定'}{item.endTime ? `–${item.endTime}` : ''}</time><div><strong>{item.name}</strong><p>{item.address}</p>{item.note ? <p>{item.note}</p> : null}<small>{place ? '地点信息：高德地图' : '已有行程地点'} · 活动安排：AI 建议或用户填写</small>{segment ? <p className="guide-route">{segment.from} → {segment.to} · {segment.km.toFixed(1)} km · 约 {Math.round(segment.hours * 60)} 分钟 · 高德 {MODES[inspection.mode || trip.roadbook?.mode || 'car']}</p> : index ? <p className="guide-unverified">相邻路段耗时待核验</p> : null}{navigation ? <a href={navigation} target="_blank" rel="noreferrer">高德导航至本站 ↗</a> : null}</div></li>;
      })}</ol>{!day.items.length ? <p>预留休息或机动安排，可在行程中补充地点。</p> : null}{inspection ? <div className="guide-inspection"><small>高德查询于 {new Date(inspection.queriedAt).toLocaleString('zh-CN')} · {inspection.complete ? '当天路段已查询' : '部分路段未完成'}</small>{inspection.weather.map((forecast) => { const cast = forecast.casts.find((row) => row.date === date); return <p key={forecast.city}>{forecast.city} · {cast ? `${cast.date} · ${cast.dayweather} / ${cast.nightweather} · ${cast.nighttemp}–${cast.daytemp}℃` : '出行日期不在当前天气预报窗口'}</p>; })}{inspection.warnings.map((warning, index) => <p className="guide-caution" key={index}>{warning}</p>)}</div> : null}</section>;
    })}
    {places.some((poi) => poi.category !== 'spot') ? <section className="guide-section"><h3>美食候选</h3><p className="guide-unverified">平台评分和人均为查询快照；菜品、分店与营业状态请再确认。</p><div className="guide-food-list">{places.filter((poi) => poi.category !== 'spot').map((poi) => <article key={poi.sourceId}><strong>{poi.name}</strong><p>{poi.address}</p><small>高德 {poi.rating == null ? '评分暂无' : `${poi.rating} 分`} · {poi.averageCost == null ? '人均未知' : `人均 ¥${poi.averageCost}`} · {poi.openingHours || '营业时间待核实'}</small></article>)}</div></section> : null}
    <div className="guide-advice-grid"><section className="guide-section"><h3>住宿与动线</h3><p>{request.hotel ? `已提供住宿：${request.hotel}` : '住宿尚未确定'}</p><p>{guide?.stayAdvice || '优先选择靠近每日动线和交通节点的住宿区域。'}</p>{request.constraints ? <p>硬约束：{request.constraints}</p> : null}</section><section className="guide-section"><h3>雨天备选</h3><p>{guide?.rainPlan || '遇雨可减少室外活动，优先休息或室内项目；开放与预约情况待核实。'}</p><small>条件性建议 · 出发前查看天气</small></section></div>
    <div className="guide-advice-grid"><section className="guide-section"><h3>避坑与提醒</h3><ul>{(guide?.pitfalls?.length ? guide.pitfalls : [trip.roadbook?.tips || '票价、营业时间与临时管控请在出发前核实。']).map((item, index) => <li key={index}>{item}</li>)}</ul><small>AI 建议或用户填写 · 以末尾实际采集的来源为准</small></section><section className="guide-section"><h3>预约与费用</h3><ul>{(guide?.bookingChecklist?.length ? guide.bookingChecklist : ['确认所选景点的官方预约要求及实际票价。']).map((item, index) => <li key={index}>{item}</li>)}</ul>{trip.roadbook?.tickets?.map((ticket, index) => <p key={index}>{ticket.name} · {ticket.price == null ? '票价待核实' : `¥${ticket.price}/人`} · {ticket.source || '来源待补充'}</p>)}<small>未知金额不计为免费；高德人均不等于实际消费。</small></section></div>
    {guide ? <section className="guide-section"><h3>来源与核验范围</h3><SourceList sources={guide.sources} /><p className="guide-unverified">补充链接不会自动读取全文，摘录由用户提供。路线查询反映查询时的估算，实际拥堵、排队与休息需要额外预留。</p></section> : null}
  </div>;
}
