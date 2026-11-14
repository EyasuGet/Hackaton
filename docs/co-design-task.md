# Co-designer task script

Status: **DRAFT, NOT RUN.** This is the executable human task script for [T3-009-A](https://github.com/EyasuGet/Hackaton/issues/26). It is reused by T3-009-B and T3-025. The task and success criteria below are *proposals*, not agreed ones, until a co-designer confirms them in section 2. No observations have been recorded. Record each session's results in the owning issue/PR using section 6, not in this file.

## 1. Before the session

- **Book a slot.** Co-designers are a shared pool, not a person assigned to our team ([reconciliation](savanna-reconciliation.md)). Book an early slot and a retest slot, and note who booked them and when in the issue. Never assume that the same person will come back.
- **Bring the session setup.** Bring two devices if possible: a Windows laptop with NVDA and an Android phone with TalkBack. If the co-designer has their own device, prefer it, but only with their permission. Use only synthetic accounts and data. No real learner records, credentials or private messages.
- **Record the revision.** Write down the commit SHA or URL being assessed, and whether it was run standalone or inside the static starter host. For a baseline session (section 3), write down the host page and starter revision.
- **Roles.** One facilitator reads the script. One note-taker records what happens. The note-taker does not help. Whoever runs the session must be able to follow this script without the original author.

## 2. Consent and agreement (read aloud, in the co-designer's preferred language)

> We are testing our software, not you. You can stop or skip anything at any time. We will write notes about what happens, but we will not record your name, your voice, your screen or your contact details unless you say yes to each one separately. We will not share your notes outside the team's evidence. Is that okay?

Record the consent and its scope (notes only / screen / audio). Without explicit consent, record nothing beyond anonymous notes.

Then agree the task together. Start from the draft below, and record the co-designer's changes and the reason for each:

| Item | Draft proposal (to confirm or change) | Agreed version |
|---|---|---|
| Primary task | Ask a question about the supplied course concept, in the language you choose, then find out where the answer came from. | |
| Language(s) | Amharic first, then English (or as the co-designer prefers) | |
| Device / assistive technology | The co-designer's usual setup; record its OS, browser, AT and version | |
| Success means | Gets a readable answer, can tell where the evidence came from, and recognises when the assistant cannot answer, all without help | |
| Things that matter most to them | *(ask: "What usually goes wrong when you try to get help with course material?")* | |

## 3. Baseline observation (before judging the new interface)

The goal is to capture the co-designer's current experience *before* they see our assistant.

1. Open the supplied course page (static starter) on the agreed setup.
2. Say: *"Imagine you are stuck on this lesson. Show me how you would usually get an answer."*
3. Observe without guiding. Record each step, where they hesitated, any barriers they met (unlabelled controls, unreadable Ethiopic text, focus lost, no announcement, zoom breaking the layout, sound needed), and the assistance level (section 5).
4. Ask: *"What would make this easier?"* Record their words as close to verbatim as possible, without identifying details.

Ask the organisers for any accessibility feedback they hold on the starter. Do not invent it. Record "not obtained" until it arrives.

## 4. Assistant task steps (T3-009-B and later retests)

Read each prompt as written. Do not point at controls or name them.

| # | Facilitator says | Observe |
|---|---|---|
| 1 | "Please open the assistant." | Can they find and enter it? Where does focus land? |
| 2 | "Ask it your question about this lesson." | Is the question box labelled? Can they send by keyboard? |
| 3 | *(wait)* | Is the answer announced once, without focus being taken? Is Ethiopic text readable? |
| 4 | "Where did that answer come from?" | Can they open the citation, and get back afterwards? |
| 5 | "Now ask something this course does not cover." | Do they understand the limitation, and do they see the offer of human help? |
| 6 | "Can you find the frequently asked questions?" | Do they reach the FAQ path? |
| 7 | "How was that compared with before?" | Their words, before/after |

Steps 4 to 6 depend on T3-007-A and T3-008-A. If a feature is not built at the assessed revision, record that step as **NOT BUILT**. Do not record it as a failure or a pass, and do not demonstrate a mock as if it were the feature.

Repeat the task under each condition that is available: keyboard only, 200% zoom, sound off, NVDA, and TalkBack. Record each unavailable device or AT as **NOT RUN**, with the reason.

## 5. Assistance levels

Use one level per step so that different facilitators score consistently:

- **Unaided:** completed with no input beyond the scripted prompt.
- **Prompted:** completed after a non-specific hint ("take your time", "is there anything else on the page?").
- **Assisted:** the facilitator named or operated a control, or explained the interface.
- **Not completed:** abandoned, or the step was impossible.

Only **Unaided** counts toward the unaided-task gate. Keep what was observed separate from interpretation. For example, "pressed Tab 14 times, said 'where is it?'" is an observation; "the button is hard to find" is an interpretation.

## 6. Recording template (copy into the owning issue/PR)

- Issue, revision/URL and host (standalone / static starter at revision ___):
- Session type: baseline / first task / retest. Slot booked by, and date (Addis Ababa time):
- Co-designer: anonymous label only (e.g. "CD-1"). Same participant as an earlier session: yes / no / unknown:
- Consent scope:
- Agreed task and success criteria (section 2 table):
- Device, OS, browser, AT and versions; zoom; sound; network:
- Per step: result (Unaided / Prompted / Assisted / Not completed / NOT BUILT / NOT RUN) and observations:
- Defect source: **module** (our assistant/embed) or **inherited host** (static starter). An inherited defect that blocks the complete user task still blocks the task; record it, and do not exclude it:
- Co-designer's own words (non-identifying):
- Organiser feedback obtained / not obtained:
- Follow-up defects (link a separate small repair issue for each):
- Facilitator and note-taker:

## 7. Privacy

Do not store names, photos, voice, contact details, device identifiers or screen recordings in the repository. Store evidence under the anonymous label and give only its location. Delete any temporary recordings after the notes are written, unless the participant consented to keep them.
