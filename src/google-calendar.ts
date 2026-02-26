import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Database } from 'bun:sqlite';
import path from 'path';

const db = new Database('./data/tasks.db');

// Create tokens table to store user OAuth tokens
db.run(`
  CREATE TABLE IF NOT EXISTS google_tokens (
    user_id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expiry_date INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

export class GoogleCalendarService {
  private oauth2Client: OAuth2Client;
  
  constructor() {
    // You need to add GOOGLE_CLIENT_SECRET to your .env file
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || `${process.env.NGROK_URL}/auth/google/callback`
    );
  }

  /**
   * Generate OAuth URL for user to authorize the app
   */
  getAuthUrl(userId: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ];

    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: userId, // Pass userId to identify user after callback
      prompt: 'consent', // Force consent screen to get refresh token
    });

    return url;
  }

  /**
   * Exchange authorization code for tokens
   */
  async handleCallback(code: string, userId: string): Promise<void> {
    const { tokens } = await this.oauth2Client.getToken(code);
    
    // Save tokens to database
    db.prepare(`
      INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry_date, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, refresh_token),
        expiry_date = excluded.expiry_date,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      userId,
      tokens.access_token!,
      tokens.refresh_token || null,
      tokens.expiry_date || null
    );
  }

  /**
   * Get authenticated calendar client for a user
   */
  private async getCalendarClient(userId: string): Promise<calendar_v3.Calendar | null> {
    const row = db.prepare(
      'SELECT access_token, refresh_token, expiry_date FROM google_tokens WHERE user_id = ?'
    ).get(userId) as TokenData | undefined;

    if (!row) {
      return null;
    }

    this.oauth2Client.setCredentials({
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expiry_date: row.expiry_date,
    });

    // Check if token needs refresh
    const isExpired = row.expiry_date && row.expiry_date <= Date.now();
    if (isExpired && row.refresh_token) {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      
      // Update tokens in database
      db.prepare(`
        UPDATE google_tokens 
        SET access_token = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(credentials.access_token!, credentials.expiry_date!, userId);

      this.oauth2Client.setCredentials(credentials);
    }

    return google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  /**
   * Check if user has authorized Google Calendar
   */
  async isAuthorized(userId: string): Promise<boolean> {
    const row = db.prepare(
      'SELECT user_id FROM google_tokens WHERE user_id = ?'
    ).get(userId);
    return !!row;
  }

  /**
   * List upcoming events
   */
  async listEvents(userId: string, maxResults: number = 10): Promise<string> {
    const calendar = await this.getCalendarClient(userId);
    
    if (!calendar) {
      return 'Not authorized. Please authorize Google Calendar first.';
    }

    try {
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      
      if (events.length === 0) {
        return 'No upcoming events found.';
      }

      const eventList = events.map((event, i) => {
        const start = event.start?.dateTime || event.start?.date;
        return `${i + 1}. ${event.summary} - ${start}`;
      }).join('\n');

      return `Upcoming events:\n${eventList}`;
    } catch (error: any) {
      return `Error fetching events: ${error.message}`;
    }
  }

  /**
   * Create a new calendar event
   */
  async createEvent(
    userId: string,
    summary: string,
    startTime: string,
    endTime: string,
    description?: string,
    location?: string
  ): Promise<string> {
    const calendar = await this.getCalendarClient(userId);
    
    if (!calendar) {
      return 'Not authorized. Please authorize Google Calendar first.';
    }

    try {
      const event: calendar_v3.Schema$Event = {
        summary,
        description,
        location,
        start: {
          dateTime: startTime,
        },
        end: {
          dateTime: endTime,
        },
      };

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });

      return `Event created: ${response.data.summary} (${response.data.htmlLink})`;
    } catch (error: any) {
      return `Error creating event: ${error.message}`;
    }
  }

  /**
   * Get free/busy information
   */
  async getFreeBusy(userId: string, timeMin: string, timeMax: string): Promise<string> {
    const calendar = await this.getCalendarClient(userId);
    
    if (!calendar) {
      return 'Not authorized. Please authorize Google Calendar first.';
    }

    try {
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: [{ id: 'primary' }],
        },
      });

      const busySlots = response.data.calendars?.primary?.busy || [];
      
      if (busySlots.length === 0) {
        return `No busy time slots between ${timeMin} and ${timeMax}`;
      }

      const busyList = busySlots.map((slot, i) => {
        return `${i + 1}. ${slot.start} - ${slot.end}`;
      }).join('\n');

      return `Busy time slots:\n${busyList}`;
    } catch (error: any) {
      return `Error fetching free/busy: ${error.message}`;
    }
  }

  /**
   * Search for events
   */
  async searchEvents(userId: string, query: string): Promise<string> {
    const calendar = await this.getCalendarClient(userId);
    
    if (!calendar) {
      return 'Not authorized. Please authorize Google Calendar first.';
    }

    try {
      const response = await calendar.events.list({
        calendarId: 'primary',
        q: query,
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      
      if (events.length === 0) {
        return `No events found matching "${query}"`;
      }

      const eventList = events.map((event, i) => {
        const start = event.start?.dateTime || event.start?.date;
        return `${i + 1}. ${event.summary} - ${start}`;
      }).join('\n');

      return `Events matching "${query}":\n${eventList}`;
    } catch (error: any) {
      return `Error searching events: ${error.message}`;
    }
  }

  /**
   * Delete an event by ID
   */
  async deleteEvent(userId: string, eventId: string): Promise<string> {
    const calendar = await this.getCalendarClient(userId);
    
    if (!calendar) {
      return 'Not authorized. Please authorize Google Calendar first.';
    }

    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId,
      });

      return `Event deleted successfully`;
    } catch (error: any) {
      return `Error deleting event: ${error.message}`;
    }
  }

  /**
   * Revoke access for a user
   */
  async revokeAccess(userId: string): Promise<void> {
    db.prepare('DELETE FROM google_tokens WHERE user_id = ?').run(userId);
  }
}

export const googleCalendarService = new GoogleCalendarService();
