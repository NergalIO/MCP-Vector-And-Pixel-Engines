// Общее для инструментов MCP: короткие схемы параметров и форматирование ответа.
import { describeScene } from '../../engine/kontur.js';
import { scene } from '../store.mjs';

export const ANY = {};
export const NUM = { type: 'number' };
export const STR = { type: 'string' };
export const OBJ = { type: 'object' };
export const KEY = { type: 'object', properties: { t: NUM, v: ANY, ease: ANY, hold: { type: 'boolean' } }, required: ['t', 'v'] };
export const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 1) }] });
export const summary = (msg) => text(`${msg}\n\n${describeScene(scene)}`);
