// Цикл работы агентов: думаем -> вызываем инструменты -> отчитываемся. Мирик делегирует подчинённым.
import { chat } from '../llm.js';
import { config } from '../config.js';
import { AGENTS, AGENT_LIST } from './registry.js';
import { bus, log } from '../bus.js';
import { store, save } from '../store.js';
import * as memdb from '../memdb.js';
import { webTools } from '../tools/web.js';
import { fileTools } from '../tools/files.js';
import { browserTools, inspectTools, closeTaskPage } from '../tools/browser.js';
import { docTools } from '../tools/docs.js';
import { vcTools } from '../tools/vc.js';
import { lookup as vcLookup, formatLookup as vcFormat, autoRecord as vcAutoRecord } from '../vcbase.js';
import { wsPath } from '../tools/files.js';
import { scrub, scrubAll, addJournal, recallFor, officeState, compressHistory } from '../memory.js';

// Уточняющих вопросов владельцу — не больше этого на одну задачу
const MAX_QUESTIONS = 5;

// Расход: лимит токенов на одну задачу (вся команда вместе) — примерно $0.02 по цене самого дешёвого провайдера
const TASK_TOKEN_BUDGET = 500_000;
// IT-проект — целая команда (план, дизайн, бэк в паре, фронт, тест и правки): ему лимит больше, ~$0.08
const IT_TOKEN_BUDGET = 2_000_000;
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
  updateProgress(task);
  bus.emit('event', { type: 'task', task });
}

// ---------- прогресс задачи (0–100%) ----------
// Дерево работы: каждый запуск сотрудника — узел; поручения идут «этапами» (пачка delegate в одном ответе).
// Прогресс узла = пройденные этапы + средний прогресс тех, кто работает сейчас; без поручений — по числу шагов.
const roots = new Map(); // taskId -> корневой узел
// Сколько этапов поручений обычно у процесса, который начинается с этого сотрудника
const ROUNDS_HINT = { borya: 2, artem: 2, dina: 2, kamila: 2, sanjar: 2 };

function newNode(agentId) {
  return { agentId, step: 0, done: false, expected: AGENTS[agentId]?.rounds || 0, roundsDone: 0, inRound: false, current: [] };
}
function nodeProgress(n) {
  if (n.done) return 1;
  const own = 1 - Math.exp(-n.step / 6); // каждый шаг ближе к концу, но 100% — только по факту
  if (!n.expected && !n.roundsDone && !n.inRound) return 0.92 * own;
  const cur = n.current.length ? n.current.reduce((x, c) => x + nodeProgress(c), 0) / n.current.length : 0;
  const stages = Math.max(n.expected, n.roundsDone + (n.inRound ? 1 : 0), 1);
  return 0.05 + 0.88 * Math.min(1, (n.roundsDone + (n.inRound ? cur : 0)) / stages);
}
function updateProgress(task) {
  const root = roots.get(task.id);
  if (!root || !ACTIVE_STATUSES.has(task.status)) return;
  const p = Math.min(99, Math.round(nodeProgress(root) * 100));
  task.progress = Math.max(task.progress || 0, p); // полоска не ползёт назад
  // оценка остатка: сколько уже шло (без ожидания ответов владельца) × сколько осталось
  const spent = Date.now() - task.createdAt - (task.waitMs || 0);
  task.etaMs = task.progress >= 8 ? Math.round(spent * (100 - task.progress) / task.progress) : null;
}
const ACTIVE_STATUSES = new Set(['running', 'paused', 'queued']);

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
      const team = AGENTS[ctx.agentId]?.team;
      if (team && !team.includes(agent)) return `Поручать можно только своей команде: ${team.join(', ')}`;
      if (ctx.depth > 1) return 'Слишком глубокое делегирование';
      if (AGENTS[agent].dept === 'it') ctx.control.limit = Math.max(ctx.control.limit || 0, IT_TOKEN_BUDGET);
      bus.emit('event', { type: 'delegate', from: ctx.agentId, to: agent, text: task.slice(0, 120) });
      log(ctx.agentId, `→ ${AGENTS[agent].name}: ${task}`, 'delegate');
      const report = await runAgent({ agentId: agent, input: task, ctx: { ...ctx, depth: ctx.depth + 1, delegated: true } });
      bus.emit('event', { type: 'report', from: agent, to: ctx.agentId });
      return `Отчёт от ${AGENTS[agent].name}:\n${report}`;
    },
  },
  {
    name: 'ask_colleague',
    description: 'Переговорить с коллегой, с которым вы работаете вместе: договориться об интерфейсе, задать вопрос, попросить ревью или оценку. Коллега не видит твоей переписки — дай ему суть и пути файлов. Возвращает его ответ.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: [...new Set(AGENT_LIST.flatMap((a) => a.peers || []))] },
        message: { type: 'string', description: 'Сообщение коллеге: контекст, вопрос или что проверить, пути файлов' },
      },
      required: ['agent', 'message'],
    },
    async run({ agent, message }, ctx) {
      const me = AGENTS[ctx.agentId];
      if (!me?.peers?.includes(agent)) return `Переговариваться можно только с: ${(me?.peers || []).join(', ') || 'никем'}`;
      // отвечающий не переспрашивает обратно — иначе пара уйдёт в бесконечный разговор
      if (ctx.talking) return 'Ты сейчас отвечаешь коллеге — не переспрашивай, ответь ему в своём отчёте.';
      bus.emit('event', { type: 'delegate', from: ctx.agentId, to: agent, text: message.slice(0, 120), talk: true });
      log(ctx.agentId, `💬 ${AGENTS[agent].name}: ${message}`, 'delegate');
      const input = `Сообщение от коллеги — ${me.name} (${me.role}), вы вместе работаете над задачей:\n${message}\n\nОтветь по делу: на вопрос, с ревью или оценкой (файл, место, как исправить). Можешь читать файлы и запускать код, но его работу за него не переделывай.`;
      const reply = await runAgent({ agentId: agent, input, ctx: { ...ctx, depth: ctx.depth + 1, talking: true } });
      bus.emit('event', { type: 'report', from: agent, to: ctx.agentId, talk: true });
      return `Ответ от ${AGENTS[agent].name}:\n${reply}`;
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
    name: 'ask_owner',
    description: `Задать владельцу уточняющие вопросы в Telegram и дождаться ответов. Только если без ответа нельзя сделать хорошо и его не узнать из памяти, контекста или у Сани. Все вопросы — одним вызовом, до начала работы. Максимум ${MAX_QUESTIONS} на задачу. Давай 2–4 варианта ответа, где можно.`,
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          maxItems: MAX_QUESTIONS,
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'Короткий конкретный вопрос' },
              options: { type: 'array', maxItems: 4, items: { type: 'string' }, description: 'Варианты-кнопки (коротко), владелец может ответить и своим текстом' },
            },
            required: ['question'],
          },
        },
      },
      required: ['questions'],
    },
    async run({ questions = [] }, ctx) {
      if (ctx.depth > 0 || !ctx.ask) return 'Спросить владельца сейчас нельзя — прими разумное решение сам и назови допущение в ответе.';
      const left = MAX_QUESTIONS - (ctx.control.asked || 0);
      if (left <= 0) return `Лимит ${MAX_QUESTIONS} вопросов на задачу исчерпан — дальше решай сам и назови допущения в ответе.`;
      const list = questions.filter((q) => q?.question).slice(0, left);
      const out = [];
      for (const [i, q] of list.entries()) {
        if (ctx.control.cancelled) throw new Error('Задача отменена');
        ctx.control.asked = (ctx.control.asked || 0) + 1;
        setState(ctx.agentId, { status: 'waiting', activity: 'ждёт ответа владельца', taskId: ctx.taskId });
        taskStep(ctx.task, ctx.agentId, '❓ ' + q.question);
        const waitFrom = Date.now();
        const answer = await ctx.ask({ question: q.question, options: q.options || [], n: i + 1, total: list.length, cancelled: () => ctx.control.cancelled });
        ctx.task.waitMs = (ctx.task.waitMs || 0) + Date.now() - waitFrom;
        if (ctx.control.cancelled) throw new Error('Задача отменена');
        const a = answer ? scrub(answer) : null;
        (ctx.task.qa ||= []).push({ q: q.question, a });
        out.push(`В: ${q.question}\nО: ${a ?? 'владелец не ответил / «решай сам» — прими разумное решение и назови его'}`);
      }
      const cut = questions.length > list.length ? `\n\n(Ещё ${questions.length - list.length} вопр. не задано — лимит ${MAX_QUESTIONS}. Решай сам.)` : '';
      return out.join('\n\n') + cut;
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

const TOOLS = Object.fromEntries([...builtinTools, ...webTools, ...fileTools, ...browserTools, ...inspectTools, ...docTools, ...vcTools].map((t) => [t.name, t]));

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
    case 'vc_lookup': return `листает базу: «${short(args.query, 30)}»`;
    case 'vc_save_facts': return `записывает в базу ${args.facts?.length || ''} фактов`;
    case 'vc_record_idea': return 'заносит идею в энциклопедию';
    case 'delegate': return `поручает ${AGENTS[args.agent]?.name || ''}`;
    case 'ask_colleague': return `обсуждает с ${AGENTS[args.agent]?.name || 'коллегой'}`;
    case 'inspect_page': return `смотрит ${short(args.target)}`;
    case 'ask_sanya': return 'пишет Сане';
    case 'ask_owner': return 'уточняет у владельца';
    case 'send_file': return 'отправляет файл';
    case 'remember': return 'записывает в блокнот';
    default: return name;
  }
}

// Старые результаты инструментов (снимки страниц, вывод терминала) больше не нужны модели целиком —
// без этого каждый следующий шаг заново отправляет всё, и расход растёт квадратично.
// Скриншоты от инструментов тоже дорогие: модели хватает двух последних осмотров
const SHOTS = new WeakSet();
const KEEP_SHOTS = 2;
function compact(messages) {
  const toolIdx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  for (const i of toolIdx.slice(0, -KEEP_FULL_RESULTS)) {
    const m = messages[i];
    if (m.content.length > 1500) m.content = m.content.slice(0, 1000) + `\n…[сокращено: старый результат, было ${m.content.length} симв.]`;
  }
  for (const m of messages.filter((x) => SHOTS.has(x)).slice(0, -KEEP_SHOTS)) {
    m.content = '[старые скриншоты убраны для экономии — файлы остались в папке shots]';
    SHOTS.delete(m);
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
  // CTO видит в поручениях только свою команду, пары — только напарника
  const schemas = tools.map((t) => {
    const sc = toolSchema(t);
    const only = t.name === 'delegate' ? agent.team : t.name === 'ask_colleague' ? agent.peers : null;
    if (only) sc.function.parameters = { ...sc.function.parameters, properties: { ...sc.function.parameters.properties, agent: { type: 'string', enum: only } } };
    return sc;
  });
  const maxSteps = agent.maxSteps || (agentId === 'mirik' ? 15 : 20);
  let extra = agentId === 'mirik' ? mirikContext(ctx, input) : '';
  // венчурщики начинают с энциклопедии StartupBase: что уже известно по теме — не ищут заново
  if (agent.dept === 'vc') {
    const base = vcFormat(vcLookup(typeof input === 'string' ? input : '', { k: 10 }));
    extra += '\n\nИЗ ЭНЦИКЛОПЕДИИ STARTUPBASE (уже проверено командой раньше — используй и ссылайся, ищи в интернете только недостающее):\n' + (base || 'по этой теме в базе пока пусто');
  }
  const system = `${agent.prompt}${extra}\n\nСейчас: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}. Рабочая папка общая для всей команды. Экономь токены: не перечитывай одно и то же, не повторяй шаги.`;
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: input }];
  const budget = (ctx.control ||= {});
  budget.tokens ||= 0;
  // узел в дереве прогресса: поручение — ребёнок того, кто поручил
  const node = newNode(agentId);
  if (ctx.node && ctx.delegated) ctx.node.current.push(node);
  else if (!ctx.node) roots.set(ctx.taskId, node);
  const actx = { ...ctx, agentId, node, delegated: false };

  setState(agentId, { status: 'thinking', activity: 'думает…', taskId: ctx.taskId });
  let nudges = 0, lastKey = '', repeats = 0;
  try {
    for (let step = 0; step < maxSteps; step++) {
      node.step = step;
      if (ctx.control?.cancelled) throw new Error('Задача отменена');
      await waitIfPaused(ctx, agentId);
      if (ctx.control?.cancelled) throw new Error('Задача отменена');
      compact(messages);
      const over = budget.tokens > (budget.limit || TASK_TOKEN_BUDGET);
      if (over) messages.push({ role: 'user', content: 'Лимит токенов на задачу исчерпан. Больше никаких инструментов — сразу дай итоговый отчёт по тому, что уже сделано.' });
      const msg = await chat({ messages, tools: over ? [] : schemas, agent: agentId });
      budget.tokens += msg._usage?.total_tokens || 0;
      const calls = msg.tool_calls || [];
      if (!calls.length) {
        const text = (msg.content || '').trim();
        // пустой ответ — не «готово»; описал намерение вместо работы; венчурщик не сохранил мнение — возвращаем к делу
        const why = !text ? 'Твой ответ пустой. Сделай работу инструментами и дай отчёт с результатом.'
          : looksLikeIntent(text) ? 'Ты описал, что собираешься сделать, но не сделал. Выполни это прямо сейчас инструментами (без «сейчас соберу/начинаю»), и только потом дай отчёт с результатом.'
          : agent.dept === 'vc' && !actx.opinionSaved && /projects\/vc\//.test(String(input)) ? 'Ты не сохранил своё мнение в файл projects/vc/<имя>/opinions/' + agentId + '.md (папку назвали в задании). Сохрани его сейчас через write_file — с «Оценка: X/10» и «Вердикт:» — и потом дай отчёт.'
          : null;
        if (why && nudges < 2 && step < maxSteps - 1 && !over) {
          nudges++;
          messages.push({ role: 'assistant', content: text || '…' });
          messages.push({ role: 'user', content: why });
          taskStep(ctx.task, agentId, '↩ возвращаю к делу' + (text ? ': ' + text.slice(0, 70) : ''));
          continue;
        }
        if (!text) { taskStep(ctx.task, agentId, '⚠️ пустой ответ'); return 'Сотрудник не дал ответа — результата нет.'; }
        taskStep(ctx.task, agentId, '✅ ' + text);
        return text;
      }
      // одно и то же раз за разом (например, опрос папки в ожидании) — останавливаем
      const key = calls.map((c) => c.function.name + c.function.arguments).join('|');
      repeats = key === lastKey ? repeats + 1 : 0;
      lastKey = key;
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      if (msg.content) taskStep(ctx.task, agentId, '💭 ' + msg.content);

      // пачка поручений — новый этап; сколько этапов ждать, видно по тому, кому поручили
      const deleg = calls.filter((c) => c.function.name === 'delegate');
      if (deleg.length) {
        const targets = deleg.map((c) => { try { return JSON.parse(c.function.arguments).agent; } catch { return null; } });
        if (!node.roundsDone) node.expected = Math.max(node.expected, ...targets.map((t) => ROUNDS_HINT[t] || 1));
        node.inRound = true;
        node.current = [];
      }
      const results = await Promise.all(
        calls.map(async (call) => {
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
          const tool = TOOLS[call.function.name];
          const label = activityLabel(call.function.name, args);
          setState(agentId, { status: call.function.name === 'delegate' ? 'managing' : 'working', activity: label, taskId: ctx.taskId });
          taskStep(ctx.task, agentId, '🔧 ' + label);
          log(agentId, label, 'tool');
          let content, images;
          try {
            const out = tool ? await tool.run(args, actx) : `Нет инструмента ${call.function.name}`;
            if (out && typeof out === 'object' && out.images) ({ text: content, images } = out);
            content = String(content ?? out);
            // мнение совета сохранено → отметка + автозапись идеи в энциклопедию
            const op = call.function.name === 'write_file' && String(args.path || '').replace(/^\/+/, '').match(/^(projects\/vc\/[^/]+)\/opinions\/[\w-]+\.md$/);
            if (op && content.startsWith('Записано')) { actx.opinionSaved = true; try { vcAutoRecord(op[1], ctx.task?.text, wsPath); } catch (e) { log(agentId, 'база: ' + e.message, 'error'); } }
          } catch (e) {
            content = 'Ошибка: ' + e.message;
            log(agentId, content, 'error');
          }
          return { role: 'tool', tool_call_id: call.id, content: scrub(content).slice(0, 12000), images };
        })
      );
      if (repeats >= 2) {
        results.at(-1).content += '\n\n[СИСТЕМА] Ты третий раз подряд делаешь одно и то же. Не жди и не опрашивай: сотрудники работают синхронно — если отчёт пришёл, работа закончена. Смени подход или подведи итог.';
      }
      // картинки нельзя вернуть в ответе инструмента — передаём их следующим сообщением
      const shots = results.flatMap((r) => r.images || []);
      for (const r of results) delete r.images;
      if (deleg.length) { node.roundsDone++; node.inRound = false; node.current = []; }
      messages.push(...results);
      if (shots.length) {
        const m = { role: 'user', content: [{ type: 'text', text: 'Скриншоты из inspect_page:' }, ...shots.slice(-4)] };
        SHOTS.add(m);
        messages.push(m);
      }
      setState(agentId, { status: 'thinking', activity: 'думает…' });
    }
    // лимит шагов: не обрываемся на полуслове, а просим честный итог без инструментов
    messages.push({ role: 'user', content: 'Лимит шагов исчерпан. Без инструментов коротко: что сделано (с путями файлов), что не успел и что предлагаешь сделать дальше.' });
    const fin = await chat({ messages, tools: [], agent: agentId, maxTokens: 800 }).catch(() => null);
    const text = (fin?.content || '').trim() || 'Не уложился в лимит шагов — работа прервана.';
    taskStep(ctx.task, agentId, '⏹ ' + text);
    return text;
  } finally {
    node.done = true;
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
    task.progress = 100;
    task.etaMs = 0;
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
    roots.delete(task.id);
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
  // уточнения тоже часть разговора: без них в следующий раз Мирик не вспомнит, о чём договорились
  const qa = task.qa?.length ? '\n\n[Уточнения по ходу]\n' + task.qa.map((x) => `— ${x.q}\n  ${x.a ?? '(решил сам)'}`).join('\n') : '';
  memdb.addMessage(chatId, 'user', scrub(text) + qa);
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
