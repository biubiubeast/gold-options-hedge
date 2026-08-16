import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { localUser, viewerUser, type LocalUser } from "./db";

type AuthSession = {
  user: LocalUser;
  expiresAt: number;
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, AuthSession>();

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function secureEqual(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

function credentials() {
  return {
    admin: {
      username: process.env.APP_USERNAME?.trim() || "xauadmin",
      password: process.env.APP_PASSWORD || "",
      user: localUser,
    },
    viewer: {
      username: process.env.VIEWER_USERNAME?.trim() || "xauwhales",
      password: process.env.VIEWER_PASSWORD || "",
      user: viewerUser,
    },
  } as const;
}

export function assertAuthConfigured() {
  const configured = credentials();
  if (!configured.admin.password || !configured.viewer.password) {
    throw new Error("APP_PASSWORD and VIEWER_PASSWORD are required before starting the website");
  }
  if (configured.admin.username === configured.viewer.username) {
    throw new Error("APP_USERNAME and VIEWER_USERNAME must be different");
  }
}

export function createAuthSession(username: string, password: string) {
  const configured = credentials();
  const account = [configured.admin, configured.viewer].find(candidate =>
    secureEqual(username, candidate.username) && secureEqual(password, candidate.password),
  );
  if (!account || !account.password) return null;

  const token = randomBytes(32).toString("base64url");
  sessions.set(token, { user: account.user, expiresAt: Date.now() + SESSION_TTL_MS });
  return { token, user: account.user };
}

export function authTokenFromRequest(req: Request) {
  const authorization = req.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

export function userFromAuthToken(token: string | null) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.user;
}

export function revokeAuthToken(token: string | null) {
  if (token) sessions.delete(token);
}

