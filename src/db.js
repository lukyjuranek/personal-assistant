import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'fs';

// Create data directory first
if (!existsSync('./data')) {
  mkdirSync('./data', { recursive: true });
}

const db = new Database('./data/schedules.db', { create: true });

// Initialize database
export function initDB() {
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

  console.log('✅ Database initialized');
}

// Schedule operations
export const scheduleDB = {
  create: (data) => {
    const stmt = db.prepare(`
      INSERT INTO schedules (userId, type, frequency, dayOfWeek, dayOfMonth, scheduledDate, time, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      data.userId,
      data.type,
      data.frequency,
      data.dayOfWeek || null,
      data.dayOfMonth || null,
      data.scheduledDate || null,
      data.time,
      data.content
    );
    
    return { id: result.lastInsertRowid, ...data };
  },

  findByUser: (userId) => {
    const stmt = db.prepare('SELECT * FROM schedules WHERE userId = ? AND active = 1');
    return stmt.all(userId);
  },

  findDue: (time, dayOfWeek, dayOfMonth, currentDate) => {
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
    return stmt.all(time, dayOfWeek, dayOfMonth, currentDate);
  },

  delete: (id, userId) => {
    const stmt = db.prepare('UPDATE schedules SET active = 0 WHERE id = ? AND userId = ?');
    const result = stmt.run(id, userId);
    return result.changes > 0;
  },

  getAll: () => {
    const stmt = db.prepare('SELECT * FROM schedules WHERE active = 1');
    return stmt.all();
  }
};

export default db;
