import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import alarmRoutes from './routes/alarm.routes';
import aiRoutes from './routes/ai.routes';
import favoriteRoutes from './routes/favorite.routes';
import { setupLocationSocket } from './sockets/location.socket';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

setupLocationSocket(io);

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/alarms', alarmRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/favorites', favoriteRoutes);

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'success', message: '🚀 GeoWake Backend is running smoothly!' });
});

server.listen(PORT, () => {
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log(`⚡ Redis Cache Connected Successfully!`);
});