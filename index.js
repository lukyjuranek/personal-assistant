import { Telegraf } from 'telegraf';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph, Annotation, START, END, messagesStateReducer } from "@langchain/langgraph";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import Bree from 'bree';
import { searchTool } from ".src/tools.ts"
import dotenv from 'dotenv';
import { plannerAgent, responderAgent, contextBuilder, detectScheduleIntent } from './src/agents.js'
import { getConversation, saveToHistory, clearHistory } from './src/memory.js';
import { initDB, scheduleDB } from './src/db.js';
dotenv.config();

initDB();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.5-flash',
  temperature: 0.7
})
  .bindTools([searchTool]);

// Simple conversation history storage (without LangChain memory)
const conversations = new Map();

const GraphState = Annotation.Root({
  messages: Annotation({
    reducer: (existing, update) => [...existing, ...update],
    default: () => [],
  }),
  // A plain value — each update just replaces the previous one
  summary: Annotation({
    reducer: (_, update) => update,
    default: () => "",
  }),
});

// Type alias for convenience
// type State = typeof GraphState.State;

async function chatNode(state) {
  const response = await model.invoke(state.messages);
  // Returning an array because our reducer appends arrays
  return { messages: [response] };
}

async function summarizeNode(state) {
  const text = state.messages.map((m) => m.content).join("\n");
  const response = await model.invoke([
    new HumanMessage(`Summarize this conversation in one sentence:\n${text}`),
  ]);
  return { summary: response.content };
}

async function agentNode(state: typeof AgentState.State) {
  const response = await llmWithTools.invoke(state.messages);
  return { messages: [response] };
}

// ToolNode automatically runs any tool_calls found in the last AI message
const toolsNode = new ToolNode([searchTool]);

// Router: if the LLM made tool calls → run tools → loop back; else → done
function shouldContinue(state: typeof AgentState.State): "tools" | typeof END {
  const last = state.messages.at(-1) as AIMessage;
  if (last.tool_calls && last.tool_calls.length > 0) return "tools";
  return END;
}

const memory = new memorySaver();

const persistentGraph = new StateGraph(AgentState)
  .addNode("agent", agentNode)
  .addNode("tools", toolsNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .compile({ checkpointer: memory }); // <-- attach the checkpointer here


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

bot.on('text', async (ctx) => {
  try {
    const userMessage = ctx.message.text;
    const userId = ctx.from.id.toString();
    const history = getConversation(userId);

    await ctx.sendChatAction('typing');

    // langgraph
    const result = await agentGraph.invoke({
      messages: [new HumanMessage(userMessage)],
    });

    const lastMessage = result.messages.at(-1);
    await ctx.reply(lastMessage.content);
    return;

    // For testing
    const context = await contextBuilder(userId);
    const plan = await plannerAgent(model, userMessage, context, userId);
    const response = await responderAgent(model, plan);
    await ctx.reply(response)
    return;

  } catch (error) {
    console.error('Error:', error);
    await ctx.reply('Sorry, something went wrong. Please try again.');
  }
});

// Start bot and scheduler
async function start() {
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

