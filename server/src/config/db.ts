import { PrismaClient } from "@prisma/client";

// Global singleton for Prisma Client
const prisma = new PrismaClient({
  log: ["error", "warn"],
});

export default prisma;
