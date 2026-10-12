# 阶段4｜GPS考勤与请假管理系统设计

**日期：2026-10-13**
**状态：本地代码与自动化测试完成；云端集合、索引、权限和 `api` 部署未执行。**

## 1. 目标

- 学生在训练场次内通过微信主动定位完成一次签到，操作尽量少。
- 教练按授权训练组创建考勤场次、查看应到/签到/迟到/请假/异常名单并人工核实。
- 学生提交请假，教练审批，审批结果正确联动考勤状态。
- 不进行后台持续定位，不把定位结果当作绝对到场证明。

## 2. 数据模型（新增3个集合，均建议 ADMINONLY）

### attendance_sessions（考勤场次）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` / `sessionId` | string | 确定性场次ID |
| `trainingGroupId` | string | 所属训练组 |
| `planId` | string | 可选关联已发布训练计划 |
| `title` | string | 场次名称，可空 |
| `attendanceDate` | string | 业务日期 `YYYY-MM-DD`（UTC+8） |
| `locationName` | string | 训练地点名称 |
| `latitude` / `longitude` | number | 教练配置的签到中心点 |
| `radiusMeters` | number | 签到允许范围，20–5000米 |
| `accuracyThresholdMeters` | number | 定位精度阈值 |
| `checkInOpenTime` / `checkInCloseTime` | string | 签到时间窗口 `HH:mm` |
| `lateAfterTime` | string | 迟到判定线 |
| `status` | string | `scheduled` / `cancelled` |
| `version` | number | 乐观锁版本 |
| `createdBy` / `createdAt` / `updatedAt` | - | 创建者与时间 |
| `schemaVersion` | number | 当前为1 |

### attendance_records（考勤记录）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` / `recordId` | string | `sessionId + studentUserId` 确定性ID |
| `sessionId` / `studentUserId` / `trainingGroupId` | string | 关联 |
| `attendanceDate` | string | 业务日期 |
| `status` | string | `checked_in` / `late` / `leave_approved` / `pending_verification` / `absent` |
| `checkInAt` | date/null | 签到时间戳 |
| `latitude` / `longitude` | number/null | 降精度(4位)保存的签到坐标 |
| `accuracyMeters` / `distanceMeters` | number/null | GPS精度与服务端计算距离 |
| `verificationReason` | string | `low_accuracy` / `near_boundary` / `accuracy_unknown` / `leave_approved` / `manual_verified` |
| `source` | string | `gps` / `manual` / `system` |
| `leaveRequestId` | string | 关联请假 |
| `originalStatus` | string | 人工调整前状态 |
| `adjustedBy` / `adjustedAt` / `adjustReason` | - | 人工核实信息 |
| `createdAt` / `updatedAt` / `schemaVersion` | - | - |

### leave_requests（请假申请）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` / `leaveId` | string | `studentUserId + sessionId + clientRequestId` 确定性ID |
| `studentUserId` / `trainingGroupId` / `sessionId` | string | 关联 |
| `attendanceDate` | string | 场次日期 |
| `reason` | string | 请假原因，最长300字 |
| `status` | string | `pending` / `approved` / `rejected` / `cancelled` |
| `reviewedBy` / `reviewedAt` / `reviewComment` | - | 审批信息 |
| `cancelledAt` | date/null | 撤销时间 |
| `createdAt` / `updatedAt` / `schemaVersion` | - | - |

## 3. 索引建议（待批准，本轮未创建）

| 集合 | 索引名 | 字段顺序 | Unique |
|---|---|---|---|
| attendance_sessions | `idx_attendance_sessions_group_date` | `trainingGroupId:1, attendanceDate:1` | 否 |
| attendance_sessions | `idx_attendance_sessions_date_status` | `attendanceDate:1, status:1` | 否 |
| attendance_records | `idx_attendance_records_session_student` | `sessionId:1, studentUserId:1` | 否 |
| attendance_records | `idx_attendance_records_student_date` | `studentUserId:1, attendanceDate:-1` | 否 |
| leave_requests | `idx_leave_requests_status_created` | `status:1, createdAt:-1` | 否 |
| leave_requests | `idx_leave_requests_student_date` | `studentUserId:1, attendanceDate:-1` | 否 |

同场次同一学生唯一性由确定性文档ID `attend_<sessionId>_<studentUserId>` 保证，不额外创建唯一索引。

## 4. API

学生：

- `attendance.get_student_today`
- `attendance.check_in`
- `attendance.list_student_records`
- `leave.create` / `leave.cancel` / `leave.list_mine`

教练/developer：

- `attendance.list_manage_sessions`
- `attendance.get_session_roster`
- `attendance.create_session` / `update_session` / `cancel_session`
- `attendance.manual_verify`
- `leave.list_pending` / `leave.list_reviewed` / `leave.review`

## 5. GPS与时间规则

- 服务端使用 Haversine 公式计算学生坐标与场次中心点距离；忽略客户端传入的 `distance`、`isWithinRange`。
- 定位精度超过配置阈值或处于边界容差范围时，记录为 `pending_verification`，由教练人工核实。
- 明显超出范围的签到返回 `OUT_OF_RANGE`，不写入有效签到。
- 业务日期与签到窗口统一按 UTC+8 处理；学生手机本地时间不决定签到是否有效。
- 迟到判定由服务端当前UTC+8时间与 `lateAfterTime` 比较。
- 签到坐标降精度到4位后保存；普通日志不输出精确坐标。

## 6. 考勤状态与统计口径

- 未到签到时间：`not_started`
- 签到窗口内未签到：`pending`
- 已签到：`checked_in`
- 迟到：`late`
- 已批准请假：`leave_approved`
- 待核实异常：`pending_verification`
- 窗口结束后未签到：`absent`（“未签到”，不等同于无故缺勤）
- 场次取消：`cancelled`

请假 `pending` 不代表批准；只有 `approved` 会联动考勤记录。人工调整保留 `originalStatus`、操作者、时间与原因。

## 7. 并发与幂等

- 签到使用确定性记录ID，重复点击返回已有记录。
- 请假创建使用确定性ID，并检查同一场次待审批申请，避免重复。
- 请假审批在事务内重新读取状态，重复或并发审批返回 `LEAVE_NOT_PENDING`。
- 已存在真实签到记录时，批准请假返回 `ATTENDANCE_CONFLICT`，不覆盖签到事实。
- 考勤场次更新/取消使用 `version` 乐观锁。

## 8. 前端页面

- `pages/student-attendance/student-attendance`：今日签到、请假申请、历史记录、个人统计。
- `pages/attendance-manage/attendance-manage`：创建考勤场次、查看名单与统计、人工核实、请假审批。
- 学生首页增加“今日签到”，教练工作台增加“今日考勤”，开发者工作台增加“进入考勤管理”。

## 9. 本轮未完成的验证

- 云端集合、索引和 ADMINONLY 权限创建。
- 新版 `api` 部署。
- 真实学生 GPS 签到、教练真实考勤管理、真实请假审批、GPS误差与并发验收，统一留待阶段T。

## 10. 微信平台配置

学生签到使用官方 `wx.getLocation`。上线前需在微信公众平台确认并配置定位相关隐私声明与用户隐私保护指引；本轮未修改任何平台设置。
