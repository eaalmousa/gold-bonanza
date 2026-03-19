import http from 'http';
import fs from 'fs';

async function test() {
  const fetchJSON = (url, options = {}) => new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });

  let out = '';
  const loginRes = await fetchJSON('http://127.0.0.1:8085/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin' })
  });
  const authHeader = { 'Authorization': `Bearer ${loginRes.token}`, 'Content-Type': 'application/json' };

  out += '1. TURNING OFF\n';
  await fetchJSON('http://127.0.0.1:8085/api/trade/toggle', { method: 'POST', headers: authHeader, body: JSON.stringify({ enabled: false }) });
  let st = await fetchJSON('http://127.0.0.1:8085/api/trade/status', { headers: authHeader });
  out += `Status enabled? ${st.enabled}\n`;

  out += '\n2. TURNING ON\n';
  await fetchJSON('http://127.0.0.1:8085/api/trade/toggle', { method: 'POST', headers: authHeader, body: JSON.stringify({ enabled: true }) });
  st = await fetchJSON('http://127.0.0.1:8085/api/trade/status', { headers: authHeader });
  out += `Status enabled? ${st.enabled}\n`;
  out += `Config Check: ${st.config?.riskPerTrade !== undefined ? 'Valid Config Retained' : 'Missing Config'}\n`;

  out += '\n3. WAITING FOR DEPLOYMENT/SCAN LOGS\n';
  await new Promise(r => setTimeout(r, 8000));
  st = await fetchJSON('http://127.0.0.1:8085/api/trade/status', { headers: authHeader });
  out += 'Latest Logs:\n';
  st.logs.slice(-4).forEach(log => out += ` -> ${log}\n`);

  fs.writeFileSync('proof2.txt', out, 'utf8');
}
test().catch(console.error);
