(() => {
  const input = document.getElementById('aPw');
  const toggle = document.getElementById('adminPasswordToggle');

  toggle?.addEventListener('click', () => {
    const willShow = input?.type === 'password';
    if (input) input.type = willShow ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(willShow));
    toggle.setAttribute('aria-label', willShow ? 'Hide password' : 'Show password');
  });
})();
