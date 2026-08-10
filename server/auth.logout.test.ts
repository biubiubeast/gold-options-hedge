import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { localUser } from "./db";
import type { TrpcContext } from "./_core/context";

const context: TrpcContext = {
  user: localUser,
  req: { protocol: "http", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

describe("local authentication compatibility", () => {
  it("always exposes the local portfolio user", async () => {
    const caller = appRouter.createCaller(context);
    expect(await caller.auth.me()).toMatchObject({ openId: "local-user", role: "admin" });
    expect(await caller.auth.logout()).toEqual({ success: true });
  });
});
