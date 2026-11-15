// Provider factory selecting tutoring answer providers based on AI_PROVIDER (T3-037).
// Supports 'faq', 'local' (Ollama/open model), or 'cloud' (Gemini).
import type { ContentAccess } from '../../content/application/content-access.ts';
import { GeminiGroundedAnswerProvider } from './gemini-grounded-answer-provider.ts';
import { FaqProvider } from '../application/faq-provider.ts';
import type { OnlineAnswerProvider } from '../application/ports/online-answer-provider.ts';
import { LocalOllamaAnswerProvider } from './local-ollama-provider.ts';

export type AiProviderMode = 'faq' | 'local' | 'cloud';

export interface AnswerProviderConfig {
  readonly provider: AiProviderMode;
  readonly localModelUrl?: string | undefined;
  readonly localModelName?: string | undefined;
}

export interface AnswerProviderWiring {
  readonly faqProvider: FaqProvider;
  readonly onlineProvider: OnlineAnswerProvider | undefined;
  readonly aiProvider: AiProviderMode;
}

export function createAnswerProviders(
  config: AnswerProviderConfig,
  content: ContentAccess,
): AnswerProviderWiring {
  const faqProvider = new FaqProvider(content);

  switch (config.provider) {
    case 'faq':
      return {
        faqProvider,
        onlineProvider: undefined,
        aiProvider: 'faq',
      };
    case 'local':
      return {
        faqProvider,
        onlineProvider: new LocalOllamaAnswerProvider({
          baseUrl: config.localModelUrl,
          modelName: config.localModelName,
        }),
        aiProvider: 'local',
      };
    case 'cloud':
      return {
        faqProvider,
        onlineProvider: new GeminiGroundedAnswerProvider(),
        aiProvider: 'cloud',
      };
    default: {
      const invalid = config.provider as string;
      throw new Error(`Unsupported AI provider: ${invalid}. Must be faq, local, or cloud.`);
    }
  }
}
