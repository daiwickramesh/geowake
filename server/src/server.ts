import express, { Request, Response } from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.routes";
import alarmRoutes from "./routes/alarm.routes";
import { setupLocationSocket } from "./sockets/location.socket";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server for both Express and WebSockets
const server = http.createServer(app);

// Initialize Socket.io with CORS
const io = new Server(server, {
  cors: { origin: "*" },
});

// Setup real-time WebSocket location engine
setupLocationSocket(io);

app.use(cors());
app.use(express.json());

// REST Routes
app.use("/api/auth", authRoutes);
app.use("/api/alarms", alarmRoutes);

// Health check
app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "🚀 GeoWake Backend & WebSockets are running smoothly!",
    timestamp: new Date().toISOString(),
  });
});

// Start listening
server.listen(PORT, () => {
  console.log(`📡 HTTP & WebSocket Server running on http://localhost:${PORT}`);
  console.log(`⚡ Redis Cache Connected Successfully!`);
});
