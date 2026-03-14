const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));
  page.on('requestfailed', request => console.log('REQ FAIL:', request.url(), request.failure().errorText));

  console.log('Navigating...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  
  console.log('Done, waiting...');
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
