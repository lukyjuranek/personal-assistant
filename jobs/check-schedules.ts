import { Telegraf } from "telegraf";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Database } from "bun:sqlite";
import type { ScheduleRow } from "../src/db";

const db = new Database("./data/schedules.db");
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-2.0-flash",
  temperature: 0.7,
});

async function checkSchedules(): Promise<void> {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const currentDay = now.getDay();
  const currentDate = now.getDate();
  const currentDateStr = now.toISOString().split("T")[0]!;

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

  const schedules = stmt.all(
    currentTime,
    currentDay,
    currentDate,
    currentDateStr
  ) as ScheduleRow[];

  console.log(`[${currentTime}] Checking schedules... Found ${schedules.length}`);

  for (const schedule of schedules) {
    try {
      let message: string;

      if (schedule.type === "prompt") {
        const result = await model.invoke(schedule.content);
        message = result.content as string;
      } else {
        message = schedule.content;
      }

      await bot.telegram.sendMessage(schedule.userId, message);
      console.log(`✅ Sent schedule ${schedule.id} to user ${schedule.userId}`);

      if (schedule.frequency === "once") {
        const updateStmt = db.prepare(
          "UPDATE schedules SET active = 0 WHERE id = ?"
        );
        updateStmt.run(schedule.id);
        console.log(`🗑️  Deactivated one-time schedule ${schedule.id}`);
      }
    } catch (error) {
      console.error(
        `❌ Error sending schedule ${schedule.id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

checkSchedules();
