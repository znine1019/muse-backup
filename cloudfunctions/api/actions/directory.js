'use strict';

const { loadUser } = require('../lib/session');

function createDirectoryActions({ repository }) {
  async function listTrainingGroups({ identity }) {
    await loadUser(repository, identity);
    const groups = await repository.listEnabledTrainingGroups();
    return {
      groups: groups.map((group) => ({
        id: group._id,
        name: group.name
      }))
    };
  }

  return {
    'directory.list_training_groups': listTrainingGroups
  };
}

module.exports = createDirectoryActions;
