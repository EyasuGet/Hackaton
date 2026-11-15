// Speech synthesis adapters for reading assistant answers aloud (T3-011).
// Provides client browser speech synthesis and consented cloud speech synthesis
// with resource cleanup, language support checking, and keyboard-operable playback.

export type SpeechState = 'idle' | 'playing' | 'paused';

export interface SpeechPlayback {
  pause(): void;
  resume(): void;
  stop(): void;
  readonly state: SpeechState;
}

export interface SpeechCallbacks {
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

export interface SpeechSynthesizer {
  readonly id: string;
  readonly name: string;
  readonly requiresConsent: boolean;
  isSupported(lang: string): boolean | Promise<boolean>;
  speak(
    text: string,
    options: {
      lang: string;
      signal?: AbortSignal;
    },
    callbacks?: SpeechCallbacks,
  ): Promise<SpeechPlayback>;
}

function createInertPlayback(): SpeechPlayback {
  return {
    pause: () => {},
    resume: () => {},
    stop: () => {},
    state: 'idle',
  };
}

/**
 * Client-side Web Speech API adapter.
 * Uses window.speechSynthesis locally without external cloud processing.
 * Only presents Amharic support if a verified Amharic voice is available.
 */
export class BrowserSpeechSynthesizer implements SpeechSynthesizer {
  readonly id = 'browser';
  readonly name = 'Client speech synthesis';
  readonly requiresConsent = false;

  constructor(private readonly getSpeechSynthesis?: () => SpeechSynthesis | undefined) {}

  private resolveSynthesis(): SpeechSynthesis | undefined {
    if (this.getSpeechSynthesis) {
      return this.getSpeechSynthesis();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      return window.speechSynthesis;
    }
    return undefined;
  }

  isSupported(lang: string): boolean {
    const synth = this.resolveSynthesis();
    if (!synth) return false;

    // Check if Amharic is supported: per T3-011, unsupported quality is not
    // presented as verified Amharic support. Only claim support if an Amharic voice exists.
    const isAmharic = lang.toLowerCase().startsWith('am');
    if (isAmharic) {
      const voices = synth.getVoices?.() ?? [];
      return voices.some((voice) => voice.lang.toLowerCase().startsWith('am'));
    }

    return true;
  }

  speak(
    text: string,
    options: { lang: string; signal?: AbortSignal },
    callbacks?: SpeechCallbacks,
  ): Promise<SpeechPlayback> {
    const synth = this.resolveSynthesis();
    if (!synth) {
      const error = new Error('Speech synthesis not supported in this browser environment');
      callbacks?.onError?.(error);
      return Promise.resolve(createInertPlayback());
    }

    if (!this.isSupported(options.lang)) {
      const error = new Error(`Speech synthesis language not supported: ${options.lang}`);
      callbacks?.onError?.(error);
      return Promise.resolve(createInertPlayback());
    }

    // Cancel any previous speech output.
    synth.cancel();

    let state: SpeechState = 'idle';
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang;

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (options.signal) {
        options.signal.removeEventListener('abort', stop);
      }
    };

    const stop = () => {
      synth.cancel();
      state = 'idle';
      cleanup();
      callbacks?.onEnd?.();
    };

    utterance.onstart = () => {
      state = 'playing';
      callbacks?.onStart?.();
    };

    utterance.onpause = () => {
      state = 'paused';
      callbacks?.onPause?.();
    };

    utterance.onresume = () => {
      state = 'playing';
      callbacks?.onResume?.();
    };

    utterance.onend = () => {
      state = 'idle';
      cleanup();
      callbacks?.onEnd?.();
    };

    utterance.onerror = (event) => {
      state = 'idle';
      cleanup();
      callbacks?.onError?.(new Error(event.error || 'Speech synthesis error'));
    };

    if (options.signal?.aborted) {
      stop();
      return Promise.resolve(createInertPlayback());
    }

    options.signal?.addEventListener('abort', stop);

    synth.speak(utterance);

    const playback: SpeechPlayback = {
      pause: () => {
        synth.pause();
      },
      resume: () => {
        synth.resume();
      },
      stop,
      get state() {
        return state;
      },
    };

    return Promise.resolve(playback);
  }
}

export type CloudAudioSynthesizerFn = (
  text: string,
  lang: string,
  signal?: AbortSignal,
) => Promise<Blob | ArrayBuffer | string>;

/**
 * Consented cloud speech synthesis adapter (T3-011).
 * Strictly requires explicit user consent before sending any text.
 * Cleans up temporary audio resources (e.g. object URLs) on stop or error.
 */
export class CloudSpeechSynthesizer implements SpeechSynthesizer {
  readonly id = 'cloud';
  readonly name = 'Consented cloud speech synthesis';
  readonly requiresConsent = true;

  constructor(
    private readonly getConsent: () => boolean,
    private readonly synthesizeAudio?: CloudAudioSynthesizerFn,
    private readonly supportedLanguages: readonly string[] = ['en', 'am', 'en-us', 'am-et'],
  ) {}

  isSupported(lang: string): boolean {
    const normalised = lang.toLowerCase();
    return this.supportedLanguages.some((supported) => normalised.startsWith(supported));
  }

  async speak(
    text: string,
    options: { lang: string; signal?: AbortSignal },
    callbacks?: SpeechCallbacks,
  ): Promise<SpeechPlayback> {
    // 1. Consent guard: cloud synthesis must be explicitly consented.
    if (!this.getConsent()) {
      const error = new Error('ConsentRequired: Cloud speech synthesis requires explicit consent');
      callbacks?.onError?.(error);
      return createInertPlayback();
    }

    // 2. Language support guard.
    if (!this.isSupported(options.lang)) {
      const error = new Error(`Cloud speech language not supported: ${options.lang}`);
      callbacks?.onError?.(error);
      return createInertPlayback();
    }

    if (options.signal?.aborted) {
      return createInertPlayback();
    }

    let state: SpeechState = 'idle';
    let audio: HTMLAudioElement | null = null;
    let objectUrl: string | null = null;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', stop);
      }
    };

    const stop = () => {
      cleanup();
      state = 'idle';
      callbacks?.onEnd?.();
    };

    try {
      let audioSource: Blob | ArrayBuffer | string;
      if (this.synthesizeAudio) {
        audioSource = await this.synthesizeAudio(text, options.lang, options.signal);
      } else {
        // Default remote API call to synthesize audio
        const response = await fetch('/api/speech/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, lang: options.lang }),
          signal: options.signal ?? null,
        });
        if (!response.ok) {
          throw new Error(`Cloud speech API failed with status ${response.status}`);
        }
        audioSource = await response.blob();
      }

      if (options.signal?.aborted) {
        cleanup();
        return createInertPlayback();
      }

      if (typeof audioSource === 'string') {
        audio = new Audio(audioSource);
      } else {
        const blob =
          audioSource instanceof Blob
            ? audioSource
            : new Blob([audioSource], { type: 'audio/mpeg' });
        objectUrl = URL.createObjectURL(blob);
        audio = new Audio(objectUrl);
      }

      audio.onplay = () => {
        state = 'playing';
        callbacks?.onStart?.();
      };

      audio.onpause = () => {
        if (!cleanedUp && state !== 'idle') {
          state = 'paused';
          callbacks?.onPause?.();
        }
      };

      audio.onended = () => {
        state = 'idle';
        cleanup();
        callbacks?.onEnd?.();
      };

      audio.onerror = () => {
        state = 'idle';
        cleanup();
        callbacks?.onError?.(new Error('Audio playback failed'));
      };

      options.signal?.addEventListener('abort', stop);

      state = 'playing';
      await audio.play();

      return {
        pause: () => {
          if (audio) {
            audio.pause();
            state = 'paused';
            callbacks?.onPause?.();
          }
        },
        resume: () => {
          if (audio) {
            void audio.play();
            state = 'playing';
            callbacks?.onResume?.();
          }
        },
        stop,
        get state() {
          return state;
        },
      };
    } catch (error) {
      cleanup();
      state = 'idle';
      const speechError = error instanceof Error ? error : new Error(String(error));
      callbacks?.onError?.(speechError);
      return createInertPlayback();
    }
  }
}
