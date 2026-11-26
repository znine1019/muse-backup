'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const STATUS_LABELS = Object.freeze({
  submitted: '意向已提交',
  processing: '教练处理中',
  registered: '教练已确认官方报名提交',
  failed: '报名未完成',
  cancelled: '意向已取消'
});
const PHASE_LABELS = Object.freeze({
  not_started: '未开始报名',
  open: '报名意向开放中',
  closed: '报名已截止',
  draft: '草稿',
  archived: '已归档'
});

const ALLOWED_MATERIAL_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'pdf']);
const MAX_MATERIAL_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_MATERIALS_PER_COMPETITION = 3;

function localRequestId() {
  return `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function localMaterialRequestId() {
  return `mat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractFileExtension(name) {
  const text = String(name || '');
  const dotIndex = text.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= text.length - 1) {
    return '';
  }
  return text.slice(dotIndex + 1).toLowerCase();
}

function formatFileSize(sizeBytes) {
  const bytes = Number(sizeBytes) || 0;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${bytes} B`;
}

function decorateMaterial(item) {
  return {
    ...item,
    sizeText: formatFileSize(item.sizeBytes)
  };
}

function decorateCompetition(competition) {
  const options = [];
  for (const event of competition.events || []) {
    for (const category of event.categories || []) {
      options.push({
        key: `${event.eventCode}|${category}`,
        label: `${event.eventName} · ${category}`
      });
    }
  }
  return {
    ...competition,
    phaseLabel: PHASE_LABELS[competition.phase] || competition.phase,
    capacityText: competition.capacityEnabled
      ? `意向人数上限 ${competition.capacity} 人（仅限小程序意向收集）`
      : '默认不限人数',
    registrationStatusLabel: competition.registration
      ? STATUS_LABELS[competition.registration.status] ||
        competition.registration.status
      : '',
    itemOptions: options,
    canSubmit: competition.phase === 'open'
  };
}

Page({
  data: {
    loading: true,
    error: '',
    currentUserId: '',
    competitions: [],
    intents: [],
    selectedCompetitionId: '',
    selectedKeys: [],
    contactNote: '',
    submitting: false,
    busyMaterialKey: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'student')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const currentUserId =
        (session && session.user && session.user.id) || '';
      const [competitionResult, intentResult] = await Promise.all([
        api.listStudentCompetitions(),
        api.listMyCompetitionIntents()
      ]);
      const rawIntents = intentResult.registrations || [];
      const materialsByCompetition = {};
      if (typeof api.listMyCompetitionMaterials === 'function') {
        const compIds = Array.from(
          new Set(
            rawIntents
              .map((item) => item.competitionId)
              .filter(Boolean)
          )
        );
        await Promise.all(
          compIds.map(async (competitionId) => {
            try {
              const res = await api.listMyCompetitionMaterials({ competitionId });
              materialsByCompetition[competitionId] = {
                materials: (res.materials || []).map(decorateMaterial),
                uploadedCount: Number(res.uploadedCount) || 0,
                maxFiles:
                  Number(res.maxFilesPerCompetition) ||
                  MAX_MATERIALS_PER_COMPETITION,
                remainingCount:
                  typeof res.remainingCount === 'number'
                    ? res.remainingCount
                    : Math.max(
                        0,
                        MAX_MATERIALS_PER_COMPETITION -
                          (Number(res.uploadedCount) || 0)
                      )
              };
            } catch (err) {
              materialsByCompetition[competitionId] = {
                materials: [],
                uploadedCount: 0,
                maxFiles: MAX_MATERIALS_PER_COMPETITION,
                remainingCount: MAX_MATERIALS_PER_COMPETITION
              };
            }
          })
        );
      }

      this.setData({
        loading: false,
        currentUserId,
        competitions: (competitionResult.competitions || []).map(decorateCompetition),
        intents: rawIntents.map((item) => {
          const mat = materialsByCompetition[item.competitionId] || {
            materials: [],
            uploadedCount: 0,
            maxFiles: MAX_MATERIALS_PER_COMPETITION,
            remainingCount: MAX_MATERIALS_PER_COMPETITION
          };
          return {
            ...item,
            statusLabel: STATUS_LABELS[item.status] || item.status,
            canCancel: item.status !== 'registered' && item.status !== 'cancelled',
            canUploadMaterial: item.status !== 'cancelled',
            materials: mat.materials,
            materialUploadedCount: mat.uploadedCount,
            materialMaxFiles: mat.maxFiles,
            materialRemainingCount: mat.remainingCount
          };
        })
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '赛事信息加载失败。'
      });
    }
  },

  toggleIntentForm(event) {
    const competitionId = event.currentTarget.dataset.competitionId;
    this.setData({
      selectedCompetitionId:
        this.data.selectedCompetitionId === competitionId ? '' : competitionId,
      selectedKeys: [],
      contactNote: ''
    });
  },

  onItemChange(event) {
    this.setData({ selectedKeys: event.detail.value || [] });
  },

  onContactNoteInput(event) {
    this.setData({ contactNote: event.detail.value });
  },

  async submitIntent() {
    if (this.data.submitting) {
      return;
    }
    const competitionId = this.data.selectedCompetitionId;
    if (!competitionId) {
      return;
    }
    if (!this.data.selectedKeys.length) {
      this.setData({ error: '请至少选择一个参赛项目和组别。' });
      return;
    }
    const items = this.data.selectedKeys.map((key) => {
      const [eventCode, category] = key.split('|');
      return { eventCode, category };
    });
    this.setData({ submitting: true, error: '' });
    try {
      const result = await api.submitCompetitionIntent({
        clientRequestId: localRequestId(),
        competitionId,
        items,
        contactNote: this.data.contactNote
      });
      wx.showToast({
        title: result.duplicate ? '意向已存在' : '意向已提交',
        icon: result.duplicate ? 'none' : 'success'
      });
      this.setData({ selectedCompetitionId: '', selectedKeys: [], contactNote: '' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '参赛意向提交失败。' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async cancelIntent(event) {
    const registrationId = event.currentTarget.dataset.registrationId;
    if (!registrationId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '确认取消参赛意向',
        content:
          '取消小程序意向不会自动撤销官方平台报名；如已由教练提交，请联系教练处理。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    try {
      await api.cancelCompetitionIntent({ registrationId, eventCodes: [] });
      wx.showToast({ title: '已取消意向', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '取消意向失败。' });
    }
  },

  async uploadMaterial(event) {
    const competitionId = event.currentTarget.dataset.competitionId;
    const registrationId = event.currentTarget.dataset.registrationId;
    if (!competitionId || !registrationId || this.data.busyMaterialKey) {
      return;
    }

    const intent = (this.data.intents || []).find(
      (item) => item.registrationId === registrationId
    );
    if (intent && intent.materialRemainingCount <= 0) {
      this.setData({
        error: `每人每场赛事最多上传 ${MAX_MATERIALS_PER_COMPETITION} 份材料，请先删除旧材料后再上传。`
      });
      return;
    }

    this.setData({ busyMaterialKey: registrationId, error: '' });
    try {
      let userId = this.data.currentUserId;
      if (!userId) {
        const session = await getApp().ensureSession({ force: true });
        userId = (session && session.user && session.user.id) || '';
      }
      if (!userId) {
        throw new Error('未能获取当前学生身份，请重新登录后再试。');
      }

      if (typeof api.getCompetitionMaterialPolicy === 'function') {
        const policy = await api.getCompetitionMaterialPolicy({ competitionId });
        if (policy && Number(policy.remainingCount) <= 0) {
          throw new Error(
            `每人每场赛事最多上传 ${policy.maxFilesPerCompetition || MAX_MATERIALS_PER_COMPETITION} 份材料，请先删除旧材料后再上传。`
          );
        }
      }

      const chooseResult = await new Promise((resolve, reject) => {
        wx.chooseMessageFile({
          count: 1,
          type: 'file',
          extension: ALLOWED_MATERIAL_EXTENSIONS,
          success: resolve,
          fail: reject
        });
      });
      const picked =
        chooseResult && Array.isArray(chooseResult.tempFiles)
          ? chooseResult.tempFiles[0]
          : null;
      if (!picked || !picked.path) {
        throw new Error('未选择可上传的文件。');
      }

      const rawName = picked.name || picked.path.split('/').pop() || '';
      const ext = extractFileExtension(rawName) || extractFileExtension(picked.path);
      if (!ALLOWED_MATERIAL_EXTENSIONS.includes(ext)) {
        throw new Error('文件类型不符：仅支持 jpg、jpeg、png、pdf 格式。');
      }

      const sizeBytes = Number(picked.size) || 0;
      if (sizeBytes <= 0) {
        throw new Error('所选文件为空，无法上传。');
      }
      if (sizeBytes > MAX_MATERIAL_SIZE_BYTES) {
        throw new Error('文件大小超过 10MB 上限，请压缩后重新上传。');
      }

      const randomPart = Math.random().toString(36).slice(2, 10);
      const cloudPath = `competition-attachments/${competitionId}/${userId}/${Date.now()}-${randomPart}.${ext}`;
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath,
        filePath: picked.path
      });
      if (!uploadResult || !uploadResult.fileID) {
        throw new Error('上传到云存储失败，未返回文件标识。');
      }

      await api.registerCompetitionMaterial({
        competitionId,
        registrationId,
        cloudPath,
        fileId: uploadResult.fileID,
        fileName: rawName || `material.${ext}`,
        sizeBytes,
        clientRequestId: localMaterialRequestId()
      });

      wx.showToast({ title: '材料已上传', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      const message =
        error && error.errMsg && error.errMsg.includes('cancel')
          ? ''
          : (error && error.message) || '材料上传失败，请重试。';
      if (message) {
        this.setData({ error: message });
      }
    } finally {
      this.setData({ busyMaterialKey: '' });
    }
  },

  async removeMaterial(event) {
    const attachmentId = event.currentTarget.dataset.attachmentId;
    if (!attachmentId || this.data.busyMaterialKey) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '确认删除材料',
        content: '删除后云存储文件将一并清除，可重新上传新材料。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.setData({ busyMaterialKey: attachmentId, error: '' });
    try {
      await api.removeCompetitionMaterial({ attachmentId });
      wx.showToast({ title: '材料已删除', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: (error && error.message) || '删除材料失败。' });
    } finally {
      this.setData({ busyMaterialKey: '' });
    }
  },

  retry() {
    this.loadPage();
  }
});
