# Remote-Chat-With-Desktop-Agent
# Antigravity Telegram Bridge

Control Antigravity IDE Agent remotely via Telegram with real-time response streaming.

## Features

- 🤖 Send tasks to Agent from Telegram
- 💬 Real-time response streaming
- ▶️ Auto-clicks "Run" buttons
- 🎮 Simple command system

## Quick Setup

1. **Create Telegram Bot**: Message [@BotFather](https://t.me/botfather) → `/newbot` → save token
2. **Get Chat ID**: Message your bot → visit `https://api.telegram.org/bot<TOKEN>/getUpdates` → copy `chat_id`
3. **Configure Script**: Edit `CONFIG` in the script with your token and chat ID
4. **Run**: Open Antigravity IDE → DevTools (F12) → Console → paste script → Enter

## Usage

**Commands:**
- `/chat on` - Enable (default)
- `/chat off` - Disable
- `/list` - Show commands

**Send Tasks:**
Just message your bot normally (without `/`). The Agent will process and stream responses back.

## How It Works

Script uses long polling to receive Telegram messages, forwards them to Agent's input, monitors responses with MutationObserver, and streams updates back to Telegram (throttled at 800ms).

## Security

⚠️ Don't share your configured script - it contains credentials.

## Limitations

- Single user only
- Resets on reopen antigravity

---

MIT License | Unofficial tool

