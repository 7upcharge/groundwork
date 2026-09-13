# Groundwork

**A source-grounded study workspace.** Upload a lecture PDF and Groundwork organizes it into revision notes and a practice quiz, builds a knowledge graph of the concepts it contains, finds the ones you're actually weak on from how you answer, and gives you practice targeted at exactly those.

> Vertical: **AI-Powered Student Workspace** (AI Productivity & Automation)
> Flow: **Lecture PDF → revision notes + practice quiz from the same content**, taken further into a closed loop: *understanding → traceability → practice → performance → personalization*.

---

## The idea, in one sentence

Every note and every quiz question carries a citation back to the exact sentence and page it came from — checked in code, not just asked of a model — so a student can actually trust what they're revising from, and a "wow" moment is one click away: **Show source**.

## The 90-second demo

1. Upload a lecture PDF (or click "Try a sample lecture").
2. Notes appear, organized by the lecture's own headings, each with a page reference.
3. Click **Show source** — the exact sentence from the PDF appears.
4. Generate a practice quiz. Answer a couple wrong on purpose.
5. Go to the dashboard: **Next Up** now names the concept you missed, with a reason ("you missed 2 of your last 2 questions on this").
6. Open that concept: its definition, every page it appears on, related concepts, your performance.
7. Click **Practice this topic** — a new quiz, built only from that concept and its neighbors.
8. Export the study pack (notes + weak areas) as Markdown.

---

## Quick start

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`, no native build step).

```bash
cd backend
npm install
npm start
```

Open http://localhost:3000, click **Continue as guest**, and try the sample lecture. Everything — accounts, subjects, documents, quizzes, scores — persists in a local SQLite file at `data/groundwork.db`.

**Optional: enable a real LLM.** Copy `backend/.env.example` to `backend/.env` and set `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`). Without a key, Groundwork runs its offline engine — see [Two engines](#two-engines-one-contract) for what that changes.

```bash
npm test   # 51 tests, fully offline, no key or network needed
```

---

## Architecture

```
 STUDENT MATERIAL (PDF)
        │
        ▼
 DOCUMENT AGENT ──► pages → sections → page-tagged passages
        │            (bullet/footer/page-number cleanup, injection flagging)
        ▼
 KNOWLEDGE AGENT ──► concepts (repeated terms/phrases) + MENTIONS/DEFINES
        │            edges to passages + RELATED_TO edges (co-occurrence)
        ▼
 NOTES AGENT ──────► per-section notes, each item cites one passage
        │            (LLM + generate→verify→repair loop, or offline extractive)
        ▼
   ┌────┴─────┐
   ▼          ▼
 QUIZ AGENT  (reused by) TARGETED PRACTICE (weak concepts → quiz)
   │
   ▼
 student answers ──► ATTEMPTS/ANSWERS (SQLite) ──► WEAKNESS (evidence-based)
                                                        │
                                                        ▼
                                                   NEXT UP (dashboard)
                                                        │
                                                        ▼
                                              concept → practice → retry loop
```

This is the real request path, not an illustration — every arrow above is a function call or a SQL join you can find in the code.

### 1. Document Agent (`agents/document.js`, `lib/pdfExtractor.js`, `lib/text.js`)
- Validates real PDF magic bytes (`%PDF-`) — the browser's MIME type/extension is only used for an early, non-authoritative rejection.
- Extracts text **page by page** via pdf.js, with eval and font loading disabled (the CVE-2024-4367 class of PDF.js issues).
- Cleans slide-deck noise before anything else touches it: strips bullet glyphs (`•`, `▪`, Wingdings, the "o " outline bullet), drops page numbers and running footers, and merges a title repeated across every slide into one section instead of N duplicate sections.
- Splits into sections at heading-shaped lines, and each section into passages — the unit everything downstream cites. Every passage keeps its page number.
- Flags (but never discards) any passage that reads like it's addressed to an AI model ("ignore previous instructions", "you are now an assistant", …) — see [Prompt injection defense](#prompt-injection-defense).

### 2. Knowledge Agent (`agents/knowledge.js`)
Builds the concept graph for a document, deterministically:
- **Concepts**: multi-word phrases the lecture *repeats* (`"electron transport chain"`), acronyms seen ≥2 times, and frequent content words — filtered against a stopword/generic-academic-word list so "the process", "three", "converted" never become graph nodes.
- **MENTIONS / DEFINES edges**: every passage a concept appears in; a passage is marked DEFINES only when it contains a real defining pattern ("X is *a/an/the* …", "X, also known as …", "X refers to …") — not merely any sentence where "X is" happens to appear. (An earlier, looser regex here produced false definitions like "oxygen is unavailable" being reported as *defining* oxygen — caught by `test/knowledge.test.js` and fixed.)
- **RELATED_TO edges**: concepts that co-occur in the same passage, weighted by how often.
- Concepts are keyed by `(subject, normalized name)`, so the same concept across a student's documents in one subject — "CSMA/CD" in Lecture 2 and again in Lecture 3 — shares one node. This is what makes cross-document connections and prerequisite-style browsing (`related` concepts) real rather than decorative.

### 3. Notes Agent (`agents/notes.js`) and Quiz Agent (`agents/quiz.js`)
Both run a real **generate → verify → repair** loop (`agents/loop.js`) when an LLM key is configured:

| Step | What happens |
|---|---|
| Generate | The model returns structured JSON (forced schema) for one document section, or one quiz batch. Every item must carry a `source_quote` copied verbatim from the given excerpt. The excerpt is explicitly fenced as untrusted data, not instructions. |
| Verify | Code (not the model) checks: does `source_quote` actually appear in the passage? Does the claim's content-word overlap and every number in it actually match the source (`agents/source.js`)? For quizzes: exactly the right number of choices/correct answers for the question type, and no duplicate questions on the same fact. |
| Repair | Anything that fails is sent back with the specific reasons, once, for the model to fix or drop. |
| Fallback | Anything still failing is dropped, never shown. If everything fails, or no key is configured, or the model call errors/times out — the **offline engine** produces the result instead. Quizzes that partially fail are topped up with offline questions rather than served short. |

The model is never trusted to grade its own work — grounding is checked in plain code (`agents/source.js`), the same code whether the model is used or not.

### 4. The offline engine (no API key required)
- **Notes**: sentences ranked by content-word frequency (length-normalized), verbatim — grounded by construction. TL;DR is always built this way even when an LLM is configured, since it's free and trivially accurate.
- **Quiz**: fill-in-the-blank questions built from the highest-ranked sentences containing a concept; the most specific concept in the sentence is blanked, distractors are other concepts from the graph. A seeded PRNG makes output reproducible — this is also why it's fully unit-testable in a way a live LLM's output generally isn't.

### 5. Weakness detection and targeted practice (`services/weakness.js`)
Never flags a weakness from a single wrong answer. A concept becomes "weak" only when:
- the two most recent answers on it were both wrong (**high** confidence), or
- overall accuracy on it is ≥50% wrong across ≥2 attempts (**medium**), or
- ≥66% wrong across ≥3 attempts (**high**)

— and two correct answers in a row on it *clears* the flag immediately, regardless of older history, because the product should reward recent improvement rather than punish it forever. The dashboard's **Next Up** picks the highest-confidence weak concept across all a student's subjects.

**Practice this topic** on a concept page (or **Next Up → Review topic**) generates a quiz scoped to that concept: questions are drawn only from passages that mention it, while distractors are still drawn from the whole subject's graph — a weak set of only 1–2 concepts still produces a real 4-choice quiz. (This was a real bug during development: an earlier version restricted distractors to the tiny focus set too, so targeted practice on 2 weak concepts silently returned zero questions. Caught by `test/quiz.test.js`'s regression test.)

### Two engines, one contract
Whether an LLM ran or not, the API returns the same shape, so the frontend never needs to know which one produced it:

```js
// GET /api/documents/:id
{ notes: { sections: { overview, definition, key_point, example, formula, exam_focus, confusion }, labels, order },
  concepts: [{ id, name }], engine: "offline" | "gemini-2.5-flash" | "claude-sonnet-5" }

// POST /api/quizzes  ->  GET /api/quizzes/:id
{ questions: [{ id, type, prompt, choices, difficulty, source: { document, page, quote } }] }
```

### Prompt injection defense
Uploaded material is data, never instructions, enforced in three independent layers:
1. **Detection** (`lib/injection.js`): passages matching patterns aimed at a model ("ignore previous instructions", "you are now an AI…", "new instructions:", attempts to forge `<system>`/`</excerpt>` tags) are flagged and **excluded from every LLM prompt** (`services/graph.js` filters `WHERE flagged = 0`). They still appear to the student as ordinary source content — Groundwork doesn't hide or alter what was actually in the PDF.
2. **Fencing** (`fenceSafe`): passage text going into a prompt has any literal `<excerpt>`/`<system>` sequences neutralized, so material can't forge the boundary between "untrusted excerpt" and "instructions" in the prompt.
3. **System prompts** explicitly tell the model the excerpt is untrusted student-uploaded content, and that text addressed to an AI within it should be treated as content to summarize/quiz, never followed.
4. **Grounding is the backstop that matters most**: even if injected text influenced a generation, the output still has to survive the code-level source-quote check before a student ever sees it.

### Loop engineering in the codebase, not just in comments
- `agents/loop.js`'s `generateVerifyRepair` is the actual function every LLM-backed agent calls — not a description of a pattern, the pattern itself, unit-tested via the verify/repair contract in `agents/notes.js` and `agents/quiz.js`.
- The development process used the same loop: build → run against the real server → click through the actual browser UI → find a real bug → fix → re-run → verify. Three real bugs were caught and fixed exactly this way during this build (see `git log` and the inline comments marked "regression"): a PDF-parsing library that leaked one document's text into the next request, a false-positive "definition" detector, and targeted practice silently returning zero questions.

---

## What's real vs. what's a deliberate simplification

Being direct about this matters more than the feature looking finished:

| | |
|---|---|
| **Real** | Accounts, sessions, SQLite persistence, the full document pipeline, the concept graph (with real MENTIONS/DEFINES/RELATED_TO edges backing actual product behavior — related concepts, source tracing, weakness detection), the offline engine, the LLM pipeline's code path, all validation/grounding/repair logic, the security controls below, all 51 tests. |
| **Untested live** | The LLM (Gemini/Claude) path has unit tests for its verify/repair/fallback logic and was code-reviewed, but was never exercised against a live API key during this build (none was available). It is expected to work — the same grounding code runs whether the JSON came from a model or was mocked — but "expected to work" is not "verified against a live model," and I'm not claiming otherwise. |
| **Simplified** | Processing runs synchronously within the upload request rather than as a background job with streamed progress — honest for the offline engine (sub-second), and reasonable for typical LLM latency, but a very large document with a slow model could mean a longer wait than a progress bar would suggest. Documents cap at 60 pages. |
| **Not built** | Everything the brief explicitly said to skip: a tutor, a study planner, exam mode, an assignment/deadline tracker, document-pile summarization, flashcards. The competition brief rewards one flow done well over feature breadth; this submission took that seriously. |

---

## Security

| Risk | Mitigation |
|---|---|
| Spoofed file type | Magic-byte check is authoritative; MIME type/extension are only an early filter |
| Malicious PDF | pdf.js runs with `isEvalSupported: false`, font-face and system fonts disabled; a fresh document per request, destroyed afterward |
| Cross-request data leakage | A regression test (`pdf.test.js`) asserts one document's text can never appear in the next request's result — an earlier PDF library failed this silently |
| Disk / path traversal | Uploads are content-addressed by SHA-256 (`services/storage.js`); the filename is never derived from user input |
| Password storage | scrypt with a random salt per password, timing-safe comparison; failed logins take the same time whether the email exists or not |
| Session hijacking | Session tokens are random 256-bit values; only their SHA-256 hash is stored in the database; cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production |
| CSRF | All state-changing requests require a custom `X-Groundwork` header, which a cross-site form or `<img>` can't attach without triggering a CORS preflight we never approve |
| XSS | The frontend never uses `innerHTML`; all DOM content is set via `textContent`/`createTextNode`. Strict CSP: `default-src 'self'`, `script-src 'self'`, `style-src 'self'` (no inline styles or scripts anywhere in the app), `object-src 'none'`, `frame-ancestors 'none'` |
| CSV/Markdown export injection | N/A here — study-pack export is Markdown, not spreadsheet-openable CSV; content is plain-text interpolated, not executable |
| Prompt injection | See [above](#prompt-injection-defense) — detection, fencing, explicit system-prompt framing, and grounding as the backstop |
| SQL injection | Every query is parameterized (`db.run/get/all` with `?` placeholders); the only template-literal SQL builds `?, ?, ?` placeholder lists for `IN (...)`, never interpolates values |
| Resource exhaustion | 10MB upload cap, 1 file, 60-page cap, 30s LLM timeout, tiered rate limits (60/min general, 20/min auth, 8/min uploads) per IP |
| Secrets | API keys read from environment/`.env` (gitignored) only, never sent to the browser; `/api/status` exposes the model name, never the key |
| User data isolation | Every query that touches a subject/document/concept/quiz filters by the authenticated `user_id`; ownership is re-checked (`requireSubject`/`requireDocument`) before any read or write |
| Error leakage | Central error handler returns safe, typed messages; stack traces are logged server-side only, never sent to the client |

**Known accepted risk:** `npm audit` reports a moderate advisory in `qs` (an Express 4 internal dependency) affecting deeply nested query-string parsing. Groundwork's API has no endpoints that parse query strings at all (routes use path params and JSON bodies), so this dependency's vulnerable code path is never reachable here.

## Accessibility

- Semantic structure throughout: skip link, one `h1` per view, labelled regions, real `<fieldset>`/`<legend>` for quiz questions with native radio/checkbox inputs (full keyboard support for free)
- WAI-ARIA tabs pattern on the notes/quiz tabs (`role="tab"`, `aria-selected`, roving `tabindex`, arrow-key switching)
- `aria-live` region for quiz score and submission feedback; focus moves to the new view's heading on navigation, for screen-reader users
- "Show source" buttons use `aria-expanded`/`aria-controls`
- Visible `:focus-visible` outlines everywhere (including on native radios); light and dark themes via `prefers-color-scheme` and an explicit override; 40px+ touch targets; the top nav reflows to a second row rather than clipping at 375px width, verified by hand at that width

## Testing

`npm test` runs **51 tests**, fully offline, in well under a second:

- **Document pipeline**: real text extraction, reproducible across repeated calls, no cross-document leakage (regression), spoofed/corrupted/scanned/oversized files, page-count truncation
- **Text structuring**: bullet-glyph stripping, page-number/footer removal, repeated-title merging, line-wrap joining, heading detection precision
- **Knowledge graph**: real vs. false-positive definition detection (regression), co-occurrence edges, generic-word filtering
- **Quiz generation**: deterministic output, every question and its explanation traceable to source, headings never become questions, targeted-practice distractor pool (regression)
- **Weakness detection**: never flags from one wrong answer, high/medium confidence thresholds, recent-improvement clears a flag, concepts tracked independently
- **Auth**: password hashing/verification, salted hashes differ, register/login round-trip, wrong-password and duplicate-email rejection, session creation/lookup/destruction, guest-account upgrade
- **Prompt injection**: detection patterns fire on real injection attempts and never on ordinary lecture text (including text that merely contains the word "ignore" or "system"); fence-escaping neutralizes fake tag closures
- **Full integration** (`integration.test.js`, against the real Express app + in-memory SQLite, zero mocking of business logic): guest → subject → upload → notes with sources → duplicate-upload dedup → quiz → two attempts → weakness detected → dashboard next-up → concept detail → targeted practice → Markdown export; plus a failure-path test covering no file, wrong type, oversized (413), corrupted, scanned/text-less (422), nonexistent resource (404), and unauthenticated access (401)

Verified by hand in the actual browser (not just the API): the full golden path end to end, mobile layout at 375px, "Show source" reveal/hide, and the guest → register (account-claim) → logout → login lifecycle.

## Assumptions

- Input is a **text-based** PDF in **English**; scanned slides need OCR, which isn't included, and sentence/stopword logic assumes English.
- A student's guest session is meant to be tried immediately and optionally saved later (`claimGuest` keeps the same user id and all their materials) — this is deliberate, so a judge never has to create an account to see the product work.
- SQLite is appropriate at this scale; a real multi-instance deployment would need a shared database and a shared rate-limit store.

## Project structure

```
backend/
  server.js / app.js        wiring: middleware, routes, error handling
  config.js
  db/schema.sql, db/index.js
  agents/
    document.js              Document Agent
    knowledge.js              Knowledge Agent (concept graph)
    notes.js, quiz.js         Notes/Quiz Agents (generate -> verify -> repair)
    source.js                 Source/Verification Agent (grounding)
    loop.js                   the generate/verify/repair loop itself
    recorder.js                per-run logging to agent_runs, for observability
  lib/
    text.js                   PDF-text cleaning, sectioning, key-term extraction
    pdfExtractor.js            isolated pdf.js text extraction
    llm.js                    Gemini/Claude structured-output clients + schema check
    schema.js                  JSON-schema validator for model output
    injection.js               prompt-injection detection + fencing
    http.js                    validation helpers, typed HttpError
  services/                    business logic + SQL (library, quiz, weakness, concepts,
                                pipeline orchestration, auth, storage, study-pack export)
  routes/                      thin Express route handlers
  middleware/security.js       CSRF header check, cookies, rate limiting, CSP
  test/                        51 tests across 9 files, one full integration test
frontend/                      index.html, app.js, style.css — no build step, no framework
samples/                       sample-lecture.pdf, large-lecture.pdf, blank-scan.pdf
```

## License

MIT
