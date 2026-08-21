import "reflect-metadata";
import { createApp } from "./app";
import { AppDataSource } from "./data-source";

const port = Number(process.env.PORT ?? 4000);

AppDataSource.initialize()
  .then(() => {
    const app = createApp();
    app.listen(port, () => {
      console.log(`Tessera API listening on :${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database connection", err);
    process.exit(1);
  });
