import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { tradeRouter } from './routes/trade';
import './lib/autoTrader';

const app = express();

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

// Explicit Preflight Handler
app.options('/*', cors() as express.RequestHandler);

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
