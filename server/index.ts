import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { tradeRouter } from './routes/trade';
import './lib/autoTrader';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/trade', tradeRouter);

const PORT = Number(process.env.PORT) || 8085; 
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server:GBv12] Secured Auto-Trading Backend running on port ${PORT}`);
});
