import "reflect-metadata";
import { createApp } from "./app";
import { AppDataSource } from "./data-source";
import { log } from "./lib/logger";

const port = Number(process.env.PORT ?? 4000);

AppDataSource.initialize()
  .then(() => {
    const app = createApp();
    app.listen(port, () => {
      log("info", "api.started", { port });
    });
  })
  .catch(() => {
    log("error", "api.start_failed", { errorCode: "database_unavailable", resultStatus: 500 });
    process.exit(1);
  });
