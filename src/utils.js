import { getConversation } from './memory.js';

// Detect if user wants to schedule something
export async function detectScheduleIntent(model, message, userId) {
  const history = getConversation(userId);
  const prompt = `Analyze this message and determine if the user wants to schedule a task or reminder.

Conversation history:
${history.map(m => `${m.role}: ${m.content}`).join('\n')}

Message: "${message}"

Reply ONLY with valid JSON in this exact format (no other text):
{
  "intent": "create_schedule" | "edit_schedule" | "delete_schedule" | "list_schedules" | "chat",
  
  // For create_schedule:
  "type": "prompt" or "reminder",
  "frequency": "once" | "daily" | "weekly" | "monthly",
  "dayOfWeek": 0-6 or null,
  "dayOfMonth": 1-31 or null,
  "scheduledDate": "YYYY-MM-DD" or null,
  "time": "HH:mm",
  "content": "the task or reminder text",

  // For edit_schedule:
  // Look at conversation history to find the schedule being referred to
  // "it", "that", "the reminder" etc. refer to the most recently mentioned schedule
  "scheduleId": number or null (if known from history),
  "updates": {
    "time": "HH:mm" or omit,
    "content": "text" or omit,
    "frequency": "once/daily/weekly/monthly" or omit,
    "dayOfWeek": 0-6 or omit,
    "dayOfMonth": 1-31 or omit,
    "scheduledDate": "YYYY-MM-DD" or omit,
    "type": "prompt/reminder" or omit
  },

  // For delete_schedule:
  "scheduleId": number or null,

  // For chat:
  "response": "your conversational response"
}

Time interpretation:
- "morning" = "09:00"
- "afternoon" = "14:00"  
- "evening" = "18:00"
- "night" = "20:00"

Important: Use the conversation history to understand context.
If the user says "change it to 2pm", look back in history to find what schedule they created or mentioned last.`;

  const response = await model.invoke(prompt);
  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  
  if (!jsonMatch) {
    return { isSchedule: false };
  }
  
  console.log("Prompt:" + prompt);
  console.log("Response: " + response);

  return JSON.parse(jsonMatch[0]);
}

