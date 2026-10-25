// Распознавание голосовых: ffmpeg -> wav, затем аудио-модель через OpenRouter.
import { spawn } from 'node:child_process';
import { chat } from './llm.js';
import { config } from './config.js';

function toWav(buf) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1']);
    const out = [];
    ff.stdout.on('data', (d) => out.push(d));
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg exit ' + code))));
    ff.stdin.on('error', () => {});
    ff.stdin.end(buf);
  });
}

export async function transcribe(buf, format = 'ogg') {
  let data = buf;
  try {
    data = await toWav(buf);
    format = 'wav';
  } catch {
    // без ffmpeg пробуем отправить как есть
  }
  const msg = await chat({
    model: config.audioModel,
    temperature: 0,
    maxTokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Дословно расшифруй это голосовое сообщение на языке оригинала. Верни только текст, без пояснений. Если речи нет — верни пустую строку.' },
        { type: 'input_audio', input_audio: { data: data.toString('base64'), format } },
      ],
    }],
  });
  return (msg.content || '').trim();
}
