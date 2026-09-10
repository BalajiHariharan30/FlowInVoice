import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { requestIdMiddleware, errorHandler } from "./api/middleware/error-handler.js";

// Routes
import { authRouter } from "./api/routes/auth.routes.js";
import { poRouter } from "./api/routes/po.routes.js";
import { invoiceRouter } from "./api/routes/invoice.routes.js";
import { reviewRouter } from "./api/routes/review.routes.js";
import { customerRouter } from "./api/routes/customer.routes.js";
import { dashboardRouter } from "./api/routes/dashboard.routes.js";
import { userRouter } from "./api/routes/user.routes.js";
import { auditRouter } from "./api/routes/audit.routes.js";
import { storageRouter } from "./api/routes/storage.routes.js";
import openApiSpec from "./api/openapi.json";
import { QueueManager } from "./workers/queue.js";
import { isDbConnected } from "./repositories/base.js";

export function createApp(): Express {
  const app = express();

  // Global Security & Parsing Middleware
  app.use(helmet({ crossOriginResourcePolicy: false }));

  // Explicit CORS configuration per Vercel + production requirements
  const explicitOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://flow-in-voice.vercel.app"
  ];
  if (env.CORS_ORIGIN && env.CORS_ORIGIN !== "*") {
    env.CORS_ORIGIN.split(",").forEach((o) => {
      const trimmed = o.trim();
      if (trimmed && !explicitOrigins.includes(trimmed)) explicitOrigins.push(trimmed);
    });
  }

  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        explicitOrigins.includes(origin) ||
        /\.vercel\.app$/.test(origin) ||
        origin.includes("localhost")
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-tenant-id", "x-request-id"]
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: true, limit: "20mb" }));
  app.use(requestIdMiddleware);

  // Health check with deployment version tracking & service status
  app.get("/health", (req: Request, res: Response) => {
    const queueHealth = QueueManager.getHealthStatus();
    const dbConnected = isDbConnected();

    // If REQUIRE_REDIS is true and Redis is not connected, report 503 Unhealthy
    if (env.REQUIRE_REDIS && queueHealth.status !== "connected") {
      return res.status(503).json({
        status: "unhealthy",
        version: "1.0.5",
        services: {
          database: { status: dbConnected ? "connected" : "disconnected", provider: "mongodb" },
          redis: queueHealth
        },
        error: `Redis is unreachable (${queueHealth.lastError || "disconnected"}). REQUIRE_REDIS=true is enforced.`,
        timestamp: new Date().toISOString()
      });
    }

    const overallStatus = queueHealth.status === "connected" && dbConnected ? "healthy" : "degraded";

    res.status(200).json({
      status: overallStatus,
      version: "1.0.5",
      services: {
        database: { status: dbConnected ? "connected" : "disconnected", provider: "mongodb" },
        redis: queueHealth
      },
      providers: {
        documentAi: env.DOCUMENT_AI_PROVIDER,
        llm: env.LLM_PROVIDER,
        storage: env.STORAGE_PROVIDER,
        erp: process.env.ERP_PROVIDER || "sandbox"
      },
      timestamp: new Date().toISOString()
    });
  });


  // OpenAPI spec documentation
  app.get("/api/docs/openapi.json", (req: Request, res: Response) => {
    res.status(200).json(openApiSpec);
  });

  // Mount API Contract Routes at /api/v1
  const apiRouter = express.Router();
  apiRouter.use("/auth", authRouter);
  apiRouter.use("/pos", poRouter);
  apiRouter.use("/invoices", invoiceRouter);
  apiRouter.use("/reviews", reviewRouter);
  apiRouter.use("/customers", customerRouter);
  apiRouter.use("/dashboard", dashboardRouter);
  apiRouter.use("/users", userRouter);
  apiRouter.use("/audit", auditRouter);
  apiRouter.use("/storage", storageRouter);

  app.use(env.API_PREFIX, apiRouter);

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.originalUrl} not found`,
      details: {},
      requestId: req.requestId || ""
    });
  });

  // Centralized flat error handler
  app.use(errorHandler);

  return app;
}
