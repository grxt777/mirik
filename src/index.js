import './sandbox.js'; // первым: права на /data и изоляция кода агентов
import { startBot } from './bot.js';
import { startServer } from './server.js';

startBot();
startServer();

process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
