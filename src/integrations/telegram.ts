import TelegramBot from "node-telegram-bot-api";
import { HumanMessage } from "@langchain/core/messages";
import { BrowserController } from "../browser/index.js";
import { createBrowserTools } from "../tools/index.js";
import { createLLM, createSystemPrompt, createGraph } from "../agent/index.js";
import { MemoryStore } from "../memory/index.js";
import { logger } from "../utils/index.js";
import type { StateGraph } from "@langchain/langgraph";

/**
 * Telegram Bot Integration
 * Handles Telegram messages and routes them to the agent
 */

interface UserSession {
  memoryStore: MemoryStore;
  graph: Awaited<ReturnType<typeof createGraph>>;
}

export class TelegramBotHandler {
  private bot: TelegramBot;
  private sessions: Map<number, UserSession> = new Map();
  private browserController: BrowserController;
  private tools: ReturnType<typeof createBrowserTools>;
  private llm: ReturnType<typeof createLLM>;
  private systemPrompt: ReturnType<typeof createSystemPrompt>;

  constructor(token: string) {
    this.bot = new TelegramBot(token, { polling: true });
    this.browserController = new BrowserController();
    this.tools = createBrowserTools(this.browserController);
    this.llm = createLLM();
    this.systemPrompt = createSystemPrompt();

    this.setupHandlers();
  }

  private getOrCreateSession(userId: number): UserSession {
    if (!this.sessions.has(userId)) {
      const graph = createGraph(this.llm, this.tools, this.systemPrompt);
      const memoryStore = new MemoryStore(50);
      this.sessions.set(userId, { memoryStore, graph });
      logger.info(`Created new session for user ${userId}`);
    }
    return this.sessions.get(userId)!;
  }

  private async runJob(
    userText: string,
    session: UserSession,
    chatId: number
  ): Promise<string> {
    const { graph, memoryStore } = session;

    logger.step(`[Telegram ${chatId}] Starting job: "${userText}"`);

    // Get existing conversation history
    const previousMessages = memoryStore.getMessages();
    const previousCount = previousMessages.length;

    // Add the new user message
    const userMessage = new HumanMessage(userText);

    // Combine previous messages with the new user message
    const initial = {
      messages: [...previousMessages, userMessage],
    };

    const startTime = Date.now();
    // @ts-ignore - recursionLimit may not be in types but is supported
    // Increased limit to allow for more exploration and investigation
    const result = await graph.invoke(initial, { recursionLimit: 60 });
    const duration = Date.now() - startTime;

    logger.step(`[Telegram ${chatId}] Graph execution completed in ${duration}ms`);

    // Save only the new messages
    const newMessages = result.messages.slice(previousCount);
    if (newMessages.length > 0) {
      memoryStore.addMessages(newMessages);
    }

    const finalMsg = result.messages[result.messages.length - 1];
    return finalMsg?.content ?? "";
  }

  private setupHandlers() {
    // Start command
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const welcome = `🤖 *LoLa Agent Bot*\n\n` +
        `I'm a web-capable agent that can browse the internet and interact with websites.\n\n` +
        `*Commands:*\n` +
        `/start - Show this message\n` +
        `/clear - Clear conversation history\n` +
        `/memory - Show memory stats\n` +
        `/help - Show help\n\n` +
        `Just send me a task and I'll do it!`;
      
      await this.bot.sendMessage(chatId, welcome, { parse_mode: "Markdown" });
    });

    // Help command
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const help = `*Available Commands:*\n\n` +
        `/start - Welcome message\n` +
        `/clear - Clear your conversation history\n` +
        `/memory - Show how many messages are stored\n` +
        `/help - Show this help\n\n` +
        `*Examples:*\n` +
        `• "Go to example.com and find the contact page"\n` +
        `• "Search for TypeScript on Google"\n` +
        `• "Take a screenshot of the current page"`;
      
      await this.bot.sendMessage(chatId, help, { parse_mode: "Markdown" });
    });

    // Clear command
    this.bot.onText(/\/clear|\/reset/, async (msg) => {
      const chatId = msg.chat.id;
      const session = this.getOrCreateSession(chatId);
      session.memoryStore.clear();
      await this.bot.sendMessage(chatId, "✓ Conversation history cleared.");
    });

    // Memory command
    this.bot.onText(/\/memory|\/stats/, async (msg) => {
      const chatId = msg.chat.id;
      const session = this.getOrCreateSession(chatId);
      const count = session.memoryStore.getMessageCount();
      await this.bot.sendMessage(chatId, `Memory: ${count} messages stored`);
    });

    // Handle all other messages
    this.bot.on("message", async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;

      // Ignore commands (already handled above)
      if (text?.startsWith("/")) {
        return;
      }

      if (!text || text.trim().length === 0) {
        await this.bot.sendMessage(chatId, "Please send me a text message with your task.");
        return;
      }

      // Show typing indicator
      await this.bot.sendChatAction(chatId, "typing");

      try {
        const session = this.getOrCreateSession(chatId);
        const response = await this.runJob(text, session, chatId);

        // Telegram has a 4096 character limit, so split long messages
        if (response.length > 4096) {
          const chunks = response.match(/.{1,4000}/g) || [];
          for (let i = 0; i < chunks.length; i++) {
            await this.bot.sendMessage(
              chatId,
              chunks[i] + (i < chunks.length - 1 ? "\n\n_(continued...)_" : ""),
              { parse_mode: "Markdown" }
            );
          }
        } else {
          await this.bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
        }
      } catch (e: any) {
        logger.error(`[Telegram ${chatId}] Error: ${e?.message ?? e}`);
        await this.bot.sendMessage(
          chatId,
          `❌ Error: ${e?.message ?? "An error occurred. Please try again."}`
        );
      }
    });

    // Error handling
    this.bot.on("polling_error", (error) => {
      logger.error(`Telegram polling error: ${error.message}`);
    });

    logger.info("Telegram bot handlers set up");
  }

  async start() {
    const me = await this.bot.getMe();
    logger.info(`Telegram bot started: @${me.username}`);
    console.log(`\n🤖 Telegram bot is running: @${me.username}`);
    console.log("You can now chat with the agent on Telegram!\n");
  }

  async stop() {
    await this.browserController.close();
    this.bot.stopPolling();
    logger.info("Telegram bot stopped");
  }
}

