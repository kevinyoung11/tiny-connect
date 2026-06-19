import { createAgentApi } from './agent-api.js';
import {
  renderAgentApprovals,
  renderAgentDelivery,
  renderAgentOutputTail,
  renderAgentTasks
} from './agent-ui.js';

export function initAgentConsole({ withIdentity = (init) => init, toast = () => {} } = {}) {
  const agentOpenButtons = [...document.querySelectorAll('[data-agent-open]')];
  const sheet = document.querySelector('#agentSheet');
  const closeBtn = document.querySelector('#closeAgentSheet');
  const form = document.querySelector('#agentTaskForm');
  const inputForm = document.querySelector('#agentInputForm');
  const startButton = form?.querySelector('button[type="submit"]');
  const sendButton = inputForm?.querySelector('button[type="submit"]');
  const kindInput = document.querySelector('#agentKind');
  const modelInput = document.querySelector('#agentModel');
  const projectPathInput = document.querySelector('#agentProjectPath');
  const promptInput = document.querySelector('#agentPrompt');
  const taskInput = document.querySelector('#agentInput');
  const taskList = document.querySelector('#agentTaskList');
  const approvalList = document.querySelector('#agentApprovalList');
  const output = document.querySelector('#agentOutput');
  const delivery = document.querySelector('#agentDelivery');
  if (!agentOpenButtons.length || !sheet || !form) return null;

  const api = createAgentApi({ withIdentity });
  let selectedTaskId = '';
  let pollTimer = null;

  async function refresh() {
    const shouldFollowOutput = isNearBottom(output);
    const snapshot = await api.fetchSnapshot();
    const tasks = snapshot.tasks || [];
    const approvals = snapshot.approvals || [];
    if (!selectedTaskId && tasks[0]) selectedTaskId = tasks[0].id;
    renderAgentTasks(taskList, tasks, { selectedTaskId });
    renderAgentApprovals(approvalList, approvals);
    const selected = tasks.find((task) => task.id === selectedTaskId) || tasks[0];
    renderAgentOutputTail(output, selected?.outputTail || '');
    if (shouldFollowOutput) scrollToBottom(output);
    renderAgentDelivery(delivery, selected?.delivery || null);
  }

  function open() {
    sheet.removeAttribute('hidden');
    requestAnimationFrame(() => sheet.classList.add('open'));
    refresh().catch((error) => toast(error.message, 'err'));
    clearInterval(pollTimer);
    pollTimer = setInterval(() => refresh().catch(() => {}), 4000);
  }

  function close() {
    sheet.classList.remove('open');
    clearInterval(pollTimer);
    pollTimer = null;
    setTimeout(() => sheet.setAttribute('hidden', ''), 220);
  }

  for (const button of agentOpenButtons) button.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  taskList?.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-task-action]');
    if (action?.dataset.taskAction === 'cancel') {
      await api.cancelTask(action.dataset.taskId);
      await refresh();
      return;
    }
    const row = event.target.closest('[data-task-id]');
    if (!row) return;
    selectedTaskId = row.dataset.taskId;
    refresh().catch((error) => toast(error.message, 'err'));
  });
  approvalList?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-approval-action]');
    if (!button) return;
    try {
      await api.resolveApproval(button.dataset.approvalId, button.dataset.approvalAction);
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      await refresh();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = promptInput.value.trim();
    if (!prompt) {
      toast('Task prompt is required.', 'err');
      return;
    }
    setButtonBusy(startButton, true, 'Starting...');
    try {
      const result = await api.startTask({
        kind: kindInput.value,
        prompt,
        title: prompt,
        model: modelInput.value.trim(),
        projectPath: projectPathInput.value.trim()
      });
      selectedTaskId = result.task?.id || selectedTaskId;
      promptInput.value = '';
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setButtonBusy(startButton, false);
      await refresh();
    }
  });
  inputForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = taskInput?.value || '';
    if (!selectedTaskId && input.trim()) {
      toast('Select a task before sending input.', 'err');
      return;
    }
    if (!input.trim()) {
      toast('Input is required.', 'err');
      return;
    }
    if (!selectedTaskId) {
      toast('Select a task before sending input.', 'err');
      return;
    }
    setButtonBusy(sendButton, true, 'Sending...');
    try {
      await api.sendInput(selectedTaskId, input);
      taskInput.value = '';
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setButtonBusy(sendButton, false);
      await refresh();
    }
  });

  return { open, close, refresh };
}

function isNearBottom(element, threshold = 24) {
  if (!element) return false;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function scrollToBottom(element) {
  if (!element) return;
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
    return;
  }
  button.textContent = button.dataset.idleLabel || button.textContent;
  delete button.dataset.idleLabel;
  button.disabled = false;
}
