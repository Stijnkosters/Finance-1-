import { promises as fs } from "fs";
import path from "path";

const DIR = process.env.DATA_DIR;

export function persistenceEnabled() {
  return !!DIR;
}

export async function readJson(name: string, fallback: any) {
  if (!DIR) return fallback;
  try {
    const t = await fs.readFile(path.join(DIR, name), "utf8");
    return JSON.parse(t);
  } catch {
    return fallback;
  }
}

export async function writeJson(name: string, data: any) {
  if (!DIR) throw new Error("DATA_DIR niet ingesteld — voeg een Railway Volume toe en zet DATA_DIR naar het mount-pad.");
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, name), JSON.stringify(data, null, 2), "utf8");
}
