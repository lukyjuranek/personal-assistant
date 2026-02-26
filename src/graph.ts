import { searchTool, getTasksTool, createTaskTool, completeTaskTool, updateTaskTool, getWeatherTool, listCalendarEventsTool, createCalendarEventTool, searchCalendarEventsTool, getFreeBusyTool, checkCalendarAuthTool } from "./src/tools.ts"
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph, Annotation, START, END, messagesStateReducer, MemorySaver } from "@langchain/langgraph";
import { SystemMessage, HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SYSTEM_PROMPT, PROACTIVE_PROMPT } from "./prompts.ts";


const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY as string,
  model: 'gemini-2.5-flash',
  temperature: 0.7,
}).bindTools([
  searchTool,
  getTasksTool,
  createTaskTool,
  updateTaskTool,
  completeTaskTool,
  getWeatherTool,
  listCalendarEventsTool,
  createCalendarEventTool,
  searchCalendarEventsTool,
  getFreeBusyTool,
  checkCalendarAuthTool
]);


const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[], BaseMessage[]>({
    reducer: (existing: BaseMessage[], update: BaseMessage[]) => [...existing, ...update],
    default: () => [],
  }),
  summary: Annotation<string, string>({
    reducer: (_: string, update: string) => update,
    default: () => "",
  }),
  userId: Annotation<string, string>({
    reducer: (_: string, update: string) => update,
    default: () => "",
  }),
});

// Type alias for convenience
type State = typeof GraphState.State;

async function agentNode(state: any): Promise<{ messages: BaseMessage[] }> {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  // Add userId to system message so tools can access it
  const systemMsg = new SystemMessage(
    `${SYSTEM_PROMPT}\n\nUser ID: ${state.userId || 'unknown'}, Today's date is ${today}`
  );

  const response = await llm.invoke([
    systemMsg,
    ...state.messages,
  ]);
  return { messages: [response] };
}

// ToolNode automatically runs any tool_calls found in the last AI message
const toolsNode = new ToolNode([
  searchTool,
  getTasksTool,
  createTaskTool,
  updateTaskTool,
  completeTaskTool,
  getWeatherTool,
  listCalendarEventsTool,
  createCalendarEventTool,
  searchCalendarEventsTool,
  getFreeBusyTool,
  checkCalendarAuthTool
]);

function shouldContinue(state: State): "tools" | typeof END {
  const last = state.messages.at(-1) as AIMessage;
  if (last?.tool_calls && last.tool_calls.length > 0) return "tools";
  return END;
}

const memory = new MemorySaver();

export const persistentGraph = new StateGraph(GraphState)
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


