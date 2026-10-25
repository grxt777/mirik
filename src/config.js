import path from 'node:path';

const env = process.env;

export const config = {
  openrouterKey: env.OPENROUTER_API_KEY || '',
  model: env.MODEL || 'z-ai/glm-5.3-flash',
  botToken: env.TELEGRAM_BOT_TOKEN || '',
  ownerIds: (env.OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number),
  adminPassword: env.ADMIN_PASSWORD || 'mirik',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 8080}`).replace(/\/$/, ''),
  port: Number(env.PORT || 8080),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  // Прямой канал с Саней (личный ассистент владельца, отдельное приложение): общий токен и его адрес
  linkToken: env.AGENT_LINK_TOKEN || '',
  sanyaUrl: (env.SANYA_URL || '').replace(/\/$/, ''),
};

config.workspaceDir = path.join(config.dataDir, 'workspace');

if (!config.openrouterKey) console.warn('[config] OPENROUTER_API_KEY не задан — агенты не смогут думать');
