import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export type FaceEyes = 'off' | 'dim' | 'on';

interface JervisFaceProps {
  /** off: idle, dim: thinking (eyes dark), on: answering (eyes lit, clip looping). */
  eyes: FaceEyes;
  className?: string;
}

// Timings inside /jervis-face.mp4 (a short generated clip of the helmet):
// the eyes are dark until about 1.6 s, light up, and the head turns until the end.
const DARK_FRAME = 0.2; // a still with the eyes off
const IGNITE_FROM = 1.2; // start here so the eyes visibly power on
const LOOP_FROM = 2.2; // once lit, keep looping from here to the end

/**
 * The Jervis helmet, rendered from a short clip: held on a dark-eyed frame
 * while Jervis is checking the systems, then played so the eyes power on and
 * looped on the lit section while it talks.
 */
export function JervisFace({ eyes, className }: JervisFaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seek = (t: number) => {
      try {
        v.currentTime = t;
      } catch {
        /* metadata not ready yet: the loadedmetadata handler below retries */
      }
    };
    if (eyes === 'on') {
      seek(IGNITE_FROM);
      void v.play().catch(() => {
        /* autoplay blocked: the poster frame still shows */
      });
    } else {
      v.pause();
      seek(DARK_FRAME);
    }
    const onMeta = () => seek(eyes === 'on' ? IGNITE_FROM : DARK_FRAME);
    v.addEventListener('loadedmetadata', onMeta);
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, [eyes]);

  const onEnded = () => {
    const v = videoRef.current;
    if (!v || eyes !== 'on') return;
    v.currentTime = LOOP_FROM;
    void v.play().catch(() => undefined);
  };

  return (
    <div
      role="img"
      aria-label={eyes === 'on' ? 'Jervis is answering' : eyes === 'dim' ? 'Jervis is thinking' : 'Jervis'}
      className={cn('relative overflow-hidden rounded-[28px] bg-black ring-1 ring-primary/30', className)}
    >
      <video
        ref={videoRef}
        src="/jervis-face.mp4"
        poster="/jervis-face-poster.jpg"
        muted
        playsInline
        preload="auto"
        onEnded={onEnded}
        className="h-full w-full object-cover"
      />
      {/* Soft edge so the clip sits in the panel instead of looking pasted on */}
      <div className="pointer-events-none absolute inset-0 rounded-[28px] shadow-[inset_0_0_32px_12px_rgba(3,10,24,0.85)]" />
      {/* Dark-eyed hold while thinking: a slow breathing veil */}
      {eyes === 'dim' ? <div className="jervis-eyes-dim pointer-events-none absolute inset-0 bg-primary/20" /> : null}
    </div>
  );
}
