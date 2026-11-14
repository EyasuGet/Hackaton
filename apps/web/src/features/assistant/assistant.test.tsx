import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assistant } from './assistant.tsx';
import type { AskResult, ConversationClient } from './conversation.ts';

afterEach(cleanup);

const englishAnswer: AskResult = {
  kind: 'answer',
  reply: { id: 'r1', text: 'Photosynthesis makes sugar.', lang: 'en' },
};

/** A client whose replies the test releases explicitly, to observe the pending state. */
function controllableClient() {
  const pending: ((result: AskResult) => void)[] = [];
  const ask = vi.fn(() => new Promise<AskResult>((resolve) => pending.push(resolve)));
  const client: ConversationClient = { ask };
  const respond = async (result: AskResult) => {
    await act(() => Promise.resolve(pending.shift()?.(result)));
  };
  return { client, ask, respond };
}

const questionBox = () => screen.getByLabelText('Your question');
const updates = () => screen.getByRole('status', { name: 'Conversation updates' });

function type(text: string) {
  fireEvent.change(questionBox(), { target: { value: text } });
}

describe('Assistant', () => {
  it('sends on Enter, shows the exchange, clears the box and keeps focus there', async () => {
    const { client, ask, respond } = controllableClient();
    render(<Assistant client={client} />);
    questionBox().focus();
    type('  What is photosynthesis?  ');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    expect(ask).toHaveBeenCalledWith('What is photosynthesis?');
    expect(updates().textContent).toBe('Sending your question…');

    await respond(englishAnswer);

    const messages = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(messages).toEqual([
      'YouWhat is photosynthesis?',
      'Assistant (demo)Photosynthesis makes sugar.',
    ]);
    expect(questionBox()).toHaveProperty('value', '');
    expect(document.activeElement).toBe(questionBox());
    expect(updates().textContent).toBe('Assistant: Photosynthesis makes sugar.');
  });

  it.each([
    ['Shift+Enter', { key: 'Enter', shiftKey: true }],
    ['Enter while an input method is composing', { key: 'Enter', isComposing: true }],
  ])('does not send on %s', (_case, keyEvent) => {
    const { client, ask } = controllableClient();
    render(<Assistant client={client} />);
    type('ሰላም');

    fireEvent.keyDown(questionBox(), keyEvent);

    expect(ask).not.toHaveBeenCalled();
  });

  it('ignores further sends while a question is pending', async () => {
    const { client, ask, respond } = controllableClient();
    render(<Assistant client={client} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.keyDown(questionBox(), { key: 'Enter' });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe('true');
    await respond(englishAnswer);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe(
      'false',
    );
  });

  it.each([
    ['failed', 'could not be sent'],
    ['denied', 'session has expired'],
  ] as const)('keeps the question and explains a %s request', async (kind, message) => {
    const { client, ask, respond } = controllableClient();
    render(<Assistant client={client} />);
    type('Keep me');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond({ kind });

    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(questionBox()).toHaveProperty('value', 'Keep me');
    expect(screen.queryByRole('listitem')).toBeNull();

    // An intentional retry sends the same question again.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await respond(englishAnswer);
    expect(ask).toHaveBeenNthCalledWith(2, 'Keep me');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for a question instead of sending an empty one', () => {
    const { client, ask } = controllableClient();
    render(<Assistant client={client} />);
    type('   ');

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Type a question before sending.');
    expect(questionBox().getAttribute('aria-invalid')).toBe('true');
  });

  it('renders markup in replies as inert text with its language and direction', async () => {
    const markup = '<img src="x" onerror="alert(1)"><script>alert(2)</script>';
    const { client, respond } = controllableClient();
    const { container } = render(<Assistant client={client} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond({ kind: 'answer', reply: { id: 'r2', text: markup, lang: 'am' } });

    expect(container.querySelector('img, script')).toBeNull();
    const reply = screen.getByText(markup);
    expect(reply.getAttribute('lang')).toBe('am');
    expect(reply.getAttribute('dir')).toBe('auto');
  });
});
