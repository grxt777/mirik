// Цикл работы агентов: думаем -> вызываем инструменты -> отчитываемся. Мирик делегирует подчинённым.
import { chat } from '../llm.js';
import { config } from '../config.js';
import { AGENTS, AGENT_LIST } from './registry.js';
import { bus, log } from '../bus.js';
import { store, save } from '../store.js';
import * as memdb from '../memdb.js';
import { webTools } from '../tools/web.js';
import { fileTools } from '../tools/files.js';
import { browserTools, closeTaskPage } from '../tools/browser.js';
import { docTools } from '../tools/docs.js';
import { videoTools } from '../tools/video.js';
import { scrub, scrubAll, addJournal, recallFor, officeState, compressHistory } from '../memory.js';

// Расход: лимит токенов на одну задачу (вся команда вместе) — примерно $0.02 по цене самого дешёвого провайдера
const TASK_TOKEN_BUDGET = 400_000;
// Сколько последних результатов инструментов держать целиком; более старые сжимаются
const KEEP_FULL_RESULTS = 2;

// Задачи, прерванные перезапуском сервера, не должны висеть «в работе»
for (const t of store.tasks) if (t.status === 'running' || t.status === 'queued' || t.status === 'paused') {
  t.status = 'interrupted';
  t.result = t.result || 'Прервано перезапуском сервера';
  t.finishedAt = t.finishedAt || Date.now();
}
scrubAll();

// ---------- состояние агентов (для офиса) ----------
export const agentState = Object.fromEntries(
  AGENT_LIST.map((a) => [a.id, { id: a.id, status: 'idle', activity: 'отдыхает', taskId: null, updatedAt: Date.now() }])
);

function setState(id, patch) {
  Object.assign(agentState[id], patch, { updatedAt: Date.now() });
  bus.emit('event', { type: 'agent', agent: agentState[id] });
}

// ---------- задачи ----------
const running = new Map(); // taskId -> { cancelled, paused, tokens }

export function createTask({ text, agent = 'mirik', source = 'panel', chatId = null }) {
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    text: scrub(text).slice(0, 2000),
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
  task.steps.push({ t: Date.now(), agent, text: scrub(text).slice(0, 300) });
  if (task.steps.length > 120) task.steps.shift();
  bus.emit('event', { type: 'task', task });
}

export function cancelTask(id) {
  const r = running.get(id);
  if (r) { r.cancelled = true; r.paused = false; }
  return !!r;
}

// Пауза: агенты дорабатывают текущий шаг (запущенный инструмент) и замирают до «Продолжить»
export function pauseTask(id) {
  const r = running.get(id);
  const task = store.tasks.find((t) => t.id === id);
  if (!r || !task || r.paused) return false;
  r.paused = true;
  task.status = 'paused';
  taskStep(task, task.agent, '⏸ Поставлено на паузу');
  save();
  return true;
}

export function resumeTask(id) {
  const r = running.get(id);
  const task = store.tasks.find((t) => t.id === id);
  if (!r || !task || !r.paused) return false;
  r.paused = false;
  task.status = 'running';
  taskStep(task, task.agent, '▶ Продолжено');
  save();
  return true;
}

async function waitIfPaused(ctx, agentId) {
  if (!ctx.control?.paused) return;
  setState(agentId, { status: 'paused', activity: '⏸ на паузе', taskId: ctx.taskId });
  while (ctx.control.paused && !ctx.control.cancelled) await new Promise((r) => setTimeout(r, 700));
  setState(agentId, { status: 'thinking', activity: 'думает…', taskId: ctx.taskId });
}

// «Сейчас соберу раскадровку…» вместо работы: модель описала план и закончила ход без инструментов
const INTENT = /(^|\s)(собираю|начинаю|приступаю|займусь|запускаю|перехожу|пишу|делаю|готовлю|сейчас\s+(сделаю|соберу|напишу|займусь|подготовлю|проверю)|далее\s+(сделаю|соберу))/i;
const DONE_MARK = /(готово|сохранил|записал|отправил|создал|собрал|результат|итог|projects\/|\.(md|json|mp4|png|docx|pdf|py)\b)/i;
const looksLikeIntent = (text) => text.length < 500 && INTENT.test(text) && !DONE_MARK.test(text.replace(/^✅\s*/, '').replace(/^готово[.!]?\s*/i, ''));

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
    description: 'Запомнить важный долгий факт о владельце или делах (предпочтения, люди, учёба, договорённости). Один факт — одна короткая фраза.',
    parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] },
    async run({ fact }) {
      const id = memdb.addFact(scrub(fact), 'manual');
      return id ? `Запомнил (факт #${id})` : 'Такой факт уже есть';
    },
  },
  {
    name: 'recall',
    description: 'Поиск по всей долгой памяти: факты о владельце, прошлые задачи с результатами, вся прошлая переписка. Ищет по словам — если не нашлось, переформулируй (синонимы, другие слова, английский/узбекский вариант) и поищи ещё раз.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Ключевые слова, не целая фраза' } }, required: ['query'] },
    async run({ query }) {
      const hits = memdb.search(query, { k: 10 });
      return hits.length ? hits.map((l) => '- ' + l).join('\n') : 'Ничего не нашлось — попробуй другие слова.';
    },
  },
  {
    name: 'forget',
    description: 'Удалить устаревший или неверный факт из памяти по его номеру (#id).',
    parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    async run({ id }) {
      return memdb.deleteFact(id) ? 'Удалил' : 'Нет такого факта';
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
        body: JSON.stringify({ text, from: AGENTS[ctx.agentId]?.name || 'Мирик', chat_id: typeof ctx.task?.chatId === 'number' ? ctx.task.chatId : store.homeChat }),
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

const TOOLS = Object.fromEntries([...builtinTools, ...webTools, ...fileTools, ...browserTools, ...docTools, ...videoTools].map((t) => [t.name, t]));

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
    case 'browser_download': return 'скачивает файл';
    case 'read_document': return `читает ${short(args.path)}`;
    case 'make_document': return `оформляет ${short(args.path)}`;
    case 'html_to_pdf': return `собирает PDF ${short(args.out)}`;
    case 'build_video': return args.quality === 'draft' ? 'собирает черновик ролика' : 'монтирует ролик';
    case 'render_video': return 'рендерит свой монтаж';
    case 'render_image': return 'делает обложку';
    case 'download_media': return 'качает медиа';
    case 'youtube_search': return `смотрит YouTube: «${short(args.query, 30)}»`;
    case 'delegate': return `поручает ${AGENTS[args.agent]?.name || ''}`;
    case 'ask_sanya': return 'пишет Сане';
    case 'send_file': return 'отправляет файл';
    case 'remember': return 'записывает в блокнот';
    default: return name;
  }
}

// Старые результаты инструментов (снимки страниц, вывод терминала) больше не нужны модели целиком —
// без этого каждый следующий шаг заново отправляет всё, и расход растёт квадратично.
function compact(messages) {
  const toolIdx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  for (const i of toolIdx.slice(0, -KEEP_FULL_RESULTS)) {
    const m = messages[i];
    if (m.content.length > 1500) m.content = m.content.slice(0, 1000) + `\n…[сокращено: старый результат, было ${m.content.length} симв.]`;
  }
}

function mirikContext(ctx, input) {
  const query = typeof input === 'string' ? input : input.find?.((p) => p.type === 'text')?.text || '';
  const parts = [];
  const facts = memdb.listFacts(40);
  if (facts.length) parts.push('Что ты знаешь о владельце (факты, #id для forget):\n' + facts.map((f) => `- #${f.id} ${f.text}`).join('\n'));
  const summary = ctx.task?.chatId != null && memdb.summary(ctx.task.chatId);
  if (summary) parts.push('Сводка более ранней переписки в этом чате:\n' + summary);
  const recalled = recallFor(query, { skipMsgIds: ctx.historyIds, skipTaskIds: new Set([ctx.taskId]) });
  if (recalled) parts.push('Из памяти (похожие прошлые задачи и факты):\n' + recalled);
  parts.push('СОСТОЯНИЕ ОФИСА (правда на текущий момент — опирайся на это, не выдумывай):\n' + officeState(agentState, AGENTS, ctx.taskId));
  return '\n\n' + parts.join('\n\n');
}

// ---------- цикл агента ----------
export async function runAgent({ agentId, input, history = [], ctx }) {
  const agent = AGENTS[agentId];
  const tools = agent.tools.map((n) => TOOLS[n]).filter(Boolean);
  const maxSteps = agentId === 'mirik' ? 15 : 20;
  const extra = agentId === 'mirik' ? mirikContext(ctx, input) : '';
  const system = `${agent.prompt}${extra}\n\nСейчас: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}. Рабочая папка общая для всей команды. Экономь токены: не перечитывай одно и то же, не повторяй шаги.`;
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: input }];
  const budget = (ctx.control ||= {});
  budget.tokens ||= 0;
  const actx = { ...ctx, agentId };

  setState(agentId, { status: 'thinking', activity: 'думает…', taskId: ctx.taskId });
  let nudges = 0, lastKey = '', repeats = 0;
  try {
    for (let step = 0; step < maxSteps; step++) {
      if (ctx.control?.cancelled) throw new Error('Задача отменена');
      await waitIfPaused(ctx, agentId);
      if (ctx.control?.cancelled) throw new Error('Задача отменена');
      compact(messages);
      const over = budget.tokens > TASK_TOKEN_BUDGET;
      if (over) messages.push({ role: 'user', content: 'Лимит токенов на задачу исчерпан. Больше никаких инструментов — сразу дай итоговый отчёт по тому, что уже сделано.' });
      const msg = await chat({ messages, tools: over ? [] : tools.map(toolSchema), agent: agentId });
      budget.tokens += msg._usage?.total_tokens || 0;
      const calls = msg.tool_calls || [];
      if (!calls.length) {
        const text = (msg.content || '').trim() || 'Готово.';
        // описал намерение вместо работы — возвращаем к делу (максимум дважды)
        if (looksLikeIntent(text) && nudges < 2 && step < maxSteps - 2 && !over) {
          nudges++;
          messages.push({ role: 'assistant', content: text });
          messages.push({ role: 'user', content: 'Ты описал, что собираешься сделать, но не сделал. Выполни это прямо сейчас инструментами (без «сейчас соберу/начинаю»), и только потом дай отчёт с результатом.' });
          taskStep(ctx.task, agentId, '↩ возвращаю к делу: ' + text.slice(0, 80));
          continue;
        }
        taskStep(ctx.task, agentId, '✅ ' + text);
        return text;
      }
      // одно и то же раз за разом (например, опрос папки в ожидании) — останавливаем
      const key = calls.map((c) => c.function.name + c.function.arguments).join('|');
      repeats = key === lastKey ? repeats + 1 : 0;
      lastKey = key;
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
          return { role: 'tool', tool_call_id: call.id, content: scrub(content).slice(0, 12000) };
        })
      );
      if (repeats >= 2) {
        results.at(-1).content += '\n\n[СИСТЕМА] Ты третий раз подряд делаешь одно и то же. Не жди и не опрашивай: сотрудники работают синхронно — если отчёт пришёл, работа закончена. Смени подход или подведи итог.';
      }
      messages.push(...results);
      setState(agentId, { status: 'thinking', activity: 'думает…' });
    }
    // лимит шагов: не обрываемся на полуслове, а просим честный итог без инструментов
    messages.push({ role: 'user', content: 'Лимит шагов исчерпан. Без инструментов коротко: что сделано (с путями файлов), что не успел и что предлагаешь сделать дальше.' });
    const fin = await chat({ messages, tools: [], agent: agentId, maxTokens: 800 }).catch(() => null);
    const text = (fin?.content || '').trim() || 'Не уложился в лимит шагов — работа прервана.';
    taskStep(ctx.task, agentId, '⏹ ' + text);
    return text;
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
    task.result = scrub(result);
    store.stats.tasksDone++;
    addJournal(task);
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
  const window = memdb.history(chatId, 20);
  const history = window.map(({ role, content }) => ({ role, content }));
  const result = await runTask(task, { ...io, historyIds: new Set(window.map((m) => m.id)) }, { input: content ?? text, history });
  memdb.addMessage(chatId, 'user', scrub(text));
  memdb.addMessage(chatId, 'assistant', scrub(result));
  // старая переписка не выбрасывается, а сжимается в сводку
  compressHistory(chatId, async (prev, chunk) => (await chat({
    maxTokens: 900,
    temperature: 0.2,
    agent: 'mirik',
    messages: [
      { role: 'system', content: 'Сожми переписку владельца с ИИ-агентом Мириком. Формат ответа строго:\nСВОДКА:\n<до 1500 символов по пунктам: договорённости, решения, текущие дела, что сделано и что осталось>\nФАКТЫ:\n- <долгие факты о владельце: учёба, работа, предпочтения, люди, цели — по одному в строке; если новых нет, напиши «- нет»>' },
      { role: 'user', content: `Прошлая сводка:\n${prev || '—'}\n\nНовая часть переписки:\n${chunk}` },
    ],
  })).content || prev).catch(() => {});
  return { task, result };
}
