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
  const sessionContext = formatTaskSessionContext(task);
  if (sessionContext) main.append(createText('div', sessionContext, 'agent-task-context'));

  const meta = document.createElement('div');
  meta.className = 'agent-task-meta';
  meta.append(createText('span', task.status || 'queued', 'agent-status'));
  meta.append(createText('span', task.riskLevel || task.risk_level || 'safe', 'agent-risk'));
  if (task.updatedAt || task.updated_at) {
    meta.append(createText('span', formatTimestamp(task.updatedAt || task.updated_at), 'agent-updated'));
  }

  row.append(main);
  row.append(meta);
  row.append(createTaskActionButton(task.id, 'cancel', 'Cancel'));
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
  card.append(createText('div', formatDeliveryMeta(delivery), 'agent-delivery-meta'));
  card.append(createText('div', formatDeliveryStatus(delivery), 'agent-delivery-status'));

  const links = document.createElement('div');
  links.className = 'agent-delivery-links';
  const prUrl = delivery.prUrl || delivery.pr_url;
  const ciUrl = delivery.ciUrl || delivery.ci_url;
  const previewUrl = delivery.previewUrl || delivery.preview_url;
  const deploymentUrl = delivery.deploymentUrl || delivery.deployment_url;
  if (prUrl) links.append(createDeliveryLink(prUrl, 'Pull request'));
  if (ciUrl) links.append(createDeliveryLink(ciUrl, 'CI'));
  if (previewUrl) links.append(createDeliveryLink(previewUrl, 'Preview'));
  if (deploymentUrl) links.append(createDeliveryLink(deploymentUrl, 'Deploy'));
  if (links.children.length) card.append(links);

  return card;
}

function createTaskActionButton(taskId, action, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'agent-task-action';
  button.dataset.taskId = taskId;
  button.dataset.taskAction = action;
  button.textContent = label;
  return button;
}

function createDeliveryLink(url, label) {
  const link = createText('a', label, 'agent-delivery-link');
  link.setAttribute('href', url);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  return link;
}

function formatDeliveryMeta(delivery) {
  const prNumber = delivery.prNumber || delivery.pr_number;
  const branch = delivery.branch || '';
  const commitSha = delivery.commitSha || delivery.commit_sha || '';
  return [
    prNumber ? `#${prNumber}` : '',
    branch,
    commitSha ? commitSha.slice(0, 7) : ''
  ].filter(Boolean).join(' · ');
}

function formatDeliveryStatus(delivery) {
  return [
    delivery.deliveryStatus || delivery.delivery_status || '',
    delivery.deploymentStatus || delivery.deployment_status || ''
  ].filter(Boolean).join(' · ');
}

function formatTaskSessionContext(task) {
  return [
    task.model ? `model ${task.model}` : '',
    task.projectPath || task.project_path || '',
    task.tmuxSession || task.tmux_session || ''
  ].filter(Boolean).join(' · ');
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
