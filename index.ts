import { Telegraf, Context as TelegrafContext } from 'telegraf';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph, Annotation, START, END, messagesStateReducer, MemorySaver } from "@langchain/langgraph";
import { SystemMessage, HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SYSTEM_PROMPT, PROACTIVE_PROMPT } from "./src/prompts.ts";
import Bree from 'bree';
import dotenv from 'dotenv';
// import { getConversation, saveToHistory, clearHistory } from './src/memory.ts';
import { initDB, scheduleDB, userDB } from './src/db.ts';
import { googleCalendarService } from './src/google-calendar.ts';
import cron from "node-cron";
import { persistentGraph } from './src/graph.ts';

dotenv.config();

initDB();

const bot: Telegraf<TelegrafContext> = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);

// Initialize Bree scheduler
// const bree = new Bree({
//   jobs: [
//     {
//       name: 'check-schedules',
//       interval: '1m',
//       path: './jobs/check-schedules.js'
//     }
//   ]
// });

const MAX_MESSAGE_LENGTH = 4096;

function sanitizeHtmlForTelegram(text: string): string {
  return text
    // Convert line breaks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    // Convert lists to plain text with bullets/numbers
    .replace(/<\/li>\s*<li>/gi, '\n• ')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?ul>/gi, '')
    .replace(/<\/?ol>/gi, '')
    // Remove unsupported block elements
    .replace(/<\/?(div|p|span|h[1-6])>/gi, '')
    // Convert headers to bold
    .replace(/<h[1-6]>/gi, '<b>')
    .replace(/<\/h[1-6]>/gi, '</b>\n');
}

async function runProactiveSuggestion(chatId: string, userId: string): Promise<void> {
  const result = await persistentGraph.invoke(
    {
      messages: [new HumanMessage(PROACTIVE_PROMPT)],
      userId,
    },
    { configurable: { thread_id: userId } }
  );

  const finalMessage = [...result.messages]
    .reverse()
    .find(m => m._getType() === "ai" && typeof m.content === "string");

  const text = sanitizeHtmlForTelegram(finalMessage?.content as string ?? "Something went wrong");

  if (text.length <= MAX_MESSAGE_LENGTH) {
    await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } else {
    const chunks = text.match(new RegExp(`.{1,${MAX_MESSAGE_LENGTH}}`, "gs")) || [];
    for (const chunk of chunks) {
      await bot.telegram.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
    }
  }
  console.log(result.messages.map(m => ({ type: m._getType(), content: JSON.stringify(m.content) })));
}

cron.schedule("0 * * * *", async () => {
  console.log("Running cron job...");

  // Get all users from database
  const users = userDB.getAll();

  if (users.length === 0) {
    console.warn("No users in database, skipping proactive suggestion");
    return;
  }

  // Send proactive suggestions to all users
  for (const user of users) {
    try {
      await runProactiveSuggestion(user.chatId, user.userId);
      console.log(`✅ Sent proactive suggestion to user ${user.userId}`);
    } catch (error) {
      console.error(`❌ Proactive suggestion error for user ${user.userId}:`, error);
    }
  }
});


bot.command('start', (ctx: TelegrafContext) => {
  const userId = ctx.from?.id?.toString();
  const chatId = ctx.chat?.id?.toString();

  if (userId && chatId) {
    userDB.upsert(userId, chatId);
  }

  ctx.reply('👋 Hi! I\'m your AI assistant.\n\nI can:\n• Have conversations with memory\n• Schedule tasks (e.g., "Every Monday at 9am give me weekend ideas")\n• Set reminders (e.g., "Remind me every Sunday at 8pm to submit homework")\n• Access your Google Calendar (use /calendar to connect)\n\nCommands:\n/calendar - Connect Google Calendar\n/suggest - Get proactive suggestions (same as hourly cron)\n/schedules - View your scheduled tasks\n/delete <ID> - Delete a schedule\n/reset - Clear conversation history');
});

bot.command('suggest', async (ctx: TelegrafContext) => {
  const chatId = ctx.chat?.id?.toString();
  const userId = ctx.from?.id?.toString();
  if (!chatId || !userId) {
    await ctx.reply('Could not identify chat or user');
    return;
  }

  // Save chat_id for this user
  userDB.upsert(userId, chatId);

  await ctx.sendChatAction('typing');
  try {
    await runProactiveSuggestion(chatId, userId);
  } catch (error) {
    console.error('Suggest error:', error);
    await ctx.reply('Sorry, something went wrong. Please try again.');
  }
});

bot.command('calendar', async (ctx: TelegrafContext) => {
  const userId = ctx.from?.id?.toString();
  const chatId = ctx.chat?.id?.toString();

  if (!userId) {
    await ctx.reply('Could not identify user');
    return;
  }

  if (userId && chatId) {
    userDB.upsert(userId, chatId);
  }

  const isAuthorized = await googleCalendarService.isAuthorized(userId);

  if (isAuthorized) {
    await ctx.reply('✅ Your Google Calendar is already connected!');
  } else {
    const authUrl = googleCalendarService.getAuthUrl(userId);
    await ctx.reply(
      `🔐 To connect your Google Calendar, please authorize the app:\n\n${authUrl}\n\nAfter authorizing, you'll be able to:\n• View your calendar events\n• Create new events\n• Search events\n• Check free/busy times`
    );
  }
});

bot.command('reset', (ctx: TelegrafContext) => {
  ctx.reply('🔄 Conversation history cleared!');
});

bot.on('text', async (ctx: TelegrafContext) => {
  try {
    const userMessage: string = ctx.message.text || "";
    const userId: string = ctx.from.id.toString();
    const chatId: string = ctx.chat.id.toString();

    // Save chat_id for this user
    userDB.upsert(userId, chatId);

    // const history = getConversation(userId);

    await ctx.sendChatAction('typing');

    const result = await persistentGraph.invoke(
      {
        messages: [new HumanMessage(userMessage)],
        userId: userId
      },
      { configurable: { thread_id: userId } }
    );

    const finalMessage = [...result.messages]
      .reverse()
      .find(m => m._getType() === "ai" && typeof m.content === "string");

    const MAX_LENGTH = 4096;
    const text = sanitizeHtmlForTelegram(finalMessage?.content as string ?? "Something went wrong");

    if (text.length <= MAX_LENGTH) {
      await ctx.replyWithHTML(text);
    } else {
      const chunks = text.match(/.{1,4096}/gs) || [];
      for (const chunk of chunks) {
        await ctx.replyWithHTML(chunk);
      }
    }
    console.log(result.messages.map(m => ({ type: m._getType(), content: JSON.stringify(m.content) })));
    return;

  } catch (error) {
    console.error('Error:', error);
    await ctx.reply('Sorry, something went wrong. Please try again.');
  }
});

bot.on("photo", async (ctx) => {
  const photo = ctx.message.photo.at(-1);
  if (!photo) {
    await ctx.reply('No photo found');
    return;
  }

  const file = await ctx.telegram.getFile(photo.file_id);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  const userId = ctx.from.id.toString();
  const chatId = ctx.chat.id.toString();

  // Save chat_id for this user
  userDB.upsert(userId, chatId);

  // download and convert to base64
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mimeType = file.file_path?.endsWith(".png") ? "image/png" : "image/jpeg";

  const userMessage = ctx.message.caption ?? "What's in this image?";
  const result = await persistentGraph.invoke(
    {
      messages: [
        new HumanMessage({
          content: [
            {
              type: "image_url",
              image_url: `data:${mimeType};base64,${base64}`,
            },
            { type: "text", text: userMessage },
          ],
        }),
      ],
      userId: userId
    },
    { configurable: { thread_id: userId } }
  );

  const last = result.messages.at(-1);
  if (!last) {
    await ctx.reply('No response generated');
    return;
  }

  const content = typeof last.content === "string"
    ? last.content
    : Array.isArray(last.content)
      ? last.content.map((b: any) => b.text ?? "").join("")
      : "";

  await ctx.replyWithHTML(sanitizeHtmlForTelegram(content));
});

// Start bot and scheduler
async function start(): Promise<void> {
  // Start OAuth callback server FIRST (before bot launch)
  const port = parseInt(process.env.OAUTH_PORT || '3000');
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // OAuth callback route
      if (url.pathname === '/auth/google/callback') {
        const code = url.searchParams.get('code');
        const userId = url.searchParams.get('state'); // userId passed as state

        if (!code || !userId) {
          return new Response('Missing code or state parameter', { status: 400 });
        }

        try {
          await googleCalendarService.handleCallback(code, userId);

          // Send message to user via Telegram
          await bot.telegram.sendMessage(
            userId,
            '✅ Google Calendar connected successfully! You can now use calendar features.'
          );

          return new Response(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>✅ Authorization Successful!</h1>
                <p>You can now close this window and return to Telegram.</p>
              </body>
            </html>
          `, {
            headers: { 'Content-Type': 'text/html' }
          });
        } catch (error) {
          console.error('OAuth callback error:', error);
          return new Response('Error during authorization', { status: 500 });
        }
      }

      return new Response('Not found', { status: 404 });
    }
  });

  console.log(`📡 OAuth callback server running on port ${port}`);
  console.log(`🔗 Callback URL: ${process.env.NGROK_URL}/auth/google/callback`);

  // Now launch the bot
  // await bree.start();
  await bot.launch();
  console.log('🤖 Bot is running with scheduling...');
}

start();

process.once('SIGINT', async () => {
  // await bree.stop();
  bot.stop('SIGINT');
});

process.once('SIGTERM', async () => {
  // await bree.stop();
  bot.stop('SIGTERM');
});
