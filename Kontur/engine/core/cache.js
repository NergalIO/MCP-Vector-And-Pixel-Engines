/** Общие кеши движка. */

/**
 * Map с ограничением размера: по числу записей или по суммарному весу (weight(key, value), например длина строки).
 * При переполнении вытесняются самые старые записи (порядок вставки), пока не останется 3/4 предела, — а не весь кеш
 * разом: сброс целиком заставлял большие сцены (тысячи путей и цветов) пересчитывать всё на каждом кадре.
 */
export class BoundedCache extends Map {
  constructor(limit, weight = null) {
    super();
    this.limit = limit;
    this.weight = weight;
    this.total = 0;
  }
  w(k, v) { return this.weight ? this.weight(k, v) : 1; }
  set(k, v) {
    if (super.has(k)) this.total -= this.w(k, super.get(k));
    super.set(k, v);
    this.total += this.w(k, v);
    if (this.total > this.limit) this.trim();
    return this;
  }
  trim() {
    for (const [k, v] of super.entries()) {
      if (this.total <= this.limit * 0.75) break;
      super.delete(k);
      this.total -= this.w(k, v);
    }
  }
  delete(k) {
    if (super.has(k)) this.total -= this.w(k, super.get(k));
    return super.delete(k);
  }
  clear() { super.clear(); this.total = 0; }
}

/**
 * Запоминание чистой функции одного объектного аргумента (WeakMap: запись живёт, пока жив объект).
 * Для объектов, которые не меняются на месте (геометрия из кеша путей, поверхности узлов).
 */
export function memoByObject(fn) {
  const memo = new WeakMap();
  return (o) => {
    if (o === null || typeof o !== 'object') return fn(o);
    let v = memo.get(o);
    if (v === undefined) { v = fn(o); memo.set(o, v); }
    return v;
  };
}
