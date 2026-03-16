import { fetchKlines } from '../src/services/binanceApi';
import { detectMarketRegime } from '../src/engines/regimeFilter';

async function run() {
  console.log('Fetching BTCUSDT 1h and 4h...');
  const btc1h = await fetchKlines('BTCUSDT', '1h', 220);
  const btc4h = await fetchKlines('BTCUSDT', '4h', 100);
  const detection = detectMarketRegime(btc1h, btc4h);
  console.log(detection);
}
run();
