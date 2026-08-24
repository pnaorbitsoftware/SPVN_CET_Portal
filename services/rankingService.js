const { Result } = require('../models');

async function updateRanks(testId) {
  const results = await Result.find({ testId, status:{ $in:['submitted','auto_submitted'] } })
    .sort({ score:-1, timeTaken:1, submittedAt:1 });
  const total = results.length;
  if (!total) return [];
  await Promise.all(results.map((result, index) => Result.updateOne(
    { _id:result._id },
    { rank:index + 1, percentile:Number((((total - index) / total) * 100).toFixed(2)) }
  )));
  return results.map((result, index) => ({ resultId:result._id, rank:index + 1 }));
}

module.exports = { updateRanks };
