'use strict';

function hasRealNameProfile(profile) {
  return Boolean(
    profile &&
      typeof profile.name === 'string' &&
      profile.name.trim().length > 0
  );
}

module.exports = { hasRealNameProfile };
