/** One-time dismissible intro for a first-time viewer landing on the
 * console cold (e.g. a portfolio visitor) - explains what they're looking
 * at and what to watch for. Remembered via localStorage so it doesn't
 * reappear on every reload once dismissed. */

const DISMISSED_KEY = 'gnss-despoof:onboarding-dismissed';

export function buildOnboarding(): void {
  if (localStorage.getItem(DISMISSED_KEY) === '1') return;

  const backdrop = document.createElement('div');
  backdrop.className = 'onboarding-backdrop';
  backdrop.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-kicker">GNSS · DESPOOF</div>
      <h1>Simulated anti-spoofing console</h1>
      <p>
        You're watching a simulated receiver feed replay recorded GNSS spoofing and
        meaconing scenarios - no live hardware is attached. Watch for:
      </p>
      <ul>
        <li>The reported position drifting or jumping away from the <span class="ob-init">◆</span> initial fix</li>
        <li>A clock-offset anomaly opening up during a meaconing (relay) attack</li>
        <li>Correlation distortion smearing the per-satellite I/Q constellation</li>
        <li>Status escalating <span class="tnum">NOMINAL → MONITORING → ANOMALY → SPOOF DETECTED</span></li>
      </ul>
      <div class="onboarding-actions">
        <button id="onboarding-dismiss" type="button">Got it</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1');
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') dismiss();
  }
  document.addEventListener('keydown', onKey);
  backdrop.querySelector<HTMLButtonElement>('#onboarding-dismiss')!.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });
}
