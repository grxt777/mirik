// Журнал групповых чатов — только в оперативной памяти (последние 12 часов, до 300 сообщений на чат).
// Telegram не отдаёт ботам историю, поэтому Мирик молча запоминает переписку и берёт её как контекст, когда его зовут.
const MAX = 300;
const TTL = 12 * 3600 * 1000;
const logs = new Map(); // chatId -> [{ mid, t, from, isBot, text, kind, fileId, fileName, mime, size, replyTo }]

const nameOf = (u) => (u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'кто-то' : 'кто-то');

export function describe(m) {
  const base = { mid: m.message_id, t: (m.date || Date.now() / 1000) * 1000, from: nameOf(m.from), fromId: m.from?.id, isBot: !!m.from?.is_bot, text: m.text || m.caption || '', replyTo: m.reply_to_message?.message_id };
  if (m.photo) return { ...base, kind: 'photo', fileId: m.photo.at(-1).file_id, fileName: `photo_${m.message_id}.jpg`, mime: 'image/jpeg', size: m.photo.at(-1).file_size };
  if (m.document) return { ...base, kind: 'document', fileId: m.document.file_id, fileName: m.document.file_name || `file_${m.message_id}`, mime: m.document.mime_type, size: m.document.file_size };
  if (m.voice || m.audio || m.video_note) {
    const v = m.voice || m.audio || m.video_note;
    return { ...base, kind: 'voice', fileId: v.file_id, fileName: `voice_${m.message_id}.${m.video_note ? 'mp4' : 'ogg'}`, mime: v.mime_type || (m.video_note ? 'video/mp4' : 'audio/ogg'), size: v.file_size, duration: v.duration };
  }
  if (m.video) return { ...base, kind: 'video', fileId: m.video.file_id, fileName: m.video.file_name || `video_${m.message_id}.mp4`, mime: m.video.mime_type, size: m.video.file_size };
  if (m.sticker) return { ...base, kind: 'sticker', text: m.sticker.emoji || '🙂' };
  return { ...base, kind: 'text' };
}

export function record(chatId, m) {
  const list = logs.get(chatId) || [];
  list.push(describe(m));
  const cutoff = Date.now() - TTL;
  while (list.length > MAX || (list[0] && list[0].t < cutoff)) list.shift();
  logs.set(chatId, list);
}

// собственные ответы Мирика тоже в журнал — чтобы он помнил, что уже говорил в чате
export function recordOwn(chatId, text) {
  record(chatId, { message_id: 0, date: Date.now() / 1000, from: { first_name: 'Мирик', is_bot: true }, text: String(text).slice(0, 1500) });
}

// сообщения до текущего: последние limit штук за hours часов
export function before(chatId, mid, { limit = 40, hours = 6 } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1000;
  return (logs.get(chatId) || []).filter((x) => x.t >= cutoff && (x.mid === 0 || x.mid < mid)).slice(-limit);
}

export const size = (chatId) => (logs.get(chatId) || []).length;
