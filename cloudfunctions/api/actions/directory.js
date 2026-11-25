'use strict';

const { loadOptionalUser } = require('../lib/session');

function createDirectoryActions({ repository }) {
  async function listTrainingGroups({ identity }) {
    /* 未注册身份需要读取启用的训练组以完成首次实名注册；已停用/已删除账号仍会被拒绝。 */
    await loadOptionalUser(repository, identity);
    const groups = await repository.listEnabledTrainingGroups();
    return {
      groups: groups.map((group) => ({
        id: group._id,
        groupId: group.groupId || group._id,
        name: group.name,
        seasonLabel: group.seasonLabel || '未标注'
      }))
    };
  }

  return {
    'directory.list_training_groups': listTrainingGroups
  };
}

module.exports = createDirectoryActions;
