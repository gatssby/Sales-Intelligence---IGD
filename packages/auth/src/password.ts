import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  assertPasswordStrength(password);
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

export function assertPasswordStrength(password: string): void {
  if (password.length < 12 || password.length > 128) throw new Error("password_length_invalid");
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("password_complexity_invalid");
  }
}

export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(18);
  let body = "";
  for (const value of bytes) body += alphabet[value % alphabet.length];
  return `T9a-${body}`;
}
