import { useNavigate } from 'react-router-dom';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useVoiceCtx } from '@/hooks/voice-provider';
import { JervisFace, type FaceEyes } from '@/components/jervis-face';

interface JervisCoreProps {
  /** Show the "Open full chat" link (hidden when already on the Ask page). */
  showOpenChat?: boolean;
  /** Smaller orb and tighter spacing, for placing the core beside other content. */
  compact?: boolean;
  className?: string;
}

export function JervisCore({ showOpenChat = true, compact = false, className }: JervisCoreProps) {
  const navigate = useNavigate();
  const t = useT();
  const { voice } = useVoiceCtx();

  const active = voice.phase === 'listening' || voice.phase === 'speaking' || voice.phase === 'greeting';
  const title = voice.recording ? t('core.release') : t(`core.${voice.phase}.title`);
  const hint = voice.recording ? t('core.listening.hint') : t(`core.${voice.phase}.hint`);

  // The helmet face replaces the orb from the moment a question is being
  // worked on until the spoken answer ends. Eyes: dim pulse while thinking,
  // fully lit while Jervis talks.
  const showFace = voice.phase === 'thinking' || voice.phase === 'greeting' || voice.phase === 'speaking';
  const eyes: FaceEyes = voice.phase === 'thinking' ? 'dim' : showFace ? 'on' : 'off';

  // Hands-free mode needs the Web Speech API. Without it the orb becomes a
  // hold-to-talk button that records and transcribes on the server.
  const holdToTalk = !voice.supported && voice.sttFallback;
  const interactive = voice.supported || holdToTalk;

  return (
    <div
      className={cn(
        'relative flex h-full flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-gradient-to-b from-primary/5 via-card to-card text-center dark:border-primary/25 dark:from-[#0f2a4d] dark:via-[#0a1930] dark:to-[#081326]',
        compact ? 'min-h-[300px] p-5' : 'min-h-[360px] p-6',
        className,
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary">{t('core.label')}</div>
      <div className={cn('mt-1 font-bold leading-none tracking-[0.18em] text-foreground', compact ? 'text-[28px]' : 'text-[34px]')}>JERVIS</div>
      <div className={cn('mt-2 text-[10.5px] font-semibold uppercase tracking-[0.3em] text-primary/70', compact ? 'mb-4' : 'mb-6')}>{t('app.tagline')}</div>

      {/* Orb while idle / listening; the helmet face takes over once Jervis is working on an answer. */}
      <button
        type="button"
        onClick={voice.supported ? voice.toggle : undefined}
        onPointerDown={holdToTalk ? () => void voice.pushToTalkStart() : undefined}
        onPointerUp={holdToTalk ? voice.pushToTalkStop : undefined}
        onPointerLeave={holdToTalk ? voice.pushToTalkStop : undefined}
        disabled={!interactive}
        aria-pressed={voice.enabled}
        title={holdToTalk ? t('core.holdToTalk') : voice.enabled ? t('core.toggleOff') : t('core.toggleOn')}
        className={cn(
          'group relative grid touch-none select-none place-items-center rounded-full transition-all duration-300 disabled:cursor-not-allowed',
          // The helmet is shown much larger than the orb.
          showFace ? (compact ? 'h-[216px] w-[216px]' : 'h-[252px] w-[252px]') : compact ? 'h-28 w-28' : 'h-36 w-36',
        )}
      >
        {/* Orb layer */}
        <span className={cn('absolute inset-0 transition-opacity duration-300', showFace ? 'opacity-0' : 'opacity-100')}>
          <span className={cn('absolute inset-0 rounded-full border border-dashed', voice.enabled ? 'border-primary/50' : 'border-border')} />
          <span
            className={cn(
              'absolute inset-3 rounded-full border-2 shadow-[0_0_22px_hsl(var(--primary)/0.25)]',
              voice.enabled ? 'border-primary/70' : 'border-border',
              active && !showFace && 'animate-ping',
            )}
          />
          <span
            className={cn(
              'absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-all',
              compact ? 'h-[68px] w-[68px]' : 'h-[88px] w-[88px]',
              voice.enabled || voice.recording
                ? 'bg-primary text-primary-foreground shadow-[0_0_30px_hsl(var(--primary)/0.55)]'
                : 'bg-secondary text-muted-foreground',
            )}
          >
            <Mic className={compact ? 'h-7 w-7' : 'h-8 w-8'} />
          </span>
        </span>

        {/* Face layer */}
        <span
          className={cn(
            'absolute inset-0 grid place-items-center transition-all duration-300',
            showFace ? 'scale-100 opacity-100' : 'scale-90 opacity-0',
            eyes === 'on' && 'drop-shadow-[0_0_18px_hsl(var(--primary)/0.55)]',
          )}
          aria-hidden={!showFace}
        >
          <JervisFace eyes={eyes} className={compact ? 'h-[208px] w-[156px]' : 'h-[244px] w-[183px]'} />
          {voice.phase === 'speaking' ? (
            <span
              className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-md"
              title={t('core.stop')}
            >
              <Square className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </span>
      </button>

      <div className={cn('text-sm font-semibold text-foreground', compact ? 'mt-4' : 'mt-5')}>{title}</div>

      {/* Waveform */}
      <div className={cn('flex h-7 items-center gap-[2.5px]', compact ? 'mt-2' : 'mt-3')}>
        {Array.from({ length: 22 }).map((_, i) => (
          <span
            key={i}
            className={cn('w-[2.5px] rounded-full bg-primary', active || voice.recording ? 'opacity-90 animate-pulse' : 'opacity-40')}
            style={{
              height: active || voice.recording ? `${5 + ((i * 11) % 22)}px` : `${3 + ((i * 5) % 7)}px`,
              animationDelay: `${i * 55}ms`,
            }}
          />
        ))}
      </div>

      {voice.transcript && (voice.phase === 'listening' || voice.phase === 'awake') ? (
        <p className="mt-3 max-w-[22rem] truncate text-xs italic text-muted-foreground">“{voice.transcript}”</p>
      ) : (
        <p className="mt-3 text-xs italic text-muted-foreground">{hint}</p>
      )}

      {voice.error ? <p className="mt-2 max-w-[22rem] text-xs text-destructive">{voice.error}</p> : null}

      <div className={cn('flex items-center gap-4 text-xs', compact ? 'mt-4' : 'mt-5')}>
        {voice.supported ? (
          <button
            type="button"
            onClick={voice.askNow}
            disabled={voice.phase === 'listening'}
            className="font-medium text-primary transition-colors hover:underline disabled:opacity-40"
          >
            {t('core.askNow')}
          </button>
        ) : null}
        {showOpenChat ? (
          <button type="button" onClick={() => navigate('/')} className="font-medium text-primary transition-colors hover:underline">
            {t('core.openChat')}
          </button>
        ) : null}
      </div>

      {holdToTalk ? <p className="mt-2 max-w-[22rem] text-xs text-muted-foreground">{t('core.unsupported')}</p> : null}
      {!interactive ? <p className="mt-2 max-w-[22rem] text-xs text-muted-foreground">{t('core.noVoice')}</p> : null}
    </div>
  );
}
