import { useEffect, useRef, useState } from 'react';
import type { AskResult } from '@/lib/types';

export type VoicePhase = 'off' | 'awake' | 'greeting' | 'listening' | 'thinking' | 'speaking';

export interface VoiceConfig {
  greeting?: { parts?: { fromHour: number; text: string }[]; honorific?: string; prompt?: string };
  greetingNow?: string;
  followUpPrompt?: string;
  notUnderstood?: string;
  silence?: string;
  wake?: { phrase?: string; variants?: string[]; prefixes?: string[] };
  timings?: { questionTimeoutMs?: number; followUpTimeoutMs?: number };
  tts?: { provider?: string; enabled?: boolean };
}

interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

function buildWakeMatcher(wake?: VoiceConfig['wake']) {
  const variants = wake?.variants?.length ? wake.variants : ['jervis', 'jarvis', 'service'];
  const prefixes = wake?.prefixes?.length ? wake.prefixes : ['hey', 'hi', 'hello', 'ok', 'okay'];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = variants.map(esc).join('|');
  const pre = prefixes.map(esc).join('|');
  const re = new RegExp(`(?:\\b(?:${pre})\\b[\\s,]*)?\\b(?:${names})\\b[\\s,.:!?-]*`, 'i');
  return (text: string): { remainder: string } | null => {
    const m = re.exec(text ?? '');
    if (!m) return null;
    return { remainder: text.slice(m.index + m[0].length).trim() };
  };
}

export function useVoice({
  config,
  onAsk,
}: {
  config?: VoiceConfig | null;
  onAsk: (question: string) => Promise<AskResult | null>;
}) {
  const [supported] = useState(
    () => typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window),
  );
  const [phase, setPhase] = useState<VoicePhase>('off');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRec | null>(null);
  const runningRef = useRef(false);
  const enabledRef = useRef(false);
  const phaseRef = useRef<VoicePhase>('off');
  const waitingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsEnabledRef = useRef(false);
  ttsEnabledRef.current = Boolean(config?.tts?.enabled);

  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;
  const matchRef = useRef(buildWakeMatcher(config?.wake));
  useEffect(() => {
    matchRef.current = buildWakeMatcher(config?.wake);
  }, [config?.wake]);
  const greetingRef = useRef('Yes?');
  greetingRef.current = config?.greetingNow ?? config?.greeting?.prompt ?? 'Yes, how can I help?';

  // Warm up the speech-synthesis voice list (loaded asynchronously).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }, []);

  const startRef = useRef<() => void>(() => {});
  const processRef = useRef<(t: string) => void>(() => {});

  const setBoth = (p: VoicePhase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // Pick a deep male voice (Indian English if present) to approximate the
  // Jackie Shroff timbre; the browser can only use voices it ships.
  const pickVoice = (): SpeechSynthesisVoice | null => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const FEMALE = /female|heera|zira|hazel|susan|samantha|aria|jenny|neerja|swara|google uk english female|eva|catherine|linda|hortense/i;
    const notFemale = voices.filter((v) => !FEMALE.test(v.name));
    const find = (re: RegExp, pool = notFemale) => pool.find((v) => re.test(v.name) || re.test(v.lang));
    return (
      // A deep Indian-English male comes closest to the Jackie Shroff timbre.
      find(/ravi|hemant|prabhat|madhur/i) ||
      find(/en-IN/i) ||
      find(/UK English Male|George|Daniel|Microsoft David|Microsoft Mark|rishi|alex/i) ||
      find(/^en/i) ||
      notFemale[0] ||
      voices[0] ||
      null
    );
  };

  const stopAudio = () => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  };

  const browserSpeak = (text: string, after?: () => void) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      after?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    // Deep, slow, gravelly fallback when ElevenLabs is not configured.
    u.rate = 0.86;
    u.pitch = 0.55;
    u.onend = () => after?.();
    u.onerror = () => after?.();
    window.speechSynthesis.speak(u);
  };

  const elevenSpeak = (text: string, after?: () => void) => {
    fetch('/api/voice/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('tts');
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          after?.();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          after?.();
        };
        await audio.play();
      })
      .catch(() => browserSpeak(text, after));
  };

  const speak = (text: string, after?: () => void) => {
    if (!text) {
      after?.();
      return;
    }
    stopAudio();
    if (ttsEnabledRef.current) elevenSpeak(text, after);
    else browserSpeak(text, after);
  };

  const handleQuestion = (question: string) => {
    waitingRef.current = false;
    setBoth('thinking');
    setTranscript('');
    onAskRef
      .current(question)
      .then((result) => {
        const a = result?.answer;
        const spoken = a ? [a.headline, ...(a.narrative ?? [])].join('. ') : 'I could not find an answer.';
        setBoth('speaking');
        speak(spoken, () => {
          if (enabledRef.current) {
            setBoth('awake');
            startRef.current();
          } else {
            setBoth('off');
          }
        });
      })
      .catch(() => {
        if (enabledRef.current) {
          setBoth('awake');
          startRef.current();
        } else {
          setBoth('off');
        }
      });
  };

  // Decide what to do with a final transcript.
  processRef.current = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (waitingRef.current || phaseRef.current === 'listening') {
      handleQuestion(t);
      return;
    }
    const hit = matchRef.current(t);
    if (!hit) return;
    if (hit.remainder && hit.remainder.length > 2) {
      handleQuestion(hit.remainder);
    } else {
      setBoth('greeting');
      waitingRef.current = true;
      speak(greetingRef.current, () => {
        if (enabledRef.current) {
          setBoth('listening');
          startRef.current(); // restart recognition to capture the question
        }
      });
    }
  };

  startRef.current = () => {
    if (!supported || runningRef.current) return;
    const Ctor =
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition ??
      (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < ev.results.length; i += 1) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setTranscript(interim || final);
      if (final) processRef.current(final);
    };
    rec.onend = () => {
      runningRef.current = false;
      recRef.current = null;
      // Keep listening while awake or waiting for a question.
      if (enabledRef.current && (phaseRef.current === 'awake' || phaseRef.current === 'listening')) {
        startRef.current();
      }
    };
    rec.onerror = (ev) => {
      runningRef.current = false;
      const err = (ev as { error?: string })?.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        enabledRef.current = false;
        setError('Microphone permission is blocked. Allow it in the browser to use voice.');
        setBoth('off');
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      runningRef.current = true;
    } catch {
      runningRef.current = false;
    }
  };

  const enable = () => {
    if (!supported) return;
    setError(null);
    enabledRef.current = true;
    setBoth('awake');
    startRef.current();
  };

  const disable = () => {
    enabledRef.current = false;
    waitingRef.current = false;
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }
    runningRef.current = false;
    stopAudio();
    setTranscript('');
    setBoth('off');
  };

  const askNow = () => {
    if (!supported) return;
    setError(null);
    enabledRef.current = true;
    waitingRef.current = true;
    setBoth('listening');
    startRef.current();
  };

  const toggle = () => {
    if (enabledRef.current) disable();
    else enable();
  };

  useEffect(
    () => () => {
      enabledRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      try {
        audioRef.current?.pause();
      } catch {
        /* ignore */
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    },
    [],
  );

  return { supported, phase, transcript, error, enable, disable, askNow, toggle, enabled: phase !== 'off' };
}
