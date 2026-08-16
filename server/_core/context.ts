import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { LocalUser } from "../db";
import { authTokenFromRequest, userFromAuthToken } from "../auth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: LocalUser | null;
  authToken: string | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const authToken = authTokenFromRequest(opts.req);
  return {
    req: opts.req,
    res: opts.res,
    user: userFromAuthToken(authToken),
    authToken,
  };
}
