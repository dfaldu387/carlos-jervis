import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useVoice, type VoiceConfig } from '@/hooks/use-voice';
import type { AskResult } from '@/lib/types';

type VoiceState = ReturnType<typeof useVoice>;
type AnswerHandler = (result: AskResult) => void;

interface VoiceContextValue {
  voice: VoiceState;
  answer: AskResult | null;
  showAnswer: boolean;
  setShowAnswer: (open: boolean) => void;
  /**
   * Lets a page take over spoken answers. While a handler is registered the
   * answer is passed to it instead of opening the global side sheet, so the
   * Ask page can show it inline next to the core. Returns an unregister fn.
   */
  claimAnswers: (handler: AnswerHandler) => () => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { language, speechLocale, t } = useI18n();
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const handlerRef = useRef<AnswerHandler | null>(null);

  const claimAnswers = useCallback((handler: AnswerHandler) => {
    handlerRef.current = handler;
    return () => {
      if (handlerRef.current === handler) handlerRef.current = null;
    };
  }, []);

  // Greeting, prompts and wake prefixes come from the server in the UI language.
  const voiceConfig = useQuery({
    queryKey: ['voice-config', language],
    queryFn: () => api.voiceConfig(language) as Promise<VoiceConfig>,
    staleTime: Infinity,
  });

  const voice = useVoice({
    config: voiceConfig.data,
    language,
    speechLocale,
    messages: { micBlocked: t('voice.micBlocked'), sttMissing: t('voice.sttMissing'), notCaught: t('voice.notCaught') },
    onAsk: async (question) => {
      const result = await api.ask(question, undefined, language);
      setAnswer(result);
      if (handlerRef.current) {
        handlerRef.current(result);
      } else {
        setShowAnswer(true);
      }
      return result;
    },
  });

  return <VoiceContext.Provider value={{ voice, answer, showAnswer, setShowAnswer, claimAnswers }}>{children}</VoiceContext.Provider>;
}

export function useVoiceCtx() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoiceCtx must be used within VoiceProvider');
  return ctx;
}
