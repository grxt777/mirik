// Инструменты энциклопедии StartupBase для агентов
import { wsPath } from './files.js';
import { lookup, formatLookup, saveFacts, recordIdea, SECTORS } from '../vcbase.js';

const SECTOR_IDS = Object.keys(SECTORS);

export const vcTools = [
  {
    name: 'vc_lookup',
    description: 'Поиск в энциклопедии StartupBase: похожие идеи, которые уже оценивали (с оценками совета), и проверенные факты отрасли (рынки, конкуренты, цены, регулирование, инвесторы) с источниками и датами. Вызывай ПЕРЕД поиском в интернете.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Ключевые слова: тема, продукт, рынок' }, sector: { type: 'string', enum: SECTOR_IDS } },
      required: ['query'],
    },
    async run({ query, sector }) {
      const text = formatLookup(lookup(query, { sector, k: 12 }));
      return text || 'В базе по этой теме пока ничего нет — ищи в интернете и сохрани найденное через vc_save_facts.';
    },
  },
  {
    name: 'vc_save_facts',
    description: 'Сохранить в энциклопедию StartupBase проверенные факты, которые пригодятся в следующих исследованиях: размеры рынков, конкуренты и их раунды, цены, регулирование, инвесторы и программы, ключевые метрики. Только с источником.',
    parameters: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Сам факт одной фразой с цифрой и контекстом (страна, год)' },
              source: { type: 'string', description: 'URL или название источника' },
              as_of: { type: 'string', description: 'Дата актуальности факта, YYYY-MM-DD' },
              kind: { type: 'string', enum: ['market', 'competitor', 'price', 'regulation', 'investor', 'metric', 'trend', 'customer'] },
              sector: { type: 'string', enum: SECTOR_IDS },
            },
            required: ['text', 'source', 'sector'],
          },
        },
      },
      required: ['facts'],
    },
    async run({ facts }, ctx) {
      const { saved, dup } = saveFacts(facts, { agent: ctx.agentId });
      return `Сохранено фактов: ${saved}${dup ? `, уже были в базе: ${dup}` : ''}`;
    },
  },
  {
    name: 'vc_record_idea',
    description: 'Записать оценённую идею в энциклопедию StartupBase после работы совета. Оценки и вердикты берутся автоматически из opinions/*.md в папке проекта.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Короткое название идеи' },
        summary: { type: 'string', description: 'Суть идеи в 1–2 предложениях' },
        sector: { type: 'string', enum: SECTOR_IDS },
        tags: { type: 'string', description: 'Ключевые слова через запятую' },
        region: { type: 'string' },
        folder: { type: 'string', description: 'Папка проекта, например projects/vc/cotton-scan' },
      },
      required: ['title', 'summary', 'sector', 'folder'],
    },
    async run(args) {
      const r = recordIdea(args, wsPath);
      const ops = r.opinions.map((o) => `${o.agent}: ${o.score ?? '?'}/10`).join(', ');
      return `Записано в базу: «${args.title}» → ${SECTORS[r.sector].name}, средняя ${r.avg?.toFixed(1) ?? '—'}/10 (${ops || 'мнений не нашлось — проверь папку opinions'}).`;
    },
  },
];
