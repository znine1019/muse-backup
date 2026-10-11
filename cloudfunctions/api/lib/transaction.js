'use strict';

function isNotFoundError(error) {
  const message = String((error && error.message) || '').toLowerCase();
  return (
    message.includes('not exist') ||
    message.includes('not found') ||
    message.includes('document not found')
  );
}

async function getDocumentOrNull(documentReference) {
  try {
    const result = await documentReference.get();
    return result.data || null;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

module.exports = {
  getDocumentOrNull
};
