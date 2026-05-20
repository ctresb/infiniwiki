import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const PAGES_DIR = path.join(process.cwd(), 'pages');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

const clean = (s: string) =>
  s.replace(/\.\./g, '').replace(/\//g, '').toLowerCase().trim();

app.get('/pages', async (_, res) => {
  await fs.mkdir(PAGES_DIR, { recursive: true });
  const files = await fs.readdir(PAGES_DIR);
  res.json(files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')));
});

app.get('/pages/:slug', async (req, res) => {
  try {
    const file = await fs.readFile(
      path.join(PAGES_DIR, `${clean(req.params.slug)}.json`),
      'utf-8'
    );
    res.json(JSON.parse(file));
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

app.post('/pages/:slug', async (req, res) => {
  await fs.mkdir(PAGES_DIR, { recursive: true });
  await fs.writeFile(
    path.join(PAGES_DIR, `${clean(req.params.slug)}.json`),
    JSON.stringify(req.body, null, 2)
  );
  res.json({ ok: true });
});

app.listen(3001, () => console.log('cache server on http://localhost:3001'));
