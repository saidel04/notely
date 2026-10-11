import { BookOpen, GraduationCap, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildQueue, deckStats, formatInterval, Grade, GRADES, newCard, previewIntervals } from "../../lib/srs";
import { Flashcard, useDeck } from "../../store/deck";
import { useReview } from "../../store/reviewStore";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";
import { nextNonce, useWorkspace } from "../../store/workspaceStore";

const NEW_PER_SESSION = 20;
const LABEL: Record<Grade, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const pdfTitle = (pdf: string) => pdf.replace(/\.pdf$/i, "");

/** The first few words of a passage, as a recall cue for cards without a question. */
function cue(text: string) {
  const words = text.trim().split(/\s+/);
  return words.length <= 5 ? text.trim() : `${words.slice(0, 5).join(" ")} …`;
}

/**
 * Flashcard review: each highlight is a card. A highlight's comment is the
 * question and the passage is the answer; highlights without a comment ask you
 * to complete the passage from its first words. Scheduled with spaced repetition.
 */
export default function ReviewPanel() {
  const scope = useUi((s) => s.review);
  const notebook = useVault((s) => s.activeNotebook);
  const { cards, loaded } = useDeck(notebook, scope?.pdf ?? null);
  const states = useReview((s) => s.states);
  const progressLoaded = useReview((s) => s.loaded && s.notebook === notebook);

  const [queue, setQueue] = useState<Flashcard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  // Snapshot the session's cards once everything has loaded.
  useEffect(() => {
    if (loaded && progressLoaded && !queue) setQueue(buildQueue(cards, states, Date.now(), NEW_PER_SESSION));
  }, [loaded, progressLoaded, queue, cards, states]);

  const card = queue?.[index] ?? null;
  const close = () => useUi.setState({ review: null });

  const answer = (g: Grade) => {
    if (!card || !shown) return;
    useReview.getState().answer(card.id, g);
    setReviewed((n) => n + 1);
    // Forgotten cards come back once more before the session ends.
    if (g === "again") setQueue((q) => (q ? [...q, card] : q));
    setIndex((i) => i + 1);
    setShown(false);
  };

  const openSource = (c: Flashcard) => {
    close();
    useWorkspace.getState().open({ kind: "pdf", name: c.pdf, target: { page: c.hl.page, highlightId: c.hl.id, nonce: nextNonce() } });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") close();
      else if (card && !shown && (e.key === " " || e.key === "Enter")) setShown(true);
      else if (card && shown && ["1", "2", "3", "4"].includes(e.key)) answer(GRADES[Number(e.key) - 1]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const now = Date.now();
  const previews = useMemo(() => (card ? previewIntervals(states[card.id] ?? newCard(), now) : null), [card, states]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = deckStats(cards, states, now);
  const left = queue ? queue.length - index : 0;
  const nextDue = stats.nextDue ? `Next review in ${formatInterval(stats.nextDue - now)}.` : "";

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Review flashcards"
        className="animate-pop flex max-h-[80vh] w-[600px] flex-col rounded-xl border border-line bg-surface shadow-pop"
      >
        <header className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <GraduationCap size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ink">Review</div>
            <div className="truncate text-[12px] text-faint">{scope?.pdf ? pdfTitle(scope.pdf) : `All PDFs in ${notebook}`}</div>
          </div>
          {card && <span className="text-[12px] text-muted tabular-nums">{left} left</span>}
          <button onClick={close} aria-label="Close review" className="rounded-md p-1 text-faint hover:bg-hover hover:text-ink">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-[300px] overflow-y-auto px-8 py-7">
          {!queue ? (
            <div className="flex h-[240px] items-center justify-center text-faint">
              <Loader2 className="animate-spin" size={20} />
            </div>
          ) : cards.length === 0 ? (
            <Empty title="No highlights to review yet">
              Highlight passages in a PDF and they become flashcards. Add a comment to a highlight to turn it into a question.
            </Empty>
          ) : !card ? (
            <Empty title={reviewed ? `Session complete — ${reviewed} card${reviewed === 1 ? "" : "s"} reviewed` : "All caught up"}>
              {nextDue || "Nothing is due."} New highlights join your next session automatically.
            </Empty>
          ) : (
            <CardView card={card} shown={shown} onOpen={() => openSource(card)} />
          )}
        </div>

        {card && (
          <footer className="border-t border-line px-5 py-3.5">
            {!shown ? (
              <button
                autoFocus
                onClick={() => setShown(true)}
                className="w-full rounded-lg bg-accent py-2.5 text-[13.5px] font-medium text-white hover:opacity-90"
              >
                Show answer <span className="ml-1.5 text-[11.5px] font-normal text-white/70">Space</span>
              </button>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {GRADES.map((g, i) => (
                  <button
                    key={g}
                    onClick={() => answer(g)}
                    className={`flex flex-col items-center rounded-lg border py-2 text-[13px] font-medium transition-colors ${
                      g === "again" ? "border-line text-danger hover:bg-hover" : g === "good" ? "border-accent bg-accent-soft text-accent" : "border-line text-ink hover:bg-hover"
                    }`}
                  >
                    {LABEL[g]}
                    <span className="mt-0.5 text-[11px] font-normal text-faint">
                      {previews?.[g]} · {i + 1}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

function CardView({ card, shown, onOpen }: { card: Flashcard; shown: boolean; onOpen: () => void }) {
  const { hl, pdf } = card;
  const question = hl.comment?.trim();
  return (
    <div>
      <div className="mb-3 text-[11.5px] font-medium tracking-wide text-faint uppercase">
        {question ? "Question" : "Complete the passage"}
      </div>
      {question ? (
        <div className="text-[19px] leading-snug font-medium text-ink">{question}</div>
      ) : (
        <div className="text-[18px] leading-relaxed text-ink" style={{ fontFamily: "var(--font-serif)" }}>
          “{cue(hl.text)}”
        </div>
      )}
      <div className="mt-2 text-[12px] text-faint">
        {pdfTitle(pdf)} · p. {hl.page}
      </div>

      {shown && (
        <div className="animate-fade mt-6 border-t border-line pt-5">
          <blockquote
            className={`border-l-[3px] pl-4 text-[16px] leading-relaxed text-ink hl-border-${hl.color}`}
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {hl.text}
          </blockquote>
          <button onClick={onOpen} className="mt-3 flex items-center gap-1.5 text-[12.5px] text-accent hover:underline">
            <BookOpen size={13} /> Open on p. {hl.page}
          </button>
        </div>
      )}
    </div>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-[240px] flex-col items-center justify-center text-center">
      <div className="mb-1.5 text-[15px] font-medium text-ink">{title}</div>
      <div className="max-w-sm text-[13px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}
