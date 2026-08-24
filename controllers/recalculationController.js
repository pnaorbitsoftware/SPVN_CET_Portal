const { Test } = require('../models');
const { organizationScope } = require('../services/organizationService');
const {
  recalculateTestResults,
  validateRecalculationRequest,
} = require('../services/recalculationService');

exports.recalculate = async (req, res) => {
  try {
    const { reason } = validateRecalculationRequest(req.body);
    const test = await Test.findOne({
      _id:req.params.id,
      isActive:{ $ne:false },
      ...organizationScope(req.organization),
    }).populate('questions');
    if (!test) {
      req.flash('error', 'Test not found.');
      return res.redirect('/admin/tests');
    }
    const audit = await recalculateTestResults({
      test,
      initiatedBy:req.session.user.id,
      organization:req.organization?._id || null,
      reason,
    });
    req.flash(
      'success',
      `Recalculated ${audit.affectedResults} result(s); ${audit.changedResults} result(s) changed. Ranks and percentiles are up to date.`
    );
  } catch (error) {
    req.flash('error', `Recalculation failed: ${error.message}`);
  }
  return res.redirect(`/admin/tests/${req.params.id}`);
};
