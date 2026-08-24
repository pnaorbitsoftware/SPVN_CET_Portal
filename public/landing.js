(() => {
  const body = document.body;
  const header = document.getElementById('siteHeader');
  const intro = document.getElementById('introStage');
  const traveler = document.getElementById('travelLogo');
  const target = document.getElementById('brandTarget');
  const brandLogo = document.getElementById('brandLogo');
  const menuToggle = document.getElementById('menuToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  const campusPhoto = document.getElementById('campusPhoto');
  const campusVisual = document.getElementById('campusVisual');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let introComplete = false;

  function finishIntro() {
    if (introComplete) return;
    introComplete = true;
    body.classList.remove('intro-running');
    body.classList.add('page-ready');
    if (brandLogo) brandLogo.style.opacity = '1';
    if (intro) intro.hidden = true;
    if (traveler) traveler.style.display = 'none';
  }

  async function runIntro() {
    if (!intro || !traveler || !target || reducedMotion) {
      finishIntro();
      return;
    }
    body.classList.add('intro-running');
    intro.hidden = false;
    if (brandLogo) brandLogo.style.opacity = '0';

    try {
      const logoImage = traveler.querySelector('img');
      if (logoImage?.decode) await Promise.race([logoImage.decode(), new Promise(resolve => setTimeout(resolve, 700))]);
    } catch (_) {}

    await new Promise(resolve => setTimeout(resolve, 760));
    const start = traveler.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const dx = end.left + end.width / 2 - (start.left + start.width / 2);
    const dy = end.top + end.height / 2 - (start.top + start.height / 2);
    const scale = Math.min(end.width / start.width, end.height / start.height);

    const logoAnimation = traveler.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 1 },
    ], {
      duration: 1120,
      easing: 'cubic-bezier(.72,0,.18,1)',
      fill: 'forwards',
    });
    const stageAnimation = intro.animate([
      { opacity: 1 },
      { opacity: 1, offset: .34 },
      { opacity: 0 },
    ], {
      duration: 1200,
      easing: 'ease',
      fill: 'forwards',
    });

    await Promise.allSettled([logoAnimation.finished, stageAnimation.finished]);
    finishIntro();
  }

  function setHeaderState() {
    header?.classList.toggle('is-scrolled', window.scrollY > 18);
  }
  setHeaderState();
  window.addEventListener('scroll', setHeaderState, { passive: true });

  menuToggle?.addEventListener('click', () => {
    const willOpen = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(willOpen));
    header?.classList.toggle('menu-open', willOpen);
    if (mobileMenu) mobileMenu.hidden = !willOpen;
  });
  mobileMenu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    menuToggle?.setAttribute('aria-expanded', 'false');
    header?.classList.remove('menu-open');
    mobileMenu.hidden = true;
  }));

  campusPhoto?.addEventListener('error', () => campusVisual?.classList.add('image-unavailable'));

  const revealItems = document.querySelectorAll('[data-reveal]');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach(item => item.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .14, rootMargin: '0px 0px -5% 0px' });
    revealItems.forEach(item => observer.observe(item));
  }

  window.setTimeout(finishIntro, 3600);
  runIntro();
})();
