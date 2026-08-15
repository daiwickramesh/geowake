import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.routes";
import alarmRoutes from "./routes/alarm.routes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/alarms", alarmRoutes);

// Health check
app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "🚀 GeoWake Backend API is running smoothly!",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`📡 Server running on http://localhost:${PORT}`);
});
