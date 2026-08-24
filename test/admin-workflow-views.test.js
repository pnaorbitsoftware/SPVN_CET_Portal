const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');

const root = path.join(__dirname, '..');
const view = name => path.join(root, 'views', 'admin', name);
const id = () => new mongoose.Types.ObjectId();
const base = {
  currentUser:{ name:'Administrator' }, collegeShort:'SPVN', collegeLogo:null,
  successMsg:[], errorMsg:[], warningMsg:[], infoMsg:[],
};

function render(file, locals) {
  return ejs.renderFile(view(file), { ...base, ...locals });
}

test('subject test part list and builder render named parts, hierarchy and per-question marks', async () => {
  const partId = id();
  const questionId = id();
  const part = {
    _id:partId, name:'Physics Mechanics Set 01', subject:'Physics', topic:'Mechanics', subtopic:'Motion',
    status:'ready', description:null, defaultPositiveMarks:1, defaultNegativeMarks:0.25,
    questionConfigs:[{ questionId }], createdBy:{ name:'Teacher' }, updatedAt:new Date(),
  };
  const listHtml = await render('test-parts.ejs', { title:'Parts', parts:[part], SUBJECTS:['Physics','Chemistry','Mathematics','Biology'], filters:{subject:'',status:''} });
  assert.match(listHtml, /Physics Mechanics Set 01/);
  assert.match(listHtml, /Combine Ready Parts/);

  const formHtml = await render('test-part-form.ejs', {
    title:'Builder', part, SUBJECTS:['Physics','Chemistry','Mathematics','Biology'], selectedSubject:'Physics', hierarchy:[],
    initialQuestions:[], selectedQuestions:[{ id:String(questionId), question:'What is velocity?', subject:'Physics', difficulty:'Easy', answer:'A', positiveMarks:1, negativeMarks:0.25 }],
  });
  assert.match(formHtml, /individual marks/i);
  assert.match(formHtml, /Write a new question/);
  assert.match(formHtml, /positiveMarks/);
});

test('five-step combined test wizard renders every decision stage and publish review', async () => {
  const part = { _id:id(), name:'Chemistry Set', subject:'Chemistry', topic:'Atoms', subtopic:null, status:'ready', questionConfigs:[{ questionId:id(), positiveMarks:1, negativeMarks:0 }] };
  const pattern = { _id:id(), code:'CUSTOM', name:'Custom' };
  const ranking = { _id:id(), code:'SCHEME_1', name:'Score, then Time' };
  const group = { _id:id(), name:'CET Batch A', course:'CET' };
  const shared = {
    title:'Wizard', COURSES:['JEE','CET','NEET'], SUBJECTS:['Physics','Chemistry','Mathematics','Biology'],
    TEST_TYPES:['MOCK','CUSTOM'], TIMING_MODES:['PERSONAL_DURATION','FIXED_WINDOW','UNTIMED'],
    RESULT_RELEASE_MODES:['IMMEDIATE','AFTER_TEST_END','SCHEDULED','MANUAL'],
  };
  const pages = [
    await render('test-wizard.ejs', { ...shared, step:'parts', wizard:{partIds:[]}, parts:[part] }),
    await render('test-wizard.ejs', { ...shared, step:'identity', wizard:{identity:{}}, patterns:[pattern], rankingSchemas:[ranking] }),
    await render('test-wizard.ejs', { ...shared, step:'audience', wizard:{audience:{}}, groups:[group] }),
    await render('test-wizard.ejs', { ...shared, step:'delivery', wizard:{delivery:{} } }),
    await render('test-wizard.ejs', { ...shared, step:'review', wizard:{identity:{title:'CET Test'},delivery:{timingMode:'PERSONAL_DURATION',duration:90,resultReleaseMode:'IMMEDIATE'}}, parts:[part], groups:[group], combined:{configs:part.questionConfigs,duplicates:[]}, totalMarks:1 }),
  ];
  assert.match(pages[0], /Which subject parts/);
  assert.match(pages[1], /Name and exam identity/);
  assert.match(pages[2], /Who will take this test/);
  assert.match(pages[3], /When and how should it run/);
  assert.match(pages[4], /Upload &amp; Publish Test/);
});

test('ranked results view shows four subjects, percentile and rank without percentage column', async () => {
  const testId = id();
  const selectedTest = { _id:testId, title:'MHT-CET Mock 01', createdAt:new Date() };
  const html = await render('results.ejs', {
    title:'Results', tests:[selectedTest], selectedTestId:String(testId), selectedTest,
    results:[{ displayRank:1, displayPercentile:100, score:150, totalMarks:200, fullTotalMarks:200, studentId:{name:'Demo Student',rollNo:'D001'}, subjectScores:{ Physics:{marks:40,total:50}, Chemistry:{marks:35,total:50}, Mathematics:{marks:75,total:100} } }],
  });
  assert.match(html, /Biology/);
  assert.match(html, /Percentile/);
  assert.match(html, /#1/);
  assert.doesNotMatch(html, />%<|Percentage/);
});
