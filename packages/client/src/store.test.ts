import { describe, expect, it, vi } from "vite-plus/test";

import { createStore } from "./store";

describe("createStore", () => {
  it("returns the initial snapshot before any set", () => {
    const store = createStore({ n: 0 });
    expect(store.getSnapshot()).toEqual({ n: 0 });
  });

  it("notifies subscribers on set and exposes the new snapshot", () => {
    const store = createStore({ n: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    const next = { n: 1 };
    store.set(next);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(next);
  });

  it("keeps the snapshot reference stable between transitions", () => {
    const store = createStore({ n: 0 });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("does not notify when set is called with the current snapshot reference", () => {
    const store = createStore({ n: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(store.getSnapshot());
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const store = createStore({ n: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set({ n: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers", () => {
    const store = createStore({ n: 0 });
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);
    store.set({ n: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("getServerSnapshot always returns the constant initial snapshot", () => {
    const initial = { n: 0 };
    const store = createStore(initial);
    store.set({ n: 5 });
    expect(store.getServerSnapshot()).toBe(initial);
  });
});
