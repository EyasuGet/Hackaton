# Lesson source fixtures

One JSON file per lesson source, imported with `pnpm content:import` (all files here) or `pnpm content:import <file>`. The format is validated strictly by `apps/api/src/modules/content/domain/lesson-source.ts`; unknown fields are errors. Change `version` whenever the content changes. Re-importing identical content does nothing, and sections missing from a new version stop being authoritative. Set `"withdrawn": true` with no sections to retire a whole source.

| File | Kind | Course / language | Origin |
|---|---|---|---|
| `savanna-va1-future-of-va-industry.json` | organiser | `course-1` / en | Authored lesson text of `pages/concept-with-navigation.html` in [alx-africa/Savanna-static-pages at `9e83ac7`](https://github.com/alx-africa/Savanna-static-pages/blob/9e83ac77891708117728ad9fc05301e124cc8ec8/pages/concept-with-navigation.html). Organiser approval to extract, translate, cache offline and redistribute was relayed by the team on 2026-11-14 |
| `demo-time-management-am.json` | demo | `course-2` / am | Synthetic lesson for Ethiopic text handling; not teaching content; pending native-speaker review |

## How the Savanna lesson was extracted

Only the children of `#curriculum_navigation_content .savanna-styles` were used, split at each `<h4>` heading; each section keeps that heading's anchor id. Text before the first heading is the `introduction` section (no anchor). Markup was reduced to plain text with list items as `- ` lines; images, links' URLs, forms and scripts were dropped. Everything outside that container (learner profile and progress, navigation, the completion form and its token, the congratulations and Markdown-guide modals) was excluded. The extraction was a one-off review step, not a crawler; re-check the pinned page before changing this file.

`course-1` and `course-2` match the demo principals' course grants (see the README's demo identities section).
