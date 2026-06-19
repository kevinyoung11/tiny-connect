# TinyConnect Agent Console Stage 6 Design

## Goal

Build TinyConnect into a real mobile controller for long-running Codex and Claude work:

- create a task from the phone;
- run Codex or Claude in a persistent tmux-backed runner;
- watch live and replayed output;
- pause for explicit approval before high-risk actions;
- expose task operations through REST and MCP-style endpoints for LibreChat;
- track PR/CI/deployment delivery state.

The first complete delivery is a vertical slice, not a full enterprise platform. It must be usable for real personal Codex/Claude sessions and designed so later integrations can harden the same boundaries.

## Product Boundary

### In Scope

- Agent task records owned by the current device user.
- Runner lifecycle for `codex`, `claude`, and `shell` task kinds.
- Stable tmux session names per task.
- Local process runner for development and smoke tests.
- Command risk classification and approval records.
- Task output ring buffer and API-readable output tail.
- Mobile Agent Console UI embedded in the existing TinyConnect app.
- Static GitHub delivery state model and APIs, ready for real GitHub integration.
- MCP-compatible JSON endpoints that LibreChat or another agent client can call.
- Audit log entries for task creation, runner updates, approvals, and delivery changes.

### Out Of Scope For First Stage-6 Vertical Slice

- Direct OAuth login.
- Full GitHub App installation flow.
- True shell command interception inside arbitrary Codex/Claude internals.
- Replacing LibreChat UI.
- Multi-user organization policy.
- Process survival across Node server restart.
- Remote tmux pipe-pane collector over SSH.

Those items remain explicit later hardening work. The vertical slice must still have interfaces that can accept them without redesign.

## Architecture

TinyConnect keeps its existing terminal layer unchanged:

- `/terminal` remains the interactive SSH/xterm transport.
- Existing SSH profiles, key management, SFTP, reconnect, settings, and mobile terminal controls keep their current behavior.

A new Agent layer sits beside it:

```text
Mobile Agent Console UI
  |
  | REST /api/agent/*
  | MCP  /api/mcp/*
  v
Agent Service
  |
  |-- Agent Task Store
  |-- Approval Store
  |-- Audit Store
  |-- Delivery Store
  |-- Runner Manager
        |
        |-- Local Process Runner
        |-- Future SSH/tmux Runner
        |-- Future Codex/Claude approval adapter
```

The runner layer is independent from browser tabs. A phone can attach to a task after reload and receive the latest task state plus recent output.

## Data Model

### agent_tasks

Fields:

- `id`: text, `task_<uuid>`.
- `user_id`: owner.
- `title`: short task title.
- `kind`: `codex`, `claude`, or `shell`.
- `prompt`: original user request.
- `status`: `queued`, `running`, `waiting_approval`, `completed`, `failed`, `cancelled`.
- `risk_level`: `safe`, `medium`, `high`, `critical`.
- `project_path`: optional local/remote project path.
- `tmux_session`: stable tmux session name, e.g. `tc-codex-abc123`.
- `runner_pid`: local process id when applicable.
- `model`: optional model label.
- `branch`: optional git branch.
- `pr_url`: optional PR URL.
- `ci_status`: `unknown`, `pending`, `passed`, `failed`.
- `delivery_status`: `none`, `ready`, `open`, `merged`, `deployed`.
- `output_tail`: recent text output.
- `metadata`: JSON object.
- timestamps.

### agent_approvals

Fields:

- `id`: text, `approval_<uuid>`.
- `task_id`.
- `user_id`.
- `status`: `pending`, `approved`, `rejected`, `expired`.
- `risk_level`.
- `command`: command or action summary.
- `reason`: why approval is required.
- `diff_summary`: optional text.
- `requested_at`, `resolved_at`.

### agent_audit_logs

Append-only event table:

- `task_created`
- `runner_started`
- `output_appended`
- `approval_requested`
- `approval_approved`
- `approval_rejected`
- `task_completed`
- `task_failed`
- `delivery_updated`
- `mcp_tool_called`

### agent_delivery

Per task delivery record:

- PR URL, PR number, branch, commit SHA.
- CI status and CI URL.
- preview URL.
- deployment status.

## API Boundary

### REST API

- `GET /api/agent/tasks`
  Lists current user's tasks.

- `POST /api/agent/tasks`
  Creates a task and starts a runner.

- `GET /api/agent/tasks/:id`
  Returns task state, latest approval, delivery state, and output tail.

- `GET /api/agent/tasks/:id/output`
  Returns recent output chunks.

- `POST /api/agent/tasks/:id/input`
  Sends input to a running task.

- `POST /api/agent/tasks/:id/cancel`
  Cancels the task. First version sends SIGINT/SIGTERM to local runner.

- `GET /api/agent/approvals`
  Lists pending approvals.

- `POST /api/agent/approvals/:id/resolve`
  Approves or rejects a pending approval.

- `GET /api/agent/tasks/:id/delivery`
  Returns PR/CI/deploy state.

- `POST /api/agent/tasks/:id/delivery`
  Updates delivery state. First version is local/stubbed and later can be driven by GitHub webhooks.

### MCP-Compatible API

Under `/api/mcp/tools/*`, expose JSON endpoints:

- `list_agent_tasks`
- `create_agent_task`
- `get_agent_task`
- `send_agent_input`
- `list_pending_approvals`
- `resolve_approval`

These endpoints do not stream. They create tasks and return IDs so LibreChat can poll or link back to TinyConnect.

## Runner Design

The first version supports local runner mode:

- `codex`: starts `codex <prompt>` when available, otherwise can be configured to use a mock command in tests.
- `claude`: starts `claude <prompt>` when available.
- `shell`: starts a configured shell command.

Runner commands are built by a pure function and tested. The service refuses unsupported task kinds.

Output capture:

- stdout and stderr append to an in-memory ring buffer.
- task `output_tail` is periodically updated.
- when a process exits, status becomes `completed` or `failed`.

Future SSH/tmux runner:

- create task-specific tmux sessions;
- collect output with `tmux capture-pane` or `pipe-pane`;
- attach phone terminal to the named session when needed.

## Approval Design

The first version has command/action approval at API level:

- task creation classifies prompt and requested command text;
- high-risk task kinds or prompts create a pending approval before runner start;
- approving starts or resumes the runner;
- rejecting marks task cancelled.

Risk classifier rules:

- `safe`: read-only inspection, tests, status commands.
- `medium`: package install, commit, branch creation.
- `high`: push, merge, deploy, delete files.
- `critical`: production database, secrets, destructive recursive delete.

This is not claimed to be full shell interception. True Codex/Claude internal command approval requires a future runner adapter or hook integration.

## Frontend Design

Add a production Agent Console to the real app, not only `controller-demo.html`.

New modules:

- `public/agent-api.js`: REST helpers.
- `public/agent-ui.js`: render task rows, task detail, approvals, delivery cards.
- `public/agent-console.js`: event binding, polling, task creation flow.

Existing `client.js` gets only a narrow integration:

- an Agent button in the HUD;
- initialization call for the Agent Console;
- no runner or task logic inside `client.js`.

UI areas:

- task list sheet;
- task detail panel;
- output tail;
- approval card with command/diff/reason;
- delivery cards for PR, CI, preview, deploy;
- create task form with kind, model, prompt.

## Security Boundary

Current device identity is weak and spoofable. The vertical slice follows existing project identity for consistency, but all security-sensitive APIs must:

- derive `userId` through `getRequestScope`;
- filter every task/approval/delivery query by `user_id`;
- never rely only on task ID possession;
- sanitize audit metadata;
- avoid storing GitHub tokens or model API keys in plain settings.

Known follow-up hardening:

- real auth;
- encrypted token storage;
- GitHub App install flow;
- non-permissive RLS;
- per-project execution allowlists.

## Acceptance Criteria

Stage-6 vertical slice is accepted when all of these are true:

1. A phone/browser can open Agent Console from the TinyConnect UI.
2. User can create a `shell` task that runs a real local command in tests and records output.
3. User can create a `codex` or `claude` task record; runner command building is correct and configurable.
4. High-risk prompt/action creates a pending approval instead of running immediately.
5. Approving the approval starts or resumes the task.
6. Rejecting the approval cancels the task.
7. Task detail shows status, output tail, approval state, and delivery state.
8. Task list survives page reload because it is stored through the backend store.
9. MCP-compatible endpoints can create and inspect a task with the same backend service.
10. Delivery API can record PR/CI/preview data and display it on the phone.
11. Tests cover stores, risk classification, runner command building, REST endpoints, MCP endpoints, and frontend renderers.
12. `npm test` passes.
13. A smoke script creates a task, observes output, resolves approval, and verifies final state.

## Rollout Plan

1. Add pure agent domain modules and tests.
2. Add Supabase-backed store schema and in-memory test store.
3. Add Agent REST routes.
4. Add local runner manager.
5. Add approval flow.
6. Add delivery state APIs.
7. Add Agent Console frontend modules.
8. Add MCP-compatible endpoints.
9. Add smoke verification.
10. Push behind existing app, with no behavior change to `/terminal`.
