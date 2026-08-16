(() => {
  try {
    const theme = localStorage.getItem('theme');
    if (theme) document.documentElement.setAttribute('data-theme', theme);
  } catch {
    // Storage can be unavailable in hardened/private browsing contexts.
  }
})();
