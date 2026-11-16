// Завантажує вкладки settings, skills, questions, resources, courses з Google Sheets у data/*.csv.
// Запускається GitHub Action за розкладом; можна запустити й локально: node scripts/sync.mjs
import fs from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(await fs.readFile(new URL("config.js", root), "utf8"), ctx);
const cfg = ctx.window.QUIZ_CONFIG || {};

const KINDS = ["settings", "skills", "questions", "resources", "courses", "base"];
const OPTIONAL = new Set(["base"]); // загальна база ресурсів — необов'язкова вкладка
const REQUIRED = { settings: /key|ключ/, skills: /id/, questions: /question|питання/, resources: /url|посилання/, courses: /url|посилання/, base: /тег теми|tag/ };

const gviz = (tab) =>
  `https://docs.google.com/spreadsheets/d/${encodeURIComponent(cfg.sheetId)}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
const source = (kind) => (cfg.csvUrls || {})[kind] || (cfg.sheetId ? gviz((cfg.tabs || {})[kind] || kind) : "");

if (!KINDS.some(source)) {
  console.log("sheetId не задано в config.js — синхронізацію пропущено.");
  process.exit(0);
}

let failed = false;
for (const kind of KINDS) {
  const url = source(kind);
  if (!url) continue;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error("отримано HTML замість CSV — таблиця не відкрита за посиланням?");
    if (!REQUIRED[kind].test(text.split("\n")[0].toLowerCase())) throw new Error("немає потрібних колонок — перевірте назву вкладки");
    const path = new URL((cfg.snapshot || {})[kind] || `data/${kind}.csv`, root);
    const old = await fs.readFile(path, "utf8").catch(() => "");
    if (old === text) { console.log(`${kind}: без змін`); continue; }
    await fs.writeFile(path, text);
    console.log(`${kind}: оновлено (${text.length} байт)`);
  } catch (e) {
    if (OPTIONAL.has(kind)) { console.log(`${kind}: пропущено (${e.message})`); continue; }
    failed = true;
    console.error(`${kind}: ${e.message}. Стара копія залишається.`);
  }
}
process.exit(failed ? 1 : 0);
