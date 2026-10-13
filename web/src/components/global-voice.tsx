import { useNavigate } from 'react-router-dom';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceCtx } from '@/hooks/voice-provider';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AnswerCard } from '@/components/answer-card';
import type { VoicePhase } from '@/hooks/use-voice';

const LABEL: Record<VoicePhase, string> = {
  off: 'Voice off',
  awake: 'Say “Hey Jervis”',
  greeting: 'Jervis is answering',
  listening: 'Listening…',
  thinking: 'Checking the systems…',
  speaking: 'Jervis is answering',
};

export function GlobalVoice() {
  const navigate = useNavigate();
  const { voice, answer, showAnswer, setShowAnswer } = useVoiceCtx();
  if (!voice.supported) return null;

  const active = voice.phase === 'listening' || voice.phase === 'speaking' || voice.phase === 'greeting';

  return (
    <>
      {/* Floating voice button, present on every page */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {voice.enabled ? (
          <span className="max-w-[220px] truncate rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-md">
            {voice.phase === 'listening' && voice.transcript ? `“${voice.transcript}”` : LABEL[voice.phase]}
          </span>
        ) : null}
        <button
          type="button"
          onClick={voice.toggle}
          title={voice.enabled ? 'Turn Jervis voice off' : 'Turn Jervis voice on'}
          aria-pressed={voice.enabled}
          className={cn(
            'relative grid h-14 w-14 place-items-center rounded-full shadow-lg transition-colors',
            voice.enabled ? 'bg-primary text-primary-foreground' : 'bg-card text-primary border border-border',
          )}
        >
          {active ? <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary/60" /> : null}
          {voice.phase === 'speaking' ? <Square className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </button>
      </div>

      <Sheet open={showAnswer} onOpenChange={setShowAnswer}>
        <SheetContent title="Jervis answered">
          {answer ? (
            <AnswerCard
              result={answer}
              onFollowUp={(q) => {
                setShowAnswer(false);
                navigate(`/ask?q=${encodeURIComponent(q)}`);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
