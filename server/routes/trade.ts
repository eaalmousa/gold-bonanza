import { Router } from 'express';
import { requireAuth } from './auth';
import { getPositions, getBalance, placeMarketOrder, placeStopMarket, placeTakeProfitMarket, setLeverage } from '../lib/binance';
import { isAutoTradingEnabled, toggleAutoTrade, tradeLogs, RISK_PER_TRADE, MAX_CONCURRENT_TRADES, LEVERAGE, SL_ENABLED, TP_ENABLED, TP1_ONLY, TP1_RR, TP2_RR, MIN_SCORE, BTC_GATE_ENABLED, TRAIL_TP_ENABLED, updateTraderConfig } from '../lib/autoTrader';


export const tradeRouter = Router();

tradeRouter.use(requireAuth);

tradeRouter.get('/positions', async (req, res) => {
  try {
    const positions = await getPositions();
    res.json(positions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

tradeRouter.get('/balance', async (req, res) => {
  try {
    const balance = await getBalance();
    res.json({ balance });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

tradeRouter.post('/autotrade/toggle', (req, res) => {
  const { enabled } = req.body;
  toggleAutoTrade(enabled);
  res.json({ success: true, isAutoTradingEnabled });
});

tradeRouter.get('/autotrade/status', (req, res) => {
  res.json({
    enabled: isAutoTradingEnabled,
    logs: tradeLogs
  });
});

tradeRouter.get('/autotrade/config', (req, res) => {
  res.json({
    enabled: isAutoTradingEnabled,
    riskPerTrade: RISK_PER_TRADE,
    maxConcurrent: MAX_CONCURRENT_TRADES,
    leverage: LEVERAGE,
    slEnabled: SL_ENABLED,
    tpEnabled: TP_ENABLED,
    tp1Only: TP1_ONLY,
    tp1RR: TP1_RR,
    tp2RR: TP2_RR,
    minScore: MIN_SCORE,
    btcGateEnabled: BTC_GATE_ENABLED,
    trailTpEnabled: TRAIL_TP_ENABLED
  });
});

tradeRouter.post('/autotrade/config', (req, res) => {
  const { riskPerTrade, maxConcurrent, leverage, slEnabled, tpEnabled, tp1Only, tp1RR, tp2RR, minScore, btcGateEnabled, trailTpEnabled } = req.body;
  updateTraderConfig({ riskPerTrade, maxConcurrent, leverage, slEnabled, tpEnabled, tp1Only, tp1RR, tp2RR, minScore, btcGateEnabled, trailTpEnabled });
  res.json({ success: true });
});

tradeRouter.post('/open', async (req, res) => {
  const { symbol, side, entryPrice, stopLoss, takeProfit } = req.body;
  try {
    const LEVERAGE = parseInt(process.env.LEVERAGE || '10', 10);
    const RISK_PER_TRADE = parseFloat(process.env.RISK_PER_TRADE || '0.10');
    
    const balance = await getBalance();
    const tradeSizeUSDT = Math.max(10, balance * RISK_PER_TRADE); // At least $10
    const leverageQty = tradeSizeUSDT * LEVERAGE;
    const qty = Math.max(0.001, leverageQty / entryPrice);

    await setLeverage(symbol, LEVERAGE);
    await placeMarketOrder(symbol, side === 'LONG' ? 'BUY' : 'SELL', qty);
    
    await new Promise(r => setTimeout(r, 1000));
    
    await placeStopMarket(symbol, side === 'LONG' ? 'SELL' : 'BUY', stopLoss);
    await placeTakeProfitMarket(symbol, side === 'LONG' ? 'SELL' : 'BUY', takeProfit);
    
    tradeLogs.unshift(`[${new Date().toISOString()}] [Manual] 🚀 DEPLOYED: ${symbol} ${side}`);
    
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

tradeRouter.post('/close', async (req, res) => {
  const { symbol, side, qty } = req.body;
  try {
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
    await placeMarketOrder(symbol, closeSide, qty);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
