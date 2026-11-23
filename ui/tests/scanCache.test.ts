import { expect, test } from 'vitest';
import { ScanCache } from '../server/scanCache.ts';

test('evicts the least recently used entry and expires old ones', () => {
  let now = 0;
  const cache = new ScanCache<string>(2, 100, () => now);
  cache.set('a', 'A');
  cache.set('b', 'B');
  expect(cache.get('a')).toBe('A'); // a is now most recent
  cache.set('c', 'C'); // evicts b
  expect(cache.get('b')).toBeUndefined();
  expect(cache.size).toBe(2);
  now = 150;
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('c')).toBeUndefined();
});
