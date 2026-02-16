import { Telegraf } from 'telegraf';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import dotenv from 'dotenv';
import { Database } from 'bun:sqlite';

dotenv.config();

const db = new Database('./data/schedules.db');
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
  temperature: 0.7
});

async function checkSchedules() {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const currentDay = now.getDay(); // 0-6
  const currentDate = now.getDate(); // 1-31
  const currentDateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Find schedules that should run now
  const stmt = db.prepare(`
    SELECT * FROM schedules 
    WHERE active = 1 
    AND time = ?
    AND (
      frequency = 'daily'
      OR (frequency = 'weekly' AND dayOfWeek = ?)
      OR (frequency = 'monthly' AND dayOfMonth = ?)
      OR (frequency = 'once' AND scheduledDate = ?)
    )
  `);
  
  const schedules = stmt.all(currentTime, currentDay, currentDate, currentDateStr);
  
  console.log(`[${currentTime}] Checking schedules... Found ${schedules.length}`);
  
  for (const schedule of schedules) {
    try {
      let message;
      
      if (schedule.type === 'prompt') {
        // Generate content using AI
        const result = await model.invoke(schedule.content);
        message = result.content;
      } else {
        // Use static reminder
        message = schedule.content;
      }
      
      // Send to user
      await bot.telegram.sendMessage(schedule.userId, message);
      console.log(`✅ Sent schedule ${schedule.id} to user ${schedule.userId}`);
      
      // If it's a one-time schedule, mark it as inactive
      if (schedule.frequency === 'once') {
        const updateStmt = db.prepare('UPDATE schedules SET active = 0 WHERE id = ?');
        updateStmt.run(schedule.id);
        console.log(`🗑️  Deactivated one-time schedule ${schedule.id}`);
      }
      
    } catch (error) {
      console.error(`❌ Error sending schedule ${schedule.id}:`, error.message);
    }
  }
}

checkSchedules();
