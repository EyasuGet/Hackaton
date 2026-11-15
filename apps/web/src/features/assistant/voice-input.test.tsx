import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import { Assistant } from './assistant.tsx';
import {
  AudioRecorderError,
  type AudioRecorder,
  type AudioRecorderState,
} from './audio-recorder.ts';
import type { AskResult, ConversationClient } from './conversation.ts';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const mockAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'rep-voice-1',
    text: 'Chloroplasts absorb sunlight during photosynthesis.',
    lang: 'en',
    createdAt: '2026-09-11T12:00:00.000Z',
  },
};

function createMockAudioRecorder(options?: {
  supported?: boolean;
  startError?: Error;
  stopError?: Error;
  audioBase64?: string;
  mimeType?: string;
}) {
  let state: AudioRecorderState = 'idle';
  const startMock = vi.fn().mockImplementation(() => {
    if (options?.startError) return Promise.reject(options.startError);
    state = 'recording';
    return Promise.resolve();
  });
  const stopMock = vi.fn().mockImplementation(() => {
    if (options?.stopError) return Promise.reject(options.stopError);
    state = 'idle';
    return Promise.resolve({
      audioBase64: options?.audioBase64 ?? 'AQIDBA==',
      mimeType: options?.mimeType ?? 'audio/webm',
    });
  });
  const cancelMock = vi.fn().mockImplementation(() => {
    state = 'idle';
  });

  const recorder: AudioRecorder = {
    isSupported: () => options?.supported ?? true,
    start: startMock,
    stop: stopMock,
    cancel: cancelMock,
    getState: () => state,
  };

  return {
    recorder,
    startMock,
    stopMock,
    cancelMock,
  };
}

const questionBox = () => screen.getByLabelText<HTMLTextAreaElement>('Your question');

describe('Voice Input & Transcript Review (T3-010-B)', () => {
  it('renders record button in idle state and keeps typed input operational', () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const client: ConversationClient = { ask };
    const { recorder } = createMockAudioRecorder();

    render(<Assistant client={client} audioRecorder={recorder} />);

    expect(screen.getByRole('button', { name: /record question/i })).toBeTruthy();
    expect(questionBox().readOnly).toBe(false);

    // Type a question manually
    fireEvent.change(questionBox(), { target: { value: 'Manual question' } });
    expect(questionBox().value).toBe('Manual question');
  });

  it('starts recording explicitly and displays recording status', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const client: ConversationClient = { ask };
    const { recorder, startMock } = createMockAudioRecorder();

    render(<Assistant client={client} audioRecorder={recorder} />);

    const recordBtn = screen.getByRole('button', { name: /record question/i });
    await act(async () => {
      fireEvent.click(recordBtn);
      await Promise.resolve();
    });

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /stop recording/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /discard recording/i })).toBeTruthy();
    expect(screen.getAllByText(/recording audio/i).length).toBeGreaterThan(0);
  });

  it('stopping recording transcribes audio, populates draft for review, and does NOT auto-submit', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const transcribe = vi.fn().mockResolvedValue({
      kind: 'transcribed' as const,
      transcript: 'What is photosynthesis?',
      lang: 'en',
    });
    const client: ConversationClient = { ask, transcribe };
    const { recorder, stopMock } = createMockAudioRecorder();

    render(<Assistant client={client} audioRecorder={recorder} />);

    // Start recording
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record question/i }));
      await Promise.resolve();
    });

    // Stop recording
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));
      await Promise.resolve();
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledWith('AQIDBA==', 'audio/webm');

    // Transcribed text is placed in the question box for review
    expect(questionBox().value).toBe('What is photosynthesis?');

    // Review banner is shown
    expect(screen.getByRole('note').textContent).toMatch(
      /review and edit your transcribed question/i,
    );

    // CRITICAL: Ensure ask() was NEVER called automatically!
    expect(ask).not.toHaveBeenCalled();
  });

  it('allows editing transcript before explicit send, and submits the edited question', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const transcribe = vi.fn().mockResolvedValue({
      kind: 'transcribed' as const,
      transcript: 'What is photosynthsis?',
      lang: 'en',
    });
    const client: ConversationClient = { ask, transcribe };
    const { recorder } = createMockAudioRecorder();

    render(<Assistant client={client} audioRecorder={recorder} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record question/i }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));
      await Promise.resolve();
    });

    expect(questionBox().value).toBe('What is photosynthsis?');

    // Correct the typo: photosynthsis -> photosynthesis
    fireEvent.change(questionBox(), { target: { value: 'What is photosynthesis?' } });

    // Explicitly submit via Send button
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
      await Promise.resolve();
    });

    expect(ask).toHaveBeenCalledWith('What is photosynthesis?');
  });

  it('discarding recording clears transcript and does not send', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const transcribe = vi.fn().mockResolvedValue({
      kind: 'transcribed' as const,
      transcript: 'Accidental voice recording',
      lang: 'en',
    });
    const client: ConversationClient = { ask, transcribe };
    const { recorder } = createMockAudioRecorder();

    render(<Assistant client={client} audioRecorder={recorder} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record question/i }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));
      await Promise.resolve();
    });

    expect(questionBox().value).toBe('Accidental voice recording');

    // Click Discard
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /discard recording/i }));
      await Promise.resolve();
    });

    // Cleared and back to idle
    expect(questionBox().value).toBe('');
    expect(screen.queryByRole('note')).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it('cancelling during active recording resets state and calls recorder.cancel()', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const client: ConversationClient = { ask };
    const { recorder, cancelMock } = createMockAudioRecorder();

    render(<Assistant client={client} audioRecorder={recorder} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record question/i }));
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /discard recording/i })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /discard recording/i }));
      await Promise.resolve();
    });

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /record question/i })).toBeTruthy();
  });

  it('handles microphone permission denial gracefully and preserves typed path', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const client: ConversationClient = { ask };
    const { recorder } = createMockAudioRecorder({
      startError: new AudioRecorderError('permission_denied', 'Permission denied'),
    });

    render(<Assistant client={client} audioRecorder={recorder} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record question/i }));
      await Promise.resolve();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/microphone access was denied/i);

    // Text input remains operational
    fireEvent.change(questionBox(), { target: { value: 'Still able to type' } });
    expect(questionBox().value).toBe('Still able to type');
  });

  it('handles unsupported audio recording gracefully', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const client: ConversationClient = { ask };
    const { recorder } = createMockAudioRecorder({
      startError: new AudioRecorderError('unsupported', 'Not supported'),
    });

    render(<Assistant client={client} audioRecorder={recorder} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record question/i }));
      await Promise.resolve();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/audio recording is not supported in this browser/i);
  });

  it('handles transcription error gracefully and preserves existing typed text', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const transcribe = vi.fn().mockResolvedValue({ kind: 'failed' as const });
    const client: ConversationClient = { ask, transcribe };
    const { recorder } = createMockAudioRecorder();

    render(<Assistant client={client} audioRecorder={recorder} />);

    fireEvent.change(questionBox(), { target: { value: 'Pre-existing draft' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record question/i }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));
      await Promise.resolve();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/could not transcribe audio/i);
    // Existing draft was NOT lost
    expect(questionBox().value).toBe('Pre-existing draft');
  });

  it('handles audio too large error gracefully', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const transcribe = vi.fn().mockResolvedValue({ kind: 'too_large' as const });
    const client: ConversationClient = { ask, transcribe };
    const { recorder } = createMockAudioRecorder();

    render(<Assistant client={client} audioRecorder={recorder} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record question/i }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));
      await Promise.resolve();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/audio recording is too large/i);
  });

  it('pressing Escape during recording cancels recording and releases hardware', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const client: ConversationClient = { ask };
    const { recorder, cancelMock } = createMockAudioRecorder();

    render(<Assistant client={client} audioRecorder={recorder} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record question/i }));
      await Promise.resolve();
    });

    const section = screen.getByRole('region', { name: /record question/i });
    fireEvent.keyDown(section, { key: 'Escape' });

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /record question/i })).toBeTruthy();
  });

  it('renders bilingual Amharic voice controls when locale is am', async () => {
    const ask = vi.fn().mockResolvedValue(mockAnswer);
    const transcribe = vi.fn().mockResolvedValue({
      kind: 'transcribed' as const,
      transcript: 'ስለ ባዮሎጂ ጥያቄ አለኝ',
      lang: 'am',
    });
    const client: ConversationClient = { ask, transcribe };
    const { recorder } = createMockAudioRecorder();

    render(
      <LocaleContext.Provider value="am">
        <Assistant client={client} audioRecorder={recorder} />
      </LocaleContext.Provider>,
    );

    // Amharic record button
    const recordBtn = screen.getByRole('button', { name: /ጥያቄ በድምጽ ቅረጽ/ });
    expect(recordBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(recordBtn);
      await Promise.resolve();
    });

    // Amharic stop & discard buttons
    expect(screen.getByRole('button', { name: /መቅረጽ አቁም/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /ቅጂውን ሰርዝ/ })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /መቅረጽ አቁም/ }));
      await Promise.resolve();
    });

    // Amharic review hint
    expect(screen.getByRole('note').textContent).toMatch(/ከመላክዎ በፊት የተቀረጸውን ጥያቄዎን ይገምግሙና ያርትዑ/i);
  });
});
