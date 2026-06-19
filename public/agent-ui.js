export function renderAgentTasks(root, tasks = [], { selectedTaskId = '' } = {}) {
  clearRoot(root);
  if (!tasks.length) {
    root.append(createEmptyState('No agent tasks yet'));
    return;
  }

  for (const task of tasks) {
    root.append(createTaskRow(task, selectedTaskId));
  }
}

export function renderAgentApprovals(root, approvals = []) {
  clearRoot(root);
  const pending = approvals.filter((approval) => (approval.status || 'pending') === 'pending');
  if (!pending.length) {
    root.append(createEmptyState('No pending approvals'));
    return;
  }

  for (const approval of pending) {
    root.append(createApprovalCard(approval));
  }
}

export function renderAgentOutputTail(root, outputTail = '') {
  clearRoot(root);
  if (!outputTail) {
    root.append(createEmptyState('No output yet'));
    return;
  }

  const output = document.createElement('pre');
  output.className = 'agent-output-tail';
  output.textContent = outputTail;
  root.append(output);
}

export function renderAgentDelivery(root, delivery) {
  clearRoot(root);
  if (!delivery) {
    root.append(createEmptyState('No delivery yet'));
    return;
  }

  root.append(createDeliveryCard(delivery));
}

function createTaskRow(task, selectedTaskId) {
  const row = document.createElement('div');
  row.className = task.id === selectedTaskId ? 'agent-task-row is-selected' : 'agent-task-row';
  row.dataset.taskId = task.id;
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');

  const main = document.createElement('div');
  main.className = 'agent-task-main';
  main.append(createText('div', task.title || task.prompt || 'Untitled task', 'agent-task-title'));
  main.append(createText('div', task.kind || 'agent', 'agent-task-kind'));

  const meta = document.createElement('div');
  meta.className = 'agent-task-meta';
  meta.append(createText('span', task.status || 'queued', 'agent-status'));
  meta.append(createText('span', task.riskLevel || task.risk_level || 'safe', 'agent-risk'));
  if (task.updatedAt || task.updated_at) {
    meta.append(createText('span', formatTimestamp(task.updatedAt || task.updated_at), 'agent-updated'));
  }

  row.append(main);
  row.append(meta);
  return row;
}

function createApprovalCard(approval) {
  const card = document.createElement('div');
  card.className = 'agent-approval-card';
  card.dataset.approvalId = approval.id;
  card.dataset.taskId = approval.taskId || approval.task_id || '';

  const header = document.createElement('div');
  header.className = 'agent-card-header';
  header.append(createText('div', 'Approval required', 'agent-card-title'));
  header.append(createText('span', approval.riskLevel || approval.risk_level || 'high', 'agent-risk'));

  card.append(header);
  card.append(createText('pre', approval.command || '', 'agent-approval-command'));
  card.append(createText('div', approval.reason || '', 'agent-approval-reason'));
  card.append(createText('pre', approval.diffSummary || approval.diff_summary || '', 'agent-approval-diff'));

  const actions = document.createElement('div');
  actions.className = 'agent-approval-actions';
  actions.append(createApprovalButton(approval.id, 'approved', 'Approve'));
  actions.append(createApprovalButton(approval.id, 'rejected', 'Reject'));
  card.append(actions);

  return card;
}

function createDeliveryCard(delivery) {
  const card = document.createElement('div');
  card.className = 'agent-delivery-card';
  card.dataset.taskId = delivery.taskId || delivery.task_id || '';

  const header = document.createElement('div');
  header.className = 'agent-card-header';
  header.append(createText('div', 'Delivery', 'agent-card-title'));
  header.append(createText('span', delivery.ciStatus || delivery.ci_status || 'pending', 'agent-ci-status'));
  card.append(header);

  card.append(createText('div', delivery.summary || '', 'agent-delivery-summary'));

  const prUrl = delivery.prUrl || delivery.pr_url;
  if (prUrl) {
    const link = createText('a', 'Open pull request', 'agent-delivery-link');
    link.setAttribute('href', prUrl);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    card.append(link);
  }

  return card;
}

function createApprovalButton(approvalId, action, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.approvalId = approvalId;
  button.dataset.approvalAction = action;
  button.textContent = label;
  return button;
}

function createEmptyState(text) {
  return createText('div', text, 'agent-empty-state');
}

function createText(tagName, textContent, className) {
  const el = document.createElement(tagName);
  el.className = className;
  el.textContent = textContent;
  return el;
}

function clearRoot(root) {
  root.innerHTML = '';
  if (Array.isArray(root.children)) {
    root.children.length = 0;
  }
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}
