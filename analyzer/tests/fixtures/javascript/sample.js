import { thing } from "./other.js";

export function add(a, b) {
  return a + b;
}

export class Counter {
  constructor() {
    this.value = 0;
  }
  increment() {
    this.value += 1;
  }
}

export const subtract = (a, b) => a - b;
