import { useEffect, useRef, useState } from 'react';
import type { AskResult, Language } from '@/lib/types';

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
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** How far back (ms) separate recognition results are stitched together when
 *  looking for the wake phrase, so "hey … Jervis" said slowly still matches. */
const WAKE_WINDOW_MS = 4000;

const WAKE_TARGETS = ['jervis', 'jarvis'];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** True when a single token sounds like the name: close in spelling, or the
 *  "j/g + vowel + r + v + vowel + s" skeleton the recognizer tends to keep. */
export function soundsLikeName(token: string): boolean {
  const t = token.toLowerCase().replace(/[^a-z]/g, '');
  if (t.length < 4) return false;
  if (/^(j|g|dj|ch|sh|y|z)[aeiouy]{1,2}r?v[aeiouy]{1,2}(s|z|ce|se|ss|sse|x)?$/.test(t)) return true;
  const tolerance = t.length >= 6 ? 2 : 1;
  return WAKE_TARGETS.some((target) => levenshtein(t, target) <= tolerance);
}

export function buildWakeMatcher(wake?: VoiceConfig['wake']) {
  const variants = wake?.variants?.length ? wake.variants : ['jervis', 'jarvis', 'service'];
  const prefixes = wake?.prefixes?.length ? wake.prefixes : ['hey', 'hi', 'hello', 'ok', 'okay'];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = variants.map(esc).join('|');
  const pre = prefixes.map(esc).join('|');
  const re = new RegExp(`(?:\\b(?:${pre})\\b[\\s,]*)?\\b(?:${names})\\b[\\s,.:!?-]*`, 'i');
  const trail = /^[\s,.:!?-]+/;

  return (text: string): { remainder: string } | null => {
    const src = text ?? '';
    const m = re.exec(src);
    if (m) return { remainder: src.slice(m.index + m[0].length).trim() };

    // Fuzzy pass: single tokens, then adjacent pairs ("jar vis", "her vis").
    const tokens: { word: string; start: number; end: number }[] = [];
    const wordRe = /[A-Za-z']+/g;
    let w: RegExpExecArray | null;
    while ((w = wordRe.exec(src)) !== null) tokens.push({ word: w[0], start: w.index, end: w.index + w[0].length });
    for (let i = 0; i < tokens.length; i += 1) {
      if (soundsLikeName(tokens[i].word)) {
        return { remainder: src.slice(tokens[i].end).replace(trail, '').trim() };
      }
      if (i + 1 < tokens.length && soundsLikeName(tokens[i].word + tokens[i + 1].word)) {
        return {
          remainder: src
            .slice(tokens[i + 1].end)
            .replace(trail, '')
            .trim(),
        };
      }
    }
    return null;
  };
}

export interface UseVoiceOptions {
  config?: VoiceConfig | null;
  onAsk: (question: string) => Promise<AskResult | null>;
  /** UI language: picks the recognizer locale, the synthesis voice and the server transcription language. */
  language?: Language;
  /** BCP-47 locale for recognition/synthesis, e.g. 'de-DE'. */
  speechLocale?: string;
  /** Localised error strings. */
  messages?: { micBlocked?: string; sttMissing?: string; notCaught?: string };
}

export function useVoice({ config, onAsk, language = 'en', speechLocale = 'en-US', messages }: UseVoiceOptions) {
  const [supported] = useState(() => typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window));
  // Push-to-talk fallback: record with MediaRecorder and transcribe on the
  // server when the browser has no Web Speech API (Firefox, locked-down builds).
  const [sttFallback] = useState(
    () =>
      typeof window !== 'undefined' &&
      !('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) &&
      'MediaRecorder' in window &&
      Boolean(navigator.mediaDevices?.getUserMedia),
  );
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const langRef = useRef({ language, speechLocale, messages });
  langRef.current = { language, speechLocale, messages };
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
  const processRef = useRef<(t: string, alternatives?: string[]) => void>(() => {});
  const recentRef = useRef<{ at: number; text: string }[]>([]);
  const pendingWakeRef = useRef<{ at: number; remainder: string } | null>(null);

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
    if (langRef.current.language === 'de') {
      const german = voices.filter((v) => /^de/i.test(v.lang));
      const male = german.find((v) => /stefan|conrad|klaus|killian|hans|michael|markus|google deutsch|male/i.test(v.name));
      return male ?? german[0] ?? null;
    }
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
    u.lang = langRef.current.speechLocale;
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

  const stopRecognition = () => {
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }
    runningRef.current = false;
    recRef.current = null;
  };

  const handleQuestion = (question: string) => {
    waitingRef.current = false;
    recentRef.current = [];
    pendingWakeRef.current = null;
    stopRecognition();
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

  const fireWake = (remainder: string) => {
    recentRef.current = [];
    pendingWakeRef.current = null;
    if (remainder && remainder.length > 2) {
      handleQuestion(remainder);
      return;
    }
    stopRecognition();
    setBoth('greeting');
    waitingRef.current = true;
    speak(greetingRef.current, () => {
      if (enabledRef.current) {
        setBoth('listening');
        startRef.current(); // restart recognition to capture the question
      }
    });
  };

  // Called with interim text while awake: remember a wake phrase as soon as it
  // is visible, because the final result often "corrects" the name away.
  const noteInterim = (alternatives: string[]) => {
    if (phaseRef.current !== 'awake') return;
    for (const alt of alternatives) {
      const hit = matchRef.current(alt);
      if (hit) {
        pendingWakeRef.current = { at: Date.now(), remainder: hit.remainder };
        return;
      }
    }
  };

  // Decide what to do with a final transcript (plus the recognizer's other
  // candidate readings of the same audio).
  processRef.current = (text: string, alternatives: string[] = []) => {
    const t = text.trim();
    if (!t) return;
    if (waitingRef.current || phaseRef.current === 'listening') {
      handleQuestion(t);
      return;
    }
    if (phaseRef.current !== 'awake') return;

    const now = Date.now();
    recentRef.current = [...recentRef.current.filter((r) => now - r.at <= WAKE_WINDOW_MS), { at: now, text: t }];
    const stitched = recentRef.current.map((r) => r.text).join(' ');

    for (const candidate of [t, ...alternatives, stitched]) {
      const hit = matchRef.current(candidate);
      if (hit) {
        fireWake(hit.remainder);
        return;
      }
    }

    // The interim text showed the name but the final result lost it.
    const pending = pendingWakeRef.current;
    if (pending && now - pending.at <= WAKE_WINDOW_MS) {
      fireWake(pending.remainder);
    }
  };

  startRef.current = () => {
    if (!supported || runningRef.current) return;
    const Ctor =
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition ??
      (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = langRef.current.speechLocale;
    // Continuous so a slow "hey … Jervis" is not cut into separate sessions.
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    let handled = 0; // results already processed in this session
    rec.onresult = (ev) => {
      let interim = '';
      const interimAlts: string[] = [];
      for (let i = handled; i < ev.results.length; i += 1) {
        const r = ev.results[i];
        if (r.isFinal) {
          handled = i + 1;
          const alts: string[] = [];
          for (let j = 1; j < r.length; j += 1) alts.push(r[j].transcript);
          setTranscript(r[0].transcript);
          processRef.current(r[0].transcript, alts);
        } else {
          interim += r[0].transcript;
          for (let j = 0; j < r.length; j += 1) interimAlts.push(r[j].transcript);
        }
      }
      if (interim) {
        setTranscript(interim);
        noteInterim(interimAlts);
      }
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
        setError(langRef.current.messages?.micBlocked ?? 'Microphone permission is blocked. Allow it in the browser to use voice.');
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
    recentRef.current = [];
    pendingWakeRef.current = null;
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

  /** Hold-to-talk: start recording the microphone (fallback browsers only). */
  const pushToTalkStart = async () => {
    if (!sttFallback || recorderRef.current) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 1000) {
          setBoth('off');
          return;
        }
        setBoth('thinking');
        try {
          const r = await fetch(`/api/voice/stt?language=${langRef.current.language}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': blob.type },
            body: blob,
          });
          const body = (await r.json().catch(() => ({}))) as { text?: string; message?: string; error?: string };
          if (r.status === 501) {
            setError(langRef.current.messages?.sttMissing ?? body.message ?? 'Speech-to-text is not configured on the server.');
            setBoth('off');
            return;
          }
          if (!r.ok || !body.text?.trim()) {
            setError(langRef.current.messages?.notCaught ?? 'I did not catch that. Please try again.');
            setBoth('off');
            return;
          }
          setTranscript(body.text);
          enabledRef.current = false; // one question per press; no wake loop in fallback mode
          handleQuestion(body.text);
        } catch {
          setError(langRef.current.messages?.notCaught ?? 'I did not catch that. Please try again.');
          setBoth('off');
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setBoth('listening');
    } catch {
      setError(langRef.current.messages?.micBlocked ?? 'Microphone permission is blocked. Allow it in the browser to use voice.');
      setBoth('off');
    }
  };

  /** Release: stop recording and send the audio for transcription. */
  const pushToTalkStop = () => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
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

  return {
    supported,
    sttFallback,
    recording,
    phase,
    transcript,
    error,
    enable,
    disable,
    askNow,
    toggle,
    pushToTalkStart,
    pushToTalkStop,
    enabled: phase !== 'off',
  };
}
