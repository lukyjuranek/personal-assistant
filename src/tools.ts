
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { Database } from "bun:sqlite";
// import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { TavilySearch } from "@langchain/tavily";

const db = new Database("./data/tasks.db");

db.run(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    dueDate TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending'
  )
`);


export const searchTool = new TavilySearch({
  maxResults: 5,
});

export const getWeatherTool = tool(
  async ({ city }) => {
    // Step 1: geocode city to lat/lon
    const geoRes = await fetch(
      `http://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${process.env.OPENWEATHER_API_KEY}`
    );
    const geoData = await geoRes.json();
    if (!geoData.length) return `Could not find location for "${city}"`;

    const { lat, lon } = geoData[0];

    // Step 2: get weather using lat/lon
    const weatherRes = await fetch(
      `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,daily,alerts&units=metric&appid=${process.env.OPENWEATHER_API_KEY}`
    );
    const data = await weatherRes.json();

    return `Weather in ${city}: ${data.current.weather[0].description}, ${data.current.temp}°C, feels like ${data.current.feels_like}°C, humidity ${data.current.humidity}%`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a city",
    schema: z.object({
      city: z.string().describe("The city name e.g. London, Tokyo"),
    }),
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

export const updateTaskTool = tool(
  async ({ taskId, title, dueDate, priority, status }) => {
    const updated = await db.update(taskId, {
      ...(title && { title }),
      ...(dueDate && { dueDate }),
      ...(priority && { priority }),
      ...(status && { status }),
    });

    if (!updated) return `Task ${taskId} not found`;
    return `Task ${taskId} updated successfully`;
  },
  {
    name: "update_task",
    description: "Update an existing task. Can change the title, due date, priority, or status.",
    schema: z.object({
      taskId: z.string().describe("The ID of the task to update"),
      title: z.string().optional().describe("New title for the task"),
      dueDate: z.string().optional().describe("New due date in ISO format e.g. 2025-05-03"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("New priority"),
      status: z.enum(["pending", "done"]).optional().describe("New status"),
    }),
  }
);
