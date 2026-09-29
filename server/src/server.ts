import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import alarmRoutes from "./routes/alarm.routes";
import aiRoutes from "./routes/ai.routes";
import favoriteRoutes from "./routes/favorite.routes";
import { setupLocationSocket } from "./sockets/location.socket";

const app = express();
app.disable("x-powered-by");
// Render (and most PaaS load balancers) terminate TLS in front of the service.
app.set("trust proxy", 1);

const corsOptions: cors.CorsOptions = {
  origin: env.corsOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
};

/**
 * `cors()` answers preflight OPTIONS requests itself and terminates them with
 * 204, so Express 5 needs no wildcard route here. (Express 5 rejects the old
 * `app.options("*")` pattern outright, which prevented the server booting.)
 */
app.use(cors(corsOptions));

app.use(express.json({ limit: "64kb" }));

// Create HTTP Server for Express & WebSockets
const server = http.createServer(app);

// 📡 Initialize Socket.io with the same CORS policy; per-connection auth is
// applied by `setupLocationSocket`.
const io = new Server(server, { cors: corsOptions });

setupLocationSocket(io);

// 🛣️ Routes
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "🚀 GeoWake Backend is running smoothly on cloud!",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/alarms", alarmRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/favorites", favoriteRoutes);

// Unknown API route -> consistent JSON 404 instead of Express' HTML page.
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found." });
});

// Central error handler: never leak stack traces or driver messages.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err && typeof err === "object" && "type" in err && err.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON." });
    return;
  }
  if (err && typeof err === "object" && "type" in err && err.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  console.error("Unhandled request error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// 🚀 Bind strictly to 0.0.0.0 for Render Cloud Load Balancers
server.listen(env.port, "0.0.0.0", () => {
  console.log(`📡 GeoWake server listening on 0.0.0.0:${env.port} (${env.nodeEnv})`);
  console.log(`🔐 JWT + Google verification active`);
});

const shutdown = (signal: string) => {
  console.log(`\n${signal} received, shutting down.`);
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
