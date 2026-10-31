---
name: sdd
description: Maintain this project's specs, implementation tasks, and architecture using specification-driven development. Use when defining requirements, planning or implementing features, fixing behavior, or changing system boundaries; ordinary prose corrections do not require an implementation task.
---

# Specification-driven development

## Sources of truth

- `AGENTS.md`: short project orientation, navigation, critical rules, acceptance gate.
- `architecture.md`: global boundaries, shared technical decisions, unresolved tradeoffs.
- `specs/<domain>.md`: durable observable requirements and scenarios; no implementation progress logs.
- `tasks/<NNN>-<change>.md`: bounded implementation checklist, referenced requirement IDs, acceptance, evidence.
- `README.md`: concise documentation map and verified setup commands when code exists.

Keep AGENTS.md in English and very short. Write project documentation in Russian unless requested otherwise. Read only the architecture, specs, and tasks relevant to the change.

## Workflow

1. Inspect relevant documents and code. Distinguish assignment constraints, agreed decisions, and open proposals.
2. For a specification request, create or update the spec and stop at the requested scope. Do not start implementation merely because a spec exists.
3. Before implementation, establish the affected requirements and create or reuse a task with explicit requirement IDs. For a bug already covered by a requirement, reference it instead of inventing a new requirement.
4. Resolve implementation-blocking decisions with the user when they affect scope or an explicitly deferred choice. Routine implementation details within agreed scope do not need repeated approval. Do not silently resolve conflicting requirements.
5. Implement against the task. Update specs when authorized behavior changes; update architecture when shared boundaries or technical decisions change. Keep README and AGENTS navigation accurate.
6. Check relevant scenarios and regressions. Record commands and outcomes, or concrete manual observations. Mark unavailable checks as unverified with the reason.
7. Mark a task `done` only when its acceptance checklist is satisfied with evidence. Record remaining work and deviations explicitly; an unchecked required criterion prevents completion.

## Document rules

- Use [templates.md](templates.md) when creating a spec or task. Omit empty optional sections; keep requirements and acceptance concrete.
- Every spec starts with YAML frontmatter: `id`, `type`, `status`, `implementation`, `parent`, `summary`. Use singular `type` (e.g. `module-design`), a unique stable kebab-case `id`, and a short summary.
- Spec `status`: `draft` (proposed or unresolved), `ready` (settled for implementation), `retired` (no longer applicable). Architecture uses `type: system-design`, `status: active`, and `parent: none`; module specs use `parent: architecture`. Parent IDs refer to documents, not implementation dependencies.
- `implementation`: `not-started`, `partial`, `complete`. Track actual code and verified acceptance separately from document readiness. A ready spec may be unimplemented; a draft spec may be partially implemented. Mark complete only when all required scenarios have evidence. Update metadata when task results change coverage.
- Respect an explicit request to discuss choices later. Open decisions that affect a requirement remain visible; do not mark dependent specs ready prematurely.
- Keep all document metadata in YAML frontmatter, not in body labels or metadata sections. Task fields: `id` (TASK-NNN), `type: implementation-task`, `status` (todo/in-progress/blocked/done), `spec` (relative path), `requirements` (list of IDs or ranges), `depends_on` (list of TASK-NNN IDs). Optional `related` entries contain `spec` and `requirements`; `scheduling_note` preserves ordering notes. Use empty lists for no dependencies. A blocked task records the blocker and what is needed to resume.
- Spec related-document links belong in optional `related` metadata as relative paths. Keep substantive requirements, scenarios, implementation steps, acceptance and result evidence in the body; meaningful cross-references within them are allowed. Do not duplicate task IDs or metadata labels in headings.
- Prefer unquoted YAML values when they preserve valid syntax and the intended type; quote only when necessary. Leave a blank line between frontmatter and the document heading.
- Requirement IDs are stable within a domain, e.g. `CLIENT-001`; never reuse retired IDs. Scenario IDs are local to a spec; refer to them with the spec link.
- Allocate task numbers after inspecting existing tasks; use the next unused three-digit number.
- Every task references the requirements it implements or changes. Every acceptance item points to observable behavior or a relevant check; do not copy the entire spec into a task.
- Keep requirement changes separate from implementation steps. For changed behavior, state which IDs are added, modified, or retired. Do not expand scope without a basis in the user's request.
- Do not fabricate commands, test outcomes, installed technologies, or implemented capabilities. Distinguish planned paths from existing files.
- For documentation-only changes, check consistency, links, and scope. For code, select checks that demonstrate the affected behavior.
