#!/usr/bin/env node
/**
 * OpenClaw API 快速测试
 */

const http = require('http');

const SECRET = 'cb2a6dbf441a2818f5a8ebd9534c76d3';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('=== OpenClaw API 测试 ===\n');

  // 测试 1: 无鉴权
  console.log('测试 1: 无鉴权访问');
  const noAuthReq = new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/openclaw/locations/intake',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.write(JSON.stringify({ query: '测试' }));
    req.end();
  });
  const noAuth = await noAuthReq;
  console.log(`  状态：${noAuth.status} (期望：401)`);
  console.log(`  响应：${JSON.stringify(noAuth.body)}\n`);

  // 测试 2: 搜索三坊七巷
  console.log('测试 2: 搜索"三坊七巷"');
  const sanfang = await request('POST', '/api/openclaw/locations/intake', {
    query: '三坊七巷',
    city: '福州'
  });
  console.log(`  状态：${sanfang.status}`);
  console.log(`  结果：${sanfang.body.status}`);
  if (sanfang.body.location) {
    console.log(`  地点：${sanfang.body.location.name}`);
  }
  if (sanfang.body.candidates) {
    console.log(`  候选：${sanfang.body.candidates.length} 个`);
    sanfang.body.candidates.forEach((c, i) => {
      console.log(`    ${i+1}. ${c.name}`);
    });
  }
  console.log();

  // 测试 3: 搜索万达广场（多候选）
  console.log('测试 3: 搜索"万达广场"');
  const wanda = await request('POST', '/api/openclaw/locations/intake', {
    query: '万达广场',
    city: '福州'
  });
  console.log(`  状态：${wanda.status}`);
  console.log(`  结果：${wanda.body.status}`);
  if (wanda.body.candidates) {
    console.log(`  候选：${wanda.body.candidates.length} 个`);
    wanda.body.candidates.forEach((c, i) => {
      console.log(`    ${i+1}. ${c.name} - ${c.address.substring(0, 30)}...`);
    });
  }
  console.log();

  // 测试 4: 确认候选
  if (wanda.body.status === 'needs_confirmation' && wanda.body.candidates.length > 0) {
    console.log('测试 4: 确认候选地点');
    const confirm = await request('POST', '/api/openclaw/locations/confirm', {
      candidate: wanda.body.candidates[0],
      category: '购物',
      reason: '测试添加'
    });
    console.log(`  状态：${confirm.status}`);
    console.log(`  结果：${confirm.body.status}`);
    if (confirm.body.location) {
      console.log(`  地点：${confirm.body.location.name}`);
    }
    console.log();
  }

  // 测试 5: 重复检测
  console.log('测试 5: 重复检测（再次搜索三坊七巷）');
  const duplicate = await request('POST', '/api/openclaw/locations/intake', {
    query: '三坊七巷',
    city: '福州'
  });
  console.log(`  状态：${duplicate.status}`);
  console.log(`  结果：${duplicate.body.status}`);
  console.log();

  console.log('=== 测试完成 ===');
}

runTests().catch(console.error);
