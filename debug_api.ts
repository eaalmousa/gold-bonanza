import dotenv from 'dotenv';
dotenv.config({ path: './server/.env' });
import { getBalance, placeMarketOrder, placeStopMarket, placeTakeProfitMarket, setLeverage, getPositions } from './server/lib/binance.ts';

async function testOrder() {
  try {
    const symbol = 'FILUSDT';
    const side = 'SHORT';
    const entryPrice = 8.65708;
    const stopLoss = 8.83459;
    const takeProfit = 8.02130;
    
    console.log("Balance:", await getBalance());
    // await setLeverage(symbol, 10);
    // console.log("Leverage set.");
    
    // const qty = 10;
    // console.log("Placing market order qty:", qty);
    // await placeMarketOrder(symbol, side === 'LONG' ? 'BUY' : 'SELL', qty);
    // console.log("Market order placed.");
    
    // await new Promise(r => setTimeout(r, 1000));
    console.log("Fetching positions...");
    const pos = await getPositions();
    console.log(pos);
    
    // console.log("Placing SL...");
    // await placeStopMarket(symbol, side === 'LONG' ? 'SELL' : 'BUY', stopLoss);
    // console.log("SL placed.");
    
    // console.log("Placing TP...");
    // await placeTakeProfitMarket(symbol, side === 'LONG' ? 'SELL' : 'BUY', takeProfit);
    // console.log("TP placed. SUCCESS");
  } catch (err) {
    console.error("ERROR:");
    console.error(err);
  }
}
testOrder();
