// @ts-check
// Проверка аргументов инструмента по его inputSchema до вызова: агент получает понятную ошибку («width: нужно число»),
// а не NaN в рендере или исключение из глубины движка. Подмножество JSON Schema, которое используют инструменты:
// type, properties, required, items, enum. Без зависимостей. Лишние поля не запрещаются — схемы их не перечисляют.
const TYPE_OK = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
};
const NAMES = { string: 'строка', number: 'число', integer: 'целое число', boolean: 'true или false', object: 'объект', array: 'массив', null: 'null' };
const MAX_ERRORS = 10;
const show = (v) => {
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
};

/** Ошибки значения value по схеме schema: массив строк (пустой — всё верно). path — имя аргумента для сообщений. */
export function checkArgs(schema, value, path = '', errs = []) {
  if (!schema || typeof schema !== 'object' || errs.length >= MAX_ERRORS) return errs;
  const where = path || 'аргументы';
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => (TYPE_OK[t] ? TYPE_OK[t](value) : true))) {
      errs.push(`${where}: нужно ${types.map((t) => NAMES[t] || t).join(' или ')}, получено ${show(value)}`);
      return errs;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errs.push(`${where}: допустимо ${schema.enum.map(show).join(', ')}, получено ${show(value)}`);
  if (TYPE_OK.object(value)) {
    for (const k of schema.required || []) if (value[k] === undefined) errs.push(`${path ? path + '.' : ''}${k}: обязательный аргумент`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (value[k] !== undefined) checkArgs(s, value[k], path ? `${path}.${k}` : k, errs);
  }
  if (Array.isArray(value) && schema.items) for (let i = 0; i < value.length && errs.length < MAX_ERRORS; i++) checkArgs(schema.items, value[i], `${where}[${i}]`, errs);
  return errs;
}
