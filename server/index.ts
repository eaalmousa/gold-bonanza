import dotenv from 'dotenv';
import path from 'path';

// FIX: Force PM2 to drop stale memory context across process.exit() restarts.
// PM2 re-injects stale environment variables natively, preventing the switcher from 
// exposing the newly written .env keys. `override: true` mass-overwrites PM2's shadow memory.
dotenv.config({ path: path.join(__dirname, '.env'), override: true });


import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { tradeRouter } from './routes/trade';
import './lib/autoTrader';
import { tradeLogs } from './lib/autoTrader';

const app = express();

// DIAGNOSTIC CHECKPOINT: Immediately on server boot
tradeLogs.unshift(`[ServerBoot] BOOT ENV READ: process.env.BINANCE_BASE_URL = ${process.env.BINANCE_BASE_URL}`);

// Production CORS: Allow only your Vercel deployment
const ALLOWED_ORIGIN = 'https://gold-bonanza-xi.vercel.app';
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Proxy Trust (for Nginx)
app.set('trust proxy', 1);

app.use(express.json());

// [GUARDRAIL] Express 5.0+ / path-to-regexp v8 strictly forbids '*' or '/*' routes.
// DO NOT revert this to app.options('*', cors()) as it will fatally crash the VPS on boot.
app.options('/{*any}', cors() as express.RequestHandler);

app.use('/api/auth', authRouter);
app.use('/api/trade', tradeRouter);

// Deployment Health Check
app.get('/api/health', (req: any, res: any) => {
  res.json({ 
    ok: true, 
    mode: process.env.NODE_ENV || 'development',
    serverAt: new Date().toISOString()
  });
});

const PORT = Number(process.env.PORT) || 8085; 
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server:GBv12] Secured Auto-Trading Backend running on port ${PORT}`);
});
