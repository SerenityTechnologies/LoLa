import * as readline from "node:readline";
import { config } from "dotenv";
import { HumanMessage } from "@langchain/core/messages";
import { BrowserController } from "./browser/index.js";
import { createBrowserTools } from "./tools/index.js";
import { createLLM, createSystemPrompt, createGraph } from "./agent/index.js";
import { MemoryStore } from "./memory/index.js";
import { logger } from "./utils/index.js";
import { TelegramBotHandler } from "./integrations/telegram.js";

// Load environment variables from .env file
config();

/**
 * Daemon loop: read tasks forever
 * For production: replace stdin with a queue (Redis, DB table, webhook).
 */
async function runJob(
  userText: string,
  graph: Awaited<ReturnType<typeof createGraph>>,
  memoryStore: MemoryStore
) {
  logger.step("=".repeat(60));
  logger.step(`Starting new job: "${userText}"`);
  
  // Get existing conversation history
  const previousMessages = memoryStore.getMessages();
  const previousCount = previousMessages.length;
  
  if (previousCount > 0) {
    logger.debug(`Loading ${previousCount} messages from conversation history`);
  }
  
  // Add the new user message
  const userMessage = new HumanMessage(userText);
  
  // Combine previous messages with the new user message
  const initial = {
    messages: [...previousMessages, userMessage],
  };

  logger.step("Invoking agent graph...");
  const startTime = Date.now();
  
  // hard safety: step limit so it can't loop forever
  // Increased limit to allow for more exploration and investigation
  // @ts-ignore - recursionLimit may not be in types but is supported
  const result = await graph.invoke(initial, { recursionLimit: 60 });
  
  const duration = Date.now() - startTime;
  logger.step(`Graph execution completed in ${duration}ms`);

  // Save only the new messages (user input + agent response + tool calls) to memory
  // Skip the previous messages that were already in memory
  const newMessages = result.messages.slice(previousCount);
  if (newMessages.length > 0) {
    logger.debug(`Saving ${newMessages.length} new messages to memory`);
    memoryStore.addMessages(newMessages);
  }

  const finalMsg = result.messages[result.messages.length - 1];
  logger.step("=".repeat(60));
  return finalMsg?.content ?? "";
}

async function main() {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const useTelegram = !!telegramToken;

  if (useTelegram) {
    // Start Telegram bot
    const telegramBot = new TelegramBotHandler(telegramToken);
    await telegramBot.start();

    process.on("SIGINT", async () => {
      console.log("\nShutting down...");
      await telegramBot.stop();
      process.exit(0);
    });
  } else {
    // Start CLI mode
    const browserController = new BrowserController();
    const tools = createBrowserTools(browserController);
    const llm = createLLM();
    const systemPrompt = createSystemPrompt();
    const graph = createGraph(llm, tools, systemPrompt);
    const memoryStore = new MemoryStore(50); // Keep last 50 messages

    console.log("Daemon agent started. Type a task and press Enter. Ctrl+C to stop.");
    console.log("Commands: /clear - clear conversation history, /memory - show memory stats\n");
    console.log("(To use Telegram, set TELEGRAM_BOT_TOKEN in your .env file)\n");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.on("line", async (line) => {
      const task = line.trim();
      if (!task) return;

      // Handle special commands
      if (task === "/clear" || task === "/reset") {
        memoryStore.clear();
        console.log("✓ Conversation history cleared.\n");
        return;
      }

      if (task === "/memory" || task === "/stats") {
        const count = memoryStore.getMessageCount();
        console.log(`\nMemory: ${count} messages stored\n`);
        return;
      }

      try {
        const out = await runJob(task, graph, memoryStore);
        console.log("\n=== FINAL ===");
        console.log(out);
        console.log("=============\n");
      } catch (e: any) {
        console.error("Job error:", e?.message ?? e);
      }
    });

    process.on("SIGINT", async () => {
      console.log("\nShutting down...");
      await browserController.close();
      process.exit(0);
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

