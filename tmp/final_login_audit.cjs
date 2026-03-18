const API_URL = 'http://localhost:8085/api';
const PASSWORD = 'admin'; // Needs to be the right password if LOGIN_PASSWORD_HASH exists

async function test() {
  const tokenHeader = (t) => t ? { 'Authorization': `Bearer ${t}` } : {};

  console.log('--- AUDIT: LOGIN ---');
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  });
  const loginText = await loginRes.text();
  console.log(`Login Status: ${loginRes.status}`);
  if (loginRes.status !== 200) {
    console.error(`Login Failed: ${loginText}`);
    return;
  }
  const token = JSON.parse(loginText).token;
  console.log('✅ Token received.');

  console.log('\n--- AUDIT: STATUS ---');
  const statusRes = await fetch(`${API_URL}/trade/status`, {
    headers: { ...tokenHeader(token), 'Content-Type': 'application/json' }
  });
  const statusText = await statusRes.text();
  console.log(`Status Check: ${statusRes.status}`);
  if (statusText.includes('<!DOCTYPE html>')) {
    console.error('❌ RECEIVED HTML! Error details follow:');
    // Extract title or body from HTML
    const title = statusText.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const body = statusText.match(/<body>([\s\S]*?)<\/body>/i)?.[1];
    console.error(`HTML Title: ${title}`);
    console.error(`HTML Body snippet: ${body?.trim().substring(0, 100)}`);
  } else {
    console.log('✅ Response is JSON (presumably):', statusText);
  }
}

test();
