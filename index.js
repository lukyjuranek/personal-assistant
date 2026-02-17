import { Telegraf } from 'telegraf';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import Bree from 'bree';
import dotenv from 'dotenv';
import { detectScheduleIntent } from './src/utils.js'
import { getConversation, saveToHistory, clearHistory } from './src/memory.js';
import { initDB, scheduleDB } from './src/db.js';
dotenv.config();

initDB();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
  temperature: 0.7
});

// Simple conversation history storage (without LangChain memory)
const conversations = new Map();

// Initialize Bree scheduler
const bree = new Bree({
  jobs: [
    {
      name: 'check-schedules',
      interval: '1m',
      path: './jobs/check-schedules.js'
    }
  ]
});

bot.command('start', (ctx) => {
  ctx.reply('👋 Hi! I\'m your AI assistant.\n\nI can:\n• Have conversations with memory\n• Schedule tasks (e.g., "Every Monday at 9am give me weekend ideas")\n• Set reminders (e.g., "Remind me every Sunday at 8pm to submit homework")\n\nCommands:\n/schedules - View your scheduled tasks\n/delete <ID> - Delete a schedule\n/reset - Clear conversation history');
});

bot.command('reset', (ctx) => {
  conversations.delete(ctx.from.id.toString());
  ctx.reply('🔄 Conversation history cleared!');
});

bot.command('schedules', async (ctx) => {
  const schedules = scheduleDB.findByUser(ctx.from.id.toString());
  
  if (schedules.length === 0) {
    ctx.reply('📅 You have no scheduled tasks.');
    return;
  }
  
  let message = '📅 Your scheduled tasks:\n\n';
  schedules.forEach((s, i) => {
    let freqText;
    if (s.frequency === 'once') {
      freqText = `Once on ${s.scheduledDate}`;
    } else if (s.frequency === 'weekly') {
      freqText = `Every ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dayOfWeek]}`;
    } else if (s.frequency === 'monthly') {
      freqText = `Monthly on day ${s.dayOfMonth}`;
    } else {
      freqText = 'Daily';
    }
    
    message += `${i + 1}. [${s.type}] ${freqText} at ${s.time}\n   "${s.content}"\n   ID: ${s.id}\n\n`;
  });
  
  message += 'To delete: /delete <ID>';
  ctx.reply(message);
});

bot.command('delete', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const id = parseInt(args[1]);
  
  if (!id) {
    ctx.reply('Usage: /delete <ID>\n\nUse /schedules to see your schedule IDs.');
    return;
  }
  
  const deleted = scheduleDB.delete(id, ctx.from.id.toString());
  
  if (deleted) {
    ctx.reply('✅ Schedule deleted!');
  } else {
    ctx.reply('❌ Schedule not found or you don\'t have permission to delete it.');
  }
});

bot.on('text', async (ctx) => {
  try {
    const userMessage = ctx.message.text;
    const userId = ctx.from.id.toString();
    const history = getConversation(userId);

    await ctx.sendChatAction('typing');

    const intent = await detectScheduleIntent(model, userMessage, userId);

    if (intent.intent === 'create_schedule') {
      const schedule = scheduleDB.create({
        userId,
        type: intent.type,
        frequency: intent.frequency,
        dayOfWeek: intent.dayOfWeek,
        dayOfMonth: intent.dayOfMonth,
        scheduledDate: intent.scheduledDate,
        time: intent.time,
        content: intent.content
      });

      let freqText;
      if (intent.frequency === 'once') {
        freqText = `once on ${intent.scheduledDate}`;
      } else if (intent.frequency === 'weekly') {
        freqText = `every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][intent.dayOfWeek]}`;
      } else if (intent.frequency === 'monthly') {
        freqText = `monthly on day ${intent.dayOfMonth}`;
      } else {
        freqText = 'daily';
      }

      const reply = 
        `✅ Scheduled! I'll ${intent.type === 'prompt' ? 'generate' : 'send'} this ${freqText} at ${intent.time}:\n\n` +
        `"${intent.content}"\n\n` +
        `Schedule ID: ${schedule.id}`;

      saveToHistory(userId, userMessage, reply);

      await ctx.reply(reply);

    } else if (intent.intent === 'edit_schedule') {
      if (!intent.scheduleId) {
        await ctx.reply('❌ Which schedule? Use /schedules to see your IDs.');
        return;
      }

      const updated = scheduleDB.update(intent.scheduleId, userId, intent.updates);

      if (updated) {
        const s = scheduleDB.findById(intent.scheduleId, userId);
        let freqText;
        if (s.frequency === 'once') {
          freqText = `once on ${s.scheduledDate}`;
        } else if (s.frequency === 'weekly') {
          freqText = `every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.dayOfWeek]}`;
        } else if (s.frequency === 'monthly') {
          freqText = `monthly on day ${s.dayOfMonth}`;
        } else {
          freqText = 'daily';
        }

        const reply = 
          `✅ Updated!\n\n` +
          `Frequency: ${freqText}\n` +
          `Time: ${s.time}\n` +
          `Content: "${s.content}"`;

        saveToHistory(userId, userMessage, reply);

        await ctx.reply(reply);
      } else {
        await ctx.reply('❌ Schedule not found. Use /schedules to see your IDs.');
      }

    } else if (intent.intent === 'delete_schedule') {
      if (!intent.scheduleId) {
        await ctx.reply('❌ Which schedule? Use /schedules to see your IDs.');
        return;
      }

      const deleted = scheduleDB.delete(intent.scheduleId, userId);
      const reply = deleted
        ? `✅ Schedule #${intent.scheduleId} deleted!`
        : '❌ Schedule not found.';

      saveToHistory(userId, userMessage, reply);

      await ctx.reply(reply);

    } else if (intent.intent === 'list_schedules') {
      const schedules = scheduleDB.findByUser(userId);

      if (schedules.length === 0) {
        await ctx.reply('📅 You have no scheduled tasks.');
        return;
      }

      let message = '📅 Your scheduled tasks:\n\n';
      schedules.forEach((s, i) => {
        let freqText;
        if (s.frequency === 'once') freqText = `Once on ${s.scheduledDate}`;
        else if (s.frequency === 'weekly') freqText = `Every ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dayOfWeek]}`;
        else if (s.frequency === 'monthly') freqText = `Monthly on day ${s.dayOfMonth}`;
        else freqText = 'Daily';
        message += `${i + 1}. [${s.type}] ${freqText} at ${s.time}\n   "${s.content}"\n   ID: ${s.id}\n\n`;
      });

      saveToHistory(userId, userMessage, reply);

      await ctx.reply(message);

    } else {
      // Regular chat
      const history = getConversation(userId);
      history.push({ role: 'user', content: userMessage });
      const response = await model.invoke(history);
      history.push({ role: 'assistant', content: response.content });

      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }

      await ctx.reply(response.content);
    }

  } catch (error) {
    console.error('Error:', error);
    await ctx.reply('Sorry, something went wrong. Please try again.');
  }
});

// Start bot and scheduler
async function start() {
  await bree.start();
  await bot.launch();
  console.log('🤖 Bot is running with scheduling...');
}

start();

process.once('SIGINT', async () => {
  await bree.stop();
  bot.stop('SIGINT');
});
process.once('SIGTERM', async () => {
  await bree.stop();
  bot.stop('SIGTERM');
});
