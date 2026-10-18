import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("every CSS custom property reference has a declaration", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../src/styles.css", import.meta.url)),
    "utf8",
  );
  const declared = new Set(
    [...css.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1]),
  );
  const referenced = new Set(
    [...css.matchAll(/var\(--([\w-]+)/g)].map((match) => match[1]),
  );
  assert.deepEqual(
    [...referenced].filter((name) => !declared.has(name)),
    [],
  );
});
