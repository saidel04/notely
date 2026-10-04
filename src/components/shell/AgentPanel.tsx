import { resolveResource } from "@tauri-apps/api/path";
import { Bot, Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useUi } from "../../store/uiStore";
import { useVault } from "../../store/vaultStore";

/** Explains how to connect an AI agent (via MCP) to this vault, with copyable setup. */
export function AgentPanel() {
  const open = useUi((s) => s.agentPanel);
  const vaultPath = useVault((s) => s.vaultPath);
  const [server, setServer] = useState<string | null>(null);

  useEffect(() => {
    if (open) void resolveResource("agent/notely-mcp.mjs").then((p) => setServer(p.replace(/^\\\\\?\\/, "")));
  }, [open]);

  if (!open) return null;
  const close = () => useUi.setState({ agentPanel: false });
  const srv = server ?? "…";
  const claudeCode = `claude mcp add notely -- node "${srv}" --vault "${vaultPath}"`;
  const desktopJson = JSON.stringify({ mcpServers: { notely: { command: "node", args: [srv, "--vault", vaultPath] } } }, null, 2);

  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="animate-pop max-h-[84vh] w-[620px] overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-pop">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Bot size={17} />
          </span>
          <h2 className="flex-1 text-[16px] font-semibold text-ink">Connect an AI agent</h2>
          <button onClick={close} className="rounded-md p-1 text-faint hover:bg-hover hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <p className="mb-5 text-[13px] leading-relaxed text-muted">
          Agents like Claude can create notebooks, write linked notes, read your PDFs and highlights, and draw diagrams —
          everything shows up here live. Notely includes an <b className="font-medium text-ink">MCP server</b> (the standard way
          agents use tools). It needs <b className="font-medium text-ink">Node.js</b> installed.
        </p>

        <Step n={1} title="Claude Code">
          Run this once in a terminal:
          <CodeBlock text={claudeCode} />
        </Step>

        <Step n={2} title="Claude Desktop, Cursor and other MCP apps">
          Add this to the app's MCP configuration (for Claude Desktop: Settings → Developer → Edit config):
          <CodeBlock text={desktopJson} />
        </Step>

        <Step n={3} title="Then just ask">
          <div className="mt-1 space-y-1.5 text-[12.5px] text-muted italic">
            <div>“Create a notebook ‘Operating Systems’ and summarize chapter 5 of the PDF into linked notes.”</div>
            <div>“Draw a flowchart of the page-fault handling process and embed it in my Chapter 6 note.”</div>
            <div>“Turn my highlights in the OS book into study notes that cite each passage.”</div>
          </div>
        </Step>

        <div className="mt-5 rounded-lg bg-hover px-3.5 py-2.5 text-[12px] leading-relaxed text-muted">
          Agents without MCP can still work directly on the files: the vault contains an <code className="text-ink">AGENTS.md</code>{" "}
          that documents the format. Agents can't delete anything through the MCP server.
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1 text-[13px] text-ink">
        <div className="mb-1 font-medium">{title}</div>
        <div className="text-[12.5px] text-muted">{children}</div>
      </div>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative mt-2">
      <pre className="overflow-x-auto rounded-lg border border-line bg-bg p-3 pr-10 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all text-ink select-text">
        {text}
      </pre>
      <button
        title="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute top-2 right-2 rounded-md bg-surface p-1.5 text-muted shadow-sm hover:text-ink"
      >
        {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
      </button>
    </div>
  );
}
