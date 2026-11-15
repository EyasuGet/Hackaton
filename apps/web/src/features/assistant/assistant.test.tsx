import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import { Assistant } from './assistant.tsx';
import type { AskResult, ConversationClient } from './conversation.ts';

afterEach(cleanup);

const englishAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'r1',
    text: 'Photosynthesis makes sugar.',
    lang: 'en',
    createdAt: '2026-09-11T12:00:00.000Z',
  },
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
    expect(messages[0]).toBe('YouWhat is photosynthesis?');
    expect(messages[1]).toContain('Assistant (demo)Photosynthesis makes sugar.');
    expect(questionBox()).toHaveProperty('value', '');
    expect(document.activeElement).toBe(questionBox());
    expect(updates().textContent).toBe('Assistant: Photosynthesis makes sugar.');
  });

  it('shows the reply instant in Ethiopian and Gregorian calendars and Addis Ababa time', async () => {
    const { client, respond } = controllableClient();
    const { container } = render(<Assistant client={client} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond(englishAnswer);

    const time = container.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-09-11T12:00:00.000Z');
    expect(time?.textContent).toContain('1 Meskerem 2019');
    expect(time?.textContent).toContain('Ethiopian calendar');
    expect(time?.textContent).toContain('11 September 2026');
    expect(time?.textContent).toContain('Gregorian');
    expect(time?.textContent).toContain('15:00');
    expect(time?.textContent).toContain('Addis Ababa time');
  });

  it('still shows a reply when its timestamp cannot be presented', async () => {
    const { client, respond } = controllableClient();
    const { container } = render(<Assistant client={client} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond({
      kind: 'answer',
      reply: { id: 'r3', text: 'Visible reply', lang: 'en', createdAt: 'not-a-date' },
    });

    expect(screen.getAllByRole('listitem')[1]?.textContent).toContain('Visible reply');
    expect(container.querySelector('time')).toBeNull();
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

    type('Now a real question');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(questionBox().getAttribute('aria-invalid')).toBeNull();
  });

  it('recovers when the client rejects instead of reporting a failure', async () => {
    const ask = vi.fn(() => Promise.reject(new Error('unexpected')));
    render(<Assistant client={{ ask }} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });

    expect((await screen.findByRole('alert')).textContent).toContain('could not be sent');
    expect(questionBox()).toHaveProperty('readOnly', false);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe(
      'false',
    );
  });

  it('renders markup in replies as inert text with its language and direction', async () => {
    const markup = '<img src="x" onerror="alert(1)"><script>alert(2)</script>';
    const { client, respond } = controllableClient();
    const { container } = render(<Assistant client={client} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond({
      kind: 'answer',
      reply: {
        id: 'r2',
        text: markup,
        lang: 'am',
        createdAt: '2026-09-11T12:00:00.000Z',
      },
    });

    expect(container.querySelector('img, script')).toBeNull();
    expect(screen.getAllByText(markup).length).toBeGreaterThan(0);
    const replyText = screen.getAllByRole('listitem')[1]?.querySelector('[dir]');
    expect(replyText?.getAttribute('lang')).toBe('am');
    expect(replyText?.getAttribute('dir')).toBe('auto');
    expect(screen.getByText('1 መስከረም 2019').getAttribute('lang')).toBe('am');
    // The interface-language prefix and the Amharic reply are tagged separately.
    const spans = [...updates().querySelectorAll('span')];
    expect(spans.map((span) => [span.textContent, span.getAttribute('lang')])).toEqual([
      ['Assistant: ', 'en'],
      [markup, 'am'],
    ]);
  });

  it('announces a reply that arrives after a language switch in the new language', async () => {
    const { client, respond } = controllableClient();
    const { rerender } = render(
      <LocaleContext value="en">
        <Assistant client={client} />
      </LocaleContext>,
    );
    type('Question');
    fireEvent.keyDown(questionBox(), { key: 'Enter' });

    rerender(
      <LocaleContext value="am">
        <Assistant client={client} />
      </LocaleContext>,
    );
    await respond(englishAnswer);

    const prefix = screen.getByRole('status', { name: 'የውይይት ማሳወቂያዎች' }).querySelector('span');
    expect([prefix?.textContent, prefix?.getAttribute('lang')]).toEqual(['ረዳት፦ ', 'am']);
  });

  it('renders online mode notice and labels assistant as online AI in mode="online"', async () => {
    const { client, respond } = controllableClient();
    render(<Assistant client={client} mode="online" />);

    expect(screen.getByRole('note').textContent).toContain(
      'Operating in consented online answer mode',
    );

    type('What is an AI task?');
    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond({
      kind: 'answer',
      reply: {
        id: 'r-online-1',
        text: 'AI tools assist with drafting notes [artificial-intelligence-and-the-future-of-va-work].',
        lang: 'en',
        createdAt: '2026-09-11T12:00:00.000Z',
        provider: 'online',
      },
    });

    const messages = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(messages[1]).toContain('Assistant (online AI)');
  });

  it('renders consent toggle and switches mode without losing the typed question', () => {
    const { client } = controllableClient();
    const onConsentChange = vi.fn();
    const { rerender } = render(
      <Assistant client={client} mode="faq" consent={false} onConsentChange={onConsentChange} />,
    );

    const checkbox = screen.getByLabelText<HTMLInputElement>(
      'Allow external AI processing for course questions',
    );
    expect(checkbox.checked).toBe(false);
    expect(screen.getByRole('note').textContent).toContain('Operating in approved course FAQ mode');

    type('Unsent question remains intact');
    fireEvent.click(checkbox);
    expect(onConsentChange).toHaveBeenCalledWith(true);

    // Parent rerenders with consent=true and mode="online"
    rerender(
      <Assistant client={client} mode="online" consent={true} onConsentChange={onConsentChange} />,
    );

    expect(checkbox.checked).toBe(true);
    expect(screen.getByRole('note').textContent).toContain(
      'Operating in consented online answer mode',
    );
    expect(questionBox()).toHaveProperty('value', 'Unsent question remains intact');
  });
});
