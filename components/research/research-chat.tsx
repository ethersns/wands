"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, CircleAlert, Sparkles, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const SUGGESTIONS = [
  "Summarise my current risk posture and the tightest constraint.",
  "Which open position carries the most concentration risk?",
  "Compare the trend-following and momentum backtests. Which held up out of sample?",
  "Explain what a stale quote means for strategy eligibility.",
  "Draft a research checklist before I raise the per-trade risk budget.",
];

function MessageBody({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const isList = lines.every((line) => /^[-*•]\s/.test(line.trim()));

        if (isList) {
          return (
            <ul key={index} className="flex flex-col gap-1 pl-1">
              {lines.map((line, lineIndex) => (
                <li
                  key={lineIndex}
                  className="flex gap-2 text-[13px] leading-relaxed text-foreground/90"
                >
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span>{line.replace(/^[-*•]\s/, "")}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p
            key={index}
            className="text-[13px] leading-relaxed text-pretty text-foreground/90"
          >
            {block}
          </p>
        );
      })}
    </div>
  );
}

export function ResearchChat() {
  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/research" }),
  });
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const busy = status === "submitted" || status === "streaming";

  React.useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, status]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="flex h-[calc(100dvh-15rem)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 sm:px-5"
        aria-live="polite"
        aria-busy={busy}
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-primary">
              <Sparkles className="size-4" aria-hidden />
            </div>
            <div className="max-w-md">
              <p className="text-[14px] font-medium text-foreground">
                Research assistant
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-pretty text-muted-foreground">
                Ask about market conditions, strategy behaviour, backtest results or
                risk exposure. Answers are research suggestions — nothing here
                executes a trade.
              </p>
            </div>
            <div className="flex w-full max-w-lg flex-col gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => submit(suggestion)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((message) => {
              const text = message.parts
                .filter((part) => part.type === "text")
                .map((part) => (part.type === "text" ? part.text : ""))
                .join("");

              if (message.role === "user") {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-br-sm border border-border bg-secondary px-3 py-2">
                      <p className="text-[13px] leading-relaxed text-pretty text-foreground">
                        {text}
                      </p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={message.id} className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
                    <Sparkles className="size-2.5 text-primary" aria-hidden />
                    Wands research
                  </span>
                  {text ? (
                    <MessageBody text={text} />
                  ) : (
                    <span className="flex gap-1" aria-label="Thinking">
                      {[0, 1, 2].map((dot) => (
                        <span
                          key={dot}
                          className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50"
                          style={{ animationDelay: `${dot * 150}ms` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error ? (
        <div className="flex items-start gap-2 border-t border-loss/25 bg-loss/[0.06] px-4 py-2.5">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-loss" aria-hidden />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The research assistant could not complete that request. Check that the AI
            Gateway is reachable, then try again.
          </p>
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
        className="border-t border-border p-3"
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              submit(input);
            }}
            placeholder="Ask about markets, strategies or risk…"
            aria-label="Message the research assistant"
            rows={1}
            className="max-h-32 min-h-9 resize-none py-2 text-[13px]"
          />
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => stop()}
              aria-label="Stop generating"
            >
              <Square className="size-3.5" aria-hidden />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim()}
              aria-label="Send message"
            >
              <ArrowUp className="size-4" aria-hidden />
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-0.5 text-[10px] text-muted-foreground">
          Research only. The assistant cannot place orders, change risk limits or
          enable live trading.
        </p>
      </form>
    </div>
  );
}
