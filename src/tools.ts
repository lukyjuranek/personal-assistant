
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { Database } from "bun:sqlite";

const db = new Database("./data/tasks.db");




export const searchTool = tool(
  async ({ query }: { query: string }) => {
    // In reality, you'd hit a real API here
    return `Search results for "${query}": lots of info found.`;
  },
  {
    name: "search",
    description: "Search the web for information",
    schema: z.object({ query: z.string().describe("Search query") }),
  }
);


export const createTaskTool = tool(
  async ({ title, dueDate, priority }) => {
    // save to your DB here
    const task = await db.prepare("INSERT INTO tasks (title, dueDate, priority) VALUES (?, ?, ?)").run(title, dueDate ?? null, priority ?? null);
    return `Task "${title}" created with id ${task.lastInsertRowid}`;
  },
  {
    name: "create_task",
    description: "Create a new task for the user",
    schema: z.object({
      title: z.string().describe("The task title"),
      dueDate: z.string().optional().describe("Due date in ISO format"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority"),
    }),
  }
);

export const getTasksTool = tool(
  async ({ status }) => {
    const tasks = await db.prepare("SELECT * FROM tasks WHERE status = ?").all(status);
    return JSON.stringify(tasks); // always return a string
  },
  {
    name: "get_tasks",
    description: "Get the user's tasks, optionally filtered by status",
    schema: z.object({
      status: z.enum(["pending", "done", "all"]).default("all"),
    }),
  }
);

export const completeTaskTool = tool(
  async ({ taskId }) => {
    await db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(taskId);
    return `Task ${taskId} marked as complete`;
  },
  {
    name: "complete_task",
    description: "Mark a task as complete",
    schema: z.object({
      taskId: z.string().describe("The ID of the task to complete"),
    }),
  }
);