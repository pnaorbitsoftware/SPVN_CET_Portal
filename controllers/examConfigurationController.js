const { RankingSchema, TestPattern } = require('../models');
const { organizationIdForWrite } = require('../services/organizationService');
const {
  QUESTION_TYPES,
  RANK_FIELDS,
  TIMING_MODES,
  criteriaFromBody,
  ensureDefaultExamConfigurations,
  patternInputFromBody,
} = require('../services/examConfigurationService');

function orgQuery(req, extra = {}) {
  return { ...extra, organization:organizationIdForWrite(req) };
}

exports.getConfigurations = async (req, res) => {
  try {
    await ensureDefaultExamConfigurations(req.organization?._id);
    const [patterns, rankingSchemas, editingPattern, editingRanking] = await Promise.all([
      TestPattern.find(orgQuery(req)).populate('rankingSchema').sort({ isSystem:-1, name:1 }),
      RankingSchema.find(orgQuery(req)).sort({ isSystem:-1, name:1 }),
      req.query.editPattern ? TestPattern.findOne(orgQuery(req, { _id:req.query.editPattern, isSystem:false })) : null,
      req.query.editRanking ? RankingSchema.findOne(orgQuery(req, { _id:req.query.editRanking, isSystem:false })) : null,
    ]);
    res.render('admin/exam-configurations', {
      title:'Exam Patterns & Ranking', patterns, rankingSchemas,
      editingPattern, editingRanking, QUESTION_TYPES, RANK_FIELDS, TIMING_MODES,
    });
  } catch (error) { console.error(error); req.flash('error','Unable to load exam configurations.'); res.redirect('/admin/dashboard'); }
};

exports.savePattern = async (req, res) => {
  try {
    const input = patternInputFromBody(req.body);
    if (input.rankingSchema) {
      const ranking = await RankingSchema.findOne(orgQuery(req, { _id:input.rankingSchema, isActive:true }));
      if (!ranking) throw new Error('Selected ranking schema is unavailable.');
    }
    let pattern = null;
    if (req.params.id) {
      pattern = await TestPattern.findOne(orgQuery(req, { _id:req.params.id, isSystem:false }));
      if (!pattern) throw new Error('Custom test pattern not found.');
      const duplicate = await TestPattern.exists(orgQuery(req, { _id:{ $ne:pattern._id }, code:input.code }));
      if (duplicate) throw new Error('That pattern code is already in use.');
      Object.assign(pattern, input);
      await pattern.save();
    } else {
      if (await TestPattern.exists(orgQuery(req, { code:input.code }))) throw new Error('That pattern code is already in use.');
      pattern = await TestPattern.create({
        ...input, organization:organizationIdForWrite(req), createdBy:req.session.user.id,
        isSystem:false, isActive:true,
      });
    }
    req.flash('success',`Test pattern ${req.params.id?'updated':'created'}.`);
    res.redirect('/admin/exam-configurations');
  } catch (error) { console.error(error); req.flash('error',error.message); res.redirect('/admin/exam-configurations'); }
};

exports.saveRanking = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!name || !code) throw new Error('Ranking schema name and code are required.');
    const input = {
      name, code, description:String(req.body.description || '').trim() || null,
      criteria:criteriaFromBody(req.body),
      tiePolicy:['ORDINAL','DENSE','COMPETITION'].includes(req.body.tiePolicy) ? req.body.tiePolicy : 'ORDINAL',
    };
    let schema = null;
    if (req.params.id) {
      schema = await RankingSchema.findOne(orgQuery(req, { _id:req.params.id, isSystem:false }));
      if (!schema) throw new Error('Custom ranking schema not found.');
      const duplicate = await RankingSchema.exists(orgQuery(req, { _id:{ $ne:schema._id }, code }));
      if (duplicate) throw new Error('That ranking code is already in use.');
      Object.assign(schema, input);
      await schema.save();
    } else {
      if (await RankingSchema.exists(orgQuery(req, { code }))) throw new Error('That ranking code is already in use.');
      schema = await RankingSchema.create({
        ...input, organization:organizationIdForWrite(req), createdBy:req.session.user.id,
        isSystem:false, isActive:true,
      });
    }
    req.flash('success',`Ranking schema ${req.params.id?'updated':'created'}.`);
    res.redirect('/admin/exam-configurations');
  } catch (error) { console.error(error); req.flash('error',error.message); res.redirect('/admin/exam-configurations'); }
};

exports.togglePattern = async (req, res) => {
  try {
    const pattern = await TestPattern.findOne(orgQuery(req, { _id:req.params.id, isSystem:false }));
    if (!pattern) req.flash('error','Only custom patterns can be disabled.');
    else { pattern.isActive=!pattern.isActive; await pattern.save(); req.flash('success',`Pattern ${pattern.isActive?'enabled':'disabled'}.`); }
  } catch (error) { console.error(error); req.flash('error','Unable to update pattern status.'); }
  res.redirect('/admin/exam-configurations');
};

exports.toggleRanking = async (req, res) => {
  try {
    const schema = await RankingSchema.findOne(orgQuery(req, { _id:req.params.id, isSystem:false }));
    if (!schema) req.flash('error','Only custom ranking schemas can be disabled.');
    else { schema.isActive=!schema.isActive; await schema.save(); req.flash('success',`Ranking schema ${schema.isActive?'enabled':'disabled'}.`); }
  } catch (error) { console.error(error); req.flash('error','Unable to update ranking schema status.'); }
  res.redirect('/admin/exam-configurations');
};
