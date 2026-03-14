import 'dotenv/config';
import { getBalance } from './server/lib/binance';

async function main() {
    try {
        const bal = await getBalance();
        console.log("BAL:", bal);
    } catch (e) {
        console.error("FAIL:", e.message);
    }
}
main();
