// Read-only Claude advisor controls. Answers are shown as plain text; nothing
// here can send a machine command or change controller state.
export const ADVISOR_NOTE = 'Advice only. Claude cannot move or configure the machine. Your question, the live '
  + 'controller state and (if ticked) the loaded program are sent through the Claude Code login on this PC.';

export function mountAdvisorControls({ root, request }) {
  const section = document.createElement('details');
  section.className = 'native-advisor';
  section.innerHTML = `<summary>Ask Claude (advice only)</summary>
    <p class="native-note" data-advisor-note></p>
    <label>Question<textarea id="native-advisor-question" rows="4" maxlength="4000"
      placeholder="Why did the controller report ALARM 17?  ·  Is line 120 of this program safe?"></textarea></label>
    <label class="native-confirm"><input type="checkbox" id="native-advisor-program"> Include the loaded program</label>
    <div class="native-row"><button data-advisor-ask>Ask</button></div>
    <p class="native-advisor-status" role="status"></p>
    <div class="native-advisor-answer" aria-live="polite"></div>`;
  root.append(section);
  const $ = selector => section.querySelector(selector);
  $('[data-advisor-note]').textContent = ADVISOR_NOTE;
  let available = false, busy = false, loaded = false;

  const render = () => {
    $('[data-advisor-ask]').disabled = !available || busy || !$('#native-advisor-question').value.trim();
  };
  async function refreshStatus() {
    try {
      const status = await request('/api/advisor');
      available = status.available === true;
      $('.native-advisor-status').textContent = available ? 'Ready. Uses your Claude Code login.' : (status.reason ?? 'Advisor unavailable.');
    } catch (error) {
      available = false; $('.native-advisor-status').textContent = error.message;
    }
    render();
  }
  section.addEventListener('toggle', () => { if (section.open && !loaded) { loaded = true; void refreshStatus(); } });
  $('#native-advisor-question').addEventListener('input', render);
  $('[data-advisor-ask]').onclick = async () => {
    busy = true; render();
    $('.native-advisor-status').textContent = 'Asking Claude…';
    $('.native-advisor-answer').textContent = '';
    try {
      const result = await request('/api/advisor/ask', { question: $('#native-advisor-question').value,
        includeProgram: $('#native-advisor-program').checked });
      $('.native-advisor-answer').textContent = result.answer;
      $('.native-advisor-status').textContent = `Answered in ${Math.round((result.elapsedMs ?? 0) / 100) / 10} s · advice only, verify against the documents.`;
    } catch (error) {
      $('.native-advisor-status').textContent = error.message;
    } finally { busy = false; render(); }
  };
  render();
  return { refreshStatus };
}
