import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const LOGIN_PASSWORD_HASH = process.env.LOGIN_PASSWORD_HASH || '';

export function requireAuth(req: any, res: any, next: any) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

authRouter.post('/login', async (req: any, res: any) => {
  console.log(`[Auth] Login attempt received. Body keys: ${Object.keys(req.body || {})}`);
  const { password } = req.body;
  
  if (!LOGIN_PASSWORD_HASH) {
    if (password === 'admin') {
      const token = jwt.sign({ authorized: true }, JWT_SECRET, { expiresIn: '24h' });
      return res.json({ token });
    }
    return res.status(401).json({ error: 'Invalid password' });
  }

  const match = await bcrypt.compare(password, LOGIN_PASSWORD_HASH);
  if (match) {
    const token = jwt.sign({ authorized: true }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token });
  }
  
  res.status(401).json({ error: 'Invalid password' });
});
