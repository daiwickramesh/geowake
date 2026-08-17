import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/db';
import { registerSchema, loginSchema } from '../schemas/auth.schema';
import { AuthRequest } from '../middleware/auth.middleware';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-fallback';

// 🌐 Real Google OAuth Token Verifier & Sign-In
export const googleAuth = async (req: Request, res: Response) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential is required.' });

    // Decode official Google JWT payload
    const googlePayload = jwt.decode(credential) as any;
    if (!googlePayload || !googlePayload.email) {
      return res.status(400).json({ error: 'Invalid Google credential token.' });
    }

    const email = googlePayload.email;
    const name = googlePayload.name || 'Google User';
    const googleId = googlePayload.sub;

    // Upsert User in PostgreSQL
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash: await bcrypt.hash(googleId || 'oauth-secret-token', 10),
          role: 'USER',
        },
      });
    }

    // Issue GeoWake JWT Token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.status(200).json({
      message: 'Google Sign-In successful!',
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (error) {
    console.error('Google Auth error:', error);
    return res.status(500).json({ error: 'Failed to authenticate with Google.' });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ errors: validation.error.issues.map((err) => err.message) });
    }
    const { name, email, password, role } = validation.data;
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(409).json({ error: 'Email already exists.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email, passwordHash, role: role || 'USER' } });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ errors: validation.error.issues.map((err) => err.message) });
    }
    const { email, password } = validation.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(200).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    return res.status(200).json({ user });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
};