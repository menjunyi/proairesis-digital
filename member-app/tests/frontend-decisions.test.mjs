import test from "node:test";
import assert from "node:assert/strict";
import { saveOpportunityDecision } from "../src/api.js";
import { startDemo, clearSession } from "../src/auth.js";

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

test("opportunity decisions refresh authoritative queues instead of filtering restored roles out", async (t) => {
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  Object.defineProperty(globalThis, "sessionStorage", {
    value: memoryStorage(),
    configurable: true,
  });
  const seed = () => startDemo({ mode: "demo" });
  function fixture(size = 1) {
    const jobs = Array.from({ length: size }, (_, i) => ({
      job: { id: `synthetic-${i}` },
    }));
    const decisions = new Map(),
      paths = [];
    const state = { view: "selected", data: null };
    const api = async (path, options) => {
      paths.push(path);
      if (options?.method === "POST") {
        const id = decodeURIComponent(path.split("/")[2]);
        decisions.set(id, options.body.decision);
        return {};
      }
      return {
        opportunities: jobs
          .filter((match) =>
            path === "/ignored"
              ? decisions.get(match.job.id) === "ignored"
              : !decisions.has(match.job.id) ||
                decisions.get(match.job.id) === "undecided",
          )
          .slice(0, 30),
      };
    };
    const reload = async () => {
      state.data = await api(
        state.view === "ignored" ? "/ignored" : "/opportunities",
      );
    };
    return { api, reload, state, paths };
  }
  try {
    await t.test(
      "Ignore then Undo restores the selected count immediately without manual Reload",
      async () => {
        seed();
        const f = fixture();
        await f.reload();
        assert.equal(f.state.data.opportunities.length, 1);
        await saveOpportunityDecision(f.api, "synthetic-0", "ignored", {
          reload: f.reload,
        });
        assert.equal(f.state.data.opportunities.length, 0);
        await saveOpportunityDecision(f.api, "synthetic-0", "undecided", {
          reload: f.reload,
        });
        assert.equal(f.state.data.opportunities.length, 1);
        assert.equal(f.state.data.opportunities[0].job.id, "synthetic-0");
        assert.equal(f.paths.at(-1), "/opportunities");
      },
    );
    await t.test(
      "Ignore and Interested refill the capped queue from server ranking",
      async () => {
        seed();
        const f = fixture(32);
        await f.reload();
        await saveOpportunityDecision(f.api, "synthetic-0", "ignored", {
          reload: f.reload,
        });
        assert.equal(f.state.data.opportunities.length, 30);
        assert.equal(f.state.data.opportunities.at(-1).job.id, "synthetic-30");
        await saveOpportunityDecision(f.api, "synthetic-1", "interested", {
          reload: f.reload,
        });
        assert.equal(f.state.data.opportunities.length, 30);
        assert.equal(f.state.data.opportunities.at(-1).job.id, "synthetic-31");
      },
    );
    await t.test(
      "Interested returns the exact application for navigation",
      async () => {
        seed();
        const application = { id: "synthetic-selected" };
        let committed;
        const result = await saveOpportunityDecision(
          async (path, options) =>
            options?.method === "POST" ? { application } : { opportunities: [] },
          "synthetic-selected",
          "interested",
          {
            onSaved(value) {
              committed = value.application;
            },
            async reload() {},
          },
        );
        assert.deepEqual(committed, application);
        assert.deepEqual(result.application, application);
      },
    );
    await t.test(
      "a tab switch during the save refreshes the current view, never the stale one",
      async () => {
        seed();
        const f = fixture();
        const api = async (...args) => {
          const result = await f.api(...args);
          f.state.view = "ignored";
          return result;
        };
        await saveOpportunityDecision(api, "synthetic-0", "ignored", {
          reload: f.reload,
        });
        assert.equal(f.paths.at(-1), "/ignored");
        assert.equal(f.state.data.opportunities.length, 1);
        await saveOpportunityDecision(f.api, "synthetic-0", "undecided", {
          reload: f.reload,
        });
        assert.equal(f.state.data.opportunities.length, 0);
      },
    );
    await t.test(
      "a failed decision never announces success or reloads",
      async () => {
        seed();
        let commits = 0,
          reloads = 0;
        await assert.rejects(
          saveOpportunityDecision(
            async () => {
              throw new Error("Synthetic save failure");
            },
            "synthetic-0",
            "ignored",
            {
              onSaved() {
                commits++;
              },
              reload() {
                reloads++;
              },
            },
          ),
          /Synthetic save failure/,
        );
        assert.equal(commits, 0);
        assert.equal(reloads, 0);
      },
    );
    await t.test(
      "a refresh failure cannot silently turn into an empty or successful queue",
      async () => {
        seed();
        let commits = 0;
        await assert.rejects(
          saveOpportunityDecision(
            async () => ({}),
            "synthetic-0",
            "undecided",
            {
              onSaved() {
                commits++;
              },
              async reload() {
                throw new Error("Synthetic load failure");
              },
            },
          ),
          /Synthetic load failure/,
        );
        assert.equal(commits, 1);
      },
    );
    await t.test(
      "logout during save prevents stale state changes and the follow-up load",
      async () => {
        seed();
        let commits = 0,
          reloads = 0;
        await assert.rejects(
          saveOpportunityDecision(
            async () => {
              clearSession();
              return {};
            },
            "synthetic-0",
            "ignored",
            {
              onSaved() {
                commits++;
              },
              reload() {
                reloads++;
              },
            },
          ),
          { code: "SESSION_CHANGED" },
        );
        assert.equal(commits, 0);
        assert.equal(reloads, 0);
      },
    );
    await t.test(
      "leaving the view during save cancels UI mutation and reload",
      async () => {
        seed();
        let mounted = true,
          commits = 0,
          reloads = 0;
        await assert.rejects(
          saveOpportunityDecision(
            async () => {
              mounted = false;
              return {};
            },
            "synthetic-0",
            "ignored",
            {
              assertCurrent() {
                if (!mounted) throw new Error("View closed");
              },
              onSaved() {
                commits++;
              },
              reload() {
                reloads++;
              },
            },
          ),
          /View closed/,
        );
        assert.equal(commits, 0);
        assert.equal(reloads, 0);
      },
    );
  } finally {
    clearSession();
    if (originalStorage)
      Object.defineProperty(globalThis, "sessionStorage", originalStorage);
    else delete globalThis.sessionStorage;
  }
});
