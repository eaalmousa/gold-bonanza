import http from 'http';
import jwt from 'jsonwebtoken';

const token = jwt.sign({ id: 'admin' }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '1d' });

const req = http.request('http://localhost:8085/api/trade/status', {
  headers: { 'Authorization': `Bearer ${token}` }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log(res.statusCode);
    const j = JSON.parse(body);
    console.log(JSON.stringify(j.backendEnvironment, null, 2));
  });
});
req.on('error', console.error);
req.end();
