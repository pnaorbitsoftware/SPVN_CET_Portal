const storedPortalUrl = localStorage.getItem('spvnPortalUrl') || '';
const portalUrlInput = document.getElementById('portalUrl');
const errorElement = document.getElementById('error');

portalUrlInput.value = storedPortalUrl;

document.getElementById('openPortal').addEventListener('click', () => {
  const portalUrl = portalUrlInput.value.trim();
  try {
    const parsedUrl = new URL(portalUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Use an http or https portal URL.');
    localStorage.setItem('spvnPortalUrl', parsedUrl.href);
    window.location.assign(parsedUrl.href);
  } catch (error) {
    errorElement.textContent = error.message || 'Enter a valid portal URL.';
  }
});
