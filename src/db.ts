import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";

export interface ScheduleRow {
  id: number;
  userId: string;
  type: string;
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  scheduledDate: string | null;
  time: string;
  content: string;
  active: number;
  createdAt: string;
}

export interface ScheduleCreate {
  userId: string;
  type: string;
  frequency: string;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  scheduledDate?: string | null;
  time: string;
  content: string;
}

export interface ScheduleUpdate {
  time?: string;
  content?: string;
  frequency?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  scheduledDate?: string;
  type?: string;
}

if (!existsSync("./data")) {
  mkdirSync("./data", { recursive: true });
}

const db = new Database("./data/schedules.db", { create: true });

export function initDB(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      type TEXT NOT NULL,
      frequency TEXT NOT NULL,
      dayOfWeek INTEGER,
      dayOfMonth INTEGER,
      scheduledDate TEXT,
      time TEXT NOT NULL,
      content TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Database initialized");
}

export const scheduleDB = {
  create: (data: ScheduleCreate): { id: number; [key: string]: unknown } => {
    const stmt = db.prepare(`
      INSERT INTO schedules (userId, type, frequency, dayOfWeek, dayOfMonth, scheduledDate, time, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.userId,
      data.type,
      data.frequency,
      data.dayOfWeek ?? null,
      data.dayOfMonth ?? null,
      data.scheduledDate ?? null,
      data.time,
      data.content
    );

    return { id: result.lastInsertRowid as number, ...data };
  },

  findByUser: (userId: string): ScheduleRow[] => {
    const stmt = db.prepare(
      "SELECT * FROM schedules WHERE userId = ? AND active = 1"
    );
    return stmt.all(userId) as ScheduleRow[];
  },

  findDue: (
    time: string,
    dayOfWeek: number,
    dayOfMonth: number,
    currentDate: string
  ): ScheduleRow[] => {
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
    return stmt.all(time, dayOfWeek, dayOfMonth, currentDate) as ScheduleRow[];
  },

  delete: (id: number, userId: string): boolean => {
    const stmt = db.prepare(
      "UPDATE schedules SET active = 0 WHERE id = ? AND userId = ?"
    );
    const result = stmt.run(id, userId);
    return result.changes > 0;
  },

  getAll: (): ScheduleRow[] => {
    const stmt = db.prepare("SELECT * FROM schedules WHERE active = 1");
    return stmt.all() as ScheduleRow[];
  },

  update: (
    id: number,
    userId: string,
    data: ScheduleUpdate
  ): boolean => {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (data.time !== undefined) {
      fields.push("time = ?");
      values.push(data.time);
    }
    if (data.content !== undefined) {
      fields.push("content = ?");
      values.push(data.content);
    }
    if (data.frequency !== undefined) {
      fields.push("frequency = ?");
      values.push(data.frequency);
    }
    if (data.dayOfWeek !== undefined) {
      fields.push("dayOfWeek = ?");
      values.push(data.dayOfWeek);
    }
    if (data.dayOfMonth !== undefined) {
      fields.push("dayOfMonth = ?");
      values.push(data.dayOfMonth);
    }
    if (data.scheduledDate !== undefined) {
      fields.push("scheduledDate = ?");
      values.push(data.scheduledDate);
    }
    if (data.type !== undefined) {
      fields.push("type = ?");
      values.push(data.type);
    }

    if (fields.length === 0) return false;

    values.push(id, userId);

    const stmt = db.prepare(`
      UPDATE schedules 
      SET ${fields.join(", ")}
      WHERE id = ? AND userId = ? AND active = 1
    `);

    const result = stmt.run(...values);
    return result.changes > 0;
  },

  findById: (id: number, userId: string): ScheduleRow | undefined => {
    const stmt = db.prepare(
      "SELECT * FROM schedules WHERE id = ? AND userId = ? AND active = 1"
    );
    return stmt.get(id, userId) as ScheduleRow | undefined;
  },
};

export default db;
