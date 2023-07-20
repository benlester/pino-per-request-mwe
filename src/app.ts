import Koa from "koa";
import Router from "koa-router";
import bodyParser from "koa-bodyparser";
import koaHelmet from "koa-helmet";
import koaCompress from "koa-compress";
import cors from "@koa/cors";

import pino from "pino";

import dotenv from "dotenv";
dotenv.config();

const router = new Router();

const localLogger = pino({
  mixin() {
    return { appName: "TEST PINO" };
  },
  base: undefined,
  level: "silly",
  useOnlyCustomLevels: true,
  customLevels: {
    error: 60,
    warn: 40,
    info: 30,
    http: 25,
    verbose: 21,
    debug: 20,
    silly: 10
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: {
    targets: [{ target: "pino-pretty", level: "silly", options: { destination: 1, colorize: true } }]
  }
});

export type Logger = typeof localLogger;

interface CustomContext extends Koa.Context {
  logger?: Logger;
}

router.get("/", async ctx => {
  function createDummyTimeout(time, shouldThrowError = false) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (shouldThrowError) {
          reject(new Error(`Rejected after ${time} milliseconds`));
        } else {
          resolve(`Resolved after ${time} milliseconds`);
        }
      }, time);
    });
  }

  // Three dummy timeout promises
  const promise1 = createDummyTimeout(2000);
  const promise2 = createDummyTimeout(1500);
  const promise3 = createDummyTimeout(3000, true); // This promise will throw an error after 3 seconds

  await Promise.all([promise1, promise2, promise3]);
  //.then(results => {
  //console.log("All promises resolved:");
  //console.log(results);
  //})
  //.catch(error => {
  //console.error("An error occurred:", error.message);
  //});

  ctx.logger.verbose("GET endpoint hit");
  ctx.body = "Simple pino logger example";
});

router.post("/", ctx => {
  ctx.logger.verbose("POST endpoint hit");
  ctx.body = "Simple pino logger POST response";
});

async function startServer() {
  const app = new Koa<CustomContext>();

  ////////////////////////////////////////////////////////////////
  // middleware
  app.use(bodyParser({ jsonLimit: "50mb" }));
  app.use(koaHelmet());
  app.use(koaCompress());
  app.use(cors({ origin: "*", credentials: true }));

  app.on("error", async (err, ctx) => {
    ctx.logger.error(err);
  });

  // elapsed time middleware
  app.use(async (ctx, next) => {
    ctx.started = Date.now();
    await next();
  });

  // initialise logger middleware
  app.use(async (ctx, next) => {
    const logFilename = `${process.env.LOG_BASE_DIR}${new Date().toISOString().split("T")[0]}/TEST_LOG.log`;

    const fileTransport = pino.transport({
      target: "pino/file",
      options: { destination: ctx.logFilename, mkdir: true }
    });

    const logger = pino(
      {
        mixin() {
          return { appName: "TEST PINO (PER REQUEST)" };
        },
        base: undefined,
        level: "silly",
        useOnlyCustomLevels: true,
        customLevels: {
          error: 60,
          warn: 40,
          info: 30,
          http: 25,
          verbose: 21,
          debug: 20,
          silly: 10
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        transport: {
          targets: [
            { target: "pino/file", level: "silly", options: { destination: logFilename, mkdir: true } },
            { target: "pino-pretty", level: "silly", options: { destination: 1, colorize: true } }
          ]
        }
      },
      fileTransport
    );

    ctx.logger = logger;
    ctx.logger.silly("Logger initialised");
    await next();

    // clean up at end of request
    if (fileTransport) {
      await fileTransport.end();
    }
  });

  app.use(async (ctx, next) => {
    await next();
    const elapsed = Date.now() - ctx.started + "ms";
    ctx.logger.debug(`Response took ${elapsed}`);
    ctx.set("X-Response-Time", elapsed);
  });

  app.use(router.routes());

  app.listen({ port: 7777 }, () => {
    localLogger.info(`Process ID: ${process.pid}`);
    localLogger.info("HTTP server ready at http://localhost:7777");
  });
}

startServer();
