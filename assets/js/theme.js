(function () {
  'use strict';
  const key = 'hex_solar_theme';
  const choices = ['system', 'light', 'dark'];
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (choices.includes(saved)) preference = saved;
  } catch { /* The system theme remains available when storage is restricted. */ }

  function applyTheme() {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#171b1a' : '#f5f6f7');
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = preference; });
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const english = document.documentElement.lang === 'en';
      const label = theme === 'dark'
        ? (english ? 'Switch to light mode' : '\u5207\u63db\u81f3\u6dfa\u8272\u6a21\u5f0f')
        : (english ? 'Switch to dark mode' : '\u5207\u63db\u81f3\u6df1\u8272\u6a21\u5f0f');
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      const icon = theme === 'dark' ? 'sun' : 'moon';
      if (button.firstElementChild?.getAttribute('data-icon') !== icon) {
        const placeholder = document.createElement('span');
        placeholder.setAttribute('data-icon', icon);
        placeholder.setAttribute('aria-hidden', 'true');
        button.replaceChildren(placeholder);
      }
    });
    window.lucide?.createIcons({ nameAttr: 'data-icon', attrs: { 'aria-hidden': 'true', focusable: 'false' } });
    window.dispatchEvent(new CustomEvent('solar-theme-change', { detail: { theme, preference } }));
  }

  function setPreference(value) {
    preference = choices.includes(value) ? value : 'system';
    try { localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
    applyTheme();
  }

  // Resolve the palette before styles and page content paint.
  applyTheme();
  document.addEventListener('DOMContentLoaded', applyTheme);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-theme-toggle]')) {
      setPreference(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    }
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-theme-select]')) setPreference(event.target.value);
  });
  media.addEventListener('change', () => { if (preference === 'system') applyTheme(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = choices.includes(event.newValue) ? event.newValue : 'system';
    applyTheme();
  });
})();
