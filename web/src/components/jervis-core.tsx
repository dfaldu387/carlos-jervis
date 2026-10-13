import { useNavigate } from 'react-router-dom';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type VoicePhase } from '@/hooks/use-voice';
import { useVoiceCtx } from '@/hooks/voice-provider';

const STATUS: Record<VoicePhase, { title: string; hint: string }> = {
  off: { title: 'Voice mode is off', hint: 'Tap the core to start, or say “Hey Jervis”' },
  awake: { title: 'Awake — say “Hey Jervis”', hint: 'Listening for the wake phrase' },
  greeting: { title: 'Jervis is answering you', hint: 'Wait for the prompt, then ask' },
  listening: { title: 'Listening — ask your question', hint: 'Speak normally, then pause' },
  thinking: { title: 'Checking the systems', hint: 'Retrieving and combining the data' },
  speaking: { title: 'Jervis is answering', hint: 'The full answer is on screen too' },
};

export function JervisCore() {
  const navigate = useNavigate();
  const { voice } = useVoiceCtx();

  const active = voice.phase === 'listening' || voice.phase === 'speaking' || voice.phase === 'greeting';
  const status = STATUS[voice.phase];

  return (
    <div className="relative flex h-full min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-gradient-to-b from-primary/5 via-card to-card p-6 text-center dark:border-primary/25 dark:from-[#0f2a4d] dark:via-[#0a1930] dark:to-[#081326]">
      <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary">Jervis Core</div>
      <div className="mt-1 text-[34px] font-bold leading-none tracking-[0.18em] text-foreground">JERVIS</div>
      <div className="mb-6 mt-2 text-[10.5px] font-semibold uppercase tracking-[0.3em] text-primary/70">
        Production Intelligence
      </div>

      {/* Orb */}
      <button
        type="button"
        onClick={voice.supported ? voice.toggle : undefined}
        disabled={!voice.supported}
        aria-pressed={voice.enabled}
        title={voice.enabled ? 'Turn voice off' : 'Tap to start voice'}
        className="group relative grid h-36 w-36 place-items-center rounded-full disabled:cursor-not-allowed"
      >
        <span className={cn('absolute inset-0 rounded-full border border-dashed', voice.enabled ? 'border-primary/50' : 'border-border')} />
        <span
          className={cn(
            'absolute inset-3 rounded-full border-2 shadow-[0_0_22px_hsl(var(--primary)/0.25)]',
            voice.enabled ? 'border-primary/70' : 'border-border',
            active && 'animate-ping',
          )}
        />
        <span
          className={cn(
            'grid h-[88px] w-[88px] place-items-center rounded-full transition-all',
            voice.enabled
              ? 'bg-primary text-primary-foreground shadow-[0_0_30px_hsl(var(--primary)/0.55)]'
              : 'bg-secondary text-muted-foreground',
          )}
        >
          {voice.phase === 'speaking' ? <Square className="h-7 w-7" /> : <Mic className="h-8 w-8" />}
        </span>
      </button>

      <div className="mt-5 text-sm font-semibold text-foreground">{status.title}</div>

      {/* Waveform */}
      <div className="mt-3 flex h-7 items-center gap-[2.5px]">
        {Array.from({ length: 22 }).map((_, i) => (
          <span
            key={i}
            className={cn('w-[2.5px] rounded-full bg-primary', active ? 'opacity-90 animate-pulse' : 'opacity-40')}
            style={{ height: active ? `${5 + ((i * 11) % 22)}px` : `${3 + ((i * 5) % 7)}px`, animationDelay: `${i * 55}ms` }}
          />
        ))}
      </div>

      {voice.transcript && (voice.phase === 'listening' || voice.phase === 'awake') ? (
        <p className="mt-3 max-w-[22rem] truncate text-xs italic text-muted-foreground">“{voice.transcript}”</p>
      ) : (
        <p className="mt-3 text-xs italic text-muted-foreground">{status.hint}</p>
      )}

      <div className="mt-5 flex items-center gap-4 text-xs">
        {voice.supported ? (
          <button
            type="button"
            onClick={voice.askNow}
            disabled={voice.phase === 'listening'}
            className="font-medium text-primary transition-colors hover:underline disabled:opacity-40"
          >
            Ask without wake phrase
          </button>
        ) : null}
        <button type="button" onClick={() => navigate('/ask')} className="font-medium text-primary transition-colors hover:underline">
          Open full chat ›
        </button>
      </div>

      {!voice.supported ? <p className="mt-2 text-xs text-muted-foreground">Voice needs Chrome or Edge.</p> : null}
    </div>
  );
}
