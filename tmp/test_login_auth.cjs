const API_URL = 'http://localhost:8081/api';
const PASSWORD = 'admin'; // You may need the REAL password here

async function test() {
  try {
    console.log('--- Step 1: Login ---');
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
      console.error('Login Failed!', loginData);
      return;
    }
    const token = loginData.token;
    console.log('Login Success! Token received:', token.substring(0, 20) + '...');

    console.log('\n--- Step 2: Use Token for status ---');
    const statusRes = await fetch(`${API_URL}/trade/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const statusData = await statusRes.json();
    if (!statusRes.ok) {
      console.error('Status Failed!', statusData);
    } else {
      console.log('Status Success! Data:', statusData);
    }

  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
