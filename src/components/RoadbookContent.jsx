import React from 'react';
import { EMPTY_ROADBOOK, MODES, budgetTotal, dayDate, navigationUrl } from '../lib/roadbook';

export function RoadbookContent({ trip, includeDays = true }) {
  const book = { ...EMPTY_ROADBOOK, ...trip.roadbook };
  const budget = budgetTotal(book.tickets);
  return <div className="roadbook-content">
    {book.aiGenerated ? <p className="inline-notice inline-notice--warning">本路书包含 AI 规划建议，行程时间、预约、票价与出行提醒需核实。</p> : null}
    <section className="roadbook-day"><h3>出行概况</h3><p>{book.origin || '出发地待补充'} · {MODES[book.mode]} · {book.travelers} 人</p>{book.preferences ? <p>{book.preferences}</p> : null}</section>
    {includeDays && trip.days.map((day) => <section className="roadbook-day" key={day.id || day.dayIndex}><header><h3>第 {day.dayIndex} 天{day.title ? ` · ${day.title}` : ''}</h3><small>{dayDate(trip, day) || '日期待定'}</small></header>{day.items.length ? day.items.map((item, index) => {
      const url = index ? navigationUrl(day.items[index - 1], item, book.mode) : null;
      return <article className="roadbook-stop" key={item.id || index}><span className="trip-order">{index + 1}</span><div><strong>{item.name}</strong><small>{item.startTime || '时间待定'}{item.endTime ? `–${item.endTime}` : ''} · {item.address || '地址待补充'}</small>{item.note ? <p>{item.note}</p> : null}{url ? <a href={url} target="_blank" rel="noreferrer">高德导航至本站 ↗</a> : index ? <small>相邻地点未定位，无法生成导航</small> : null}</div></article>;
    }) : <p>这一天还没有地点，请在行程中编排。</p>}</section>)}
    <section className="roadbook-day"><h3>门票与花费参考</h3><p>人均已填 ¥{budget.total.toFixed(2)} · {budget.unknown} 项金额待核实{book.budget !== '' && book.budget != null ? ` · 人均预算 ¥${book.budget}` : ''}</p>{book.budget !== '' && book.budget != null && budget.total > Number(book.budget) ? <p className="danger-text">已填花费超过人均预算。</p> : null}{book.tickets.map((ticket, index) => <article className="roadbook-cost" key={index}><strong>{ticket.name || '未命名项目'} · {ticket.price === '' || ticket.price == null ? '待核实' : `¥${ticket.price}/人`}</strong><p>{ticket.reservation || '预约信息待补充'}</p><small>来源：{ticket.source || '未提供，票价待核实'}</small></article>)}{!book.tickets.length ? <p>尚未填写花费，空白金额不计为免费。</p> : null}</section>
    <section className="roadbook-day"><h3>穿着建议</h3><p>{book.clothing || '根据目的地与出行日期补充衣物、雨具和鞋履。'}</p><h3>注意事项</h3><p>{book.tips || '出发前核实开放时间、预约要求、交通与天气。'}</p></section>
  </div>;
}
