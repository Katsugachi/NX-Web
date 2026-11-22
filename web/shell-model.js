// SPDX-License-Identifier: GPL-3.0-or-later
export function recentGames(raw) {
  try {
    const entries = JSON.parse(raw ?? '[]');
    return Array.isArray(entries) ? entries.filter(item => item && typeof item.name === 'string'
      && Number.isFinite(item.size) && item.size >= 0).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function rememberGame(entries, file) {
  return [{ name: file.name, size: file.size }, ...entries.filter(item => item.name !== file.name)].slice(0, 6);
}

export function compatibilityProblems(checks) {
  return checks.filter(check => check.required && check.status === 'fail');
}

export function runtimeProblem(state = '') {
  if (state.includes('eden.js not found')) return 'Engine files are missing. Run npm run build:engine, then reload.';
  if (state.startsWith('Error:')) return `${state}. See Settings → Diagnostics for details.`;
  if (state.startsWith('This browser cannot') || state.startsWith('Reload once')) return state;
  return '';
}
