// Remembers the last blueprint, the selected book entry, print/view options and the camera in
// localStorage so a reload comes back to the same view.
const KEY = 'factorio2irl:v1';

export function loadSaved() {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function saveState(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: the page still works, it just won't restore */
  }
}

export function clearSaved() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
