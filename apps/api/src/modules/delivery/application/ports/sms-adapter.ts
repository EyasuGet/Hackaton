// Port interface for outbound SMS delivery adapters.
// Concrete implementations (e.g. AfroMessageSmsAdapter) handle provider-specific
// transport, authentication, payload mapping, and status normalization.

import type { SendSmsRequest, SendSmsResult, SmsStatusResult } from '../../domain/sms-contract.ts';

export interface SmsAdapter {
  readonly providerName: string;

  /**
   * Dispatches an SMS through the approved provider route.
   * Validates recipient format and length/encoding limits before making any network calls.
   */
  send(request: SendSmsRequest): Promise<SendSmsResult>;

  /**
   * Queries the latest delivery state for a previously dispatched message ID.
   * Retains an 'unknown' status if the provider or network cannot confirm the state.
   */
  checkStatus(messageId: string): Promise<SmsStatusResult>;
}
