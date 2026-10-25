// Telegram-бот Мирика.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { store, save, chatHistory } from './store.js';
import { bus } from './bus.js';
import { AGENTS, AGENT_LIST } from './agents/registry.js';
import { agentState, talkToMirik, createTask, runTask, cancelTask } from './agents/runtime.js';
import { wsPath } from './tools/files.js';

export let bot = null;

const STATUS_ICON = { idle: '😴', thinking: '🤔', working: '⚙️', managing: '📣' };

function isOwner(id) {
  if (config.ownerIds.length) return config.ownerIds.includes(id);
  return store.owners.includes(id);
}

export function ownerChats() {
  return config.ownerIds.length ? config.ownerIds : store.owners;
}

// Markdown от модели -> HTML для Telegram
export function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = [];
  let s = String(md).replace(/```\w*\n?([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(code) - 1}\u0000`);
  s = esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre>${esc(blocks[i])}</pre>`);
}

async function sendLong(ctx, text) {
  const s = String(text || '…');
  for (let i = 0; i < s.length; i += 3500) {
    const part = s.slice(i, i + 3500);
    await ctx.api.sendMessage(ctx.chat.id, mdToHtml(part), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
      .catch(() => ctx.api.sendMessage(ctx.chat.id, part));
  }
}

// io-объект для агентов: как им писать в этот чат
function chatIO(api, chatId) {
  return {
    notify: (text) => api.sendMessage(chatId, '📣 ' + String(text).slice(0, 4000)).catch(() => {}),
    sendFile: (full, caption) => api.sendDocument(chatId, new InputFile(full), { caption: caption?.slice(0, 1000) }),
    sendPhoto: (buf, caption) => api.sendPhoto(chatId, new InputFile(buf, 'screen.jpg'), { caption: caption?.slice(0, 1000) }),
  };
}

// Живой статус: одно сообщение, которое редактируется по ходу задачи
function liveStatus(api, chatId, statusMsgId, taskRef) {
  let last = 0, timer = null, text = '';
  const render = () => {
    const task = taskRef.task;
    if (!task) return;
    const lines = task.steps.slice(-6).map((s) => `${AGENTS[s.agent]?.emoji || '•'} ${AGENTS[s.agent]?.name}: ${s.text.slice(0, 120)}`);
    const next = `⏳ Работаем…\n\n${lines.join('\n')}`;
    if (next === text) return;
    text = next;
    last = Date.now();
    api.editMessageText(chatId, statusMsgId, next, {
      reply_markup: new InlineKeyboard().text('⛔ Стоп', `stop:${task.id}`),
    }).catch(() => {});
  };
  const onEvent = (e) => {
    if (e.type !== 'task' || e.task.id !== taskRef.task?.id || e.task.status !== 'running') return;
    clearTimeout(timer);
    timer = setTimeout(render, Math.max(0, 1500 - (Date.now() - last)));
  };
  bus.on('event', onEvent);
  return () => { clearTimeout(timer); bus.off('event', onEvent); };
}

async function handleTask(ctx, { text, content, agent = 'mirik' }) {
  const chatId = ctx.chat.id;
  await ctx.api.sendChatAction(chatId, 'typing').catch(() => {});
  const status = await ctx.reply(`${AGENTS[agent].emoji} ${AGENTS[agent].name} взялся за дело…`);
  const taskRef = {};
  const stopLive = liveStatus(ctx.api, chatId, status.message_id, taskRef);
  const io = chatIO(ctx.api, chatId);
  try {
    let result;
    if (agent === 'mirik') {
      ({ result } = await talkToMirik(chatId, { text, content, onTask: (t) => (taskRef.task = t) }, io));
    } else {
      const task = createTask({ text, agent, source: 'telegram', chatId });
      taskRef.task = task;
      result = await runTask(task, io);
    }
    stopLive();
    await ctx.api.deleteMessage(chatId, status.message_id).catch(() => {});
    await sendLong(ctx, result);
  } catch (e) {
    stopLive();
    await ctx.api.editMessageText(chatId, status.message_id, '❌ ' + e.message).catch(() => {});
  }
}

function officeKeyboard() {
  const kb = new InlineKeyboard();
  if (config.publicUrl.startsWith('https://')) kb.webApp('🏢 Открыть офис', config.publicUrl + '/');
  else kb.url('🏢 Офис', config.publicUrl + '/');
  return kb.row().text('👥 Команда', 'team').text('📋 Задачи', 'tasks').row().text('📊 Статистика', 'stats');
}

function teamText() {
  return '👥 Команда офиса:\n\n' + AGENT_LIST.map((a) => {
    const s = agentState[a.id];
    return `${a.emoji} ${a.name} — ${a.role}\n   ${STATUS_ICON[s.status] || ''} ${s.activity}`;
  }).join('\n\n') + '\n\nНапрямую: /timur /liza /borya /nika + задание';
}

function tasksText() {
  const icon = { queued: '🕓', running: '⏳', done: '✅', failed: '❌', cancelled: '⛔' };
  const list = store.tasks.slice(-10).reverse();
  if (!list.length) return 'Заданий пока не было.';
  return '📋 Последние задания:\n\n' + list.map((t) => `${icon[t.status]} ${AGENTS[t.agent].emoji} ${t.text.slice(0, 70)}`).join('\n');
}

function statsText() {
  const s = store.stats;
  return `📊 Статистика\n\nЗаданий выполнено: ${s.tasksDone}\nТокенов: ${s.tokens.toLocaleString('ru-RU')}\nПотрачено: $${s.cost.toFixed(4)}\nМодель: ${config.model}\nФактов в памяти: ${store.memory.length}`;
}

export function startBot() {
  if (!config.botToken) {
    console.warn('[bot] TELEGRAM_BOT_TOKEN не задан — бот выключен, работает только офис');
    return null;
  }
  bot = new Bot(config.botToken);

  // Доступ только владельцу. Если OWNER_IDS пуст — владельцем становится первый написавший.
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (!id) return;
    if (!config.ownerIds.length && !store.owners.length) {
      store.owners.push(id);
      save();
      await ctx.reply('👑 Ты теперь мой владелец. Привет, босс!');
    }
    if (!isOwner(id)) return ctx.reply('Я работаю только на своего босса 🙂');
    return next();
  });

  bot.command('start', (ctx) =>
    ctx.reply(
      `Привет! Я Мирик 👑 — старший ИИ-агент.\nУ меня в офисе работает команда: программист, исследователь, оператор браузера и отличница.\n\nПросто напиши задание — я раздам его своим и пришлю результат.\nМожно кидать фото и файлы.\n\nКоманды:\n/team — команда\n/tasks — задания\n/stop — остановить всё\n/secret имя значение — сохранить логин/пароль для сайтов\n/secrets — список секретов\n/memory — что я о тебе помню\n/files — рабочая папка, /get путь — скачать файл\n/reset — забыть текущий диалог\n/stats — статистика`,
      { reply_markup: officeKeyboard() }
    )
  );
  bot.command('office', (ctx) => ctx.reply('Офис команды 🏢', { reply_markup: officeKeyboard() }));
  bot.command('team', (ctx) => ctx.reply(teamText()));
  bot.command('tasks', (ctx) => ctx.reply(tasksText()));
  bot.command('stats', (ctx) => ctx.reply(statsText()));
  bot.callbackQuery('team', (ctx) => ctx.answerCallbackQuery().then(() => ctx.reply(teamText())));
  bot.callbackQuery('tasks', (ctx) => ctx.answerCallbackQuery().then(() => ctx.reply(tasksText())));
  bot.callbackQuery('stats', (ctx) => ctx.answerCallbackQuery().then(() => ctx.reply(statsText())));
  bot.callbackQuery(/^stop:(.+)$/, async (ctx) => {
    cancelTask(ctx.match[1]);
    await ctx.answerCallbackQuery('Останавливаю…');
  });

  bot.command('stop', (ctx) => {
    const ids = store.tasks.filter((t) => t.status === 'running').map((t) => t.id);
    ids.forEach(cancelTask);
    return ctx.reply(ids.length ? `⛔ Остановил заданий: ${ids.length}` : 'Сейчас ничего не выполняется');
  });

  bot.command('reset', (ctx) => {
    chatHistory(ctx.chat.id).length = 0;
    save();
    return ctx.reply('🧹 Диалог забыт (долгосрочная память осталась, см. /memory)');
  });

  bot.command('memory', (ctx) => {
    const m = store.memory.slice(-30).map((x) => '• ' + x.text).join('\n');
    return ctx.reply(m ? '🧠 Что я помню:\n\n' + m + '\n\n/forgetall — стереть всё' : 'Память пуста');
  });
  bot.command('forgetall', (ctx) => {
    store.memory.length = 0;
    save();
    return ctx.reply('🧠 Память очищена');
  });

  bot.command('secret', async (ctx) => {
    const [name, ...rest] = ctx.match.trim().split(/\s+/);
    await ctx.deleteMessage().catch(() => {});
    if (!name || !rest.length) return ctx.reply('Формат: /secret имя значение\nНапр.: /secret school_login ivanov\nСообщение с паролем я сразу удаляю.');
    store.secrets[name] = rest.join(' ');
    save();
    return ctx.reply(`🔐 Секрет «${name}» сохранён. Агенты вводят его в формы, но не видят значение.`);
  });
  bot.command('secrets', (ctx) => {
    const names = Object.keys(store.secrets);
    return ctx.reply(names.length ? '🔐 Секреты: ' + names.join(', ') + '\n\nУдалить: /delsecret имя' : 'Секретов нет. Добавить: /secret имя значение');
  });
  bot.command('delsecret', (ctx) => {
    delete store.secrets[ctx.match.trim()];
    save();
    return ctx.reply('Удалено');
  });

  bot.command('files', async (ctx) => {
    const dir = ctx.match.trim() || '.';
    try {
      const entries = await fs.readdir(wsPath(dir), { withFileTypes: true });
      const list = entries.slice(0, 60).map((e) => (e.isDirectory() ? '📁 ' + e.name + '/' : '📄 ' + e.name)).join('\n');
      return ctx.reply(`📂 ${dir}\n\n${list || '(пусто)'}\n\nСкачать: /get путь`);
    } catch (e) {
      return ctx.reply('❌ ' + e.message);
    }
  });
  bot.command('get', async (ctx) => {
    try {
      await ctx.replyWithDocument(new InputFile(wsPath(ctx.match.trim())));
    } catch (e) {
      await ctx.reply('❌ ' + e.message);
    }
  });

  for (const a of AGENT_LIST.filter((a) => a.id !== 'mirik')) {
    bot.command(a.id, (ctx) => {
      const text = ctx.match.trim();
      if (!text) return ctx.reply(`${a.emoji} ${a.name} (${a.role}) слушает. Напиши: /${a.id} задание`);
      handleTask(ctx, { text, agent: a.id });
    });
  }

  // Фото -> Мирик видит картинку (модель мультимодальная)
  bot.on('message:photo', async (ctx) => {
    const photo = ctx.message.photo.at(-1);
    const file = await ctx.api.getFile(photo.file_id);
    const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    const caption = ctx.message.caption || 'Что на фото? Если это задание — реши.';
    handleTask(ctx, {
      text: '[фото] ' + caption,
      content: [{ type: 'text', text: caption }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }],
    });
  });

  // Документы -> в рабочую папку inbox/
  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const file = await ctx.api.getFile(doc.file_id);
    const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
    const rel = path.join('inbox', doc.file_name || file.file_path.split('/').pop());
    await fs.mkdir(path.dirname(wsPath(rel)), { recursive: true });
    await fs.writeFile(wsPath(rel), Buffer.from(await res.arrayBuffer()));
    handleTask(ctx, { text: `Пользователь прислал файл ${rel}. ${ctx.message.caption || 'Посмотри, что в нём, и скажи, что с ним сделать.'}` });
  });

  bot.on(['message:voice', 'message:audio', 'message:video_note'], (ctx) => ctx.reply('🎙 Голосовые пока не понимаю — напиши текстом.'));

  bot.on('message:text', (ctx) => {
    handleTask(ctx, { text: ctx.message.text });
  });

  bot.catch((err) => console.error('[bot]', err.message));

  bot.api.setMyCommands([
    { command: 'start', description: 'Меню' },
    { command: 'office', description: 'Открыть офис' },
    { command: 'team', description: 'Команда и кто чем занят' },
    { command: 'tasks', description: 'Последние задания' },
    { command: 'stop', description: 'Остановить все задания' },
    { command: 'secret', description: 'Сохранить логин/пароль' },
    { command: 'secrets', description: 'Список секретов' },
    { command: 'memory', description: 'Что Мирик помнит' },
    { command: 'files', description: 'Рабочая папка' },
    { command: 'reset', description: 'Забыть диалог' },
    { command: 'stats', description: 'Статистика' },
  ]).catch(() => {});
  if (config.publicUrl.startsWith('https://')) {
    bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Офис', web_app: { url: config.publicUrl + '/' } } }).catch(() => {});
  }

  bot.start({ onStart: (me) => console.log(`[bot] @${me.username} запущен`) });
  return bot;
}
