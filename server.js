const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'guestbook.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

app.use(express.json());
app.use(express.static(__dirname, { extensions: ['html'] }));

app.get('/api/messages', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, message, created_at FROM messages ORDER BY id DESC LIMIT 200'
  ).all();
  res.json(rows);
});

app.post('/api/messages', (req, res) => {
  const { name, message } = req.body || {};
  if (typeof name !== 'string' || typeof message !== 'string') {
    return res.status(400).json({ error: '請輸入名字和留言' });
  }
  const cleanName = name.trim().slice(0, 40);
  const cleanMessage = message.trim().slice(0, 300);
  if (!cleanName || !cleanMessage) {
    return res.status(400).json({ error: '請輸入名字和留言' });
  }
  const info = db.prepare('INSERT INTO messages (name, message) VALUES (?, ?)').run(cleanName, cleanMessage);
  const row = db.prepare('SELECT id, name, message, created_at FROM messages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

app.post('/api/summarize', async (req, res) => {
  if (!anthropic) {
    return res.status(500).json({ error: '伺服器尚未設定 ANTHROPIC_API_KEY' });
  }

  const rows = db.prepare(
    'SELECT name, message FROM messages ORDER BY id DESC LIMIT 200'
  ).all();

  if (rows.length === 0) {
    return res.json({ summary: '目前還沒有留言，先邀請大家留個言吧！' });
  }

  const transcript = rows
    .map((r) => `${r.name}：${r.message}`)
    .join('\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `以下是訪客留言板上的留言，請用繁體中文寫一句話（不超過 50 字）總結大家的留言氛圍與重點，語氣溫暖自然，不要條列、不要加引號：\n\n${transcript}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    res.json({ summary: textBlock ? textBlock.text.trim() : '' });
  } catch (err) {
    console.error('Summarize failed:', err);
    res.status(502).json({ error: 'AI 總結失敗，請稍後再試' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
