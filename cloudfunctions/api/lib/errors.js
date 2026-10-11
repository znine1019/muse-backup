'use strict';

class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new AppError(code, message, details);
}

function isDatabaseNotReadyError(error) {
  const message = String((error && error.message) || '').toLowerCase();
  return (
    message.includes('collection not exist') ||
    message.includes('collection does not exist') ||
    message.includes('database not exist') ||
    message.includes('collection not found')
  );
}

function toPublicError(error) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  if (isDatabaseNotReadyError(error)) {
    return {
      code: 'DATABASE_NOT_READY',
      message: '云数据库尚未完成初始化，请先创建阶段1所需集合。'
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: '服务器处理失败，请稍后重试。'
  };
}

module.exports = {
  AppError,
  fail,
  isDatabaseNotReadyError,
  toPublicError
};
