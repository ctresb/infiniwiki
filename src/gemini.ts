import PROMPT_MD from '../docs/prompt.md?raw';
import SCHEMA_JSON from '../docs/schema.json';

const MODEL = 'gemini-3.1-flash-lite';

function endpoint(): string {
  const key = import.meta.env.VITE_GEMINI_API_KEY;
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${key}`;
}

export async function streamArticle(
  topic: string,
  onText: (chunk: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const body = {
    systemInstruction: { parts: [{ text: PROMPT_MD }] },
    contents: [{ role: 'user', parts: [{ text: topic }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SCHEMA_JSON,
    },
  };

  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`gemini ${res.status}: ${errText.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trimEnd();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;
      try {
        const data = JSON.parse(payload);
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text.length) onText(text);
      } catch {
        /* keepalive or partial — ignore */
      }
    }
  }
}
