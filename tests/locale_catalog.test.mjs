import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { messages, uiZhTW } from "../src/screen/features/works/localeCatalog.ts";

const screen = new URL("../src/screen/", import.meta.url).pathname;
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const sources = walk(screen).filter(
  (file) => /\.tsx?$/.test(file) && !file.endsWith("localeCatalog.ts"),
);
const text = sources.map((file) => readFileSync(file, "utf8")).join("\n");

const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every key exists in both locales with matching placeholders", () => {
  for (const [key, entry] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(entry).sort(), ["en", "zh-TW"], key);
    assert.ok(entry.en.trim(), `${key} en`);
    assert.ok(entry["zh-TW"].trim(), `${key} zh-TW`);
    assert.deepEqual(placeholders(entry["zh-TW"]), placeholders(entry.en), `${key} placeholders`);
    assert.ok(/[㐀-鿿]/.test(entry["zh-TW"]) || entry["zh-TW"] === entry.en, `${key} zh-TW text`);
  }
});

test("every t() key used on screen exists, and no catalog key is unused", () => {
  const used = new Set([...text.matchAll(/\bt\(\s*"([^"]+)"/g)].map((m) => m[1]));
  for (const key of used) assert.ok(Object.hasOwn(messages, key), `unknown key ${key}`);
  const quoted = new Set([...text.matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]));
  for (const key of Object.keys(messages)) assert.ok(quoted.has(key), `unused key ${key}`);
});

test("the pinned screen-ui copy has a zh-TW translation", () => {
  const sdk = [
    "Cancel", "Close", "More actions", "No matches", "Reload", "Save",
    "Saving…", "Search", "Search options", "Select", "Type",
  ];
  for (const english of sdk) assert.ok(uiZhTW[english]?.trim(), english);
});

test("no hardcoded English labels in screen markup", () => {
  // JSX text children that are plain words must come from t(); attribute labels too.
  const markup = sources.filter((file) => file.endsWith(".tsx")).map((file) => readFileSync(file, "utf8")).join("\n");
  const literalChild = /<\/?[A-Za-z][^<>]*>\s*([A-Z][a-z]+(?: [a-z]+)*)\s*</g;
  const found = [...markup.matchAll(literalChild)].map((m) => m[1]);
  assert.deepEqual(found, []);
  const attribute = /\b(?:aria-label|placeholder|title|label)="[A-Za-z][^"]*"/g;
  assert.deepEqual([...markup.matchAll(attribute)].map((m) => m[0]), []);
});
