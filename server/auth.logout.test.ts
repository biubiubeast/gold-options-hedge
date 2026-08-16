import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { localUser } from "./db";
import type { TrpcContext } from "./_core/context";
import { userFromAuthToken } from "./auth";

const context: TrpcContext = {
  user: localUser,
  authToken: null,
  req: { protocol: "http", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

describe("application authentication", () => {
  it("exposes the authenticated administrator", async () => {
    const caller = appRouter.createCaller(context);
    expect(await caller.auth.me()).toMatchObject({ openId: "xauadmin", role: "admin" });
    expect(await caller.auth.logout()).toEqual({ success: true });
  });

  it("creates distinct admin and restricted-user sessions and revokes logout tokens", async () => {
    process.env.APP_USERNAME = "xauadmin";
    process.env.APP_PASSWORD = "test-admin-secret";
    process.env.VIEWER_USERNAME = "xauwhales";
    process.env.VIEWER_PASSWORD = "test-viewer-secret";
    const publicCaller = appRouter.createCaller({ ...context, user: null, authToken: null });
    const admin = await publicCaller.auth.login({ username: "xauadmin", password: "test-admin-secret" });
    const viewer = await publicCaller.auth.login({ username: "xauwhales", password: "test-viewer-secret" });
    expect(admin.user.role).toBe("admin");
    expect(viewer.user).toMatchObject({ openId: "xauwhales", role: "user" });
    expect(userFromAuthToken(viewer.token)?.role).toBe("user");

    const viewerCaller = appRouter.createCaller({ ...context, user: viewer.user, authToken: viewer.token });
    expect(await viewerCaller.auth.logout()).toEqual({ success: true });
    expect(userFromAuthToken(viewer.token)).toBeNull();
    await expect(publicCaller.auth.login({ username: "xauwhales", password: "wrong-password" })).rejects.toThrow("用户名或密码错误");
  });
});
