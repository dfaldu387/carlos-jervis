import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Mic, Sparkles, Search, Clock, TrendingUp, FileSearch, RotateCw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AnswerCard } from '@/components/answer-card';
import { Button } from '@/components/ui/button';
import type { AskResult } from '@/lib/types';

interface Turn {
  id: string;
  question: string;
  result?: AskResult;
  failed?: string;
}

const EXAMPLES = [
  { icon: Search, cat: 'Investigate', q: 'Any critical problems this week?' },
  { icon: Clock, cat: 'Shift summary', q: 'Summarize the early shift yesterday' },
  { icon: TrendingUp, cat: 'Explore trends', q: 'Which production line had the most issues this week?' },
  { icon: FileSearch, cat: 'Find evidence', q: 'Which parts were involved in E-4120?' },
];

const STAGES = ['Understanding your question…', 'Checking available production data…', 'Preparing your answer…'];

export function AskPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const sessionRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const askedParamRef = useRef(false);

  const ask = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text) return;
    setBusy(true);
    setDraft('');
    const id = `t-${Date.now()}`;
    setTurns((prev) => [...prev, { id, question: text }]);
    try {
      const result = await api.ask(text, sessionRef.current);
      sessionRef.current = result.sessionId;
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, result } : t)));
    } catch (e) {
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, failed: (e as Error).message } : t)));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  // A ?q= param (from the Command Center) asks that question once on arrival.
  useEffect(() => {
    const q = searchParams.get('q');
    if (q && !askedParamRef.current) {
      askedParamRef.current = true;
      void ask(q);
      searchParams.delete('q');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, ask, setSearchParams]);

  useEffect(() => {
    if (!busy) {
      setStage(0);
      return;
    }
    const t = setInterval(() => setStage((s) => (s < 2 ? s + 1 : s)), 900);
    return () => clearInterval(t);
  }, [busy]);

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  };

  const dictate = () => {
    // Browser dictation via the Web Speech API (Chrome/Edge). Typed loosely
    // because the DOM lib does not ship SpeechRecognition types everywhere.
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR() as {
      lang: string;
      start: () => void;
      onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
    };
    rec.lang = 'en-US';
    rec.onresult = (ev) => setDraft(ev.results[0][0].transcript);
    rec.start();
  };

  const empty = turns.length === 0 && !busy;

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col">
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="mb-4 grid h-13 w-13 place-items-center rounded-2xl bg-primary/10 p-3 text-primary">
            <Sparkles className="h-7 w-7" />
          </span>
          <h1 className="max-w-xl text-2xl font-bold tracking-tight text-foreground">
            What would you like to understand about production?
          </h1>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Ask a question in plain English. Jervis searches the approved sources available to you and explains what it finds, naming the system behind every figure.
          </p>
          <div className="mt-7 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
            {EXAMPLES.map((c) => (
              <button
                key={c.cat}
                type="button"
                onClick={() => ask(c.q)}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary/10 text-primary">
                  <c.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.cat}</span>
                  <span className="block text-sm font-medium text-foreground">{c.q}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 pb-4">
          {turns.map((turn) => (
            <div key={turn.id} className="flex flex-col gap-3">
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{turn.question}</div>
              </div>
              {turn.result ? <AnswerCard result={turn.result} onFollowUp={ask} /> : null}
              {turn.failed ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Could not answer: {turn.failed}</p>
                  <Button variant="secondary" size="sm" onClick={() => ask(turn.question)}>
                    <RotateCw /> Retry
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {busy ? (
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              {STAGES[stage]}
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="sticky bottom-0 bg-gradient-to-t from-background via-background to-transparent pb-2 pt-4">
        <form
          className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[26px] border border-border bg-card p-1.5 pl-5 shadow-md focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={onInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(draft);
              }
            }}
            rows={1}
            placeholder="Ask Jervis about production issues, events, or trends…"
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={dictate}
            title="Dictate"
            className="grid h-9 w-9 flex-none place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Mic className="h-[18px] w-[18px]" />
          </button>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className={cn(
              'grid h-9 w-9 flex-none place-items-center rounded-full text-primary-foreground transition-colors',
              busy || !draft.trim() ? 'cursor-not-allowed bg-muted text-muted-foreground' : 'bg-primary hover:bg-primary/90',
            )}
          >
            <Send className="h-[17px] w-[17px]" />
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
      </div>
    </div>
  );
}
