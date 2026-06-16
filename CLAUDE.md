# Rackoon Tycoon 🦝

AWS SAA-C03 study guide evolving into a browser game. Theme: **Factorio meets RollerCoaster Tycoon**.

## Project rules
- **Always communicate in caveman mode (full).** Drop articles / filler / pleasantries / hedging. Fragments OK. Code, commits, and security warnings: write normal prose. Enforced by the `caveman@caveman` plugin SessionStart hook (enabled in `.claude/settings.json`); this line is the documented rule.
- **Avoid risky npm dependencies.** Prefer zero runtime deps. Any new package needs explicit approval (see `backlog.md`).
- **Phase the work.** Build per the Sprints/Tasks in `backlog.md`, one phase per session, to avoid context loss.

## Layout
- `index.html` — SAA-C03 study guide, gap-focused (priority gaps from interview at top).
- `backlog.md` — game design + Sprints + Tasks + Phases.
- `README.md` — original brief.
- Game source: added after plan approval. Stack: vanilla JS (ES modules) + HTML5 Canvas, zero runtime deps.
