import { AlertTriangle, GraduationCap, Layers, Pencil, Plus, RotateCcw, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { actions } from "../../lib/actions";
import { Card, parseDeck } from "../../lib/flashcards";
import { useDeckCards } from "../../store/deck";
import { useDecks } from "../../store/deckStore";

/**
 * A flashcard deck: the `.cards` file as a grid of cards you can flip, plus an
 * editor for the file itself. One line is one card, written `Question: answer`.
 */
export function DeckView({ notebook, name }: { notebook: string; name: string }) {
  const text = useDecks((s) => s.text[name]);
  const { cards, problems } = useDeckCards(name);
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  /** Cards showing their answer, by id. */
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  // A deck with nothing in it yet opens straight into the editor — decided once
  // per deck, when its file arrives, so writing the first card doesn't bounce
  // you out of the editor.
  const decided = useRef<string | null>(null);
  useEffect(() => {
    if (text === undefined || decided.current === name) return;
    decided.current = name;
    const fresh = parseDeck(text);
    setEditing(!fresh.cards.length && !fresh.problems.length);
  }, [text, name]);

  const shown = useMemo(() => {
    if (!order) return cards;
    const by = new Map(cards.map((c) => [c.id, c]));
    const picked = order.map((id) => by.get(id)).filter((c): c is Card => !!c);
    // Cards added since the shuffle go at the end rather than disappearing.
    return [...picked, ...cards.filter((c) => !order.includes(c.id))];
  }, [cards, order]);

  const anyFlipped = shown.some((c) => flipped[c.id]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <Layers size={14} className="shrink-0 text-faint" />
        <span className="truncate text-[13px] font-medium text-ink">{name}</span>
        <span className="shrink-0 text-[12px] text-faint tabular-nums">
          {cards.length} card{cards.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        {cards.length > 1 && !editing && (
          <>
            <ToolBtn title="Shuffle the cards" onClick={() => setOrder(shuffled(cards.map((c) => c.id)))}>
              <Shuffle size={13} /> Shuffle
            </ToolBtn>
            <ToolBtn
              title={anyFlipped ? "Show every question again" : "Show every answer"}
              onClick={() => setFlipped(anyFlipped ? {} : Object.fromEntries(cards.map((c) => [c.id, true])))}
            >
              <RotateCcw size={13} /> {anyFlipped ? "Questions" : "Answers"}
            </ToolBtn>
          </>
        )}
        <ToolBtn title={editing ? "Back to the cards" : "Edit the deck as text"} active={editing} onClick={() => setEditing(!editing)}>
          {editing ? <Layers size={13} /> : <Pencil size={13} />} {editing ? "Cards" : "Edit"}
        </ToolBtn>
        {cards.length > 0 && (
          <ToolBtn title="Review this deck with spaced repetition" accent onClick={() => actions.review(name)}>
            <GraduationCap size={13} /> Review
          </ToolBtn>
        )}
      </div>

      {editing ? (
        <DeckEditor notebook={notebook} name={name} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {problems.length > 0 && (
            <button
              onClick={() => setEditing(true)}
              className="mb-3 flex w-full items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-[12.5px] text-muted hover:border-line-strong"
            >
              <AlertTriangle size={14} className="mt-px shrink-0 text-danger" />
              <span>
                {problems.length === 1 ? "Line" : "Lines"} {problems.map((p) => p.line).join(", ")}{" "}
                {problems.length === 1 ? "isn't a card" : "aren't cards"} — a card needs a colon, as{" "}
                <code className="text-ink">Question: answer</code>. Click to fix.
              </span>
            </button>
          )}
          {cards.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-1 text-[15px] font-medium text-ink">No cards yet</div>
              <div className="mb-5 max-w-sm text-[12.5px] leading-relaxed text-faint">
                Write one card per line as <code className="text-muted">Question: answer</code>. Click a card to flip it.
              </div>
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] text-ink hover:border-line-strong"
              >
                <Plus size={14} className="text-muted" /> Add cards
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3 pb-4">
              {shown.map((c) => (
                <FlipCard
                  key={c.id}
                  card={c}
                  flipped={!!flipped[c.id]}
                  onFlip={() => setFlipped((f) => ({ ...f, [c.id]: !f[c.id] }))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One card: the question, flipping to the answer when clicked. */
function FlipCard({ card, flipped, onFlip }: { card: Card; flipped: boolean; onFlip: () => void }) {
  return (
    <button
      onClick={onFlip}
      aria-pressed={flipped}
      aria-label={`${card.question} — click to ${flipped ? "hide" : "show"} the answer`}
      className="card-flip group h-[150px] text-left"
      data-flipped={flipped || undefined}
    >
      <span className="card-flip-inner">
        <span className="card-face">
          <span className="text-[10.5px] font-medium tracking-wide text-faint uppercase">Question</span>
          <span className="card-text text-[14.5px] leading-snug font-medium text-ink">{card.question}</span>
          <span className="text-[11px] text-faint opacity-0 transition-opacity group-hover:opacity-100">Click to flip</span>
        </span>
        <span className="card-face card-back">
          <span className="text-[10.5px] font-medium tracking-wide text-accent uppercase">Answer</span>
          <span className="card-text text-[14.5px] leading-relaxed text-ink" style={{ fontFamily: "var(--font-serif)" }}>
            {card.answer}
          </span>
        </span>
      </span>
    </button>
  );
}

/** The deck file itself: plain lines, saved as you type. */
function DeckEditor({ notebook, name }: { notebook: string; name: string }) {
  const text = useDecks((s) => s.text[name] ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), [name]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <textarea
        ref={ref}
        value={text}
        spellCheck={false}
        onChange={(e) => useDecks.getState().set(name, e.target.value)}
        aria-label={`${name} — one flashcard per line`}
        placeholder={"What does ATP stand for?: Adenosine triphosphate"}
        className="min-h-0 flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[13px] leading-[1.8] text-ink outline-none placeholder:text-faint"
      />
      <div className="shrink-0 border-t border-line px-5 py-2 text-[11.5px] text-faint">
        One card per line — <code className="text-muted">Question: answer</code>. Lines starting with{" "}
        <code className="text-muted">#</code> are ignored; write a colon inside a question as{" "}
        <code className="text-muted">\:</code>. Saved to {notebook}/{name}.cards
      </div>
    </div>
  );
}

function ToolBtn({
  children,
  title,
  active,
  accent,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] transition-colors ${
        accent
          ? "bg-accent-soft text-accent hover:opacity-80"
          : active
            ? "bg-active text-ink"
            : "text-muted hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Fisher–Yates, so every order is equally likely. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
