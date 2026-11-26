'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const createCompetitionActions = require('../../cloudfunctions/api/actions/competitions');
const { createStorage } = require('../../cloudfunctions/api/lib/storage');
const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  COMPETITION_ATTACHMENT_STATUS,
  COMPETITION_MATERIAL_POLICY,
  COMPETITION_REGISTRATION_STATUS,
  COMPETITION_STATUS,
  MEMBERSHIP_STATUS,
  ROLES
} = require('../../cloudfunctions/api/lib/constants');
const { deterministicId } = require('../../cloudfunctions/api/lib/repository');
const { IDENTITY, createConcurrentRepository } = require('./helpers');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function createMockStorage(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const deletedCalls = [];
  const tempUrlCalls = [];
  let failDelete = false;

  const storage = {
    files,
    deletedCalls,
    tempUrlCalls,
    setFailDelete(flag) {
      failDelete = Boolean(flag);
    },
    async statFile(fileId) {
      if (!files.has(fileId)) {
        return null;
      }
      return { sizeBytes: files.get(fileId) };
    },
    async deleteFile(fileId) {
      deletedCalls.push(fileId);
      if (failDelete) {
        const error = new Error('云存储文件删除失败，请稍后重试。');
        error.code = 'STORAGE_DELETE_FAILED';
        throw error;
      }
      files.delete(fileId);
      return { deleted: true, fileId };
    },
    async getTempUrl(fileId, maxAgeSeconds) {
      tempUrlCalls.push({ fileId, maxAgeSeconds });
      if (!files.has(fileId)) {
        const error = new Error('获取材料临时下载链接失败，请稍后重试。');
        error.code = 'STORAGE_TEMP_URL_FAILED';
        throw error;
      }
      return `https://temp.example.invalid/signed/${encodeURIComponent(fileId)}?maxAge=${maxAgeSeconds}`;
    }
  };

  return storage;
}

function createHarness() {
  const repository = createConcurrentRepository();
  repository.competitionAttachmentCollection = {
    __name: COLLECTIONS.COMPETITION_ATTACHMENTS
  };
  repository.competitionAttachmentIdForRequest = (
    registrationId,
    clientRequestId
  ) =>
    deterministicId('competition_attachment', registrationId, clientRequestId);
  repository.getCompetition = async (competitionId) =>
    repository
      .readCollection(COLLECTIONS.COMPETITIONS)
      .find((item) => item._id === competitionId) || null;
  repository.getRegistration = async (registrationId) =>
    repository
      .readCollection(COLLECTIONS.COMPETITION_REGISTRATIONS)
      .find((item) => item._id === registrationId) || null;
  repository.getCompetitionAttachment = async (attachmentId) =>
    repository
      .readCollection(COLLECTIONS.COMPETITION_ATTACHMENTS)
      .find((item) => item._id === attachmentId) || null;
  repository.getCoachGroupIds = async (userId) =>
    repository
      .readCollection(COLLECTIONS.GROUP_MEMBERSHIPS)
      .filter(
        (m) =>
          m.userId === userId &&
          m.roleInGroup === ROLES.COACH &&
          m.status === MEMBERSHIP_STATUS.ACTIVE
      )
      .map((m) => m.groupId);
  repository.getStudentGroupIds = async (userId) =>
    repository
      .readCollection(COLLECTIONS.GROUP_MEMBERSHIPS)
      .filter(
        (m) =>
          m.userId === userId &&
          m.roleInGroup === ROLES.STUDENT &&
          m.status === MEMBERSHIP_STATUS.ACTIVE
      )
      .map((m) => m.groupId);

  const developer = repository.seedStudent({
    _id: 'usr_mat_dev',
    openid: 'openid_mat_dev',
    status: 'active',
    roles: [ROLES.DEVELOPER]
  });
  const coachA = repository.seedStudent({
    _id: 'usr_mat_coach_a',
    openid: 'openid_mat_coach_a',
    status: 'active',
    roles: [ROLES.COACH]
  });
  const coachB = repository.seedStudent({
    _id: 'usr_mat_coach_b',
    openid: 'openid_mat_coach_b',
    status: 'active',
    roles: [ROLES.COACH]
  });
  const studentA = repository.seedStudent({
    _id: 'usr_mat_student_a',
    openid: 'openid_mat_student_a',
    status: 'active',
    roles: [ROLES.STUDENT]
  });
  const studentB = repository.seedStudent({
    _id: 'usr_mat_student_b',
    openid: 'openid_mat_student_b',
    status: 'active',
    roles: [ROLES.STUDENT]
  });
  const parentUser = repository.seedStudent({
    _id: 'usr_mat_parent',
    openid: 'openid_mat_parent',
    status: 'active',
    roles: [ROLES.PARENT]
  });

  repository.seedRecord(COLLECTIONS.TRAINING_GROUPS, {
    _id: 'grp_mat_a',
    groupId: 'grp_mat_a',
    name: '模拟短跑组A',
    enabled: true
  });
  repository.seedRecord(COLLECTIONS.TRAINING_GROUPS, {
    _id: 'grp_mat_b',
    groupId: 'grp_mat_b',
    name: '模拟长跑组B',
    enabled: true
  });
  repository.seedRecord(COLLECTIONS.GROUP_MEMBERSHIPS, {
    _id: 'gm_coach_a',
    userId: coachA._id,
    groupId: 'grp_mat_a',
    roleInGroup: ROLES.COACH,
    status: MEMBERSHIP_STATUS.ACTIVE
  });
  repository.seedRecord(COLLECTIONS.GROUP_MEMBERSHIPS, {
    _id: 'gm_coach_b',
    userId: coachB._id,
    groupId: 'grp_mat_b',
    roleInGroup: ROLES.COACH,
    status: MEMBERSHIP_STATUS.ACTIVE
  });
  repository.seedRecord(COLLECTIONS.GROUP_MEMBERSHIPS, {
    _id: 'gm_student_a',
    userId: studentA._id,
    groupId: 'grp_mat_a',
    roleInGroup: ROLES.STUDENT,
    status: MEMBERSHIP_STATUS.ACTIVE
  });
  repository.seedRecord(COLLECTIONS.GROUP_MEMBERSHIPS, {
    _id: 'gm_student_b',
    userId: studentB._id,
    groupId: 'grp_mat_b',
    roleInGroup: ROLES.STUDENT,
    status: MEMBERSHIP_STATUS.ACTIVE
  });

  const competitionA = repository.seedRecord(COLLECTIONS.COMPETITIONS, {
    _id: 'comp_mat_a',
    competitionId: 'comp_mat_a',
    title: '模拟秋季田径赛',
    location: '模拟体育场',
    eventDate: '2026-12-20',
    registrationStartAt: '2026-10-01 00:00',
    registrationEndAt: '2026-12-15 23:59',
    trainingGroupIds: ['grp_mat_a'],
    status: COMPETITION_STATUS.PUBLISHED,
    version: 1
  });
  const regA = repository.seedRecord(COLLECTIONS.COMPETITION_REGISTRATIONS, {
    _id: 'reg_mat_a',
    registrationId: 'reg_mat_a',
    competitionId: competitionA._id,
    studentUserId: studentA._id,
    trainingGroupIds: ['grp_mat_a'],
    status: COMPETITION_REGISTRATION_STATUS.SUBMITTED,
    items: [{ itemId: 'it_1', eventCode: '100m', eventName: '100米', category: '甲组' }]
  });

  const storage = createMockStorage({
    'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/f1.pdf': 204800,
    'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/f2.jpg': 102400,
    'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/f3.png': 51200,
    'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/f4.jpeg': 64000
  });

  const actions = createCompetitionActions({ repository, storage });

  return {
    repository,
    storage,
    actions,
    developer,
    coachA,
    coachB,
    studentA,
    studentB,
    parentUser,
    competitionA,
    regA
  };
}

function validPayload(overrides = {}) {
  return {
    competitionId: 'comp_mat_a',
    registrationId: 'reg_mat_a',
    cloudPath:
      'competition-attachments/comp_mat_a/usr_mat_student_a/1732600000000-abc123.pdf',
    fileId:
      'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/f1.pdf',
    fileName: '模拟参赛证明.pdf',
    sizeBytes: 204800,
    clientRequestId: 'req_mat_001',
    ...overrides
  };
}

test('1. 学生登记本人材料成功，记录 active、配额更新且写入审计', async () => {
  const { repository, actions, studentA } = createHarness();
  const policyBefore = await actions['competition.get_material_policy']({
    identity: IDENTITY(studentA.openid),
    payload: { competitionId: 'comp_mat_a' }
  });
  assert.deepEqual(policyBefore.allowedExtensions, ['jpg', 'jpeg', 'png', 'pdf']);
  assert.equal(policyBefore.maxSizeBytes, 10 * 1024 * 1024);
  assert.equal(policyBefore.maxFilesPerCompetition, 3);
  assert.equal(policyBefore.uploadedCount, 0);
  assert.equal(policyBefore.remainingCount, 3);

  const result = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload()
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.attachment.status, COMPETITION_ATTACHMENT_STATUS.ACTIVE);
  assert.equal(result.attachment.studentUserId, studentA._id);
  assert.equal(result.attachment.extension, 'pdf');
  assert.equal(result.attachment.contentType, 'application/pdf');
  assert.equal(result.attachment.sizeBytes, 204800);

  const policyAfter = await actions['competition.get_material_policy']({
    identity: IDENTITY(studentA.openid),
    payload: { competitionId: 'comp_mat_a' }
  });
  assert.equal(policyAfter.uploadedCount, 1);
  assert.equal(policyAfter.remainingCount, 2);

  const audits = repository
    .readCollection(COLLECTIONS.AUDIT_LOGS)
    .filter((item) => item.action === AUDIT_ACTIONS.COMPETITION_MATERIAL_REGISTERED);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].targetId, result.attachment.attachmentId);
});

test('2. cloudPath 前缀指向他人 userId 时被拒', async () => {
  const { actions, studentA } = createHarness();
  await assert.rejects(
    actions['competition.register_material']({
      identity: IDENTITY(studentA.openid),
      payload: validPayload({
        cloudPath:
          'competition-attachments/comp_mat_a/usr_mat_student_b/1732600000000-other.pdf'
      })
    }),
    (error) => error.code === 'INVALID_CLOUD_PATH'
  );
});

test('3. 扩展名 exe/zip 被拒；fileName 含路径穿越 ../ 被清洗且长度截断 <=80', async () => {
  const { actions, studentA } = createHarness();
  await assert.rejects(
    actions['competition.register_material']({
      identity: IDENTITY(studentA.openid),
      payload: validPayload({
        fileName: 'payload.exe',
        cloudPath:
          'competition-attachments/comp_mat_a/usr_mat_student_a/1732600000000-a.exe'
      })
    }),
    (error) => error.code === 'INVALID_FILE_TYPE'
  );
  await assert.rejects(
    actions['competition.register_material']({
      identity: IDENTITY(studentA.openid),
      payload: validPayload({
        fileName: 'archive.zip',
        cloudPath:
          'competition-attachments/comp_mat_a/usr_mat_student_a/1732600000000-a.zip'
      })
    }),
    (error) => error.code === 'INVALID_FILE_TYPE'
  );

  const longPrefix = '模拟材料'.repeat(30);
  const res = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload({
      fileName: `../../secret\\..\\${longPrefix}\u0007.pdf`,
      clientRequestId: 'req_clean_name'
    })
  });
  assert.equal(res.attachment.fileName.includes('..'), false);
  assert.equal(res.attachment.fileName.includes('/'), false);
  assert.equal(res.attachment.fileName.includes('\\'), false);
  assert.equal(/[\u0000-\u001f\u007f]/.test(res.attachment.fileName), false);
  assert.ok(res.attachment.fileName.length <= 80);
  assert.ok(res.attachment.fileName.endsWith('.pdf'));
});

test('4. sizeBytes = 0、> 10MB、非数字均被拒', async () => {
  const { actions, studentA } = createHarness();
  for (const badSize of [
    0,
    -1,
    COMPETITION_MATERIAL_POLICY.MAX_SIZE_BYTES + 1,
    '204800',
    NaN,
    null
  ]) {
    await assert.rejects(
      actions['competition.register_material']({
        identity: IDENTITY(studentA.openid),
        payload: validPayload({ sizeBytes: badSize })
      }),
      (error) => error.code === 'INVALID_FILE_SIZE'
    );
  }
});

test('5. 第 4 个文件被拒（每人每赛事上限 3）', async () => {
  const { actions, studentA } = createHarness();
  await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload({ clientRequestId: 'req_1' })
  });
  await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload({
      clientRequestId: 'req_2',
      cloudPath:
        'competition-attachments/comp_mat_a/usr_mat_student_a/2.jpg',
      fileId:
        'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/f2.jpg',
      fileName: '模拟材料2.jpg',
      sizeBytes: 102400
    })
  });
  await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload({
      clientRequestId: 'req_3',
      cloudPath:
        'competition-attachments/comp_mat_a/usr_mat_student_a/3.png',
      fileId:
        'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/f3.png',
      fileName: '模拟材料3.png',
      sizeBytes: 51200
    })
  });

  await assert.rejects(
    actions['competition.register_material']({
      identity: IDENTITY(studentA.openid),
      payload: validPayload({
        clientRequestId: 'req_4',
        cloudPath:
          'competition-attachments/comp_mat_a/usr_mat_student_a/4.jpeg',
        fileId:
          'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/f4.jpeg',
        fileName: '模拟材料4.jpeg',
        sizeBytes: 64000
      })
    }),
    (error) => error.code === 'MATERIAL_LIMIT_EXCEEDED'
  );
});

test('6. 同一 clientRequestId 重复提交幂等，只留 1 条记录', async () => {
  const { repository, actions, studentA } = createHarness();
  const first = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload({ clientRequestId: 'req_idem_001' })
  });
  const second = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload({ clientRequestId: 'req_idem_001' })
  });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.attachment.attachmentId, first.attachment.attachmentId);
  assert.equal(
    repository.readCollection(COLLECTIONS.COMPETITION_ATTACHMENTS).length,
    1
  );
});

test('7. 无有效报名（不存在或已取消）时登记被拒', async () => {
  const { repository, actions, studentA } = createHarness();
  await assert.rejects(
    actions['competition.register_material']({
      identity: IDENTITY(studentA.openid),
      payload: validPayload({ registrationId: 'reg_not_exists' })
    }),
    (error) => error.code === 'REGISTRATION_REQUIRED'
  );

  repository.seedRecord(COLLECTIONS.COMPETITION_REGISTRATIONS, {
    _id: 'reg_cancelled_a',
    registrationId: 'reg_cancelled_a',
    competitionId: 'comp_mat_a',
    studentUserId: studentA._id,
    trainingGroupIds: ['grp_mat_a'],
    status: COMPETITION_REGISTRATION_STATUS.CANCELLED,
    items: []
  });
  await assert.rejects(
    actions['competition.register_material']({
      identity: IDENTITY(studentA.openid),
      payload: validPayload({ registrationId: 'reg_cancelled_a' })
    }),
    (error) => error.code === 'REGISTRATION_REQUIRED'
  );
});

test('8. 删除自己的材料成功、云文件被删、写审计且重复删除幂等', async () => {
  const { repository, storage, actions, studentA } = createHarness();
  const created = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload()
  });
  const removed = await actions['competition.remove_material']({
    identity: IDENTITY(studentA.openid),
    payload: { attachmentId: created.attachment.attachmentId }
  });
  assert.equal(removed.alreadyRemoved, false);
  assert.equal(removed.attachment.status, COMPETITION_ATTACHMENT_STATUS.REMOVED);
  assert.equal(storage.deletedCalls.length, 1);

  const removedAgain = await actions['competition.remove_material']({
    identity: IDENTITY(studentA.openid),
    payload: { attachmentId: created.attachment.attachmentId }
  });
  assert.equal(removedAgain.alreadyRemoved, true);
  assert.equal(storage.deletedCalls.length, 1);
  const audits = repository
    .readCollection(COLLECTIONS.AUDIT_LOGS)
    .filter((item) => item.action === AUDIT_ACTIONS.COMPETITION_MATERIAL_REMOVED);
  assert.equal(audits.length, 1);
});

test('9. 删除他人材料被拒', async () => {
  const { actions, studentA, studentB } = createHarness();
  const created = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload()
  });
  await assert.rejects(
    actions['competition.remove_material']({
      identity: IDENTITY(studentB.openid),
      payload: { attachmentId: created.attachment.attachmentId }
    }),
    (error) => error.code === 'OUT_OF_SCOPE'
  );
});

test('10. 教练在管理范围内可列出材料（不含下载URL）；跨赛事范围被拒', async () => {
  const { actions, studentA, coachA, coachB } = createHarness();
  await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload()
  });

  const listed = await actions['competition.list_registration_materials']({
    identity: IDENTITY(coachA.openid),
    payload: { competitionId: 'comp_mat_a' }
  });
  assert.equal(listed.total, 1);
  assert.equal(listed.byRegistration.reg_mat_a.length, 1);
  assert.equal(listed.byRegistration.reg_mat_a[0].tempFileURL, undefined);
  assert.equal(listed.byRegistration.reg_mat_a[0].url, undefined);

  await assert.rejects(
    actions['competition.list_registration_materials']({
      identity: IDENTITY(coachB.openid),
      payload: { competitionId: 'comp_mat_a' }
    }),
    (error) => error.code === 'OUT_OF_SCOPE'
  );
});

test('11. developer 全局可列出材料并可获取临时下载链接', async () => {
  const { actions, studentA, developer } = createHarness();
  const created = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload()
  });

  const listed = await actions['competition.list_registration_materials']({
    identity: IDENTITY(developer.openid),
    payload: { competitionId: 'comp_mat_a' }
  });
  assert.equal(listed.total, 1);

  const urlRes = await actions['competition.get_material_url']({
    identity: IDENTITY(developer.openid),
    payload: { attachmentId: created.attachment.attachmentId }
  });
  assert.equal(urlRes.expiresInSeconds, 60);
  assert.match(urlRes.tempFileURL, /^https:\/\//);
});

test('12. 获取下载链接写审计且审计中不含 URL 明文；跨范围教练被拒', async () => {
  const { repository, storage, actions, studentA, coachA, coachB } =
    createHarness();
  const created = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload()
  });

  await assert.rejects(
    actions['competition.get_material_url']({
      identity: IDENTITY(coachB.openid),
      payload: { attachmentId: created.attachment.attachmentId }
    }),
    (error) => error.code === 'OUT_OF_SCOPE'
  );

  const urlRes = await actions['competition.get_material_url']({
    identity: IDENTITY(coachA.openid),
    payload: { attachmentId: created.attachment.attachmentId }
  });
  assert.equal(storage.tempUrlCalls.length, 1);
  assert.equal(storage.tempUrlCalls[0].maxAgeSeconds, 60);
  assert.ok(urlRes.tempFileURL.includes('https://'));

  const audits = repository
    .readCollection(COLLECTIONS.AUDIT_LOGS)
    .filter((item) => item.action === AUDIT_ACTIONS.COMPETITION_MATERIAL_DOWNLOADED);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.attachmentId, created.attachment.attachmentId);
  assert.equal(audits[0].metadata.competitionId, 'comp_mat_a');
  assert.equal(JSON.stringify(audits[0]).includes(urlRes.tempFileURL), false);
  assert.equal(JSON.stringify(audits[0]).includes('https://'), false);
});

test('13. 家长角色调用全部 6 个材料接口均被拒', async () => {
  const { actions, studentA, parentUser } = createHarness();
  const created = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload()
  });
  const calls = [
    ['competition.get_material_policy', { competitionId: 'comp_mat_a' }],
    ['competition.register_material', validPayload({ clientRequestId: 'p1' })],
    ['competition.remove_material', { attachmentId: created.attachment.attachmentId }],
    ['competition.list_my_materials', { competitionId: 'comp_mat_a' }],
    ['competition.list_registration_materials', { competitionId: 'comp_mat_a' }],
    ['competition.get_material_url', { attachmentId: created.attachment.attachmentId }]
  ];
  for (const [route, payload] of calls) {
    await assert.rejects(
      actions[route]({ identity: IDENTITY(parentUser.openid), payload }),
      (error) => error.code === 'FORBIDDEN',
      `parent should be forbidden on ${route}`
    );
  }
});

test('14. active 以外（removed）的记录不出现在学生列表与教练列表', async () => {
  const { actions, studentA, coachA } = createHarness();
  const first = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload({ clientRequestId: 'req_keep' })
  });
  const second = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload({
      clientRequestId: 'req_del',
      cloudPath:
        'competition-attachments/comp_mat_a/usr_mat_student_a/2.jpg',
      fileId:
        'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/f2.jpg',
      fileName: '待删材料.jpg',
      sizeBytes: 102400
    })
  });
  await actions['competition.remove_material']({
    identity: IDENTITY(studentA.openid),
    payload: { attachmentId: second.attachment.attachmentId }
  });

  const mine = await actions['competition.list_my_materials']({
    identity: IDENTITY(studentA.openid),
    payload: { competitionId: 'comp_mat_a' }
  });
  assert.equal(mine.materials.length, 1);
  assert.equal(mine.materials[0].attachmentId, first.attachment.attachmentId);
  assert.equal(mine.uploadedCount, 1);
  assert.equal(mine.remainingCount, 2);

  const managed = await actions['competition.list_registration_materials']({
    identity: IDENTITY(coachA.openid),
    payload: { competitionId: 'comp_mat_a' }
  });
  assert.equal(managed.total, 1);
  assert.equal(
    managed.byRegistration.reg_mat_a[0].attachmentId,
    first.attachment.attachmentId
  );
});

test('15. statFile 返回 null 时登记被拒，且落库以服务端 statFile 大小为准', async () => {
  const { actions, storage, studentA } = createHarness();
  await assert.rejects(
    actions['competition.register_material']({
      identity: IDENTITY(studentA.openid),
      payload: validPayload({
        fileId: 'cloud://mock-env/competition-attachments/comp_mat_a/missing.pdf',
        clientRequestId: 'req_missing_stat'
      })
    }),
    (error) => error.code === 'FILE_NOT_FOUND_IN_STORAGE'
  );

  /* Client claims 1234 bytes, but real cloud file size is 204800 bytes */
  const registered = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload({
      sizeBytes: 1234,
      clientRequestId: 'req_server_size'
    })
  });
  assert.equal(registered.attachment.sizeBytes, 204800);

  /* Real file in storage exceeds 10MB even though client lied with 1024 */
  storage.files.set(
    'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/huge.pdf',
    COMPETITION_MATERIAL_POLICY.MAX_SIZE_BYTES + 512
  );
  await assert.rejects(
    actions['competition.register_material']({
      identity: IDENTITY(studentA.openid),
      payload: validPayload({
        fileId:
          'cloud://mock-env/competition-attachments/comp_mat_a/usr_mat_student_a/huge.pdf',
        sizeBytes: 1024,
        clientRequestId: 'req_huge_real'
      })
    }),
    (error) => error.code === 'INVALID_FILE_SIZE'
  );
});

test('16. 存储删除失败时 remove_material 显式失败、数据库记录保持 active 且不写审计', async () => {
  const { repository, storage, actions, studentA } = createHarness();
  const created = await actions['competition.register_material']({
    identity: IDENTITY(studentA.openid),
    payload: validPayload()
  });

  storage.setFailDelete(true);
  await assert.rejects(
    actions['competition.remove_material']({
      identity: IDENTITY(studentA.openid),
      payload: { attachmentId: created.attachment.attachmentId }
    }),
    (error) => error.code === 'STORAGE_DELETE_FAILED'
  );

  const stored = await repository.getCompetitionAttachment(
    created.attachment.attachmentId
  );
  assert.equal(stored.status, COMPETITION_ATTACHMENT_STATUS.ACTIVE);
  const removeAudits = repository
    .readCollection(COLLECTIONS.AUDIT_LOGS)
    .filter((item) => item.action === AUDIT_ACTIONS.COMPETITION_MATERIAL_REMOVED);
  assert.equal(removeAudits.length, 0);
});

test('17. storage 封装支持注入 mock cloud SDK 且异常显式报错、statFile 异常返回 null', async () => {
  const mockCloud = {
    async getTempFileURL({ fileList }) {
      return {
        fileList: [
          {
            fileID: fileList[0].fileID,
            status: 0,
            tempFileURL: `https://signed.invalid/${fileList[0].maxAge}`
          }
        ]
      };
    },
    async deleteFile({ fileList }) {
      return { fileList: [{ fileID: fileList[0], status: 0 }] };
    },
    async downloadFile({ fileID }) {
      if (fileID.includes('missing')) {
        throw new Error('not found');
      }
      return { fileContent: Buffer.alloc(4096) };
    }
  };
  const storage = createStorage(mockCloud);
  assert.equal(await storage.getTempUrl('file_1', 60), 'https://signed.invalid/60');
  assert.deepEqual(await storage.deleteFile('file_1'), {
    deleted: true,
    fileId: 'file_1'
  });
  assert.deepEqual(await storage.statFile('file_1'), { sizeBytes: 4096 });
  assert.equal(await storage.statFile('file_missing'), null);
});

test('18. 页面结构检查：学生页与教练页包含材料上传/删除/查看入口且不含写死真名或文件名', () => {
  const studentWxml = fs.readFileSync(
    path.join(
      PROJECT_ROOT,
      'miniprogram/pages/student-competitions/student-competitions.wxml'
    ),
    'utf8'
  );
  const coachWxml = fs.readFileSync(
    path.join(
      PROJECT_ROOT,
      'miniprogram/pages/competition-manage/competition-manage.wxml'
    ),
    'utf8'
  );

  assert.match(studentWxml, /bindtap="uploadMaterial"/);
  assert.match(studentWxml, /bindtap="removeMaterial"/);
  assert.ok(studentWxml.includes('materialUploadedCount'));
  assert.ok(studentWxml.includes('materialRemainingCount'));
  assert.ok(studentWxml.includes('上传材料'));

  assert.match(coachWxml, /bindtap="toggleRegistrationMaterials"/);
  assert.match(coachWxml, /bindtap="downloadMaterial"/);
  assert.ok(coachWxml.includes('查看/下载'));
  assert.ok(coachWxml.includes('暂无报名材料'));

  for (const content of [studentWxml, coachWxml]) {
    assert.equal(/\.pdf|\.jpg|\.jpeg|\.png/i.test(content), false);
    assert.equal(/张三|李四|王五/.test(content), false);
  }
});

test('19. 页面逻辑检查：学生上传流程与教练下载流程正确串联云存储与 API', async () => {
  function runPage(relPath, apiStub, roles, wxOverrides) {
    const file = path.join(PROJECT_ROOT, relPath);
    let registered = null;
    vm.runInNewContext(
      fs.readFileSync(file, 'utf8'),
      {
        require: (req) => {
          if (req.includes('services/api')) return apiStub;
          if (req.includes('xlsx-writer')) {
            return require(path.join(PROJECT_ROOT, 'miniprogram/utils/xlsx-writer.js'));
          }
          return {
            getSessionDestination: () => ({ url: '/pages/index/index' }),
            sessionHasRole: (_s, role) => roles.includes(role)
          };
        },
        Page: (p) => {
          registered = p;
        },
        getApp: () => ({
          ensureSession: async () => ({
            user: { id: 'usr_mat_student_a', roles }
          })
        }),
        wx: {
          reLaunch: () => {},
          showToast: () => {},
          showModal: (o) => o.success({ confirm: true }),
          ...wxOverrides
        },
        console,
        Date,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Promise,
        Set
      },
      { filename: file }
    );
    const instance = {
      data: JSON.parse(JSON.stringify(registered.data)),
      setData(update) {
        for (const [k, v] of Object.entries(update)) {
          this.data[k] = v;
        }
      }
    };
    for (const [k, v] of Object.entries(registered)) {
      if (typeof v === 'function') instance[k] = v.bind(instance);
    }
    return instance;
  }

  const studentCalls = [];
  const studentPage = runPage(
    'miniprogram/pages/student-competitions/student-competitions.js',
    {
      listStudentCompetitions: async () => ({ competitions: [] }),
      listMyCompetitionIntents: async () => ({
        registrations: [
          {
            registrationId: 'reg_mat_a',
            competitionId: 'comp_mat_a',
            competitionTitle: '模拟赛事',
            status: 'submitted',
            items: []
          }
        ]
      }),
      listMyCompetitionMaterials: async () => ({
        materials: [],
        uploadedCount: 0,
        maxFilesPerCompetition: 3,
        remainingCount: 3
      }),
      getCompetitionMaterialPolicy: async () => ({
        allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'],
        maxSizeBytes: 10 * 1024 * 1024,
        maxFilesPerCompetition: 3,
        uploadedCount: 0,
        remainingCount: 3
      }),
      registerCompetitionMaterial: async (payload) => {
        studentCalls.push(payload);
        return { attachment: { attachmentId: 'att_1' }, duplicate: false };
      }
    },
    ['student'],
    {
      chooseMessageFile: (o) =>
        o.success({
          tempFiles: [{ path: '/tmp/sample.pdf', name: '体检单.pdf', size: 12000 }]
        }),
      cloud: {
        uploadFile: async ({ cloudPath }) => ({
          fileID: `cloud://mock/${cloudPath}`
        })
      }
    }
  );
  await studentPage.loadPage();
  await studentPage.uploadMaterial({
    currentTarget: {
      dataset: { competitionId: 'comp_mat_a', registrationId: 'reg_mat_a' }
    }
  });
  assert.equal(studentCalls.length, 1);
  assert.ok(
    studentCalls[0].cloudPath.startsWith(
      'competition-attachments/comp_mat_a/usr_mat_student_a/'
    )
  );

  const openedDocs = [];
  const coachPage = runPage(
    'miniprogram/pages/competition-manage/competition-manage.js',
    {
      listCompetitionMeta: async () => ({ groups: [], events: [] }),
      listManageCompetitions: async () => ({ competitions: [] }),
      listRegistrationMaterials: async () => ({
        byRegistration: {
          reg_mat_a: [
            {
              attachmentId: 'att_1',
              fileName: '体检单.pdf',
              extension: 'pdf',
              sizeBytes: 12000,
              createdAt: '2026-11-27T00:00:00.000Z'
            }
          ]
        }
      }),
      getCompetitionMaterialUrl: async () => ({
        tempFileURL: 'https://temp.example.invalid/att_1.pdf',
        extension: 'pdf'
      })
    },
    ['coach'],
    {
      downloadFile: (o) => o.success({ statusCode: 200, tempFilePath: '/tmp/att_1.pdf' }),
      openDocument: (o) => {
        openedDocs.push(o.filePath);
        o.success();
      }
    }
  );
  await coachPage.toggleRegistrationMaterials({
    currentTarget: {
      dataset: { competitionId: 'comp_mat_a', registrationId: 'reg_mat_a' }
    }
  });
  assert.equal(coachPage.data.expandedMaterialRegistrationId, 'reg_mat_a');
  assert.equal(coachPage.data.materialsByRegistration.reg_mat_a.length, 1);
  await coachPage.downloadMaterial({
    currentTarget: { dataset: { attachmentId: 'att_1' } }
  });
  assert.deepEqual(openedDocs, ['/tmp/att_1.pdf']);
});
