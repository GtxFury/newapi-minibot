import dotenv from "dotenv";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { startMiniAppServer } from "./miniappServer.js";
import { NewApiClient } from "./newapiClient.js";
import { UserTokenStore } from "./store.js";

dotenv.config();

async function main() {
  const config = loadConfig();
  const store = new UserTokenStore(config.tokenStorePath);
  await store.load();

  const apiClient = new NewApiClient(config.baseUrl);
  const miniApp = await startMiniAppServer({ config, store, apiClient });
  const bot = createBot({ config, store, apiClient });

  await bot.launch();
  console.log(`[bil-bot] 已启动，NewAPI base URL: ${config.baseUrl}`);
  if (miniApp) {
    console.log(`[bil-bot] Mini App 已启动: ${miniApp.localUrl}`);
    if (config.miniAppUrl) {
      console.log(`[bil-bot] Mini App 对外地址: ${config.miniAppUrl}`);
    }
  }

  const stop = async (signal) => {
    console.log(`[bil-bot] 收到 ${signal}，正在退出...`);
    bot.stop(signal);
    if (miniApp?.close) {
      await miniApp.close();
    }
  };

  process.once("SIGINT", () => {
    stop("SIGINT").catch((error) => {
      console.error("[bil-bot] 退出异常:", error);
    });
  });
  process.once("SIGTERM", () => {
    stop("SIGTERM").catch((error) => {
      console.error("[bil-bot] 退出异常:", error);
    });
  });
}

main().catch((error) => {
  console.error("[bil-bot] 启动失败:", error);
  process.exit(1);
});
