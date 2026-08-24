const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTransactionUnsupportedError,
  withTransactionFallback,
} = require('../services/mongoTransactionService');

test('transaction compatibility detection is narrow and recognizes standalone MongoDB errors', () => {
  assert.equal(isTransactionUnsupportedError({ code:20 }), true);
  assert.equal(isTransactionUnsupportedError(new Error('This MongoDB deployment does not support retryable writes.')), true);
  assert.equal(isTransactionUnsupportedError(new Error('validation failed')), false);
});

test('transaction helper retries once without a session on unsupported deployments', async () => {
  const calls = [];
  let ended = false;
  const mongoose = {
    async startSession() {
      return {
        async withTransaction(work) {
          await work();
          throw new Error('Transaction numbers are only allowed on a replica set member or mongos');
        },
        async endSession() { ended = true; },
      };
    },
  };

  const mode = await withTransactionFallback(mongoose, async session => {
    calls.push(session ? 'transaction' : 'fallback');
  });

  assert.equal(mode, 'fallback');
  assert.deepEqual(calls, ['transaction', 'fallback']);
  assert.equal(ended, true);
});
