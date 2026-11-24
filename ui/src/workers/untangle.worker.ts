/// <reference lib="webworker" />
import { untangle, type UntangleInput } from '../utils/untangle';

self.onmessage = (event: MessageEvent<UntangleInput & { token: number }>) => {
  const { token, ...input } = event.data;
  const result = untangle(input);
  (self as unknown as Worker).postMessage({ token, ...result });
};
