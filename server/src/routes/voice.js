import { Router } from 'express';
import { config, elevenLabsEnabled } from '../config.js';
import { logger } from '../utils/logger.js';
import { now, toIsoDate } from '../utils/dates.js';
import {
  GREETING_PARTS,
  GREETING_PROMPT,
  HONORIFIC,
  currentHour,
  openingFor,
} from '../agent/greeting.js';

export const voiceRouter = Router();

/**
 * POST /api/voice/tts
 *
 * Server-side text-to-speech through ElevenLabs. The API key never leaves the
 * server; the browser receives only the generated MP3. When ElevenLabs is not
 * configured this returns 501 and the client falls back to the browser voice.
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
 * Voice conversation configuration.
 *
 * The wake phrase, the greeting and the prompts live here rather than in the
 * browser so the assistant's spoken wording stays with the rest of its
 * language, and so the client can change what Jervis says without a front-end
 * release. Recognition and synthesis themselves run in the browser - no audio
 * leaves the machine.
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

voiceRouter.get('/config', (req, res) => {
  const today = toIsoDate(now());

  res.json({
    /**
     * The browser builds the spoken greeting from this table at the moment the
     * wake phrase lands, using the listener's own clock. Sending a finished
     * string instead would go stale on a page left open across midday - and on
     * a shift that starts before noon and ends after it, that is every day.
     */
    greeting: {
      parts: GREETING_PARTS,
      honorific: HONORIFIC,
      prompt: GREETING_PROMPT,
    },

    // What the server's clock would say right now, for reference and tests.
    greetingNow: openingFor(currentHour()),

    // Spoken after an answer, to invite the follow-up without a second wake.
    followUpPrompt: 'Anything else?',

    // Said when the question was not understood.
    notUnderstood:
      'I did not catch a production question. Name a day, a shift, a line or an error code.',

    // Said when the microphone heard nothing.
    silence: 'I did not hear anything.',

    wake: {
      phrase: 'Hey Jervis',
      variants: WAKE_VARIANTS,
      prefixes: ['hey', 'hi', 'hello', 'ok', 'okay', 'yo'],
    },

    timings: {
      // How long to wait for a question after the greeting, in ms.
      questionTimeoutMs: 12000,
      // How long the follow-up window stays open after an answer, in ms.
      followUpTimeoutMs: 9000,
    },

    role: { id: req.access.role, name: req.access.roleName },

    // Which engine produces the spoken audio: ElevenLabs when configured,
    // otherwise the browser's own speech synthesis.
    tts: { provider: elevenLabsEnabled() ? 'elevenlabs' : 'browser', enabled: elevenLabsEnabled() },

    // Read out when the user asks what they can say.
    examples: [
      'What problems did we have on Friday?',
      `Summarize the early shift on ${today}`,
      'How many vehicles were reworked yesterday?',
      'How much downtime did we have this week?',
    ],
  });
});
