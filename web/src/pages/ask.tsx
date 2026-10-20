import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Mic, Search, Sun, Mail, LayoutGrid, RotateCw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AnswerCard } from '@/components/answer-card';
import { JervisCore } from '@/components/jervis-core';
import { Button } from '@/components/ui/button';
import { useVoiceCtx } from '@/hooks/voice-provider';
import { useI18n } from '@/lib/i18n';
import type { AskResult } from '@/lib/types';

interface Turn {
  id: string;
  question: string;
  result?: AskResult;
  failed?: string;
  // True while this turn is being re-fetched after a language switch.
  refreshing?: boolean;
  // Set when the question came from a localised prompt (example/suggestion), so
  // its bubble follows the UI language instead of staying in the asked language.
  questionKey?: string;
}

// Translation keys; the question text is localised too so German users get
// German examples that the NLU understands.
const EXAMPLES = [
  { icon: Sun, cat: 'ask.ex.briefing', q: 'ask.ex.briefing.q' },
  { icon: Mail, cat: 'ask.ex.inbox', q: 'ask.ex.inbox.q' },
  { icon: Search, cat: 'ask.ex.investigate', q: 'ask.ex.investigate.q' },
  { icon: LayoutGrid, cat: 'ask.ex.dashboard', q: 'ask.ex.dashboard.q' },
];

const STAGES = ['ask.stage.1', 'ask.stage.2', 'ask.stage.3'];

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

  // Spoken ("Hey Jervis") answers land in this page's conversation instead of
  // the global side sheet, so everything Jervis says shows up beside the core.
  const { voice, claimAnswers } = useVoiceCtx();
  const { t, language } = useI18n();
  const languageRef = useRef(language);
  languageRef.current = language;
  const tRef = useRef(t);
  tRef.current = t;
  // Latest turns without making the refresh effect depend on them (so its own
  // setTurns updates don't cancel the in-flight re-fetch).
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const prevLanguageRef = useRef(language);
  const loadedSessionRef = useRef(false);

  // The text to ask the server for a turn: a localised prompt follows the
  // current language; anything else is sent exactly as it was asked.
  const questionTextFor = (turn: Turn) => (turn.questionKey ? tRef.current(turn.questionKey) : turn.question);
  useEffect(() => claimAnswers((result) => setTurns((prev) => [...prev, { id: `v-${result.id}`, question: result.question, result }])), [claimAnswers]);

  // Answers are rendered from text the server generated in the language that
  // was active when the question was asked; only the card chrome follows the
  // live UI language. So when the viewer switches EN/DE we re-ask every answered
  // turn in the new language and swap the results in place, rethreading a fresh
  // session so the server-side conversation mirrors what's on screen.
  useEffect(() => {
    if (prevLanguageRef.current === language) return;
    prevLanguageRef.current = language;
    const toRefresh = turnsRef.current.filter((turn) => turn.result || turn.failed);
    if (toRefresh.length === 0) return;
    let cancelled = false;
    setTurns((prev) => prev.map((turn) => (turn.result || turn.failed ? { ...turn, refreshing: true } : turn)));
    (async () => {
      let session: string | undefined;
      for (const turn of toRefresh) {
        try {
          const result = await api.ask(questionTextFor(turn), session, language);
          session = result.sessionId;
          if (cancelled) return;
          // Keyed turns (examples) relabel live via t(); for the rest, follow the
          // server's localized phrasing of the question (follow-ups, prompts).
          setTurns((prev) =>
            prev.map((x) =>
              x.id === turn.id
                ? { ...x, result, failed: undefined, refreshing: false, question: x.questionKey ? x.question : result.localizedQuestion ?? x.question }
                : x,
            ),
          );
        } catch (e) {
          if (cancelled) return;
          setTurns((prev) => prev.map((x) => (x.id === turn.id ? { ...x, failed: (e as Error).message, refreshing: false } : x)));
        }
      }
      if (!cancelled) sessionRef.current = session;
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  const ask = useCallback(async (question: string, questionKey?: string) => {
    const text = question.trim();
    if (!text) return;
    setBusy(true);
    setDraft('');
    const id = `t-${Date.now()}`;
    setTurns((prev) => [...prev, { id, question: text, questionKey }]);
    try {
      const result = await api.ask(text, sessionRef.current, languageRef.current);
      sessionRef.current = result.sessionId;
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, result } : t)));
    } catch (e) {
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, failed: (e as Error).message } : t)));
    } finally {
      setBusy(false);
    }
  }, []);

  // Typed questions and spoken ones both show the progress line.
  const waiting = busy || voice.phase === 'thinking';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns, waiting]);

  // A ?session= param (from Conversation History) loads that transcript into
  // the panel once and continues it, so follow-ups extend the same session.
  useEffect(() => {
    const sid = searchParams.get('session');
    if (!sid || loadedSessionRef.current) return;
    loadedSessionRef.current = true;
    void (async () => {
      try {
        const convo = await api.conversation(sid);
        sessionRef.current = convo.sessionId;
        setTurns(convo.turns.map((turn, i) => ({ id: `h-${i}`, question: turn.question, result: turn.result })));
      } catch {
        /* a stale or foreign session id just opens a fresh panel */
      } finally {
        searchParams.delete('session');
        setSearchParams(searchParams, { replace: true });
      }
    })();
  }, [searchParams, setSearchParams]);

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
    if (!waiting) {
      setStage(0);
      return;
    }
    const t = setInterval(() => setStage((s) => (s < 2 ? s + 1 : s)), 900);
    return () => clearInterval(t);
  }, [waiting]);

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
    rec.lang = languageRef.current === 'de' ? 'de-DE' : 'en-US';
    rec.onresult = (ev) => setDraft(ev.results[0][0].transcript);
    rec.start();
  };

  const empty = turns.length === 0 && !waiting;

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col">
      <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
        {/* Left: the Jervis voice core, pinned while the conversation scrolls */}
        <div className="lg:sticky lg:top-6 lg:flex lg:min-h-[calc(100vh-13.5rem)] lg:items-center lg:self-start">
          <JervisCore showOpenChat={false} compact className="mx-auto w-full max-w-md lg:max-w-none" />
        </div>

        {/* Right: the conversation */}
        <div className="flex min-h-0 flex-col">
          {empty ? (
            <div className="flex flex-1 flex-col items-center justify-center py-6 text-center lg:items-start lg:text-left">
              <h1 className="max-w-xl text-2xl font-bold tracking-tight text-foreground">{t('ask.title')}</h1>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t('ask.subtitle')}</p>
              <div className="mt-5 grid w-full gap-3 sm:grid-cols-2">
                {EXAMPLES.map((c) => (
                  <button
                    key={c.cat}
                    type="button"
                    onClick={() => ask(t(c.q), c.q)}
                    className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                  >
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary/10 text-primary">
                      <c.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t(c.cat)}</span>
                      <span className="block text-sm font-medium text-foreground">{t(c.q)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-5 pb-4 pt-2">
              {turns.map((turn) => (
                <div key={turn.id} className={cn('flex flex-col gap-3', turn.refreshing && 'opacity-50 transition-opacity')}>
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      {turn.questionKey ? t(turn.questionKey) : turn.question}
                    </div>
                  </div>
                  {turn.result ? <AnswerCard result={turn.result} onFollowUp={ask} /> : null}
                  {turn.failed ? (
                    <div className="flex flex-col items-start gap-2">
                      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{t('ask.failed', { message: turn.failed })}</p>
                      <Button variant="secondary" size="sm" onClick={() => ask(turn.question)}>
                        <RotateCw /> {t('ask.retry')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
              {waiting ? (
                <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                  {t(STAGES[stage])}
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {/* Composer: pinned to the bottom of the viewport, centred in the content
          area, narrow enough to stay clear of the floating voice button. */}
      <div className="sticky bottom-0 z-30 bg-gradient-to-t from-background via-background to-transparent pb-2 pt-4">
        <div className="mx-auto w-full max-w-3xl pr-20 sm:pr-0">
          <form
            className="flex w-full items-end gap-2 rounded-[26px] border border-border bg-card p-1.5 pl-5 shadow-md focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15"
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
              placeholder={t('ask.placeholder')}
              className="max-h-40 flex-1 resize-none bg-transparent py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={dictate}
              title={t('ask.dictate')}
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
          <p className="mt-2 text-center text-xs text-muted-foreground">{t('ask.hint')}</p>
        </div>
      </div>
    </div>
  );
}
