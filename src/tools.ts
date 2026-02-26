
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { Database } from "bun:sqlite";
// import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { TavilySearch } from "@langchain/tavily";
import { googleCalendarService } from "./google-calendar";

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
    const geoData = await geoRes.json() as any[];
    if (!Array.isArray(geoData) || geoData.length === 0) {
      return `Could not find location for "${city}"`;
    }

    const { lat, lon } = geoData[0];

    // Step 2: get weather using lat/lon
    const weatherRes = await fetch(
      `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,daily,alerts&units=metric&appid=${process.env.OPENWEATHER_API_KEY}`
    );
    const data = await weatherRes.json() as any;

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
    let query = 'UPDATE tasks SET ';
    const updates: string[] = [];
    const values: any[] = [];
    
    if (title) {
      updates.push('title = ?');
      values.push(title);
    }
    if (dueDate) {
      updates.push('dueDate = ?');
      values.push(dueDate);
    }
    if (priority) {
      updates.push('priority = ?');
      values.push(priority);
    }
    if (status) {
      updates.push('status = ?');
      values.push(status);
    }
    
    if (updates.length === 0) {
      return `No updates provided for task ${taskId}`;
    }
    
    query += updates.join(', ') + ' WHERE id = ?';
    values.push(taskId);
    
    const result = db.prepare(query).run(...values);
    
    if (result.changes === 0) return `Task ${taskId} not found`;
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

// Google Calendar Tools
export const listCalendarEventsTool = tool(
  async ({ userId, maxResults }) => {
    return await googleCalendarService.listEvents(userId, maxResults);
  },
  {
    name: "list_calendar_events",
    description: "List upcoming events from user's Google Calendar",
    schema: z.object({
      userId: z.string().describe("The user's ID"),
      maxResults: z.number().optional().default(10).describe("Maximum number of events to return"),
    }),
  }
);

export const createCalendarEventTool = tool(
  async ({ userId, summary, startTime, endTime, description, location }) => {
    return await googleCalendarService.createEvent(
      userId,
      summary,
      startTime,
      endTime,
      description,
      location
    );
  },
  {
    name: "create_calendar_event",
    description: "Create a new event in user's Google Calendar",
    schema: z.object({
      userId: z.string().describe("The user's ID"),
      summary: z.string().describe("Event title/summary"),
      startTime: z.string().describe("Start time in ISO 8601 format (e.g., 2026-03-15T10:00:00Z)"),
      endTime: z.string().describe("End time in ISO 8601 format (e.g., 2026-03-15T11:00:00Z)"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
    }),
  }
);

export const searchCalendarEventsTool = tool(
  async ({ userId, query }) => {
    return await googleCalendarService.searchEvents(userId, query);
  },
  {
    name: "search_calendar_events",
    description: "Search for events in user's Google Calendar by keyword",
    schema: z.object({
      userId: z.string().describe("The user's ID"),
      query: z.string().describe("Search query to find events"),
    }),
  }
);

export const getFreeBusyTool = tool(
  async ({ userId, timeMin, timeMax }) => {
    return await googleCalendarService.getFreeBusy(userId, timeMin, timeMax);
  },
  {
    name: "get_free_busy",
    description: "Get free/busy information for user's calendar within a time range",
    schema: z.object({
      userId: z.string().describe("The user's ID"),
      timeMin: z.string().describe("Start of time range in ISO 8601 format"),
      timeMax: z.string().describe("End of time range in ISO 8601 format"),
    }),
  }
);

export const checkCalendarAuthTool = tool(
  async ({ userId }) => {
    const isAuth = await googleCalendarService.isAuthorized(userId);
    if (isAuth) {
      return "User is authorized to access Google Calendar";
    } else {
      const authUrl = googleCalendarService.getAuthUrl(userId);
      return `User needs to authorize Google Calendar. Please visit: ${authUrl}`;
    }
  },
  {
    name: "check_calendar_auth",
    description: "Check if user has authorized Google Calendar access and get auth URL if not",
    schema: z.object({
      userId: z.string().describe("The user's ID"),
    }),
  }
);

