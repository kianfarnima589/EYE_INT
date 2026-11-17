import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "kv_store.json");

const store = new Map<string, any>();
let loaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          store.set(k, v);
        }
      }
    }
  } catch (e) {
    console.log("kv_store load warning:", String(e));
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const obj: Record<string, any> = {};
      for (const [k, v] of store.entries()) {
        obj[k] = v;
      }
      const tmp = `${DATA_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(obj), "utf-8");
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.log("kv_store flush warning:", String(e));
    }
  }, 150);
}

export const set = async (key: string, value: any): Promise<void> => {
  ensureLoaded();
  store.set(key, value);
  scheduleFlush();
};

export const get = async (key: string): Promise<any> => {
  ensureLoaded();
  return store.get(key);
};

export const del = async (key: string): Promise<void> => {
  ensureLoaded();
  store.delete(key);
  scheduleFlush();
};

export const mset = async (keys: string[], values: any[]): Promise<void> => {
  ensureLoaded();
  for (let i = 0; i < keys.length; i++) {
    store.set(keys[i], values[i]);
  }
  scheduleFlush();
};

export const mget = async (keys: string[]): Promise<any[]> => {
  ensureLoaded();
  return keys.map((k) => store.get(k)).filter((v) => v !== undefined);
};

export const mdel = async (keys: string[]): Promise<void> => {
  ensureLoaded();
  for (const k of keys) {
    store.delete(k);
  }
  scheduleFlush();
};

export const getByPrefix = async (prefix: string): Promise<any[]> => {
  ensureLoaded();
  const out: any[] = [];
  for (const [k, v] of store.entries()) {
    if (k.startsWith(prefix)) {
      out.push(v);
    }
  }
  return out;
};