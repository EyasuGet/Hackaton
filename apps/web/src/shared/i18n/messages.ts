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
  'demo.scenario.faqCited': 'Approved course FAQ (cited)',
  'demo.scenario.faqLimitation': 'Course FAQ (missing evidence limitation)',
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
  'assistant.modeNotice':
    'Operating in approved course FAQ mode. Answers are grounded in course materials with explicit citations without cloud processing.',
  'assistant.empty': 'No messages yet. Ask a question about your course below.',
  'assistant.speakerLearner': 'You',
  'assistant.speakerAssistant': 'Assistant (demo)',
  'assistant.speakerFaq': 'Assistant (course FAQ)',
  'assistant.questionLabel': 'Your question',
  'assistant.hint': 'Press Enter to send, or Shift+Enter for a new line.',
  'assistant.send': 'Send',
  'assistant.waiting': 'Waiting for a reply…',
  'assistant.sending': 'Sending your question…',
  'assistant.announcePrefix': 'Assistant: ',
  'assistant.updatesLabel': 'Conversation updates',
  'assistant.citationsLabel': 'Sources & Citations:',
  'assistant.problemEmpty': 'Type a question before sending.',
  'assistant.problemDenied':
    'You are not signed in, or your session has expired. Your question was not sent and is still in the box.',
  'assistant.problemFailed':
    'Your question could not be sent. Check your connection, then press Send to try again. Your question is still in the box.',
  // Labels around a displayed date; the date values follow the reply language.
  'date.ethiopianCalendar': 'Ethiopian calendar',
  'date.gregorianCalendar': 'Gregorian',
  'date.addisAbabaTime': 'Addis Ababa time',
  // Human help request (T3-016-A)
  'help.heading': 'Request human help',
  'help.intro':
    'If you need help from a staff member, you can submit a request with context about your question. Staff will respond when available.',
  'help.requestButton': 'Request help',
  'help.contextPrompt':
    'Describe what you need help with. You will review exactly what is shared before it is submitted.',
  'help.contextLabel': 'Your context (what you want to share)',
  'help.reviewButton': 'Review before sending',
  'help.cancelDraft': 'Discard',
  'help.disclosureHeading': 'What will be shared with support staff',
  'help.disclosureBody':
    'The text you wrote will be sent to and stored by support staff so they can respond to your request. It will be kept for up to 7 days.',
  'help.disclosureNoStaffPromise':
    'Staff respond when available. This request does not guarantee a specific response time.',
  'help.previewLabel': 'Your context:',
  'help.confirmButton': 'Confirm and send',
  'help.backButton': 'Go back and edit',
  'help.submitting': 'Sending your request…',
  'help.waiting':
    'Your request is waiting for a staff member. You can close this page and return later.',
  'help.noStaffPromise':
    'Staff respond when they are available. No specific response time is guaranteed.',
  'help.cancelButton': 'Cancel this request',
  'help.cancelled': 'Your request has been cancelled.',
  'help.errorDenied':
    'You are not signed in, or your session has expired. Your request was not sent.',
  'help.errorFailed': 'Your request could not be sent. Check your connection and try again.',
} as const;

export type MessageKey = keyof typeof en;

// Draft translations: competent-speaker review is still required (T3-006-C human verify).
export const am: Partial<Record<MessageKey, string>> = {
  'app.title': 'የትምህርት ረዳት',
  'app.languageLabel': 'ቋንቋ',
  'demo.heading': 'የሙከራ ሁኔታ',
  'demo.notice': 'መልሶች ከተሰየሙ የሙከራ ናሙናዎች የመጡ ናቸው። ይህ እውነተኛ አስተማሪ አይደለም፤ የትኛውም መልስ እውነተኛ አይደለም።',
  'demo.scenarioLabel': 'የሙከራ መልስ ዓይነት',
  'demo.scenario.faqCited': 'የተረጋገጠ የትምህርት FAQ (ከምንጭ ጥቅስ ጋር)',
  'demo.scenario.faqLimitation': 'የትምህርት FAQ (ያልተገኘ መረጃ ገደብ)',
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
  'assistant.modeNotice':
    'በተረጋገጠ የትምህርት ተደጋጋሚ ጥያቄዎች (FAQ) ሁኔታ ላይ ይገኛል። መልሶች ያለ ደመና ማቀነባበሪያ ከትምህርት ክፍሎች የተገኙ ናቸው።',
  'assistant.empty': 'እስካሁን ምንም መልእክት የለም። ስለ ትምህርትዎ ጥያቄ ከታች ይጠይቁ።',
  'assistant.speakerLearner': 'እርስዎ',
  'assistant.speakerAssistant': 'ረዳት (ሙከራ)',
  'assistant.speakerFaq': 'ረዳት (የትምህርት FAQ)',
  'assistant.questionLabel': 'ጥያቄዎ',
  'assistant.hint': 'ለመላክ Enter ይጫኑ፤ ለአዲስ መስመር Shift+Enter ይጫኑ።',
  'assistant.send': 'ላክ',
  'assistant.waiting': 'መልስ እየተጠበቀ ነው…',
  'assistant.sending': 'ጥያቄዎ እየተላከ ነው…',
  'assistant.announcePrefix': 'ረዳት፦ ',
  'assistant.updatesLabel': 'የውይይት ማሳወቂያዎች',
  'assistant.citationsLabel': 'ምንጮች እና ጥቅሶች፡',
  'assistant.problemEmpty': 'ከመላክዎ በፊት ጥያቄ ይጻፉ።',
  'assistant.problemDenied': 'አልገቡም፤ ወይም ክፍለ ጊዜዎ አብቅቷል። ጥያቄዎ አልተላከም፤ አሁንም በሳጥኑ ውስጥ አለ።',
  'assistant.problemFailed':
    'ጥያቄዎ ሊላክ አልቻለም። ግንኙነትዎን ያረጋግጡ፤ ከዚያ እንደገና ለመሞከር ላክ የሚለውን ይጫኑ። ጥያቄዎ አሁንም በሳጥኑ ውስጥ አለ።',
  'date.ethiopianCalendar': 'የኢትዮጵያ አቆጣጠር',
  'date.gregorianCalendar': 'የግሪጎሪያን አቆጣጠር',
  'date.addisAbabaTime': 'የአዲስ አበባ ሰዓት',
  // Human help request (T3-016-A) — draft; competent-speaker review required.
  'help.heading': 'የሰው እርዳታ ይጠይቁ',
  'help.intro': 'ከሰራተኛ አባል እርዳታ ከፈለጉ፣ ስለ ጥያቄዎ አውዳዊ መረጃ ያካተተ ጥያቄ ማቅረብ ይችላሉ። ሰራተኞች ሲገኙ ምላሽ ይሰጣሉ።',
  'help.requestButton': 'እርዳታ ይጠይቁ',
  'help.contextPrompt': 'እርዳታ የሚፈልጉበትን ሁኔታ ይግለጹ። ከመላክዎ በፊት ምን እንደሚጋራ ይከልሳሉ።',
  'help.contextLabel': 'አውዳዊ መረጃዎ (ማጋራት የሚፈልጉት)',
  'help.reviewButton': 'ከመላክ በፊት ይከልሱ',
  'help.cancelDraft': 'ሰርዝ',
  'help.disclosureHeading': 'ለድጋፍ ሰራተኞች የሚጋራው ነገር',
  'help.disclosureBody': 'የጻፉት ጽሑፍ ለድጋፍ ሰራተኞች ይላካል እናም ተቀምጦ ምላሽ ይሰጣሉ። እስከ 7 ቀናት ድረስ ይቀመጣል።',
  'help.disclosureNoStaffPromise': 'ሰራተኞች ሲገኙ ምላሽ ይሰጣሉ። ይህ ጥያቄ ልዩ የምላሽ ጊዜ አያረጋግጥም።',
  'help.previewLabel': 'አውዳዊ መረጃዎ፦',
  'help.confirmButton': 'አረጋግጥ እና ላክ',
  'help.backButton': 'ተመለስ እና ያርትዑ',
  'help.submitting': 'ጥያቄዎ እየተላከ ነው…',
  'help.waiting': 'ጥያቄዎ ሰራተኛ እስኪሰጣቸው እየጠበቀ ነው። ይህን ገጽ ዝጋ እና ቆይተው ይመለሱ።',
  'help.noStaffPromise': 'ሰራተኞች ሲገኙ ምላሽ ይሰጣሉ። ልዩ የምላሽ ጊዜ አይረጋገጥም።',
  'help.cancelButton': 'ይህን ጥያቄ ሰርዝ',
  'help.cancelled': 'ጥያቄዎ ተሰርዟል።',
  'help.errorDenied': 'አልገቡም፤ ወይም ክፍለ ጊዜዎ አብቅቷል። ጥያቄዎ አልተላከም።',
  'help.errorFailed': 'ጥያቄዎ ሊላክ አልቻለም። ግንኙነትዎን ያረጋግጡ እና እንደገና ይሞክሩ።',
};
