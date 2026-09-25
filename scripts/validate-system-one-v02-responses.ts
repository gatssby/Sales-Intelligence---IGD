import { resolve } from "node:path";
import { validateSystemOneV02ResponseDirectory } from "./lib/system-one-v02.js";

const root = resolve("private/system-one/external-review-v02/responses");
const gpt = await validateSystemOneV02ResponseDirectory(resolve(root, "gpt"));
const gemini = await validateSystemOneV02ResponseDirectory(resolve(root, "gemini"));
process.stdout.write(JSON.stringify({ valid: true, gpt: gpt.valid, gemini: gemini.valid }) + "\n");
