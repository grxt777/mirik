// Шина событий: агенты -> офис (WebSocket) и Telegram.
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

const logBuffer = [];
export function log(agent, text, kind = 'info') {
  const entry = { t: Date.now(), agent, text: String(text).slice(0, 500), kind };
  logBuffer.push(entry);
  if (logBuffer.length > 200) logBuffer.shift();
  bus.emit('event', { type: 'log', entry });
}
export const recentLogs = () => logBuffer.slice(-100);
