import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GoogleGenAI, Modality, Type, type LiveServerMessage } from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';
import { allowedOrigin, validateMessage, windowLimit } from './security.ts';
import { ASYT_PROMPT } from './prompt.ts';

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT || 3000);
const key = process.env.GEMINI_API_KEY?.trim() || '';
const modelName = process.env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live';
const ai = key ? new GoogleGenAI({ apiKey: key }) : null;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set('Permissions-Policy', 'camera=(), geolocation=()');
  next();
});
app.get('/api/health', (_req, res) => {
  res.status(key ? 200 : 503).json({ status: key ? 'ready' : 'configuration_required', service: 'asyt-experience', model: modelName });
});
app.get('/api/privacy', (_req, res) => res.json({
  demoUsesCloud: true, aiProvider: 'Google Gemini', storesConversations: false,
  notice: 'Only activate voice and provide business context if you agree that it is sent to Gemini for processing.',
}));

const wss = new WebSocketServer({ noServer: true, maxPayload: 80 * 1024, perMessageDeflate: false });
const rateLimit = windowLimit(5, 60_000);
const socketsPerIp = new Map<string, number>();
const maxTotal = 20;
server.on('upgrade', (req, socket, head) => {
  const reject = (status: number, reason: string) => {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (req.url !== '/live') return reject(404, 'Not Found');
  if (!ai) return reject(503, 'Service Unavailable');
  if (!allowedOrigin(req.headers.origin, req.headers.host, process.env.ALLOWED_ORIGINS || '')) return reject(403, 'Forbidden');
  const ip = req.socket.remoteAddress || 'unknown';
  if (!rateLimit(ip) || (socketsPerIp.get(ip) || 0) >= 2 || wss.clients.size >= maxTotal) return reject(429, 'Too Many Requests');

  wss.handleUpgrade(req, socket, head, client => {
    socketsPerIp.set(ip, (socketsPerIp.get(ip) || 0) + 1);
    client.once('close', () => {
      const remaining = (socketsPerIp.get(ip) || 1) - 1;
      if (remaining <= 0) socketsPerIp.delete(ip); else socketsPerIp.set(ip, remaining);
    });
    wss.emit('connection', client, req);
  });
});

type Section = 'overview' | 'technology' | 'privacy' | 'diagnostic' | 'contact';
const sections = new Set<Section>(['overview', 'technology', 'privacy', 'diagnostic', 'contact']);
const navigationTool = {
  name: 'show_section',
  description: 'Show a relevant section of the website to illustrate the topic currently being discussed with the visitor.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      section: { type: Type.STRING, description: 'Must be overview, technology, privacy, diagnostic, or contact.' },
    },
    required: ['section'],
  },
};

wss.on('connection', (client: WebSocket) => {
  let closed = false;
  let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | undefined;
  const safeSend = (data: Record<string, unknown>) => {
    if (!closed && client.readyState === WebSocket.OPEN && client.bufferedAmount < 2_000_000) {
      client.send(JSON.stringify(data));
    }
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { session?.close(); } catch { /* already closed */ }
    session = undefined;
  };

  const setup = async () => {
    if (!ai) return;
    try {
      session = await ai.live.connect({
        model: modelName,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: ASYT_PROMPT,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [navigationTool] }],
        },
        callbacks: {
          onopen: () => {},
          onmessage: (event: LiveServerMessage) => {
            if (closed) return;
            const content = event.serverContent;
            if (content?.interrupted) safeSend({ type: 'interrupted' });
            if (content?.inputTranscription?.text) safeSend({ type: 'transcript', role: 'user', text: content.inputTranscription.text.slice(0, 3000) });
            if (content?.outputTranscription?.text) safeSend({ type: 'transcript', role: 'assistant', text: content.outputTranscription.text.slice(0, 3000) });
            for (const part of content?.modelTurn?.parts || []) {
              if (part.inlineData?.data) safeSend({ type: 'audio', data: part.inlineData.data });
            }
            if (content?.turnComplete) safeSend({ type: 'turn_complete' });
            if (event.toolCall?.functionCalls?.length) {
              const responses = event.toolCall.functionCalls.map(fc => {
                const value = (fc.args as { section?: unknown } | undefined)?.section;
                const requested = typeof value === 'string' && sections.has(value as Section) ? value as Section : 'overview';
                if (fc.name === 'show_section') safeSend({ type: 'navigate', section: requested });
                return { id: fc.id, name: fc.name, response: { result: fc.name === 'show_section' ? 'The web interface section is now visible to the visitor.' : 'Unknown function' } };
              });
              try { session?.sendToolResponse({ functionResponses: responses }); } catch { /* session terminated */ }
            }
          },
          onerror: () => {
            safeSend({ type: 'error', text: 'The Gemini voice session encountered an error. Please try again.' });
          },
          onclose: () => {
            if (!closed) {
              safeSend({ type: 'closed', text: 'Gemini ended the session.' });
              client.close(1000, 'Gemini closed');
            }
          },
        },
      });
      if (closed) { session.close(); return; }
      safeSend({ type: 'ready', model: modelName });
      session.sendRealtimeInput({ text: 'Start with a brief, welcoming introduction in French: present yourself as the ASYT consultant, explain in a few words that ASYT builds local private AI systems, and ask what brings the visitor here. Do not claim this voice demo is offline.' });
    } catch {
      safeSend({ type: 'error', text: 'Unable to establish Gemini Live. Check model access and API quota.' });
      client.close(1011, 'Gemini connection failed');
    }
  };

  client.on('message', raw => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString()); } catch { return; }
    const message = validateMessage(parsed);
    if (!message) return;
    if (message.type === 'ping') { safeSend({ type: 'pong' }); return; }
    if (!session || closed) return;
    try {
      if (message.type === 'audio' && message.audio) {
        session.sendRealtimeInput({ audio: { data: message.audio, mimeType: 'audio/pcm;rate=16000' } });
      } else if (message.type === 'text' && message.text) {
        session.sendRealtimeInput({ text: message.text });
      }
    } catch {
      safeSend({ type: 'error', text: 'Could not send this message. Please reconnect.' });
    }
  });
  client.on('close', cleanup);
  client.on('error', cleanup);
  void setup();
});

async function serve() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(root, 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  }
  server.listen(port, '0.0.0.0', () => console.log(`[ASYT Experience] Running on port ${port} | Gemini key configured: ${Boolean(key)}`));
}
void serve().catch(() => { console.error('Cannot start ASYT Experience'); process.exitCode = 1; });
