// Browser audio recording adapter for learner voice input (T3-010-B).
// Encapsulates navigator.mediaDevices.getUserMedia and MediaRecorder lifecycle.
// Enforces explicit start and stop actions, releases hardware tracks immediately,
// and negotiates supported MIME types for backend transcription.

export type AudioRecorderState = 'idle' | 'recording';

export interface AudioRecordingResult {
  readonly audioBase64: string;
  readonly mimeType: string;
}

export type AudioRecorderErrorKind = 'permission_denied' | 'unsupported' | 'failed';

export class AudioRecorderError extends Error {
  constructor(
    readonly kind: AudioRecorderErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = 'AudioRecorderError';
  }
}

export interface AudioRecorder {
  isSupported(): boolean;
  start(): Promise<void>;
  stop(): Promise<AudioRecordingResult>;
  cancel(): void;
  getState(): AudioRecorderState;
}

export const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
] as const;

export function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (
      typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported(mimeType)
    ) {
      return mimeType;
    }
  }
  return 'audio/webm';
}

export function isAudioRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(',') ? (dataUrl.split(',')[1] ?? '') : dataUrl;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read audio blob'));
    reader.readAsDataURL(blob);
  });
}

export class BrowserAudioRecorder implements AudioRecorder {
  private state: AudioRecorderState = 'idle';
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  isSupported(): boolean {
    return isAudioRecordingSupported();
  }

  getState(): AudioRecorderState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === 'recording') return;
    if (!this.isSupported()) {
      throw new AudioRecorderError(
        'unsupported',
        'Audio recording is not supported in this browser',
      );
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: unknown) {
      this.cleanup();
      const errName = (err as Error)?.name;
      if (
        errName === 'NotAllowedError' ||
        errName === 'PermissionDeniedError' ||
        errName === 'SecurityError'
      ) {
        throw new AudioRecorderError('permission_denied', 'Microphone permission denied');
      }
      throw new AudioRecorderError(
        'failed',
        (err as Error)?.message ?? 'Failed to access microphone',
      );
    }

    try {
      const mimeType = getSupportedMimeType();
      this.recordedChunks = [];
      const options = mimeType ? { mimeType } : undefined;
      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(250);
      this.state = 'recording';
    } catch (err: unknown) {
      this.cleanup();
      throw new AudioRecorderError(
        'failed',
        (err as Error)?.message ?? 'Failed to start MediaRecorder',
      );
    }
  }

  async stop(): Promise<AudioRecordingResult> {
    if (this.state !== 'recording' || !this.mediaRecorder) {
      throw new AudioRecorderError('failed', 'Not currently recording');
    }

    const recorder = this.mediaRecorder;
    const stream = this.mediaStream;
    const mimeType = recorder.mimeType || getSupportedMimeType();

    return new Promise<AudioRecordingResult>((resolve, reject) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(this.recordedChunks, { type: mimeType });
          // Stop media tracks immediately to release hardware microphone
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
          }
          this.mediaStream = null;
          this.mediaRecorder = null;
          this.recordedChunks = [];
          this.state = 'idle';

          const base64 = await blobToBase64(blob);
          resolve({ audioBase64: base64, mimeType });
        } catch (error) {
          reject(
            new AudioRecorderError(
              'failed',
              (error as Error)?.message ?? 'Failed to process audio blob',
            ),
          );
        }
      };

      recorder.onerror = () => {
        this.cleanup();
        reject(new AudioRecorderError('failed', 'MediaRecorder error occurred'));
      };

      try {
        recorder.stop();
      } catch (err) {
        this.cleanup();
        reject(new AudioRecorderError('failed', (err as Error)?.message));
      }
    });
  }

  cancel(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignore stop error during forced cleanup
      }
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.state = 'idle';
  }
}
