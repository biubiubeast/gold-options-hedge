import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { timingSafeEqual } from "crypto";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function requireBasicAuth(app: express.Express) {
  const username = process.env.APP_USERNAME?.trim() || "admin";
  const password = process.env.APP_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "APP_PASSWORD is required in production. Set a strong password before exposing the site."
      );
    }

    console.warn("APP_PASSWORD is not set; development server has no login protection.");
    return;
  }

  app.use((req, res, next) => {
    const authorization = req.get("authorization") || "";
    const [scheme, credentials] = authorization.split(" ");

    if (scheme === "Basic" && credentials) {
      try {
        const decoded = Buffer.from(credentials, "base64").toString("utf8");
        const separatorIndex = decoded.indexOf(":");
        const suppliedUsername = decoded.slice(0, separatorIndex);
        const suppliedPassword = decoded.slice(separatorIndex + 1);

        if (
          separatorIndex >= 0 &&
          secureEqual(suppliedUsername, username) &&
          secureEqual(suppliedPassword, password)
        ) {
          next();
          return;
        }
      } catch {
        // Invalid Basic authentication payload falls through to the challenge.
      }
    }

    res.set("WWW-Authenticate", 'Basic realm="Gold Options Hedge", charset="UTF-8"');
    res.status(401).send("需要用户名和密码才能访问黄金期权仓位分析。 ");
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  requireBasicAuth(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = process.env.NODE_ENV === "production"
    ? preferredPort
    : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
