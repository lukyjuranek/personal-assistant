import { Telegraf } from 'telegraf';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import Bree from 'bree';
import dotenv from 'dotenv';
import { initDB, scheduleDB } from './src/db.js';

dotenv.config();

// Initialize database
initDB();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
  temperature: 0.7
});

// Simple conversation history storage (without LangChain memory)
const conversations = new Map();

function getConversation(userId) {
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  return conversations.get(userId);
}

async function chatWithMemory(userId, message) {
  const history = getConversation(userId);
  
  // Add user message
  history.push({ role: 'user', content: message });
  
  // Get response
  const response = await model.invoke(history);
  
  // Add assistant response
  history.push({ role: 'assistant', content: response.content });
  
  // Keep only last 20 messages
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
  
  return response.content;
}

// Detect if user wants to schedule something
async function detectScheduleIntent(message) {
  const prompt = `Analyze this message and determine if the user wants to schedule a task or reminder.

Message: "${message}"

Reply ONLY with valid JSON in this exact format (no other text):

{
  "isSchedule": true/false,
  "type": "prompt" or "reminder" (prompt = AI generates content, reminder = static message),
  "frequency": "once" or "daily" or "weekly" or "monthly",
  "dayOfWeek": 0-6 for weekly (0=Sunday, 1=Monday, etc) or null,
  "dayOfMonth": 1-31 for monthly or null,
  "scheduledDate": "YYYY-MM-DD" for one-time tasks or null,
  "time": "HH:mm" in 24h format,
  "content": "the task description or reminder text"
}

Current date: ${new Date().toISOString().split('T')[0]}
Current time: ${new Date().toTimeString().slice(0, 5)}

Examples:
"Every Monday at 9am give me weekend ideas" -> {"isSchedule": true, "type": "prompt", "frequency": "weekly", "dayOfWeek": 1, "scheduledDate": null, "time": "09:00", "content": "Give me 5 weekend activity ideas"}
"Remind me every Sunday at 8pm to submit homework" -> {"isSchedule": true, "type": "reminder", "frequency": "weekly", "dayOfWeek": 0, "scheduledDate": null, "time": "20:00", "content": "Reminder: Submit your homework!"}
"At 4pm research top 5 things to do in Madrid" -> {"isSchedule": true, "type": "prompt", "frequency": "once", "scheduledDate": "2025-02-16", "time": "16:00", "content": "Research and give me top 5 things to do in Madrid"}
"Tomorrow at 10am remind me to call mom" -> {"isSchedule": true, "type": "reminder", "frequency": "once", "scheduledDate": "2025-02-17", "time": "10:00", "content": "Reminder: Call mom"}
"On March 15th at 2pm send me birthday gift ideas" -> {"isSchedule": true, "type": "prompt", "frequency": "once", "scheduledDate": "2025-03-15", "time": "14:00", "content": "Give me birthday gift ideas"}
"What's the weather like?" -> {"isSchedule": false}

Important: 
- For "today" use today's date
- For "tomorrow" use tomorrow's date
- For specific dates like "March 15th", convert to YYYY-MM-DD format
- For relative times like "in 2 hours", calculate the actual time
- If no date specified but says "at 4pm", assume today if time hasn't passed, otherwise tomorrow`;

  const response = await model.invoke(prompt);
  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  
  if (!jsonMatch) {
    return { isSchedule: false };
  }
  
  return JSON.parse(jsonMatch[0]);
}

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
    
    await ctx.sendChatAction('typing');
    
    // Check if user wants to schedule something
    const intent = await detectScheduleIntent(userMessage);
    
    if (intent.isSchedule) {
      // Save schedule to database
      const schedule = scheduleDB.create({
        userId: userId,
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
      
      await ctx.reply(`✅ Scheduled! I'll ${intent.type === 'prompt' ? 'generate' : 'send'} this ${freqText} at ${intent.time}:\n\n"${intent.content}"\n\nSchedule ID: ${schedule.id}\n\nUse /schedules to view all schedules.`);
      return;
    }
    
    // Regular conversation with memory
    const response = await chatWithMemory(userId, userMessage);
    await ctx.reply(response);
    
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
