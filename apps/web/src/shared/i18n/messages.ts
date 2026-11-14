// Shared Amharic/English dictionary for learner-facing interface text.
//
// Conventions for every feature that adds strings:
// - English is the source and must define every key. Keys are flat, dotted and
//   name the place, then the meaning: `<feature>.<purpose>` (e.g. `assistant.send`).
// - Add the Amharic string in the same change. A key missing from `am` falls back to
//   the English text tagged `lang="en"`, so it is visible and pronounced correctly,
//   but the dictionary test fails until it is translated.
// - Whole sentences only: never build a sentence by joining fragments, because word
//   order differs between the languages.
// - Learner content (questions, replies, sources) is never put here; it carries its
//   own language tag.
// - Each feature's strings need review by a competent Amharic speaker before that
//   feature is complete.

export type Locale = 'en' | 'am';

export const en = {
  'app.title': 'Learning assistant',
  'app.languageLabel': 'Language',
  'demo.heading': 'Demo mode',
  'demo.notice':
    'Replies come from labelled test fixtures. This is not a tutor, and no answer is real.',
  'demo.scenarioLabel': 'Demo reply scenario',
  'demo.scenario.english': 'English reply',
  'demo.scenario.amharic': 'Amharic reply',
  'demo.scenario.mixed': 'Mixed-direction reply (Arabic first)',
  'demo.scenario.markup': 'Reply containing HTML markup',
  'demo.scenario.slow': 'Slow reply (3 seconds)',
  'demo.scenario.denied': 'Session expired',
  'demo.scenario.failed': 'Network failure',
  'status.label': 'Service status',
  'status.checking': 'Checking the API…',
  'status.available': 'API available',
  'status.unavailable': 'API unavailable',
  'assistant.heading': 'Conversation',
  'assistant.empty': 'No messages yet. Ask a question about your course below.',
  'assistant.speakerLearner': 'You',
  'assistant.speakerAssistant': 'Assistant (demo)',
  'assistant.questionLabel': 'Your question',
  'assistant.hint': 'Press Enter to send, or Shift+Enter for a new line.',
  'assistant.send': 'Send',
  'assistant.waiting': 'Waiting for a reply…',
  'assistant.sending': 'Sending your question…',
  'assistant.announcePrefix': 'Assistant: ',
  'assistant.updatesLabel': 'Conversation updates',
  'assistant.problemEmpty': 'Type a question before sending.',
  'assistant.problemDenied':
    'You are not signed in, or your session has expired. Your question was not sent and is still in the box.',
  'assistant.problemFailed':
    'Your question could not be sent. Check your connection, then press Send to try again. Your question is still in the box.',
} as const;

export type MessageKey = keyof typeof en;

// Draft translations: competent-speaker review is still required (T3-006-C human verify).
export const am: Partial<Record<MessageKey, string>> = {
  'app.title': 'የትምህርት ረዳት',
  'app.languageLabel': 'ቋንቋ',
  'demo.heading': 'የሙከራ ሁኔታ',
  'demo.notice': 'መልሶቹ ከተሰየሙ የሙከራ ናሙናዎች የመጡ ናቸው። ይህ እውነተኛ አስጠኚ አይደለም፤ የትኛውም መልስ እውነተኛ አይደለም።',
  'demo.scenarioLabel': 'የሙከራ መልስ ዓይነት',
  'demo.scenario.english': 'የእንግሊዝኛ መልስ',
  'demo.scenario.amharic': 'የአማርኛ መልስ',
  'demo.scenario.mixed': 'የተቀላቀለ አቅጣጫ ያለው መልስ (በዓረብኛ የሚጀምር)',
  'demo.scenario.markup': 'የHTML ምልክቶችን የያዘ መልስ',
  'demo.scenario.slow': 'የዘገየ መልስ (3 ሰከንድ)',
  'demo.scenario.denied': 'ክፍለ ጊዜው አብቅቷል',
  'demo.scenario.failed': 'የአውታረ መረብ ብልሽት',
  'status.label': 'የአገልግሎት ሁኔታ',
  'status.checking': 'ኤፒአዩ እየተፈተሸ ነው…',
  'status.available': 'ኤፒአዩ ይገኛል',
  'status.unavailable': 'ኤፒአዩ አይገኝም',
  'assistant.heading': 'ውይይት',
  'assistant.empty': 'እስካሁን ምንም መልእክት የለም። ስለ ትምህርትዎ ጥያቄ ከታች ይጠይቁ።',
  'assistant.speakerLearner': 'እርስዎ',
  'assistant.speakerAssistant': 'ረዳት (ሙከራ)',
  'assistant.questionLabel': 'ጥያቄዎ',
  'assistant.hint': 'ለመላክ Enter ይጫኑ፤ ለአዲስ መስመር Shift+Enter ይጫኑ።',
  'assistant.send': 'ላክ',
  'assistant.waiting': 'መልስ እየተጠበቀ ነው…',
  'assistant.sending': 'ጥያቄዎ እየተላከ ነው…',
  'assistant.announcePrefix': 'ረዳት፦ ',
  'assistant.updatesLabel': 'የውይይት ማሳወቂያዎች',
  'assistant.problemEmpty': 'ከመላክዎ በፊት ጥያቄ ይጻፉ።',
  'assistant.problemDenied': 'አልገቡም፣ ወይም ክፍለ ጊዜዎ አብቅቷል። ጥያቄዎ አልተላከም፤ አሁንም በሳጥኑ ውስጥ አለ።',
  'assistant.problemFailed':
    'ጥያቄዎ ሊላክ አልቻለም። ግንኙነትዎን ያረጋግጡ፣ ከዚያ እንደገና ለመሞከር ላክ የሚለውን ይጫኑ። ጥያቄዎ አሁንም በሳጥኑ ውስጥ አለ።',
};
