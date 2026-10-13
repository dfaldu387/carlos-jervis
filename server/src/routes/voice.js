import { Router, raw } from 'express';
import { config, elevenLabsEnabled } from '../config.js';
import { logger } from '../utils/logger.js';
import { now, toIsoDate } from '../utils/dates.js';
import {
  GREETING_PARTS,
  GREETING_PARTS_DE,
  GREETING_PROMPT,
  GREETING_PROMPT_DE,
  HONORIFIC,
  currentHour,
  openingFor,
} from '../agent/greeting.js';
import { normalizeLanguage, t } from '../agent/i18n.js';

export const voiceRouter = Router();

/**
 * POST /api/voice/tts
 *
 * Server-side text-to-speech through ElevenLabs. The API key never leaves the
 * server; the browser receives only the generated MP3. When ElevenLabs is not
 * configured this returns 501 and the client falls back to the browser voice.
 * The text is forwarded unchanged: the multilingual model handles German and
 * English from the same voice, so there is nothing to translate here.
 */
voiceRouter.post('/tts', async (req, res, next) => {
  try {
    if (!elevenLabsEnabled()) {
      res.status(501).json({ error: 'not_configured', message: 'ElevenLabs is not configured on the server.' });
      return;
    }
    const text = String(req.body?.text ?? '').trim().slice(0, 2000);
    if (!text) {
      res.status(400).json({ error: 'request_error', message: 'text is required' });
      return;
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenlabs.voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': config.elevenlabs.apiKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: config.elevenlabs.model,
          voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.35, use_speaker_boost: true },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.warn('ElevenLabs TTS failed', { status: response.status });
      res.status(502).json({ error: 'tts_failed', message: `ElevenLabs returned ${response.status}`, detail: detail.slice(0, 200) });
      return;
    }

    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'no-store');
    res.send(audio);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/voice/stt?language=en|de
 *
 * Push-to-talk fallback for browsers without the Web Speech API. The body is
 * the raw recording (audio/webm, audio/ogg, audio/mp4 or audio/wav, up to
 * 5 MB) and is forwarded to ElevenLabs Speech-to-Text; only the transcript
 * comes back. The API key stays on the server and is never logged. Without a
 * key the route answers 501 so the client can hide the microphone button.
 */
const STT_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/mpeg'];
const STT_LIMIT = '5mb';

voiceRouter.post('/stt', raw({ type: STT_TYPES, limit: STT_LIMIT }), async (req, res, next) => {
  try {
    if (!config.elevenlabs.apiKey) {
      res.status(501).json({ error: 'stt_unavailable', message: 'Speech-to-text needs an ElevenLabs key on the server.' });
      return;
    }
    const language = normalizeLanguage(req.query.language ?? 'en');
    const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!Buffer.isBuffer(req.body) || req.body.length === 0 || !STT_TYPES.includes(contentType)) {
      res.status(400).json({
        error: 'request_error',
        message: `Send the recording as the raw body with one of: ${STT_TYPES.slice(0, 4).join(', ')}.`,
      });
      return;
    }

    const extension = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3' }[contentType] ?? 'webm';
    const form = new FormData();
    form.append('file', new Blob([req.body], { type: contentType }), `recording.${extension}`);
    form.append('model_id', 'scribe_v1');
    form.append('language_code', language === 'de' ? 'deu' : 'eng');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': config.elevenlabs.apiKey },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.warn('ElevenLabs STT failed', { status: response.status });
      res.status(502).json({ error: 'stt_failed', message: `ElevenLabs returned ${response.status}`, detail: detail.slice(0, 200) });
      return;
    }

    const result = await response.json().catch(() => ({}));
    const text = String(result.text ?? '').trim();
    res.json({ text, language, detected: result.language_code ?? null });
  } catch (error) {
    next(error);
  }
});

/**
 * Voice conversation configuration.
 *
 * The wake phrase, the greeting and the prompts live here rather than in the
 * browser so the assistant's spoken wording stays with the rest of its
 * language, and so the client can change what Jervis says without a front-end
 * release. Recognition and synthesis themselves run in the browser - no audio
 * leaves the machine. `?language=de` returns the German wording and adds the
 * German wake prefixes.
 */

/**
 * Speech recognition mis-hears a made-up name constantly, so the wake matcher
 * accepts what Chrome actually returns for "Jervis". Collected by dictating the
 * phrase repeatedly; extend the list rather than loosening it to a prefix
 * match, which would fire on ordinary speech.
 */
const WAKE_VARIANTS = [
  'jervis',
  'jarvis',
  'jervas',
  'jervais',
  'gervais',
  'jarvez',
  'jervis-',
  'service',
  'cervis',
  'jervie',
  'jarvie',
  'jervi',
];

const WAKE_PREFIXES = {
  en: ['hey', 'hi', 'hello', 'ok', 'okay', 'yo'],
  de: ['hey', 'hi', 'hello', 'ok', 'okay', 'yo', 'hallo', 'he'],
};

voiceRouter.get('/config', (req, res) => {
  const today = toIsoDate(now());
  const language = normalizeLanguage(req.query.language ?? 'en');
  const prompt = language === 'de' ? GREETING_PROMPT_DE : GREETING_PROMPT;

  res.json({
    language,

    /**
     * The browser builds the spoken greeting from this table at the moment the
     * wake phrase lands, using the listener's own clock. Sending a finished
     * string instead would go stale on a page left open across midday - and on
     * a shift that starts before noon and ends after it, that is every day.
     */
    greeting: {
      parts: language === 'de' ? GREETING_PARTS_DE : GREETING_PARTS,
      honorific: HONORIFIC,
      prompt,
    },

    // What the server's clock would say right now, for reference and tests.
    greetingNow: openingFor(currentHour(), HONORIFIC, prompt, language),

    // Spoken after an answer, to invite the follow-up without a second wake.
    followUpPrompt: t(language, 'voice.followUp'),

    // Said when the question was not understood.
    notUnderstood: t(language, 'voice.notUnderstood'),

    // Said when the microphone heard nothing.
    silence: t(language, 'voice.silence'),

    wake: {
      phrase: 'Hey Jervis',
      variants: WAKE_VARIANTS,
      prefixes: WAKE_PREFIXES[language],
    },

    timings: {
      // How long to wait for a question after the greeting, in ms.
      questionTimeoutMs: 12000,
      // How long the follow-up window stays open after an answer, in ms.
      followUpTimeoutMs: 9000,
    },

    role: { id: req.access.role, name: req.access.roleName },

    // Which engine produces the spoken audio: ElevenLabs when configured,
    // otherwise the browser's own speech synthesis. Speech-to-text needs only
    // the key, for the push-to-talk fallback.
    tts: { provider: elevenLabsEnabled() ? 'elevenlabs' : 'browser', enabled: elevenLabsEnabled() },
    stt: { provider: config.elevenlabs.apiKey ? 'elevenlabs' : 'browser', enabled: Boolean(config.elevenlabs.apiKey) },

    // Read out when the user asks what they can say.
    examples: [1, 2, 3, 4, 5].map((index) => t(language, `voice.example.${index}`, { date: today })),
  });
});
