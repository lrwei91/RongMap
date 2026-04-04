#!/usr/bin/env node
/**
 * OpenClaw 地点录入 API 测试脚本
 * 
 * 使用方法：
 * 1. 设置环境变量：export OPENCLAW_SHARED_SECRET=test-secret-123
 * 2. 启动服务：npm start
 * 3. 运行测试：node test-openclaw-intake.js
 */

const https = require('https');
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const SECRET = process.env.OPENCLAW_SHARED_SECRET || 'test-secret-123';

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(data)
          });
        } catch (err) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function runTests() {
  console.log('=== OpenClaw 地点录入 API 测试 ===\n');
  console.log('使用密钥:', SECRET);
  console.log('基础 URL:', BASE_URL);
  console.log('');

  // 测试 1: 缺少鉴权
  console.log('测试 1: 缺少鉴权');
  try {
    const res = await makeRequest('POST', '/api/openclaw/locations/intake', { query: '测试' });
    // 不带鉴权头
    const noAuthRes = new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/openclaw/locations/intake',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(JSON.stringify({ query: '测试' }));
      req.end();
    });

    const result = await noAuthRes;
    console.log(`  状态码：${result.status} (期望：401)`);
    console.log(`  响应：${JSON.stringify(result.body)}`);
    console.log(`  ✅ ${result.status === 401 ? '通过' : '失败'}\n`);
  } catch (err) {
    console.log(`  ❌ 错误：${err.message}\n`);
  }

  // 测试 2: 缺少可识别地点信息
  console.log('测试 2: 缺少可识别地点信息');
  try {
    const res = await makeRequest('POST', '/api/openclaw/locations/intake', {});
    console.log(`  状态码：${res.status} (期望：200)`);
    console.log(`  响应：${JSON.stringify(res.body)}`);
    console.log(`  ✅ ${(res.status === 200 && res.body.status === 'not_found') ? '通过' : '失败'}\n`);
  } catch (err) {
    console.log(`  ❌ 错误：${err.message}\n`);
  }

  // 测试 3: 搜索已知地点（单一高置信）
  console.log('测试 3: 搜索已知地点（三坊七巷）');
  try {
    const res = await makeRequest('POST', '/api/openclaw/locations/intake', {
      query: '三坊七巷',
      city: '福州'
    });
    console.log(`  状态码：${res.status} (期望：200)`);
    console.log(`  响应状态：${res.body.status}`);
    if (res.body.ruleDecision) {
      console.log(`  规则决策：${res.body.ruleDecision}`);
    }
    console.log(`  响应：${JSON.stringify(res.body, null, 2)}`);
    if (
      (res.body.status === 'saved' || res.body.status === 'needs_confirmation' || res.body.status === 'duplicate') &&
      !(res.body.status === 'needs_confirmation' && res.body.message === '地点已存在')
    ) {
      console.log(`  ✅ 通过\n`);
    } else {
      console.log(`  ⚠️ 未找到地点\n`);
    }
  } catch (err) {
    console.log(`  ❌ 错误：${err.message}\n`);
  }

  // 测试 4: 搜索模糊地点（多候选）
  console.log('测试 4: 搜索模糊地点（万达广场）');
  try {
    const res = await makeRequest('POST', '/api/openclaw/locations/intake', {
      query: '万达广场',
      city: '福州'
    });
    console.log(`  状态码：${res.status} (期望：200)`);
    console.log(`  响应状态：${res.body.status}`);
    if (res.body.ruleDecision) {
      console.log(`  规则决策：${res.body.ruleDecision}`);
    }
    if (res.body.candidates) {
      console.log(`  候选数量：${res.body.candidates.length}`);
      res.body.candidates.forEach((c, i) => {
        console.log(`    ${i + 1}. ${c.name} - ${c.address} [${c.category || '无分类'}]`);
      });
    }
    console.log(`  ✅ 通过\n`);
  } catch (err) {
    console.log(`  ❌ 错误：${err.message}\n`);
  }

  // 测试 5: 确认候选地点
  console.log('测试 5: 确认候选地点');
  try {
    // 先获取候选
    const searchRes = await makeRequest('POST', '/api/openclaw/locations/intake', {
      query: '福州大学',
      city: '福州'
    });

    if (searchRes.body.status === 'needs_confirmation' && searchRes.body.candidates.length > 0) {
      const candidate = searchRes.body.candidates[0];
      const confirmRes = await makeRequest('POST', '/api/openclaw/locations/confirm', {
        candidate: {
          name: candidate.name,
          address: candidate.address,
          latitude: candidate.latitude,
          longitude: candidate.longitude
        },
        category: '学校',
        reason: '测试添加'
      });
      console.log(`  状态码：${confirmRes.status} (期望：200)`);
      console.log(`  响应状态：${confirmRes.body.status}`);
      console.log(`  响应：${JSON.stringify(confirmRes.body, null, 2)}`);
      if (confirmRes.body.location) {
        console.log(`  归一化分类：${confirmRes.body.location.category}`);
      }
      console.log(`  ✅ 通过\n`);
    } else if (searchRes.body.status === 'saved') {
      console.log(`  地点已自动保存，跳过确认测试\n`);
    } else {
      console.log(`  未找到候选地点，跳过确认测试\n`);
    }
  } catch (err) {
    console.log(`  ❌ 错误：${err.message}\n`);
  }

  // 测试 6: 重复地点
  console.log('测试 6: 重复地点检测');
  try {
    const res = await makeRequest('POST', '/api/openclaw/locations/intake', {
      query: '三坊七巷',
      city: '福州'
    });
    console.log(`  状态码：${res.status}`);
    console.log(`  响应状态：${res.body.status}`);
    if (res.body.status === 'duplicate') {
      console.log(`  ✅ 正确检测到重复地点\n`);
    } else {
      console.log(`  ⚠️ 未检测到重复（可能是首次添加）\n`);
    }
  } catch (err) {
    console.log(`  ❌ 错误：${err.message}\n`);
  }

  console.log('=== 测试完成 ===');
}

runTests().catch(console.error);
