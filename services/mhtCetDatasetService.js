const crypto = require('node:crypto');

const SOURCE_INDEX_URL = 'https://docs.aglasem.com/org/maharashtra-state-common-entrance-test-cell/mht-cet/question-paper';
const OFFICIAL_PORTAL_URL = 'https://cetcell.mahacet.org/';

function aglasemPdfUrl(documentId) {
  return `https://cdn.aglasem.com/aglasem-doc/${documentId}/${documentId}.pdf`;
}

const SOURCES = [
  {
    code:'MHT_CET_2015_PCB',
    year:2015,
    variant:'MHT-CET PCB',
    paper:'MHT-CET 2015 PCB · Version 11',
    questionDocumentId:'233a1bf2-f6f1-11eb-8fe3-0a5e36bc6706',
    answerDocumentId:'229e0c10-f6f3-11eb-b0d3-0a5e36bc6706',
    questionSha256:'0110152db82f508c0d591a5a201035538216e7a2f09997998a504814c1608867',
    answerSha256:'95686fd313726f279ed17ad45e50c4847561eeeded6aa179624ba219ac006e15',
    expectedQuestions:200,
    subjectForNumber(number) {
      if (number <= 50) return 'Physics';
      if (number <= 100) return 'Chemistry';
      return 'Biology';
    },
    marksForSubject:() => 1,
  },
  {
    code:'MHT_CET_2016_PC',
    year:2016,
    variant:'MHT-CET PCM',
    paper:'MHT-CET 2016 Physics & Chemistry · Version 11',
    questionDocumentId:'22f56af2-f6f1-11eb-8209-0a5e36bc6706',
    answerDocumentId:'22a4bbdc-f6f3-11eb-b708-0a5e36bc6706',
    questionSha256:'ee8e77c188614004376138a38b3877a79594d2490740127f3e18081dd5028146',
    answerSha256:'2dd3d6693eeb39e25aa3041280d8cc08ecd8defa21b5fd992d0642ab6554a201',
    expectedQuestions:100,
    subjectForNumber:number => number <= 50 ? 'Physics' : 'Chemistry',
    marksForSubject:() => 1,
  },
  {
    code:'MHT_CET_2016_MATH',
    year:2016,
    variant:'MHT-CET PCM',
    paper:'MHT-CET 2016 Mathematics · Version 11',
    questionDocumentId:'235ca942-f6f1-11eb-841e-0a5e36bc6706',
    answerDocumentId:'22a22e1c-f6f3-11eb-8b0a-0a5e36bc6706',
    questionSha256:'3a71da95b1d4ce4668f24dad55b4f14d6c43b6c3c3bbc0f04c51ffad2c4b3728',
    answerSha256:'30672e3c2dddee84464035238f3a1fe8fee3b0beb291eb6c4a6de7fb1f4948ae',
    expectedQuestions:50,
    subjectForNumber:() => 'Mathematics',
    marksForSubject:() => 2,
  },
  {
    code:'MHT_CET_2019_PCMB',
    year:2019,
    variant:'MHT-CET PCMB',
    paper:'MHT-CET 2019 PCMB · 12 May response paper',
    questionDocumentId:'4425ad24-f6ef-11eb-99fb-0a5e36bc6706',
    questionSha256:'93c42c52a8d5590a69933de117e88597ebbe5c55fa1f8182c79be8fefe53f097',
    expectedQuestions:250,
    responseSheet:true,
    marksForSubject:subject => subject === 'Mathematics' ? 2 : 1,
  },
].map(source => ({
  ...source,
  questionUrl:aglasemPdfUrl(source.questionDocumentId),
  ...(source.answerDocumentId ? { answerUrl:aglasemPdfUrl(source.answerDocumentId) } : {}),
  pageUrl:`https://docs.aglasem.com/view/${source.questionDocumentId}`,
}));

const TOPIC_RULES = {
  Physics:[
    ['Units and Measurements', 'Dimensions and measurement', /dimension|unit|measurement|significant figure|error/i],
    ['Rotational Dynamics', 'Rotation, torque and angular momentum', /moment of inertia|angular momentum|torque|rolling|rotational|wheel|disc|ring/i],
    ['Mechanical Properties of Fluids', 'Surface tension and fluid flow', /surface tension|capillary|viscos|bernoulli|liquid drop|fluid/i],
    ['Oscillations', 'Simple harmonic motion', /simple harmonic|s\.h\.m|oscillat|spring constant|pendulum/i],
    ['Wave Motion', 'Sound, strings and wave motion', /sound|sonometer|organ pipe|string|wave|frequency|beats|doppler|whistle/i],
    ['Thermal Physics', 'Heat and thermodynamics', /thermodynamic|adiabatic|isothermal|heat|temperature|specific heat|gas law|boltzmann|stefan/i],
    ['Electrostatics', 'Electric field, potential and capacitance', /electrostatic|electric field|electric flux|potential difference|capacitor|capacit|coulomb/i],
    ['Current Electricity', 'Circuits and electrical instruments', /current|resistance|resistivity|galvanometer|ammeter|voltmeter|metre bridge|wheatstone|cell|battery/i],
    ['Magnetic Effects of Current', 'Magnetic field and induction', /magnetic|inductor|inductance|solenoid|cyclotron|lorentz/i],
    ['Electromagnetic Induction', 'Induction and alternating current', /induced|induction|alternating current|a\.c\.|transformer|reactance|resonance/i],
    ['Ray Optics', 'Mirrors, lenses and optical instruments', /lens|mirror|refractive|refraction|optical|prism|image formed/i],
    ['Wave Optics', 'Interference, diffraction and polarisation', /interference|diffraction|polarisation|young.?s double slit/i],
    ['Dual Nature of Radiation', 'Photoelectric effect and matter waves', /photoelectric|de broglie|photon|work function/i],
    ['Atoms and Nuclei', 'Atomic and nuclear physics', /bohr|nucleus|nuclear|radioactive|half-life|binding energy|isotope|satellite/i],
    ['Semiconductor Devices', 'Semiconductors and digital electronics', /semiconductor|transistor|diode|logic gate|p-type|n-type/i],
    ['Gravitation', 'Gravitation and satellites', /gravit|satellite|escape velocity|planet|earth.?s surface/i],
    ['Laws of Motion', 'Force and linear motion', /newton|friction|projectile|velocity|acceleration|force|momentum|work done|kinetic energy/i],
  ],
  Chemistry:[
    ['Some Basic Concepts of Chemistry', 'Mole concept and stoichiometry', /mole|molar mass|stoichiometr|avogadro|empirical formula|molecular formula/i],
    ['Atomic Structure', 'Atomic models and quantum numbers', /atomic structure|quantum number|orbital|electron configuration|bohr/i],
    ['Chemical Bonding', 'Bonding and molecular structure', /chemical bond|hybridi|bond angle|vsepr|molecular shape|dipole moment/i],
    ['States of Matter', 'Gases and liquids', /ideal gas|real gas|vapour pressure|gas equation|compressibility/i],
    ['Thermodynamics', 'Chemical thermodynamics', /enthalpy|entropy|gibbs|thermochem|heat of reaction/i],
    ['Chemical Equilibrium', 'Ionic and chemical equilibrium', /equilibrium|ph\b|buffer|solubility product|dissociation|hydrolysis/i],
    ['Electrochemistry', 'Cells and electrolysis', /electrochem|electrode|electrolysis|faraday|cell potential|reduction potential/i],
    ['Chemical Kinetics', 'Rates and reaction order', /reaction rate|rate constant|order of reaction|activation energy|half-life/i],
    ['Solutions', 'Concentration and colligative properties', /solution|molality|molarity|osmotic|colligative|henry.?s law|raoult/i],
    ['Solid State', 'Crystal structure and solids', /crystal|unit cell|solid state|packing efficiency|lattice/i],
    ['Coordination Compounds', 'Coordination chemistry', /coordination|ligand|complex compound|crystal field/i],
    ['Organic Chemistry', 'Organic principles and reactions', /organic|isomer|iupac|nucleophile|electrophile|hydrocarbon|alkane|alkene|alkyne/i],
    ['Alcohols, Phenols and Ethers', 'Alcohols, phenols and ethers', /alcohol|phenol|ether/i],
    ['Aldehydes, Ketones and Carboxylic Acids', 'Carbonyl compounds', /aldehyde|ketone|carboxylic|carbonyl/i],
    ['Amines', 'Amines and diazonium salts', /amine|diazonium|aniline/i],
    ['Biomolecules', 'Biomolecules and polymers', /carbohydrate|protein|amino acid|vitamin|polymer|enzyme/i],
    ['p-Block Elements', 'p-block chemistry', /p-block|halogen|noble gas|group 1[3-8]/i],
    ['d- and f-Block Elements', 'Transition and inner-transition elements', /transition element|d-block|f-block|lanthan|actin/i],
  ],
  Mathematics:[
    ['Mathematical Logic', 'Statements and logic', /truth value|tautology|logical|negation|statement/i],
    ['Matrices and Determinants', 'Matrices and determinants', /matrix|matrices|determinant|adjoint/i],
    ['Trigonometric Functions', 'Trigonometry', /sin|cos|tan|cosec|sec\b|cot\b|trigonom/i],
    ['Pair of Straight Lines', 'Lines in two dimensions', /straight line|pair of lines|slope|bisect.*angle/i],
    ['Vectors', 'Vector algebra', /vector|dot product|cross product|scalar triple/i],
    ['Three Dimensional Geometry', 'Lines and planes in space', /direction cosine|direction ratio|plane|three dimensional|3d|coplanar/i],
    ['Differentiation', 'Derivatives and differentiability', /derivative|differentiat|rolle|mean value theorem/i],
    ['Applications of Derivatives', 'Tangents, normals and extrema', /maximum|minimum|increasing|decreasing|tangent|normal|rate of change/i],
    ['Integration', 'Indefinite and definite integration', /integral|integrate|∫|area bounded/i],
    ['Differential Equations', 'Differential equations', /differential equation|order and degree/i],
    ['Probability', 'Probability distributions', /probability|binomial distribution|random variable|variance|expectation/i],
    ['Complex Numbers', 'Complex numbers', /complex number|argand|modulus.*complex|imaginary/i],
    ['Sequences and Series', 'Sequences and series', /sequence|series|arithmetic progression|geometric progression|a\.p\.|g\.p\./i],
    ['Conic Sections', 'Circle, parabola, ellipse and hyperbola', /circle|parabola|ellipse|hyperbola|conic/i],
  ],
  Biology:[
    ['Cell Biology', 'Cell structure and division', /cell|mitosis|meiosis|organelle|chromosome|membrane/i],
    ['Genetics and Evolution', 'Inheritance and evolution', /genetic|inherit|mendel|allele|mutation|evolution|dna|rna|gene/i],
    ['Plant Physiology', 'Plant functions and transport', /photosynth|transpiration|plant hormone|xylem|phloem|stomata|photoperiod/i],
    ['Human Physiology', 'Human organ systems', /human|heart|blood|kidney|nephron|hormone|digestion|respiration|nerve|brain|muscle/i],
    ['Reproduction', 'Plant and human reproduction', /reproduction|fertili|embryo|gamete|pollination|menstrual|sperm|ovum/i],
    ['Biotechnology', 'Biotechnology and its applications', /biotechnology|recombinant|pcr|cloning|restriction enzyme|plasmid/i],
    ['Ecology and Environment', 'Ecology and ecosystems', /ecology|ecosystem|biodiversity|pollution|population|food chain|environment/i],
    ['Microbes and Human Welfare', 'Microorganisms and applications', /microbe|bacteria|virus|fungus|fermentation|pathogen/i],
    ['Plant Diversity', 'Plant kingdom and classification', /algae|bryophyte|pteridophyte|gymnosperm|angiosperm|plant kingdom/i],
    ['Animal Diversity', 'Animal kingdom and classification', /animal kingdom|invertebrate|vertebrate|arthropod|mollusc|chordate/i],
    ['Health and Disease', 'Immunity and disease', /disease|immunity|antibody|vaccine|cancer|aids|malaria/i],
  ],
};

function cleanText(value = '') {
  return String(value)
    .replace(/AglaSem Admission/gi, ' ')
    .replace(/SPACE FOR ROUGH WORK/gi, ' ')
    .replace(/\bBIIB\s+-?\s*\d+\s*-?\s*11\b/gi, ' ')
    .replace(/\b11\s+-?\s*\d+\s*-?\s*BIIB\b/gi, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:?])/g, '$1')
    .replace(/\s+\)/g, ')')
    .replace(/°\s+C\b/g, '°C')
    .trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fingerprint(question) {
  return sha256(String(question).toLocaleLowerCase().replace(/\s+/g, ' ').trim());
}

function groupPageItems(items, tolerance = 1.5) {
  const rows = [];
  for (const item of items) {
    const text = String(item.str || '').trim();
    if (!text) continue;
    const y = Number(item.transform?.[5] || 0);
    const x = Number(item.transform?.[4] || 0);
    let row = rows.find(candidate => Math.abs(candidate.y - y) < tolerance);
    if (!row) {
      row = { y, parts:[] };
      rows.push(row);
    }
    row.parts.push({ x, text });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => cleanText(row.parts.sort((a, b) => a.x - b.x).map(part => part.text).join(' ')))
    .filter(Boolean);
}

async function pdfLines(pdfBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data:new Uint8Array(pdfBuffer),
    useSystemFonts:true,
    isEvalSupported:false,
    verbosity:0,
  });
  try {
    const document = await task.promise;
    const lines = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      lines.push(...groupPageItems(content.items));
    }
    return lines;
  } finally {
    await task.destroy().catch(() => {});
  }
}

function groupPageLayoutItems(items, tolerance = 1.5) {
  const rows = [];
  for (const item of items) {
    const text = String(item.str || '').trim();
    if (!text) continue;
    const y = Number(item.transform?.[5] || 0);
    const x = Number(item.transform?.[4] || 0);
    let row = rows.find(candidate => Math.abs(candidate.y - y) < tolerance);
    if (!row) {
      row = { y, parts:[] };
      rows.push(row);
    }
    row.parts.push({ x, text });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => ({
      y:row.y,
      parts:row.parts.sort((a, b) => a.x - b.x),
      text:cleanText(row.parts.map(part => part.text).join(' ')),
    }))
    .filter(row => row.text);
}

function greenRowGroups(imageData, width, height, scale = 2) {
  const activeRows = [];
  const fromX = Math.max(0, Math.round(40 * scale));
  const toX = Math.min(width, Math.round(135 * scale));
  for (let y = 0; y < height; y += 1) {
    let greenPixels = 0;
    for (let x = fromX; x < toX; x += 1) {
      const offset = (y * width + x) * 4;
      const red = imageData[offset];
      const green = imageData[offset + 1];
      const blue = imageData[offset + 2];
      if (green > 75 && green - red > 24 && green - blue > 18 && green > red * 1.15) {
        greenPixels += 1;
      }
    }
    if (greenPixels >= 3) activeRows.push({ y, greenPixels });
  }

  const groups = [];
  activeRows.forEach(row => {
    let group = groups.at(-1);
    if (!group || row.y - group.at(-1).y > 3) {
      group = [];
      groups.push(group);
    }
    group.push(row);
  });
  return groups
    .filter(group => group.length >= 3 && Math.max(...group.map(row => row.greenPixels)) >= 7)
    .map(group => group.reduce((sum, row) => sum + row.y, 0) / group.length);
}

async function responsePageLayouts(pdfBuffer, dependencies = {}) {
  const pdfjs = dependencies.pdfjs || await import('pdfjs-dist/legacy/build/pdf.mjs');
  const canvasModule = dependencies.canvasModule || require('@napi-rs/canvas');
  const renderScale = dependencies.renderScale || 2;
  const task = pdfjs.getDocument({
    data:new Uint8Array(pdfBuffer),
    useSystemFonts:true,
    isEvalSupported:false,
    verbosity:0,
  });
  try {
    const document = await task.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale:renderScale });
      const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvasContext:context, viewport }).promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const greenCanvasRows = greenRowGroups(pixels, canvas.width, canvas.height, renderScale);
      pages.push({
        pageNumber,
        height:viewport.height / renderScale,
        rows:groupPageLayoutItems(content.items),
        greenRows:greenCanvasRows.map(y => (viewport.height - y) / renderScale),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy().catch(() => {});
  }
}

function parseResponseQuestionHeader(text) {
  const match = String(text).match(/^Q\.(\d{1,3})(?:\s+(\d)(?:\s+(\d))?)?(?:\s+|$)(.*)$/i);
  if (!match) return null;
  const suffix = [match[2], match[3]].filter(Boolean).join('');
  const number = Number(`${match[1]}${suffix}`);
  if (!Number.isInteger(number) || number < 1 || number > 200) return null;
  return { number, text:cleanText(match[4]) };
}

function responseAnswerForOptions(optionRows, pages) {
  const candidates = optionRows.map(option => {
    const page = pages[option.pageNumber - 1];
    const nearest = page.greenRows.reduce((best, greenY) => {
      const distance = Math.abs(greenY - option.y);
      return !best || distance < best.distance ? { distance, greenY } : best;
    }, null);
    return { ...option, distance:nearest?.distance ?? Infinity };
  }).filter(option => option.distance <= 9);
  if (candidates.length !== 1) return null;
  return ['A','B','C','D'][candidates[0].number - 1];
}

function mergeInlineScriptRows(rows) {
  const subscriptDigits = { '0':'₀', '1':'₁', '2':'₂', '3':'₃', '4':'₄', '5':'₅', '6':'₆', '7':'₇', '8':'₈', '9':'₉' };
  const superscriptDigits = { '0':'⁰', '1':'¹', '2':'²', '3':'³', '4':'⁴', '5':'⁵', '6':'⁶', '7':'⁷', '8':'⁸', '9':'⁹' };
  const prepared = rows.map(original => ({
    ...original,
    parts:original.parts?.map(part => ({ ...part })) || null,
  }));
  const attach = (target, scriptParts, digitMap, superscript = false) => {
    scriptParts.forEach(scriptPart => {
      let insertionIndex = target.parts.findIndex(part => part.x > scriptPart.x);
      if (insertionIndex < 0) insertionIndex = target.parts.length;
      const targetIndex = Math.max(0, insertionIndex - 1);
      const followingText = target.parts[insertionIndex]?.text || '';
      const symbol = superscript && scriptPart.text === '0' && /^C(?:\b|\/)/.test(followingText)
        ? '°'
        : digitMap[scriptPart.text];
      target.parts[targetIndex].text += symbol;
    });
    target.text = cleanText(target.parts.map(part => part.text).join(' '));
  };

  for (let index = 0; index < prepared.length; index += 1) {
    const row = prepared[index];
    if (!row.parts?.length) continue;
    const partCountBeforeSuffixCleanup = row.parts.length;
    row.parts = row.parts.filter(part => !(/^\d$/.test(part.text) && part.x >= 47 && part.x <= 58));
    if (row.parts.length !== partCountBeforeSuffixCleanup) {
      row.text = cleanText(row.parts.map(part => part.text).join(' '));
    }
    if (!row.parts.length) {
      prepared[index] = null;
      continue;
    }
    const scriptParts = row.parts.every(part => /^\d$/.test(part.text) && part.x > 58) ? row.parts : null;
    const previous = [...prepared.slice(0, index)].reverse().find(Boolean);
    const next = prepared.slice(index + 1).find(Boolean);
    const nextDistance = next && next.pageNumber === row.pageNumber ? row.y - next.y : Infinity;
    const previousDistance = previous && previous.pageNumber === row.pageNumber ? previous.y - row.y : Infinity;
    const inlineSuperscripts = row.parts.filter(part => /^\d$/.test(part.text) && part.x > 58);
    const nonScriptParts = row.parts.filter(part => !inlineSuperscripts.includes(part));
    if (
      inlineSuperscripts.length
      && nonScriptParts.length
      && /^Ans\b/i.test(nonScriptParts.map(part => part.text).join(' '))
      && next?.parts?.length
      && nextDistance >= 0.5
      && nextDistance <= 4.5
    ) {
      attach(next, inlineSuperscripts, superscriptDigits, true);
      row.parts = nonScriptParts;
      row.text = cleanText(row.parts.map(part => part.text).join(' '));
      continue;
    }
    if (!scriptParts) continue;
    if (next?.parts?.length && nextDistance >= 0.5 && nextDistance <= 4.5) {
      attach(next, scriptParts, superscriptDigits, true);
      prepared[index] = null;
    } else if (previous?.parts?.length && previousDistance >= 0.5 && previousDistance <= 4.5) {
      attach(previous, scriptParts, subscriptDigits);
      prepared[index] = null;
    }
  }
  return prepared.filter(Boolean);
}

function extractResponseQuestions(pages, expectedQuestions) {
  const blocks = [];
  let subject = null;
  let current = null;
  const subjectQuestionCounts = new Map();
  const finish = () => {
    if (current) blocks.push(current);
    current = null;
  };

  pages.forEach(page => {
    const pageRows = mergeInlineScriptRows(page.rows.map(row => ({ ...row, pageNumber:page.pageNumber })));
    pageRows.forEach(row => {
      const section = row.text.match(/^Section\s*:\s*(Physics|Chemistry|Mathematics|Biology)\b/i);
      if (section) subject = section[1][0].toUpperCase() + section[1].slice(1).toLowerCase();
      const header = parseResponseQuestionHeader(row.text);
      if (header) {
        finish();
        const nextNumber = (subjectQuestionCounts.get(subject) || 0) + 1;
        subjectQuestionCounts.set(subject, nextNumber);
        current = {
          number:nextNumber,
          printedNumber:header.number,
          subject,
          sourcePage:page.pageNumber,
          rows:[],
          headerText:header.text,
        };
      }
      if (current) current.rows.push(row);
    });
  });
  finish();

  const parsed = [];
  blocks.forEach(block => {
    if (!block.subject) return;
    const answerIndex = block.rows.findIndex(row => /^Ans\b/i.test(row.text));
    const metadataIndex = block.rows.findIndex(row => /^Question Type\s*:/i.test(row.text));
    if (answerIndex < 0 || metadataIndex <= answerIndex) return;
    const questionContentRows = mergeInlineScriptRows(block.rows.slice(0, answerIndex)
      .map(row => ({ ...row }))
      .filter(row => !/^aglasem\.com$/i.test(row.text)));
    const mergedHeader = parseResponseQuestionHeader(questionContentRows[0]?.text || '');
    const questionRows = questionContentRows.slice(1);
    const question = cleanText([mergedHeader?.text || block.headerText, ...questionRows.map(row => row.text)].filter(Boolean).join(' '));
    const optionRows = [];
    const options = {};
    let activeOption = null;
    mergeInlineScriptRows(block.rows.slice(answerIndex + 1, metadataIndex)).forEach(row => {
      if (/^aglasem\.com$/i.test(row.text)) return;
      const option = row.text.match(/^([1-4])\.\s*(.*)$/);
      if (option) {
        activeOption = Number(option[1]);
        options[activeOption] = cleanText(option[2]);
        optionRows.push({ number:activeOption, pageNumber:row.pageNumber, y:row.y });
      } else if (activeOption) {
        options[activeOption] = cleanText(`${options[activeOption]} ${row.text}`);
      }
    });
    const sourceIdRow = block.rows.find(row => /^Question ID\s*:/i.test(row.text));
    const sourceId = sourceIdRow?.text.match(/:\s*(\d+)/)?.[1] || null;
    const answer = responseAnswerForOptions(optionRows, pages);
    if (!sourceId || !question || Object.keys(options).length !== 4) return;
    parsed.push({
      number:block.number,
      subject:block.subject,
      sourceId,
      sourcePage:block.sourcePage,
      question,
      options:{ A:options[1], B:options[2], C:options[3], D:options[4] },
      answer,
    });
  });

  const bySourceId = new Map();
  parsed.forEach(block => {
    if (!bySourceId.has(block.sourceId)) bySourceId.set(block.sourceId, block);
  });
  if (bySourceId.size > expectedQuestions) {
    throw new Error(`Response parser produced ${bySourceId.size} questions; expected at most ${expectedQuestions}`);
  }
  return [...bySourceId.values()];
}

function sequentialOptionMarkers(block) {
  const markers = [];
  let cursor = 0;
  for (const label of ['A','B','C','D']) {
    const expression = new RegExp(`\\b${label}\\)\\s*`, 'g');
    expression.lastIndex = cursor;
    const match = expression.exec(block);
    if (!match) return [];
    markers.push({ label, index:match.index, end:expression.lastIndex });
    cursor = expression.lastIndex;
  }
  return markers;
}

function extractQuestionBlocks(lines, expectedQuestions) {
  const text = lines.join('\n');
  const starts = [...text.matchAll(/(?:^|\n)(\d{1,3})\.\s+/g)];
  const candidates = [];
  starts.forEach((start, index) => {
    const number = Number(start[1]);
    if (number < 1 || number > expectedQuestions) return;
    const offset = start[0].startsWith('\n') ? 1 : 0;
    const from = start.index + offset;
    const to = index + 1 < starts.length ? starts[index + 1].index : text.length;
    const raw = cleanText(text.slice(from, to).replace(/\n/g, ' '));
    const markers = sequentialOptionMarkers(raw);
    if (markers.length !== 4) return;
    const question = cleanText(raw.slice(raw.indexOf('.') + 1, markers[0].index));
    const options = {};
    markers.forEach((marker, markerIndex) => {
      const end = markerIndex + 1 < markers.length ? markers[markerIndex + 1].index : raw.length;
      options[marker.label] = cleanText(raw.slice(marker.end, end));
    });
    candidates.push({ number, question, options, raw });
  });

  const byNumber = new Map();
  candidates.forEach(candidate => {
    const existing = byNumber.get(candidate.number);
    const candidateScore = candidate.question.length + Object.values(candidate.options).join('').length;
    const existingScore = existing ? existing.question.length + Object.values(existing.options).join('').length : -1;
    if (!existing || candidateScore > existingScore) byNumber.set(candidate.number, candidate);
  });
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

function extractAnswerKey(lines, expectedQuestions) {
  const answerMap = new Map();
  const text = lines.join(' ');
  for (const match of text.matchAll(/\b(\d{1,3})\s+([A-D])\b/g)) {
    const number = Number(match[1]);
    if (number >= 1 && number <= expectedQuestions && !answerMap.has(number)) {
      answerMap.set(number, match[2]);
    }
  }
  return answerMap;
}

function inferTopic(subject, text) {
  const rule = (TOPIC_RULES[subject] || []).find(([, , expression]) => expression.test(text));
  return rule
    ? { topic:rule[0], subtopic:rule[1] }
    : { topic:`General ${subject}`, subtopic:'Mixed syllabus application' };
}

function questionSubType(question) {
  if (/assertion.{0,20}reason/i.test(question)) return 'assertion_reason';
  if (/match\s+(?:the\s+)?(?:following|column|list)/i.test(question)) return 'match_based';
  if (/statement\s*(?:i|1|one|a)/i.test(question)) return 'statement_based';
  if (/calculate|find\s+the\s+(?:value|number|ratio|magnitude)|how\s+many|what is the (?:value|ratio)/i.test(question)) return 'numerical';
  if (/equation|expression|formula/i.test(question)) return 'formula_based';
  return 'conceptual';
}

function complexityScore(value) {
  const symbols = (value.question.match(/[=<>^√∫Σπ]|\b(?:sin|cos|tan|log)\b/gi) || []).length;
  const optionLength = ['A','B','C','D'].reduce((sum, key) => sum + String(value[`option${key}`] || '').length, 0);
  return value.question.length + optionLength * 0.25 + symbols * 20;
}

function qualityError(block, answer) {
  if (!answer) return 'missing-answer';
  if (block.question.length < 18) return 'short-question';
  if (block.question.length > 1200) return 'long-question';
  const options = Object.values(block.options);
  if (options.some(option => !option || option.length > 320)) return 'invalid-options';
  if (new Set(options.map(option => option.toLocaleLowerCase())).size !== 4) return 'duplicate-options';
  if (/\b(?:figure|diagram)\b|\bgraph\b\s+(?:shown|given)|circuit\s+(?:shown|given)/i.test(block.question)) {
    return 'visual-dependent';
  }
  return null;
}

function normalizeQuestion(source, block, answer) {
  const error = qualityError(block, answer);
  if (error) return { error };
  const subject = block.subject || source.subjectForNumber(block.number);
  const hierarchy = inferTopic(subject, `${block.question} ${Object.values(block.options).join(' ')}`);
  const sourceFingerprint = fingerprint(block.question);
  const value = {
    sourceType:'PYQ',
    course:['CET'],
    question:block.question,
    optionA:block.options.A,
    optionB:block.options.B,
    optionC:block.options.C,
    optionD:block.options.D,
    correctAnswer:answer,
    correctAnswers:[answer],
    numericalAnswer:null,
    questionType:'SINGLE_CORRECT',
    questionSubType:questionSubType(block.question),
    subject,
    topic:hierarchy.topic,
    subtopic:hierarchy.subtopic,
    difficulty:'Medium',
    marks:source.marksForSubject(subject),
    explanation:null,
    tags:['PYQ', 'CET', 'MHT-CET', source.variant, `Year-${source.year}`, subject, hierarchy.topic, hierarchy.subtopic],
    sourceDocument:`State CET Cell · ${source.paper}`,
    sourcePage:block.sourcePage || null,
    isActive:true,
    pyq:{
      exam:'CET',
      variant:source.variant,
      year:source.year,
      session:null,
      paper:source.paper,
      sourceKey:`${source.code}:Q${block.sourceId || block.number}`,
      sourceExternalId:`${source.code}:Q${block.sourceId || block.number}`,
      sourceDataset:'State CET Cell papers via AglaSem Docs',
      sourceVersion:source.questionSha256,
      sourceUrl:source.pageUrl,
      sourceLicense:'Official examination material · educational use',
      sourceLicenseUrl:OFFICIAL_PORTAL_URL,
      sourceFingerprint,
      difficultyBasis:'relative-content-complexity',
    },
  };
  return { value, complexity:complexityScore(value) };
}

function assignRelativeDifficulties(rows) {
  const groups = new Map();
  rows.forEach(row => {
    const key = row.value.subject;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  groups.forEach(group => {
    group.sort((a, b) => a.complexity - b.complexity || a.value.pyq.sourceKey.localeCompare(b.value.pyq.sourceKey));
    group.forEach((row, index) => {
      const percentile = (index + 0.5) / group.length;
      row.value.difficulty = percentile <= 0.3 ? 'Easy' : percentile > 0.8 ? 'Hard' : 'Medium';
    });
  });
  return rows;
}

async function fetchPinnedPdf(url, expectedHash, fetchImplementation = fetch) {
  const response = await fetchImplementation(url, { headers:{ 'user-agent':'SPVN-CET-PYQ-Importer/1.0 (educational source verification)' } });
  if (!response.ok) throw new Error(`PDF download failed (${response.status}) for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const actualHash = sha256(buffer);
  if (actualHash !== expectedHash) {
    throw new Error(`Source PDF hash mismatch for ${url}; expected ${expectedHash}, received ${actualHash}`);
  }
  return buffer;
}

async function extractSource(source, dependencies = {}) {
  const fetchPdf = dependencies.fetchPinnedPdf || fetchPinnedPdf;
  if (source.responseSheet) {
    const questionBuffer = await fetchPdf(source.questionUrl, source.questionSha256);
    const toPageLayouts = dependencies.responsePageLayouts || responsePageLayouts;
    const pages = await toPageLayouts(questionBuffer, dependencies);
    const blocks = extractResponseQuestions(pages, source.expectedQuestions);
    const rejected = {};
    const rows = [];
    blocks.forEach(block => {
      const normalized = normalizeQuestion(source, block, block.answer);
      if (!normalized.value) {
        rejected[normalized.error] = (rejected[normalized.error] || 0) + 1;
        return;
      }
      rows.push(normalized);
    });
    return {
      rows,
      rejected,
      parsedQuestions:blocks.length,
      parsedAnswers:blocks.filter(block => block.answer).length,
      missingQuestionNumbers:[],
      missingAnswerNumbers:blocks.filter(block => !block.answer).map(block => block.sourceId),
    };
  }
  const toLines = dependencies.pdfLines || pdfLines;
  const [questionBuffer, answerBuffer] = await Promise.all([
    fetchPdf(source.questionUrl, source.questionSha256),
    fetchPdf(source.answerUrl, source.answerSha256),
  ]);
  const [questionLines, answerLines] = await Promise.all([toLines(questionBuffer), toLines(answerBuffer)]);
  const blocks = extractQuestionBlocks(questionLines, source.expectedQuestions);
  const answers = extractAnswerKey(answerLines, source.expectedQuestions);
  const rejected = {};
  const rows = [];
  blocks.forEach(block => {
    const normalized = normalizeQuestion(source, block, answers.get(block.number));
    if (!normalized.value) {
      rejected[normalized.error] = (rejected[normalized.error] || 0) + 1;
      return;
    }
    rows.push(normalized);
  });
  const missingQuestionNumbers = Array.from({ length:source.expectedQuestions }, (_, index) => index + 1)
    .filter(number => !blocks.some(block => block.number === number));
  const missingAnswerNumbers = Array.from({ length:source.expectedQuestions }, (_, index) => index + 1)
    .filter(number => !answers.has(number));
  return { rows, rejected, parsedQuestions:blocks.length, parsedAnswers:answers.size, missingQuestionNumbers, missingAnswerNumbers };
}

module.exports = {
  OFFICIAL_PORTAL_URL,
  SOURCE_INDEX_URL,
  SOURCES,
  TOPIC_RULES,
  assignRelativeDifficulties,
  cleanText,
  extractAnswerKey,
  extractQuestionBlocks,
  extractSource,
  fetchPinnedPdf,
  fingerprint,
  groupPageItems,
  groupPageLayoutItems,
  greenRowGroups,
  inferTopic,
  mergeInlineScriptRows,
  normalizeQuestion,
  parseResponseQuestionHeader,
  pdfLines,
  qualityError,
  responseAnswerForOptions,
  responsePageLayouts,
  sequentialOptionMarkers,
  extractResponseQuestions,
};
