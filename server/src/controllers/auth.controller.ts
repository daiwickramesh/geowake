import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../config/db";
import { registerSchema, loginSchema } from "../schemas/auth.schema";
import { AuthRequest } from "../middleware/auth.middleware";

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-fallback";

export const register = async (req: Request, res: Response) => {
  try {
    // 1. Validate request body against Zod schema
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        errors: validation.error.issues.map((err) => err.message),
      });
    }

    const { name, email, password, role } = validation.data;

    // 2. Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res
        .status(409)
        .json({ error: "User with this email already exists." });
    }

    // 3. Hash password securely
    const passwordHash = await bcrypt.hash(password, 10);

    // 4. Save user to PostgreSQL database
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: role || "USER",
      },
    });

    // 5. Issue JWT Token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.status(201).json({
      message: "User registered successfully!",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    // 1. Validate request body
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        errors: validation.error.issues.map((err) => err.message),
      });
    }

    const { email, password } = validation.data;

    // 2. Find user in database
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // 3. Compare password hash
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // 4. Issue JWT Token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      message: "Login successful!",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.status(200).json({ user });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error." });
  }
};
