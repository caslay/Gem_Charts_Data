---
description: 4-stage pipeline (Opus Plan -> Gemini High Build -> Opus Audit -> Gemini Med Deploy)
---

Execute a strict 4-stage quant engine pipeline for: $PROMPT

### Stage 1: Architecture & Precision Spec
- **Primary Model:** Claude Opus 4.6 (Thinking)
- **Quota Fallback:** Gemini 3.8 (High)
- **Action:**
  1. Inspect target files, math formulas, and state logic.
  2. Account for floating-point rounding, tick size precision, and order state edge cases.
  3. Output the blueprint to `/plans/quant-spec.md`.
  4. Do not touch source code in this stage.

---

### Stage 2: Code Implementation & Type Checking
- **Model:** Gemini 3.8 (High)
- **Action:**
  1. Read `/plans/quant-spec.md`.
  2. Implement code changes, types, and logic updates.
  3. Run local build and type checks (`npm run build` or `tsc`). Ensure zero errors.
  4. Stop before committing.

---

### Stage 3: Risk & Logic Audit
- **Primary Model:** Claude Opus 4.6 (Thinking)
- **Quota Fallback:** Gemini 3.8 (High)
- **Action:**
  1. Inspect `git diff` against `/plans/quant-spec.md`.
  2. Audit for unhandled exceptions, math divergences, or memory leaks.
  3. If issues are found, document them in `/plans/audit-issues.md` for Gemini to resolve.
  4. If clean, output an explicit audit pass.

---

### Stage 4: Documentation, Git Sync & Remote Deployment
- **Model:** Gemini 3.8 (Medium)
- **Action:**
  1. Document changes in relevant docs.
  2. Stage and commit changes with a clean semantic commit message, then push to Git.
  3. Reference `ecosystem.config.js` to execute the remote PM2 reload command and verify service health.