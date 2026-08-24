const { Result, Test } = require('../models');

const DEFAULT_CRITERIA = [
  { field:'score', direction:'DESC' },
  { field:'timeTaken', direction:'ASC' },
  { field:'submittedAt', direction:'ASC' },
];
const ALLOWED_FIELDS = new Set(['score','correctAnswers','wrongAnswers','timeTaken','submittedAt']);

function criteriaFor(test) {
  const source = test?.rankingSchemaSnapshot?.criteria?.length
    ? test.rankingSchemaSnapshot.criteria
    : test?.rankingSchema?.criteria?.length ? test.rankingSchema.criteria : DEFAULT_CRITERIA;
  const criteria = source.filter(item => ALLOWED_FIELDS.has(item.field))
    .map(item => ({ field:item.field, direction:item.direction === 'ASC' ? 'ASC' : 'DESC' }));
  return criteria.length ? criteria : DEFAULT_CRITERIA;
}

function comparable(value) {
  if (value instanceof Date) return value.getTime();
  if (value === null || value === undefined) return null;
  const dateValue = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value).getTime() : NaN;
  return Number.isFinite(dateValue) ? dateValue : value;
}

function compareByCriteria(left, right, criteria) {
  for (const criterion of criteria) {
    const leftValue = comparable(left[criterion.field]);
    const rightValue = comparable(right[criterion.field]);
    if (leftValue === rightValue) continue;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const comparison = leftValue < rightValue ? -1 : 1;
    return criterion.direction === 'ASC' ? comparison : -comparison;
  }
  return String(left._id || '').localeCompare(String(right._id || ''));
}

function tieKey(result, criteria) {
  return JSON.stringify(criteria.map(criterion => comparable(result[criterion.field])));
}

function rankResults(results, criteria, tiePolicy = 'ORDINAL') {
  const sorted = [...results].sort((left,right) => compareByCriteria(left,right,criteria));
  let previousKey = null;
  let previousRank = 0;
  let denseRank = 0;
  return sorted.map((result,index) => {
    const key = tieKey(result, criteria);
    let rank = index + 1;
    if (tiePolicy !== 'ORDINAL') {
      if (key !== previousKey) {
        denseRank += 1;
        previousRank = tiePolicy === 'DENSE' ? denseRank : index + 1;
      }
      rank = previousRank;
    }
    previousKey = key;
    return { result, rank };
  });
}

async function updateRanks(testId) {
  const [test, results] = await Promise.all([
    Test.findById(testId).populate('rankingSchema'),
    Result.find({ testId, status:{ $in:['submitted','auto_submitted'] } }),
  ]);
  const total = results.length;
  if (!total) return [];
  const criteria = criteriaFor(test);
  const tiePolicy = test?.rankingSchemaSnapshot?.tiePolicy || test?.rankingSchema?.tiePolicy || 'ORDINAL';
  const ranked = rankResults(results, criteria, tiePolicy);
  await Result.bulkWrite(ranked.map(({ result,rank }) => ({
    updateOne:{
      filter:{ _id:result._id },
      update:{ $set:{ rank, percentile:Number((((total - rank + 1) / total) * 100).toFixed(2)) } },
    },
  })));
  return ranked.map(({ result,rank }) => ({ resultId:result._id, rank }));
}

module.exports = { DEFAULT_CRITERIA, compareByCriteria, criteriaFor, rankResults, updateRanks };
