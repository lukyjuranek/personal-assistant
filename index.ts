import { Telegraf, Context as TelegrafContext } from 'telegraf';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph, Annotation, START, END, messagesStateReducer, MemorySaver } from "@langchain/langgraph";
import { SystemMessage, HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SYSTEM_PROMPT } from "./prompts.ts";
import Bree from 'bree';
import { searchTool, getTasksTool, createTaskTool, completeTaskTool, updateTaskTool, getWeatherTool } from "./src/tools.ts"
import dotenv from 'dotenv';
import { plannerAgent, responderAgent, contextBuilder, detectScheduleIntent } from './src/agents.ts'
// import { getConversation, saveToHistory, clearHistory } from './src/memory.ts';
import { initDB, scheduleDB } from './src/db.ts';

dotenv.config();

initDB();

const bot: Telegraf<TelegrafContext> = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY as string,
  model: 'gemini-2.5-flash',
  temperature: 0.7
})
  .bindTools([searchTool, getTasksTool, createTaskTool, updateTaskTool, completeTaskTool, getWeatherTool]);


const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[], BaseMessage[]>({
    reducer: (existing: BaseMessage[], update: BaseMessage[]) => [...existing, ...update],
    default: () => [],
  }),
  summary: Annotation<string, string>({
    reducer: (_: string, update: string) => update,
    default: () => "",
  }),
});

// Type alias for convenience
type State = typeof GraphState.State;

async function chatNode(state: { messages: BaseMessage[] }): Promise<{ messages: BaseMessage[] }> {
  const response = await llm.invoke(state.messages);
  return { messages: [response] };
}

async function summarizeNode(state: { messages: BaseMessage[] }): Promise<{ summary: string }> {
  const text = state.messages.map((m) => m.content).join("\n");
  const response = await llm.invoke([
    new HumanMessage(`Summarize this conversation in one sentence:\n${text}`),
  ]);
  return { summary: response.content };
}

async function agentNode(state: any): Promise<{ messages: BaseMessage[] }> {
  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...state.messages,
  ]);
  return { messages: [response] };
}

// ToolNode automatically runs any tool_calls found in the last AI message
const toolsNode = new ToolNode([searchTool, getTasksTool, createTaskTool, updateTaskTool, completeTaskTool, getWeatherTool]);

function shouldContinue(state: State): "tools" | typeof END {
  const last = state.messages.at(-1) as AIMessage;
  if (last?.tool_calls && last.tool_calls.length > 0) return "tools";
  return END;
}

const memory = new MemorySaver();

const persistentGraph = new StateGraph(GraphState)
  .addNode("agent", agentNode)
  .addNode("tools", toolsNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .compile({
    checkpointer: memory,
    // interruptBefore: ["tools"], // pause BEFORE the "tools" node every time}); // <-- attach the checkpointer here
  });


// Each call with the same thread_id continues where it left off:
// await persistentGraph.invoke(
//   { messages: [new HumanMessage("My name is Alice")] },
//   { configurable: { thread_id: "session-1" } }
// );
// await persistentGraph.invoke(
//   { messages: [new HumanMessage("What's my name?")] },
//   { configurable: { thread_id: "session-1" } } // remembers Alice!
// );


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

bot.on('text', async (ctx: TelegrafContext) => {
  try {
    const userMessage: string = ctx.message.text || "";
    // const userId: string = ctx.from.id.toString();
    // const history = getConversation(userId);

    await ctx.sendChatAction('typing');

    // Langgraph
    const result = await persistentGraph.invoke(
      { messages: [new HumanMessage(userMessage)] },
      { configurable: { thread_id: "session-1" } }
    );

    const finalMessage = [...result.messages]
      .reverse()
      .find(m => m._getType() === "ai" && typeof m.content === "string");

    await ctx.reply(finalMessage?.content as string ?? "Something went wrong");
    console.log(result.messages.map(m => ({ type: m._getType(), content: JSON.stringify(m.content) })));
    return;

  } catch (error) {
    console.error('Error:', error);
    await ctx.reply('Sorry, something went wrong. Please try again.');
  }
});

// Start bot and scheduler
async function start(): Promise<void> {
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



bot.command('start', (ctx: TelegrafContext) => {
  ctx.reply('👋 Hi! I\'m your AI assistant.\n\nI can:\n• Have conversations with memory\n• Schedule tasks (e.g., "Every Monday at 9am give me weekend ideas")\n• Set reminders (e.g., "Remind me every Sunday at 8pm to submit homework")\n\nCommands:\n/schedules - View your scheduled tasks\n/delete <ID> - Delete a schedule\n/reset - Clear conversation history');
});

bot.command('reset', (ctx: TelegrafContext) => {
  conversations.delete(ctx.from?.id?.toString() || "");
  ctx.reply('🔄 Conversation history cleared!');
});

// Type for schedule row - adjust as your db exports!
type ScheduleRow = {
  id: number;
  userId: string;
  type: string;
  frequency: string;
  scheduledDate?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  time: string;
  content: string;
}

bot.command('schedules', async (ctx: TelegrafContext) => {
  const schedules: ScheduleRow[] = scheduleDB.findByUser(ctx.from?.id?.toString() || "");

  if (schedules.length === 0) {
    ctx.reply('📅 You have no scheduled tasks.');
    return;
  }

  let message = '📅 Your scheduled tasks:\n\n';
  schedules.forEach((s, i) => {
    let freqText: string;
    if (s.frequency === 'once') {
      freqText = `Once on ${s.scheduledDate}`;
    } else if (s.frequency === 'weekly') {
      freqText = `Every ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dayOfWeek ?? 0]}`;
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

bot.command('delete', async (ctx: TelegrafContext) => {
  const args: string[] = ctx.message?.text?.split(' ') ?? [];
  const id: number = parseInt(args[1]);

  if (!id) {
    ctx.reply('Usage: /delete <ID>\n\nUse /schedules to see your schedule IDs.');
    return;
  }

  const deleted: boolean = scheduleDB.delete(id, ctx.from?.id?.toString() || "");

  if (deleted) {
    ctx.reply('✅ Schedule deleted!');
  } else {
    ctx.reply('❌ Schedule not found or you don\'t have permission to delete it.');
  }
});

