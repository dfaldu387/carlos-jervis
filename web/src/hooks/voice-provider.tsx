import { createContext, useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useVoice, type VoiceConfig } from '@/hooks/use-voice';
import type { AskResult } from '@/lib/types';

type VoiceState = ReturnType<typeof useVoice>;

interface VoiceContextValue {
  voice: VoiceState;
  answer: AskResult | null;
  showAnswer: boolean;
  setShowAnswer: (open: boolean) => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  const voiceConfig = useQuery({
    queryKey: ['voice-config'],
    queryFn: () => api.voiceConfig() as Promise<VoiceConfig>,
    staleTime: Infinity,
  });

  const voice = useVoice({
    config: voiceConfig.data,
    onAsk: async (question) => {
      const result = await api.ask(question);
      setAnswer(result);
      setShowAnswer(true);
      return result;
    },
  });

  return (
    <VoiceContext.Provider value={{ voice, answer, showAnswer, setShowAnswer }}>{children}</VoiceContext.Provider>
  );
}

export function useVoiceCtx() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoiceCtx must be used within VoiceProvider');
  return ctx;
}
