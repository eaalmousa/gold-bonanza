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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[Server] Secured Auto-Trading Backend running on port ${PORT}`);
});
