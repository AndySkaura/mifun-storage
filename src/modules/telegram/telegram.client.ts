import { Bot, InputFile } from "grammy";

export function createTelegramBot(token: string): Bot {
  return new Bot(token);
}

export { InputFile };
