(() => {
  const MATH_SIGNAL = /(\\(?:begin|frac|sqrt|sum|prod|int|lim|log|ln|sin|cos|tan|sec|csc|cot|vec|overline|underline|left|right|pi|theta|alpha|beta|gamma|Delta|infty)\b|\[\[[\s\S]*\]\]|[A-Za-z0-9)\]}]\s*[\^_]\s*(?:\{|[-+A-Za-z0-9])|[=<>]\s*\\)/;
  const DELIMITED_MATH = /(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$]+\$)/;
  const renderOptions = {
    throwOnError: false,
    strict: 'ignore',
    trust: false,
  };

  function looksLikeMath(value) {
    return MATH_SIGNAL.test(String(value || '')) || DELIMITED_MATH.test(String(value || ''));
  }

  function normalizeBracketMatrices(value) {
    return value.replace(/\[\[([\s\S]*?)\]\]/g, (match, body) => {
      const rows = body.split(/\]\s*,\s*\[/);
      if (rows.length < 2) return match;
      const matrixRows = rows.map(row => row.split(/\s*,\s*/).join(' & '));
      return `\\begin{bmatrix}${matrixRows.join(' \\\\ ')}\\end{bmatrix}`;
    });
  }

  function legacyTextToTex(value) {
    let text = normalizeBracketMatrices(String(value || '').trim())
      .replace(/%/g, '\\%')
      .replace(/\u2212/g, '-');
    const protectedTokens = [];
    const protect = token => {
      const index = protectedTokens.push(token) - 1;
      return `\uE000${index}\uE001`;
    };

    text = text.replace(/\\(?:begin|end)\{[^{}]+\}/g, protect);
    text = text.replace(/\\text\{[^{}]*\}/g, protect);
    text = text.replace(/\\[A-Za-z]+/g, protect);
    text = text.replace(/\b(sin|cos|tan|sec|csc|cot|log|ln|lim|det)\b/g, word => protect(`\\${word}`));
    text = text.replace(/\b[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*\b/g, phrase => `\\text{${phrase}}`);
    text = text.replace(/\uE000(\d+)\uE001/g, (match, index) => protectedTokens[Number(index)] || match);
    return text;
  }

  function renderValue(element, value, displayMode = false) {
    const raw = String(value || '').trim();
    if (!raw || !looksLikeMath(raw) || !window.katex) return false;

    try {
      if (DELIMITED_MATH.test(raw) && window.renderMathInElement) {
        element.textContent = raw;
        window.renderMathInElement(element, {
          ...renderOptions,
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
            { left: '$', right: '$', display: false },
          ],
        });
      } else {
        window.katex.render(legacyTextToTex(raw), element, { ...renderOptions, displayMode });
      }
      element.dataset.mathRendered = '1';
      return true;
    } catch {
      element.textContent = raw;
      delete element.dataset.mathRendered;
      return false;
    }
  }

  function renderStaticMath(root = document) {
    root.querySelectorAll('.math-content').forEach(element => {
      const raw = element.dataset.mathSource || element.textContent;
      renderValue(element, raw, element.dataset.mathDisplay === 'block');
    });
  }

  function bindMathInputs(root = document) {
    root.querySelectorAll('.math-input').forEach(input => {
      const preview = input.parentElement?.querySelector('.math-preview')
        || input.closest('[data-math-field]')?.querySelector('.math-preview');
      if (!preview) return;

      const update = () => {
        preview.textContent = '';
        const rendered = renderValue(preview, input.value, true);
        preview.classList.toggle('hidden', !rendered);
      };
      input.addEventListener('input', update);
      update();
    });
  }

  function initialize() {
    renderStaticMath();
    bindMathInputs();
  }

  window.SPVNMath = { looksLikeMath, renderValue, renderStaticMath, bindMathInputs };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
