import { create } from "zustand";
import { CardState, Grade, newCard, schedule } from "../lib/srs";
import { errorMessage, vaultApi } from "../lib/vault";
import { useUi } from "./uiStore";

// Spaced-repetition progress for the active notebook's flashcards, stored in
// `<notebook>/.notely/review.json` and keyed by card id — a hash of the card's
// question — so progress survives editing an answer or renaming the deck.

interface ReviewStore {
  notebook: string | null;
  states: Record<string, CardState>;
  loaded: boolean;
  load(notebook: string): Promise<void>;
  answer(cardId: string, grade: Grade, now?: number): void;
}

let saveTimer = 0;
let pendingSave: (() => Promise<void>) | null = null;

export const useReview = create<ReviewStore>((set, get) => ({
  notebook: null,
  states: {},
  loaded: false,

  async load(notebook) {
    if (get().notebook === notebook && get().loaded) return;
    await flushReview();
    set({ notebook, states: {}, loaded: false });
    let states: Record<string, CardState> = {};
    try {
      const raw = await vaultApi.readReview(notebook);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.version === 1 && parsed.cards && typeof parsed.cards === "object") states = parsed.cards;
    } catch {
      // Unreadable progress: start fresh rather than block reviewing.
    }
    if (get().notebook === notebook) set({ states, loaded: true });
  },

  answer(cardId, grade, now = Date.now()) {
    const { notebook, states } = get();
    if (!notebook) return;
    const next = { ...states, [cardId]: schedule(states[cardId] ?? newCard(), grade, now) };
    set({ states: next });
    window.clearTimeout(saveTimer);
    pendingSave = async () => {
      try {
        await vaultApi.writeReview(notebook, JSON.stringify({ version: 1, cards: get().states }));
      } catch (e) {
        useUi.getState().toast(errorMessage(e), "error");
      }
    };
    saveTimer = window.setTimeout(() => void flushReview(), 600);
  },
}));

/** Writes any unsaved review progress now. */
export async function flushReview() {
  window.clearTimeout(saveTimer);
  const save = pendingSave;
  pendingSave = null;
  await save?.();
}

window.addEventListener("beforeunload", () => void flushReview());
