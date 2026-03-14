import 'dotenv/config';
import { getBalance } from './server/lib/binance.ts';

async function verify() {
  try {
    console.log('--- BINANCE CONNECTION VERIFICATION ---');
    const balance = await getBalance();
    console.log(`✅ SUCCESS! Connection established.`);
    console.log(`Current Testnet Balance: $${balance.toFixed(2)} USDT`);
    console.log('----------------------------------------');
  } catch (err) {
    console.error('❌ CONNECTION FAILED:');
    console.error(err.message);
  }
}

verify();
