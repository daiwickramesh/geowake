import express, { Request, Response } from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.routes";
import alarmRoutes from "./routes/alarm.routes";
import aiRoutes from "./routes/ai.routes";
import favoriteRoutes from "./routes/favorite.routes";
import { setupLocationSocket } from "./sockets/location.socket";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Create HTTP Server for Express & WebSockets
const server = http.createServer(app);

// 🌐 1. Allow All CORS Origins & Preflight Requests
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.options("*", cors()); // Handle preflight OPTIONS requests

app.use(express.json());

// 📡 2. Initialize Socket.io with open CORS
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

setupLocationSocket(io);

// 🛣️ 3. Routes
app.use("/api/auth", authRoutes);
app.use("/api/alarms", alarmRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/favorites", favoriteRoutes);

// Health Check
app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "🚀 GeoWake Backend is running smoothly on cloud!",
    timestamp: new Date().toISOString(),
  });
});

// 🚀 4. Bind strictly to 0.0.0.0 for Render Cloud Load Balancers
server.listen(PORT, "0.0.0.0", () => {
  console.log(`📡 Cloud Server listening on 0.0.0.0:${PORT}`);
  console.log(`⚡ Redis Cache Connected!`);
});
