// Общее для инструментов MCP: короткие схемы параметров и форматирование ответа.
import { describeScene } from '../../engine/kontur.js';
export { nodeById, needNode } from '../scene_util.mjs';

export const ANY = {};
export const NUM = { type: 'number' };
export const STR = { type: 'string' };
export const OBJ = { type: 'object' };
/** Путь к файлу или папке: относительный считается от папки сцены (Session.resolvePath / findPath). */
export const PATH = { type: 'string', description: 'относительный — от папки сцены' };
export const KEY = { type: 'object', properties: { t: NUM, v: ANY, ease: ANY, hold: { type: 'boolean' } }, required: ['t', 'v'] };
export const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 1) }] });
/** Ответ: сообщение и сводка сцены под ним. */
export const summary = (scene, msg) => text(`${msg}\n\n${describeScene(scene)}`);
/** Картинка в ответе инструмента. */
export const image = (buf, mime = 'image/png') => ({ type: 'image', data: (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString('base64'), mimeType: mime });
/** Ответ: картинка и текст под ней. */
export const withImage = (buf, msg, mime) => ({ content: [image(buf, mime), { type: 'text', text: msg }] });
