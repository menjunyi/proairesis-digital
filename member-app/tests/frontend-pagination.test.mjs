import test from "node:test";
import assert from "node:assert/strict";
import { loadAllApplications, loadAccountExport } from "../src/api.js";
import { clearSession, startDemo } from "../src/auth.js";
import { MemoryStore, change } from "../server/store.mjs";
import { createService } from "../server/service.mjs";

const exportedAt = "2026-10-12T00:00:00.000Z";
const app = (id, letters = []) => ({
  id,
  job: { title: `Synthetic ${id}` },
  notes: "Synthetic notes",
  letters,
});
const letter = (id) => ({ id, text: `Synthetic draft ${id}` });
const exportPage = (records, nextCursor = null) => ({
  schemaVersion: 1,
  exportedAt,
  records,
  nextCursor,
});

function memoryStorage() {
  const storage = Object.create(null);
  Object.defineProperties(storage, {
    getItem: {
      value(key) {
        return storage[key] ?? null;
      },
    },
    setItem: {
      value(key, value) {
        storage[key] = String(value);
      },
    },
    removeItem: {
      value(key) {
        delete storage[key];
      },
    },
  });
  return storage;
}

test("paginated frontend collections are complete, bounded and tied to one session", async (t) => {
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  Object.defineProperty(globalThis, "sessionStorage", {
    value: memoryStorage(),
    configurable: true,
  });
  const seed = () => startDemo({ mode: "demo" });
  try {
    await t.test(
      "client reassembles actual byte-bounded service pages including split letter histories",
      async () => {
        seed();
        const store = new MemoryStore();
        const user = {
          sub: "synthetic-pagination",
          email: "synthetic@example.test",
        };
        const pk = `USER#${user.sub}`;
        const applications = Array.from({ length: 37 }, (_, index) => {
          const value = app(`synthetic-${String(index).padStart(3, "0")}`);
          value.job = { ...value.job, id: value.id, source: "user-provided" };
          return value;
        });
        const letters = Array.from({ length: 80 }, (_, index) => ({
          id: `draft-${String(index).padStart(3, "0")}`,
          text: "Synthetic QA draft. ".repeat(800),
        }));
        await store.transact([
          ...applications.map((value) =>
            change(pk, `APP#${value.id}`, null, value),
          ),
          ...letters.map((value) =>
            change(pk, `LETTER#${applications[0].id}#${value.id}`, null, value),
          ),
        ]);
        const service = createService({
          store,
          feed: {
            async status() {
              return { status: "not-configured" };
            },
            async jobs() {
              return [];
            },
          },
        });
        const counts = { applications: 0, export: 0 };
        const api = async (path) => {
          const url = new URL(path, "https://synthetic.example.test");
          const cursor = url.searchParams.get("cursor") ?? undefined;
          const page =
            url.pathname === "/applications"
              ? await service.applications(user, cursor)
              : await service.exportAccount(user, cursor);
          counts[url.pathname.slice(1)]++;
          assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024 * 1024);
          return page;
        };
        const loaded = await loadAllApplications(api);
        assert.equal(loaded.applications.length, applications.length);
        assert.equal(loaded.applications[0].letters.length, letters.length);
        assert.deepEqual(loaded.applications[0].letters, letters);
        const exported = await loadAccountExport(api);
        assert.equal(
          exported.records.length,
          applications.length + letters.length,
        );
        assert.ok(counts.applications > 1);
        assert.ok(counts.export > 1);
      },
    );
    await t.test(
      "application letter slices merge by application and letter IDs",
      async () => {
        seed();
        const paths = [];
        const pages = [
          {
            applications: [app("one", [letter("a")])],
            nextCursor: "opaque+cursor/=",
          },
          {
            applications: [app("one", [letter("a"), letter("b")]), app("two")],
            nextCursor: null,
          },
        ];
        const result = await loadAllApplications(async (path) => {
          paths.push(path);
          return pages.shift();
        });
        assert.deepEqual(paths, [
          "/applications",
          "/applications?cursor=opaque%2Bcursor%2F%3D",
        ]);
        assert.deepEqual(
          result.applications.map((value) => value.id),
          ["one", "two"],
        );
        assert.deepEqual(
          result.applications[0].letters.map((value) => value.id),
          ["a", "b"],
        );
        assert.equal(result.applications[0].notes, "Synthetic notes");
      },
    );
    await t.test(
      "all export records share one timestamp and pagination fields are removed",
      async () => {
        seed();
        const pages = [
          exportPage(
            [{ type: "PROFILE", value: { name: "Synthetic" } }],
            "next",
          ),
          exportPage([{ type: "APP#one", value: app("one") }]),
        ];
        const result = await loadAccountExport(async () => pages.shift());
        assert.deepEqual(Object.keys(result), [
          "schemaVersion",
          "exportedAt",
          "records",
        ]);
        assert.equal(result.exportedAt, exportedAt);
        assert.deepEqual(
          result.records.map((record) => record.type),
          ["PROFILE", "APP#one"],
        );
      },
    );
    await t.test(
      "a later network or stale-snapshot failure rejects the entire collection",
      async () => {
        for (const load of [loadAllApplications, loadAccountExport]) {
          seed();
          let calls = 0;
          const error = Object.assign(
            new Error("The data changed. Restart the request."),
            { code: "PAGINATION_STALE", status: 409 },
          );
          await assert.rejects(
            load(async () => {
              if (++calls === 1)
                return {
                  applications: [app("one")],
                  ...exportPage([], "next"),
                };
              throw error;
            }),
            (value) => value === error,
          );
          assert.equal(calls, 2);
        }
      },
    );
    await t.test(
      "repeated and cycling cursors cannot loop or return partial data",
      async () => {
        seed();
        let calls = 0;
        await assert.rejects(
          loadAllApplications(async () => ({
            applications: [app(String(++calls))],
            nextCursor: "same",
          })),
          { code: "INCOMPLETE_COLLECTION" },
        );
        assert.equal(calls, 2);
        const cursors = ["a", "b", "a"];
        calls = 0;
        await assert.rejects(
          loadAccountExport(async () => {
            calls++;
            return exportPage([], cursors.shift());
          }),
          { code: "INCOMPLETE_COLLECTION" },
        );
        assert.equal(calls, 3);
      },
    );
    await t.test(
      "missing completion markers and malformed pages fail closed",
      async () => {
        for (const page of [
          { applications: [] },
          { applications: [], nextCursor: "" },
          { applications: [], nextCursor: 12 },
          { nextCursor: null },
          { applications: [app("one", [{}])], nextCursor: null },
        ]) {
          seed();
          await assert.rejects(
            loadAllApplications(async () => page),
            { code: "INCOMPLETE_COLLECTION" },
          );
        }
        for (const page of [
          exportPage([{}]),
          { ...exportPage([]), schemaVersion: 2 },
          { ...exportPage([]), exportedAt: "not a date" },
        ]) {
          seed();
          await assert.rejects(
            loadAccountExport(async () => page),
            { code: "INCOMPLETE_COLLECTION" },
          );
        }
      },
    );
    await t.test(
      "changing export timestamp rejects mixed snapshots",
      async () => {
        seed();
        const pages = [
          exportPage([], "next"),
          { ...exportPage([]), exportedAt: "2026-10-12T00:01:00.000Z" },
        ];
        await assert.rejects(
          loadAccountExport(async () => pages.shift()),
          { code: "INCOMPLETE_COLLECTION" },
        );
      },
    );
    await t.test(
      "logout and same-account re-login stop collection before the next page",
      async () => {
        for (const changeSession of [clearSession, seed]) {
          seed();
          let calls = 0;
          await assert.rejects(
            loadAllApplications(async () => {
              calls++;
              changeSession();
              return { applications: [app("one")], nextCursor: "next" };
            }),
            { code: "SESSION_CHANGED" },
          );
          assert.equal(calls, 1);
        }
      },
    );
    await t.test(
      "closing the initiating view cancels after the current request",
      async () => {
        seed();
        let closed = false,
          calls = 0;
        await assert.rejects(
          loadAccountExport(
            async () => {
              calls++;
              closed = true;
              return exportPage([], "next");
            },
            {
              assertCurrent() {
                if (closed) throw new Error("View closed");
              },
            },
          ),
          /View closed/,
        );
        assert.equal(calls, 1);
      },
    );
    await t.test(
      "a unique but unending cursor chain has a fixed page ceiling",
      async () => {
        seed();
        let calls = 0;
        await assert.rejects(
          loadAllApplications(async () => ({
            applications: [],
            nextCursor: String(++calls),
          })),
          { code: "INCOMPLETE_COLLECTION" },
        );
        assert.equal(calls, 1000);
      },
    );
  } finally {
    clearSession();
    if (originalStorage)
      Object.defineProperty(globalThis, "sessionStorage", originalStorage);
    else delete globalThis.sessionStorage;
  }
});
