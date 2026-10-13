import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceCtx } from '@/hooks/voice-provider';
import { useT } from '@/lib/i18n';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AnswerCard } from '@/components/answer-card';
import type { VoicePhase } from '@/hooks/use-voice';

const LABEL_KEY: Record<VoicePhase, string> = {
  off: 'voice.off',
  awake: 'voice.awake',
  greeting: 'voice.answering',
  listening: 'voice.listening',
  thinking: 'voice.thinking',
  speaking: 'voice.answering',
};

const POS_KEY = 'jervis.voice-button.pos';
const EDGE = 12; // minimum gap to the viewport edge, px
const DRAG_THRESHOLD = 5; // px of movement before a press counts as a drag

interface Pos {
  x: number;
  y: number;
}

const loadPos = (): Pos | null => {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pos>;
    return typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null;
  } catch {
    return null;
  }
};

const savePos = (p: Pos) => {
  try {
    window.localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: position just won't persist */
  }
};

const clamp = (p: Pos, el: HTMLElement | null): Pos => {
  const w = el?.offsetWidth ?? 56;
  const h = el?.offsetHeight ?? 56;
  return {
    x: Math.min(Math.max(p.x, EDGE), Math.max(EDGE, window.innerWidth - w - EDGE)),
    y: Math.min(Math.max(p.y, EDGE), Math.max(EDGE, window.innerHeight - h - EDGE)),
  };
};

export function GlobalVoice() {
  const navigate = useNavigate();
  const { voice, answer, showAnswer, setShowAnswer } = useVoiceCtx();
  const t = useT();

  // Draggable floating control. `pos` is null until the user moves it, which
  // keeps the default bottom-right placement from CSS.
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => (typeof window === 'undefined' ? null : loadPos()));
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  // Keep a saved position on screen when the window is resized.
  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((p) => (p ? clamp(p, boxRef.current) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  // Hands-free needs the Web Speech API; otherwise the button is hold-to-talk.
  const holdToTalk = !voice.supported && voice.sttFallback;
  if (!voice.supported && !holdToTalk) return null;

  const active = voice.phase === 'listening' || voice.phase === 'speaking' || voice.phase === 'greeting';

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top, moved: false };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    e.preventDefault();
    setPos(clamp({ x: d.originX + dx, y: d.originY + dy }, boxRef.current));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      boxRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (d.moved) {
      // A drag must not also toggle the microphone.
      suppressClickRef.current = true;
      setPos((p) => {
        if (p) savePos(p);
        return p;
      });
    }
  };

  const onToggle = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    voice.toggle();
  };

  return (
    <>
      {/* Floating voice button, present on every page; drag it anywhere. */}
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
        className={cn(
          'fixed bottom-6 right-6 z-40 flex touch-none select-none flex-col items-end gap-2',
          dragRef.current?.moved ? 'cursor-grabbing' : 'cursor-grab',
        )}
        title={t('voice.drag')}
      >
        {voice.enabled || voice.recording ? (
          <span className="max-w-[220px] truncate rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-md">
            {voice.phase === 'listening' && voice.transcript ? `“${voice.transcript}”` : voice.recording ? t('core.release') : t(LABEL_KEY[voice.phase])}
          </span>
        ) : null}
        <button
          type="button"
          onClick={holdToTalk ? undefined : onToggle}
          onPointerDown={holdToTalk ? () => void voice.pushToTalkStart() : undefined}
          onPointerUp={holdToTalk ? voice.pushToTalkStop : undefined}
          onPointerLeave={holdToTalk ? voice.pushToTalkStop : undefined}
          title={holdToTalk ? t('core.holdToTalk') : voice.enabled ? t('voice.turnOff') : t('voice.turnOn')}
          aria-pressed={voice.enabled}
          className={cn(
            'relative grid h-14 w-14 place-items-center rounded-full shadow-lg transition-colors',
            voice.enabled || voice.recording ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-primary',
          )}
        >
          {active ? <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary/60" /> : null}
          {voice.phase === 'speaking' ? <Square className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </button>
      </div>

      <Sheet open={showAnswer} onOpenChange={setShowAnswer}>
        <SheetContent title={t('voice.answered')}>
          {answer ? (
            <AnswerCard
              result={answer}
              onFollowUp={(q) => {
                setShowAnswer(false);
                navigate(`/?q=${encodeURIComponent(q)}`);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
