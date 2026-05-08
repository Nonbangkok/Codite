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
