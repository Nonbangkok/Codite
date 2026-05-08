import { helper } from "./imported";
import * as fs from "fs";

export function greet(name: string): string {
  return `Hello, ${name}`;
}

export class User {
  constructor(public name: string) {}
  greet(): string {
    return greet(this.name);
  }
}

export interface Greeter {
  greet(): string;
}

export type UserId = string;

export enum Role {
  Admin,
  Guest,
}

export const arrowGreet = (name: string): string => `Hi, ${name}`;
const fnExpr = function double(x: number) { return x * 2; };

const obj = {
  shouldNotBeCounted() { return 1; },
  alsoNotCounted: function () { return 2; },
};
