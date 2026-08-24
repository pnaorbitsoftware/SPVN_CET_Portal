const TRANSACTION_UNSUPPORTED_CODES = new Set([20, 263, 303]);

function isTransactionUnsupportedError(error) {
  if (!error) return false;
  if (TRANSACTION_UNSUPPORTED_CODES.has(Number(error.code))) return true;
  const message = String(error.message || error).toLowerCase();
  return message.includes('transaction numbers are only allowed on a replica set member or mongos')
    || message.includes('does not support retryable writes')
    || message.includes('transactions are not supported');
}

async function withTransactionFallback(mongoose, work) {
  const session = await mongoose.startSession();
  let shouldFallback = false;
  try {
    await session.withTransaction(() => work(session));
  } catch (error) {
    if (!isTransactionUnsupportedError(error)) throw error;
    shouldFallback = true;
  } finally {
    await session.endSession();
  }

  if (shouldFallback) {
    await work(null);
    return 'fallback';
  }
  return 'transaction';
}

module.exports = { isTransactionUnsupportedError, withTransactionFallback };
