import { LazyStore } from "@tauri-apps/plugin-store";

// App-level preferences (not part of the vault): lives in the app config dir.
const store = new LazyStore("settings.json", { defaults: {}, autoSave: 400 });

export const settings = {
  get: <T>(key: string) => store.get<T>(key),
  set: (key: string, value: unknown) => store.set(key, value),
};

const timers = new Map<string, number>();

/** Debounced `settings.set` for values that change rapidly (scroll position, layout). */
export function setSettingSoon(key: string, value: unknown, delay = 600) {
  window.clearTimeout(timers.get(key));
  timers.set(
    key,
    window.setTimeout(() => {
      timers.delete(key);
      void settings.set(key, value);
    }, delay),
  );
}
