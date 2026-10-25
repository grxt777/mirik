// Цикл работы агентов: думаем -> вызываем инструменты -> отчитываемся. Мирик делегирует подчинённым.
import { chat } from '../llm.js';
import { config } from '../config.js';
import { AGENTS, AGENT_LIST } from './registry.js';
import { bus, log } from '../bus.js';
import { store, save, addMemory, chatHistory, pushHistory } from '../store.js';
import { webTools } from '../tools/web.js';
import { fileTools } from '../tools/files.js';
import { browserTools, closeTaskPage } from '../tools/browser.js';

// ---------- состояние агентов (для офиса) ----------
export const agentState = Object.fromEntries(
  AGENT_LIST.map((a) => [a.id, { id: a.id, status: 'idle', activity: 'отдыхает', taskId: null, updatedAt: Date.now() }])
);

function setState(id, patch) {
  Object.assign(agentState[id], patch, { updatedAt: Date.now() });
  bus.emit('event', { type: 'agent', agent: agentState[id] });
}

// ---------- задачи ----------
const running = new Map(); // taskId -> { cancelled }

export function createTask({ text, agent = 'mirik', source = 'panel', chatId = null }) {
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    text: String(text).slice(0, 2000),
    agent,
    status: 'queued',
    source,
    chatId,
    createdAt: Date.now(),
    steps: [],
    result: null,
  };
  store.tasks.push(task);
  if (store.tasks.length > 200) store.tasks.shift();
  save();
  bus.emit('event', { type: 'task', task });
  return task;
}

function taskStep(task, agent, text) {
  task.steps.push({ t: Date.now(), agent, text: String(text).slice(0, 300) });
  if (task.steps.length > 120) task.steps.shift();
  bus.emit('event', { type: 'task', task });
}

export function cancelTask(id) {
  const r = running.get(id);
  if (r) r.cancelled = true;
  return !!r;
}

// ---------- инструменты ----------
const builtinTools = [
  {
    name: 'delegate',
    description: 'Поручить задачу сотруднику и получить его отчёт. Можно вызывать несколько раз параллельно.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: AGENT_LIST.filter((a) => a.id !== 'mirik').map((a) => a.id) },
        task: { type: 'string', description: 'Подробное задание со всем нужным контекстом' },
      },
      required: ['agent', 'task'],
    },
    async run({ agent, task }, ctx) {
      if (!AGENTS[agent] || agent === 'mirik') return 'Нет такого сотрудника';
      if (ctx.depth > 1) return 'Слишком глубокое делегирование';
      bus.emit('event', { type: 'delegate', from: ctx.agentId, to: agent, text: task.slice(0, 120) });
      log(ctx.agentId, `→ ${AGENTS[agent].name}: ${task}`, 'delegate');
      const report = await runAgent({ agentId: agent, input: task, ctx: { ...ctx, depth: ctx.depth + 1 } });
      bus.emit('event', { type: 'report', from: agent, to: ctx.agentId });
      return `Отчёт от ${AGENTS[agent].name}:\n${report}`;
    },
  },
  {
    name: 'remember',
    description: 'Запомнить важный факт о владельце или делах надолго.',
    parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] },
    async run({ fact }) {
      addMemory(fact);
      return 'Запомнил';
    },
  },
  {
    name: 'recall',
    description: 'Поиск по долгосрочной памяти.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run({ query }) {
      const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const hits = store.memory.filter((m) => words.some((w) => m.text.toLowerCase().includes(w)));
      return (hits.length ? hits : store.memory.slice(-15)).map((m) => '- ' + m.text).join('\n') || 'Память пуста';
    },
  },
  {
    name: 'ask_sanya',
    description: 'Написать Сане — личному ассистенту владельца — и получить ответ. Саня ведёт память о владельце, дневник (дни, деньги, здоровье), свои таблицы, напоминания, будильники на iPhone, дедлайны e-class. Ты старший — можешь поручать ему изменения.',
    parameters: { type: 'object', properties: { text: { type: 'string', description: 'Вопрос или поручение со всем нужным контекстом' } }, required: ['text'] },
    async run({ text }, ctx) {
      if (!config.sanyaUrl || !config.linkToken) return 'Связь с Саней не настроена';
      // задачу от Сани обратно ему не отдаём — иначе они будут гонять её по кругу
      if (ctx.fromSanya) return 'Это задание пришло от Сани — не передавай его обратно, сделай сам.';
      bus.emit('event', { type: 'delegate', from: ctx.agentId, to: 'sanya', text: text.slice(0, 120) });
      log(ctx.agentId, `→ Саня: ${text}`, 'delegate');
      const res = await fetch(`${config.sanyaUrl}/link/ask`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.linkToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, from: AGENTS[ctx.agentId]?.name || 'Мирик' }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json().catch(() => ({}));
      if (data.pending) return 'Саня ещё работает — результат он пришлёт владельцу в Telegram сам.';
      return data.reply ? `Ответ Сани:\n${data.reply}` : `Ошибка связи с Саней: ${data.error || 'HTTP ' + res.status}`;
    },
  },
  {
    name: 'notify_user',
    description: 'Отправить владельцу промежуточное сообщение о прогрессе.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async run({ text }, ctx) {
      await ctx.notify?.(text);
      return 'Отправлено';
    },
  },
];

const TOOLS = Object.fromEntries([...builtinTools, ...webTools, ...fileTools, ...browserTools].map((t) => [t.name, t]));

const toolSchema = (t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } });

function activityLabel(name, args) {
  const short = (s, n = 40) => (String(s || '').length > n ? String(s).slice(0, n) + '…' : String(s || ''));
  switch (name) {
    case 'web_search': return `гуглит «${short(args.query)}»`;
    case 'fetch_url': return `читает ${short(args.url)}`;
    case 'run_code': return `запускает ${args.language}`;
    case 'write_file': return `пишет ${short(args.path)}`;
    case 'read_file': return `читает ${short(args.path)}`;
    case 'browser_open': return `открывает ${short(args.url)}`;
    case 'browser_click': return 'кликает';
    case 'browser_type': case 'browser_fill_secret': return 'печатает в форму';
    case 'browser_screenshot': return 'делает скриншот';
    case 'delegate': return `поручает ${AGENTS[args.agent]?.name || ''}`;
    case 'ask_sanya': return 'пишет Сане';
    case 'send_file': return 'отправляет файл';
    case 'remember': return 'записывает в блокнот';
    default: return name;
  }
}

// ---------- цикл агента ----------
export async function runAgent({ agentId, input, history = [], ctx }) {
  const agent = AGENTS[agentId];
  const tools = agent.tools.map((n) => TOOLS[n]).filter(Boolean);
  const maxSteps = agentId === 'mirik' ? 20 : 30;
  const memory = agentId === 'mirik' && store.memory.length
    ? '\n\nЧто ты помнишь о владельце:\n' + store.memory.slice(-30).map((m) => '- ' + m.text).join('\n')
    : '';
  const system = `${agent.prompt}${memory}\n\nСейчас: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}. Рабочая папка общая для всей команды.`;
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: input }];
  const actx = { ...ctx, agentId };

  setState(agentId, { status: 'thinking', activity: 'думает…', taskId: ctx.taskId });
  try {
    for (let step = 0; step < maxSteps; step++) {
      if (ctx.control?.cancelled) throw new Error('Задача отменена');
      const msg = await chat({ messages, tools: tools.map(toolSchema) });
      const calls = msg.tool_calls || [];
      if (!calls.length) {
        const text = (msg.content || '').trim() || 'Готово.';
        taskStep(ctx.task, agentId, '✅ ' + text);
        return text;
      }
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      if (msg.content) taskStep(ctx.task, agentId, '💭 ' + msg.content);

      const results = await Promise.all(
        calls.map(async (call) => {
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
          const tool = TOOLS[call.function.name];
          const label = activityLabel(call.function.name, args);
          setState(agentId, { status: call.function.name === 'delegate' ? 'managing' : 'working', activity: label, taskId: ctx.taskId });
          taskStep(ctx.task, agentId, '🔧 ' + label);
          log(agentId, label, 'tool');
          let content;
          try {
            content = tool ? String(await tool.run(args, actx)) : `Нет инструмента ${call.function.name}`;
          } catch (e) {
            content = 'Ошибка: ' + e.message;
            log(agentId, content, 'error');
          }
          return { role: 'tool', tool_call_id: call.id, content: content.slice(0, 20000) };
        })
      );
      messages.push(...results);
      setState(agentId, { status: 'thinking', activity: 'думает…' });
    }
    return 'Не уложился в лимит шагов. Вот что успел: ' + (messages.at(-1)?.content || '').slice(0, 1500);
  } finally {
    setState(agentId, { status: 'idle', activity: 'отдыхает', taskId: null });
  }
}

// Главная точка входа: задание для Мирика (или конкретного агента).
// io: { notify(text), sendFile(path, caption), sendPhoto(buf, caption) }
export async function runTask(task, io = {}, { input, history = [] } = {}) {
  const control = { cancelled: false };
  running.set(task.id, control);
  task.status = 'running';
  bus.emit('event', { type: 'task', task });
  log(task.agent, `Новое задание: ${task.text}`, 'task');
  try {
    const result = await runAgent({
      agentId: task.agent,
      input: input ?? task.text,
      history,
      ctx: { task, taskId: task.id, depth: 0, control, ...io },
    });
    task.status = 'done';
    task.result = result;
    store.stats.tasksDone++;
    return result;
  } catch (e) {
    task.status = control.cancelled ? 'cancelled' : 'failed';
    task.result = 'Ошибка: ' + e.message;
    log(task.agent, task.result, 'error');
    throw e;
  } finally {
    task.finishedAt = Date.now();
    running.delete(task.id);
    closeTaskPage(task.id);
    save();
    bus.emit('event', { type: 'task', task });
  }
}

// Диалог с Мириком в чате с памятью разговора.
export async function talkToMirik(chatId, { text, content, source = 'telegram', onTask }, io) {
  const task = createTask({ text, agent: 'mirik', source, chatId });
  onTask?.(task);
  const history = chatHistory(chatId).slice(-20);
  const result = await runTask(task, io, { input: content ?? text, history });
  pushHistory(chatId, { role: 'user', content: text });
  pushHistory(chatId, { role: 'assistant', content: result });
  return { task, result };
}
