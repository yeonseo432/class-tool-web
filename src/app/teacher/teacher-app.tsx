'use client';

import { useEffect } from 'react';
import './teacher.css';

/**
 * 교사 화면 (legacy Index.html + AnalysisUI.html).
 * 화면 골격만 React로 그리고, 내용은 public/teacher-app/app.js → analysis.js 가 직접 그려요.
 * 두 스크립트는 전역 범위를 공유하는 일반 <script> 라서 한 페이지에서 한 번만 실행할 수 있어요.
 */
export default function TeacherApp() {
  useEffect(() => {
    const nav = document.getElementById('nav');
    if (document.querySelector('script[data-teacher-app]')) {
      // 이미 실행된 페이지에 다른 화면에서 돌아온 경우: 새 골격이므로 새로 불러옴
      // (개발 모드 StrictMode 의 두 번 실행은 같은 골격이라 그대로 둠)
      if (!nav?.dataset.init) location.reload();
      return;
    }
    if (nav) nav.dataset.init = '1';
    const load = (src: string) =>
      new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.dataset.teacherApp = '1';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(src));
        document.body.appendChild(s);
      });
    load('/teacher-app/app.js')
      .then(() => load('/teacher-app/analysis.js'))
      .catch((e) => {
        const main = document.getElementById('main');
        if (main) main.textContent = '화면을 불러오지 못했어요. 새로고침해 주세요. (' + e.message + ')';
      });
  }, []);

  return (
    <>
      <nav id="nav" />
      <div id="flyout" />
      <main id="main" />
      <div id="modalRoot" />
      <div id="toast" />
      <div id="busy" />
      <input type="file" id="fileInput" accept="image/*" hidden />
      <datalist id="subjList" />
    </>
  );
}
