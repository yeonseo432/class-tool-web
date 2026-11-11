import 'server-only';
import type { Ctx } from '../core';
import * as analysis from './analysis';
import * as bank from './bank';
import { bootstrap } from './bootstrap';
import * as classes from './classes';
import * as concepts from './concepts';
import * as live from './live';
import * as mis from './misconceptions';
import * as roster from './roster';
import * as settings from './settings';

/*
 * 교사용 기능 목록 — legacy Code.js 의 `const API = {...}` 와 같은 이름.
 * 화면에서는 POST /api/teacher { fn, args } 로 호출 (기존 google.script.run.api(token, fn, args)).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 화면에서 오는 인자는 각 함수가 직접 검증
type ApiFn = (ctx: Ctx, ...args: any[]) => Promise<unknown>;

export const API: Record<string, ApiFn> = {
  bootstrap,
  // 문제은행
  createFolder: bank.createFolder, renameFolder: bank.renameFolder, deleteItems: bank.deleteItems,
  moveItems: bank.moveItems, copyItems: bank.copyItems, saveQuestion: bank.saveQuestion,
  aiChat: bank.aiChat, aiFormat: bank.aiFormat, uploadImage: bank.uploadImage,
  aiChoices: bank.aiChoices, aiImage: bank.aiImage,
  // 수업
  listClasses: classes.classesMeta, createClass: classes.createClass, updateClass: classes.updateClass, deleteClass: classes.deleteClass,
  getLessons: classes.getLessons, addLesson: classes.addLesson, deleteLesson: classes.deleteLesson,
  updateLesson: classes.updateLesson, setLessonQuestions: classes.setLessonQuestions,
  getLessonDetail: classes.getLessonDetail, upcoming: classes.upcoming,
  // 학생 명단 (수업하기 › 학생 목록 관리)
  homerooms: roster.homerooms, getRoster: roster.getRoster, saveHomeroom: roster.saveHomeroom, deleteHomeroom: roster.deleteHomeroom,
  addStudents: roster.addStudents, updateStudent: roster.updateStudent, deleteStudents: roster.deleteStudents,
  resetStudentPassword: roster.resetStudentPassword,
  // 실시간 (교사 위젯)
  startLive: live.startLive, liveControl: live.liveControl, liveStats: live.liveStats,
  // 개념지도
  getConceptMap: concepts.getConceptMap, saveNode: concepts.saveNode, deleteNode: concepts.deleteNode,
  savePositions: concepts.savePositions, addLink: concepts.addLink, aiLinkConcepts: concepts.aiLinkConcepts, deleteLink: concepts.deleteLink,
  // 설정
  saveSettings: settings.saveSettings, saveSemester: settings.saveSemester,
  deleteSemester: settings.deleteSemester, saveHolidays: settings.saveHolidays,
  // 오개념
  getMisconceptions: mis.getMisconceptions, saveMisconception: mis.saveMisconception,
  deleteMisconception: mis.deleteMisconception, importMisconceptions: mis.importMisconceptions,
  // 형성평가 통계 · 출제 추천 (Analysis.js)
  getFormativeStats: analysis.getFormativeStats, recommendExam: analysis.recommendExam,
  examAdvice: analysis.examAdvice,
};
