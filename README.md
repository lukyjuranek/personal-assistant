# Personal AI Assistant

A Telegram bot powered by Google Gemini AI with scheduling capabilities.

## Features

- 🤖 Conversational AI with memory
- 📅 Schedule recurring tasks (daily, weekly, monthly)
- ⏰ One-time reminders
- 🎯 Smart vs static reminders (AI-generated or pre-written)

## Setup

1. Install dependencies:
```bash
bun install
```

2. Create `.env` file:
```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
```

3. Get your tokens:
   - Telegram: Message [@BotFather](https://t.me/botfather) on Telegram
   - Gemini: Get from [Google AI Studio](https://aistudio.google.com/apikey)

4. Run the bot:
```bash
bun index.js
```

## Usage

- Chat naturally with the bot
- Schedule tasks: "Every Monday at 9am give me weekend ideas"
- Set reminders: "Tomorrow at 10am remind me to call mom"
- View schedules: `/schedules`
- Delete schedule: `/delete <ID>`

## Tech Stack

- Bun
- Telegraf (Telegram bot framework)
- LangChain + Google Gemini AI
- Bun SQLite (built-in)
- Bree (job scheduler)
