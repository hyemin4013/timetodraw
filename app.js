// ══════════════════════════════════════════════════════════════
//  app.js — 미술시간 Attendance Management SPA
//  Requires firebase.js (Firestore functions) to be loaded first.
// ══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────
  const DAY_KR  = ['일', '월', '화', '수', '목', '금', '토']; // 0=Sun
  const DAY_KR6 = ['월', '화', '수', '목', '금', '토'];        // index 0=Mon(1)…5=Sat(6)
  const HOURS   = Array.from({ length: 10 }, (_, i) => i + 10); // 10-19

  // ── Application State ─────────────────────────────────────────
  const state = {
    year:       new Date().getFullYear(),
    month:      new Date().getMonth() + 1,
    students:   [],
    schedules:  [],
    attendance: [],
    settings:   { disabledDates: [] },
    view:       'attendance',
  };

  // ── DOM Utilities ─────────────────────────────────────────────
  const $  = id  => document.getElementById(id);
  const qs = sel => document.querySelector(sel);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)            e.className   = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function showLoading() { $('loading-overlay').classList.remove('hidden'); }
  function hideLoading() { $('loading-overlay').classList.add('hidden');    }

  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }


  // ── Popup System ──────────────────────────────────────────────
  function showPopup(title, bodyHTML, buttons) {
    $('popup-title').textContent = title;
    $('popup-body').innerHTML    = bodyHTML;
    const footer = $('popup-footer');
    footer.innerHTML = '';
    (buttons || []).forEach(btn => {
      const b = el('button', btn.cls || 'btn-secondary', btn.label);
      b.onclick = () => { closePopup(); btn.action && btn.action(); };
      footer.appendChild(b);
    });
    $('popup-overlay').classList.remove('hidden');
  }

  function closePopup() {
    $('popup-overlay').classList.add('hidden');
  }

  $('popup-close').onclick = closePopup;
  $('popup-overlay').addEventListener('click', e => {
    if (e.target === $('popup-overlay')) closePopup();
  });


  // ── Year / Month Selectors ────────────────────────────────────
  function initPeriodSelectors() {
    const ySel = $('yearSelect');
    const mSel = $('monthSelect');
    const now  = new Date().getFullYear();

    for (let y = now - 2; y <= now + 1; y++) {
      const o = el('option', '', y + '년');
      o.value = y;
      if (y === state.year) o.selected = true;
      ySel.appendChild(o);
    }
    for (let m = 1; m <= 12; m++) {
      const o = el('option', '', m + '월');
      o.value = m;
      if (m === state.month) o.selected = true;
      mSel.appendChild(o);
    }

    ySel.onchange = () => { state.year  = +ySel.value; onPeriodChange(); };
    mSel.onchange = () => { state.month = +mSel.value; onPeriodChange(); };
  }

  async function onPeriodChange() {
    await loadMonthData();
    renderCurrentView();
  }


  // ── View Switching ────────────────────────────────────────────
  function switchView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const viewEl = $('view-' + name);
    if (viewEl) viewEl.classList.add('active');
    const btn = qs(`.nav-btn[data-view="${name}"]`);
    if (btn) btn.classList.add('active');
    state.view = name;
    renderCurrentView();
  }

  function renderCurrentView() {
    switch (state.view) {
      case 'attendance': renderAttendance(); break;
      case 'students':   renderStudents();   break;
      case 'week5':      renderWeek5();      break;
      case 'export':     renderExport();     break;
      case 'settings':   renderSettings();   break;
    }
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });


  // ── Data Loading ──────────────────────────────────────────────
  let loadError = null;

  async function loadMonthData(retryCount = 0) {
    showLoading();
    loadError = null;
    try {
      const ym = yearMonth();
      const [students, schedules, attendance, settings] = await Promise.all([
        getStudents(),
        getSchedules(ym),
        getAttendanceForMonth(ym),
        getSettings(),
      ]);
      state.students   = students;
      state.schedules  = schedules;
      state.attendance = attendance;
      state.settings   = settings || { disabledDates: [] };
    } catch (err) {
      console.error('loadMonthData 실패:', err);
      if (retryCount < 2) {
        hideLoading();
        await new Promise(r => setTimeout(r, 1200));
        return loadMonthData(retryCount + 1);
      }
      loadError = err.message;
      toast('데이터 로딩 실패: ' + err.message);
    } finally {
      hideLoading();
    }
  }


  // ── Date Helpers ──────────────────────────────────────────────
  function yearMonth() {
    return `${state.year}-${pad(state.month)}`;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function dateStr(day) {
    return `${state.year}-${pad(state.month)}-${pad(day)}`;
  }

  function daysInMonth() {
    return new Date(state.year, state.month, 0).getDate();
  }

  // JS day of week (0=Sun … 6=Sat) for a day-of-month
  function jsDay(day) {
    return new Date(state.year, state.month - 1, day).getDay();
  }

  // Convert JS day → system dayOfWeek (Mon=1 … Sat=6; Sun=7 unused)
  function toSysDay(jsd) { return jsd === 0 ? 7 : jsd; }

  function weekOfMonth(day) {
    const firstJsDay = new Date(state.year, state.month - 1, 1).getDay();
    return Math.ceil((day + firstJsDay) / 7);
  }

  // Previous yearMonth string
  function prevYearMonth() {
    const d = new Date(state.year, state.month - 2, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }


  // ── Per-student helpers ───────────────────────────────────────
  function studentScheduledDays(studentId) {
    const days = new Set();
    const stSched = state.schedules.filter(s => s.studentId === studentId);
    const total   = daysInMonth();
    for (let d = 1; d <= total; d++) {
      const sysD = toSysDay(jsDay(d));
      if (stSched.some(s => s.dayOfWeek === sysD)) days.add(d);
    }
    return days;
  }

  function attendanceMap() {
    // attendanceMap[studentId][date] = record
    const map = {};
    state.students.forEach(s => { map[s.id] = {}; });
    state.attendance.forEach(a => {
      if (!map[a.studentId]) map[a.studentId] = {};
      map[a.studentId][a.date] = a;
    });
    return map;
  }


  // ══════════════════════════════════════════════
  //  ATTENDANCE VIEW
  // ══════════════════════════════════════════════
  function renderAttendance() {
    $('attendance-title').textContent = `${state.year}년 ${state.month}월 출석부`;

    // Show/hide error banner
    let errBanner = $('attendance-error-banner');
    if (!errBanner) {
      errBanner = el('div', 'attendance-error-banner');
      errBanner.id = 'attendance-error-banner';
      $('view-attendance').insertBefore(errBanner, $('view-attendance').querySelector('.view-header').nextSibling);
    }
    if (loadError) {
      errBanner.style.display = '';
      errBanner.textContent = `⚠️ Firebase 연결 실패: ${loadError} — 아래 새로고침 버튼을 누르세요.`;
    } else {
      errBanner.style.display = 'none';
    }

    const hasStudents = state.students.length > 0;
    $('no-students-msg').style.display = hasStudents ? 'none' : '';
    qs('.attendance-table-wrapper').style.display = hasStudents ? '' : 'none';

    const noSchedules = state.schedules.length === 0 && hasStudents;
    const copyBtn = $('btn-copy-schedules');
    copyBtn.style.display = noSchedules ? '' : 'none';

    if (!hasStudents) return;

    const total    = daysInMonth();
    const disabled = new Set(state.settings.disabledDates || []);
    const aMap     = attendanceMap();

    // Build schedule lookup: schedMap[studentId][day] = schedule entry
    const schedMap = {};
    state.students.forEach(s => { schedMap[s.id] = {}; });
    state.schedules.forEach(sc => {
      if (!schedMap[sc.studentId]) schedMap[sc.studentId] = {};
      for (let d = 1; d <= total; d++) {
        if (toSysDay(jsDay(d)) === sc.dayOfWeek) {
          schedMap[sc.studentId][d] = sc;
        }
      }
    });

    // ── Header ──
    const thead = $('attendance-table').querySelector('thead');
    const tbody = $('attendance-table').querySelector('tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    const hRow = document.createElement('tr');
    const nameTh = el('th', 'col-name', '학생');
    hRow.appendChild(nameTh);

    for (let d = 1; d <= total; d++) {
      const jd      = jsDay(d);
      const dStr    = dateStr(d);
      const isDisab = disabled.has(dStr);
      const isSun   = jd === 0;
      const isSat   = jd === 6;

      const th = el('th', isSun ? 'day-sun' : (isSat ? 'day-sat' : '') + (isDisab ? ' day-disabled' : ''));
      th.innerHTML = `<div class="day-num">${d}</div><div class="day-label">${DAY_KR[jd]}</div>`;
      hRow.appendChild(th);
    }

    const sumTh = el('th', '', '출석');
    sumTh.style.minWidth = '52px';
    hRow.appendChild(sumTh);
    thead.appendChild(hRow);

    // ── Student rows ──
    state.students.forEach(student => {
      const row      = document.createElement('tr');
      const schedDays = new Set(Object.keys(schedMap[student.id] || {}).map(Number));
      let presentCnt = 0;
      let schedCnt   = 0;

      const limit        = (student.monthlySessionCount > 0) ? student.monthlySessionCount : null;
      const totalPresent = limit !== null
        ? state.attendance.filter(a => a.studentId === student.id && a.status === 'present').length
        : 0;

      const nameTd = el('td', 'col-name', student.name);
      row.appendChild(nameTd);

      for (let d = 1; d <= total; d++) {
        const td      = document.createElement('td');
        const dStr    = dateStr(d);
        const jd      = jsDay(d);
        const isDisab = disabled.has(dStr);
        const isSched = schedDays.has(d);
        const rec     = aMap[student.id]?.[dStr];
        const validStart  = /^\d{4}-\d{2}-\d{2}$/.test(student.startDate);
        const beforeStart = validStart && dStr < student.startDate;
        const isSun   = jd === 0;

        if (beforeStart) {
          td.classList.add('cell-before-start');
        } else if (isDisab) {
          td.classList.add('cell-disabled');
        } else if (isSun) {
          td.classList.add('cell-sunday');
        } else if (isSched) {
          schedCnt++;
          if (rec?.status === 'present') {
            td.classList.add('cell-present');
            presentCnt++;
            const cb = makeCB(true,  () => handleUncheck(student.id, dStr));
            td.appendChild(cb);
          } else {
            td.classList.add('cell-absent');
            const cb = makeCB(false, () => handleCheck(student.id, dStr));
            if (limit !== null && totalPresent >= limit) {
              cb.disabled = true;
              td.classList.add('cell-limit-reached');
              td.title = `월 목표 ${limit}회 도달`;
            }
            td.appendChild(cb);
          }
        } else {
          // Non-scheduled day
          if (rec?.status === 'makeup' || rec?.status === 'present') {
            td.classList.add('cell-makeup');
            const dot = el('span', 'makeup-dot');
            dot.title  = `보강 (${rec.originalDate || '날짜 없음'})`;
            dot.onclick = () => confirmRemoveMakeup(student, dStr);
            td.appendChild(dot);
          } else {
            td.classList.add('cell-clickable');
            td.onclick = () => handleNonScheduledClick(student, dStr, schedMap);
          }
        }

        row.appendChild(td);
      }

      // Summary cell — cap denominator by monthly session limit if set
      const displaySched = (limit !== null) ? Math.min(schedCnt, limit) : schedCnt;
      const sumTd = el('td', 'col-summary', `${presentCnt}/${displaySched}`);
      row.appendChild(sumTd);
      tbody.appendChild(row);
    });
  }

  function makeCB(checked, onChange) {
    const cb = document.createElement('input');
    cb.type      = 'checkbox';
    cb.className = 'cell-checkbox';
    cb.checked   = checked;
    if (!checked) cb.style.accentColor = '#dc2626';
    cb.addEventListener('change', async () => {
      cb.disabled = true;
      await onChange();
    });
    return cb;
  }

  async function handleCheck(studentId, dStr) {
    const student = state.students.find(s => s.id === studentId);
    if (student?.monthlySessionCount) {
      const cnt = state.attendance.filter(a => a.studentId === studentId && a.status === 'present').length;
      if (cnt >= student.monthlySessionCount) {
        toast(`월 수업 횟수(${student.monthlySessionCount}회)를 초과할 수 없습니다.`);
        return;
      }
    }
    try {
      await upsertAttendance({ studentId, date: dStr, status: 'present' });
      toast('출석 처리 완료');
      await loadMonthData();
      renderAttendance();
    } catch (e) {
      toast('오류: ' + e.message);
      await loadMonthData();
      renderAttendance();
    }
  }

  async function handleUncheck(studentId, dStr) {
    try {
      await deleteAttendance(studentId, dStr);
      toast('출석 취소');
      await loadMonthData();
      renderAttendance();
    } catch (e) {
      toast('오류: ' + e.message);
      await loadMonthData();
      renderAttendance();
    }
  }

  function confirmRemoveMakeup(student, dStr) {
    showPopup(
      '보강 삭제',
      `<strong>${student.name}</strong>의 <strong>${dStr}</strong> 보강 기록을 삭제하시겠습니까?`,
      [
        { label: '취소', cls: 'btn-secondary' },
        {
          label: '삭제', cls: 'btn-danger',
          action: async () => {
            await deleteAttendance(student.id, dStr);
            toast('보강 기록 삭제');
            await loadMonthData();
            renderAttendance();
          },
        },
      ]
    );
  }

  function handleNonScheduledClick(student, dStr, schedMap) {
    const day     = parseInt(dStr.split('-')[2]);
    const week    = weekOfMonth(day);
    const total   = daysInMonth();
    const aMap    = attendanceMap();

    // Find absent scheduled days in the same week for this student
    const absentThisWeek = [];
    for (let d = 1; d <= total; d++) {
      if (weekOfMonth(d) !== week) continue;
      if (!schedMap[student.id]?.[d]) continue;
      const dS = dateStr(d);
      const rec = aMap[student.id]?.[dS];
      if (!rec || rec.status === 'absent') absentThisWeek.push(dS);
    }

    let body = `<strong>${student.name}</strong>의 <strong>${dStr}</strong>은 정규 수업일이 아닙니다.<br>보강으로 처리하시겠습니까?`;

    const buttons = [{ label: '취소', cls: 'btn-secondary' }];

    if (absentThisWeek.length > 0) {
      body += `<div class="absent-options"><p style="margin-top:10px;font-weight:700;color:#111">같은 주 결석일 선택 (자동 대체):</p>`;
      absentThisWeek.forEach(absDate => {
        body += `<button class="absent-option-btn" data-absdate="${absDate}">${absDate} 결석 → 보강으로 대체</button>`;
      });
      body += `</div>`;
    } else {
      buttons.push({
        label: '보강으로 처리', cls: 'btn-primary',
        action: async () => {
          await upsertAttendance({ studentId: student.id, date: dStr, status: 'makeup', originalDate: null });
          toast('보강 처리 완료');
          await loadMonthData();
          renderAttendance();
        },
      });
    }

    showPopup('보강 처리', body, buttons);

    // Wire absent-option buttons after popup renders
    setTimeout(() => {
      document.querySelectorAll('.absent-option-btn').forEach(btn => {
        btn.onclick = async () => {
          const originalDate = btn.dataset.absdate;
          closePopup();
          await upsertAttendance({ studentId: student.id, date: dStr, status: 'makeup', originalDate });
          toast('보강 처리 완료');
          await loadMonthData();
          renderAttendance();
        };
      });
    }, 30);
  }

  // Refresh data button
  $('btn-refresh-data').onclick = async () => {
    await loadMonthData();
    renderAttendance();
  };

  // Copy schedules from previous month
  $('btn-copy-schedules').onclick = async () => {
    const prev = prevYearMonth();
    showLoading();
    try {
      const count = await copySchedules(prev, yearMonth());
      if (count === 0) {
        toast(`${prev}에 스케줄이 없습니다.`);
      } else {
        toast(`${count}개 스케줄을 복사했습니다.`);
        await loadMonthData();
        renderAttendance();
      }
    } catch (e) {
      toast('복사 실패: ' + e.message);
    } finally {
      hideLoading();
    }
  };


  // ══════════════════════════════════════════════
  //  STUDENT MANAGEMENT VIEW
  // ══════════════════════════════════════════════
  function renderStudents() {
    $('students-period-label').textContent = `기준 월: ${state.year}년 ${state.month}월`;
    const tbody = $('students-table').querySelector('tbody');
    tbody.innerHTML = '';

    if (state.students.length === 0) {
      const tr = document.createElement('tr');
      const td = el('td', '', '등록된 학생이 없습니다.');
      td.colSpan = 7;
      td.style.textAlign = 'center';
      td.style.color = 'var(--text-muted)';
      td.style.padding = '28px';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    state.students.forEach(student => {
      tbody.appendChild(buildStudentRow(student));
    });
  }

  function buildStudentRow(student) {
    const tr = document.createElement('tr');
    const aMap = attendanceMap();

    // Name
    tr.appendChild(editableCell(student.name, async val => {
      await updateStudent(student.id, { name: val });
      await loadMonthData();
      renderStudents();
    }));

    // Phone
    tr.appendChild(editableCell(student.phone || '', async val => {
      await updateStudent(student.id, { phone: val });
      await loadMonthData();
      renderStudents();
    }));

    // Schedule chips
    const schedTd = document.createElement('td');
    const stSched = state.schedules.filter(s => s.studentId === student.id);
    const chips   = el('div', 'schedule-chips');
    stSched.forEach(sc => {
      const chip = el('span', 'schedule-chip', `${DAY_KR6[sc.dayOfWeek - 1]} ${sc.hour}시`);
      const del  = el('span', 'chip-del', '✕');
      del.title  = '삭제';
      del.onclick = async () => {
        await deleteSchedule(sc.id);
        toast('수업 삭제');
        await loadMonthData();
        renderStudents();
      };
      chip.appendChild(del);
      chips.appendChild(chip);
    });

    const addBtn = el('button', 'btn-secondary btn-sm', '+ 추가');
    addBtn.onclick = () => showAddSchedulePopup(student);
    chips.appendChild(addBtn);
    schedTd.appendChild(chips);
    tr.appendChild(schedTd);

    // Attendance count this month
    const schedDays   = studentScheduledDays(student.id);
    const presentCnt  = state.attendance.filter(a => a.studentId === student.id && a.status === 'present').length;
    const schedTotal  = (student.monthlySessionCount > 0)
      ? Math.min(schedDays.size, student.monthlySessionCount)
      : schedDays.size;
    const countTd     = el('td', '', `${presentCnt} / ${schedTotal}`);
    countTd.style.textAlign = 'center';
    tr.appendChild(countTd);

    // Monthly session target
    const monthlyTd = editableCell(
      student.monthlySessionCount != null ? String(student.monthlySessionCount) : '',
      async val => {
        const num = val === '' ? null : parseInt(val);
        await updateStudent(student.id, { monthlySessionCount: isNaN(num) ? null : num });
        await loadMonthData();
        renderStudents();
      }
    );
    monthlyTd.style.textAlign = 'center';
    tr.appendChild(monthlyTd);

    // Paid badge — toggles all schedules for this student this month
    const isPaid   = stSched.length > 0 && stSched.every(s => s.paid);
    const paidTd   = document.createElement('td');
    const badge    = el('span', `paid-badge ${isPaid ? 'paid-yes' : 'paid-no'}`, isPaid ? '납부 ✓' : '미납');
    badge.onclick  = async () => {
      const newPaid = !isPaid;
      showLoading();
      try {
        for (const sc of stSched) await updateSchedule(sc.id, { paid: newPaid });
        toast(newPaid ? '납부 처리' : '미납으로 변경');
        await loadMonthData();
        renderStudents();
      } finally { hideLoading(); }
    };
    paidTd.appendChild(badge);
    tr.appendChild(paidTd);

    // Start date
    tr.appendChild(editableCell(student.startDate || '', async val => {
      await updateStudent(student.id, { startDate: val });
      await loadMonthData();
      renderStudents();
    }));

    // Delete button
    const actionsTd = document.createElement('td');
    const delBtn    = el('button', 'btn-danger btn-sm', '삭제');
    delBtn.onclick  = () => {
      showPopup(
        '학생 삭제',
        `<strong>${student.name}</strong> 학생을 삭제하시겠습니까?`,
        [
          { label: '취소', cls: 'btn-secondary' },
          {
            label: '삭제', cls: 'btn-danger',
            action: async () => {
              showLoading();
              try {
                await deleteStudent(student.id);
                toast('학생 삭제 완료');
                await loadMonthData();
                renderStudents();
              } finally { hideLoading(); }
            },
          },
        ]
      );
    };
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);

    return tr;
  }

  function editableCell(value, onSave) {
    const td   = document.createElement('td');
    const span = el('span', 'editable-cell', value || '—');

    span.onclick = () => {
      const input = document.createElement('input');
      input.value = value || '';
      input.style.cssText = 'border:1.5px solid var(--primary);border-radius:4px;padding:4px 6px;font-size:.88rem;width:100%;outline:none;';
      td.replaceChildren(input);
      input.focus();
      input.select();

      const save = async () => {
        const newVal = input.value.trim();
        if (newVal !== value) {
          showLoading();
          try { await onSave(newVal); }
          finally { hideLoading(); }
        } else {
          td.replaceChildren(span);
        }
      };

      input.onblur  = save;
      input.onkeydown = e => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { td.replaceChildren(span); }
      };
    };

    td.appendChild(span);
    return td;
  }

  function showAddSchedulePopup(student) {
    const ym = yearMonth();
    const body = `
      <div class="popup-field">
        <label>요일</label>
        <select id="sched-dow">
          ${DAY_KR6.map((d, i) => `<option value="${i + 1}">${d}요일</option>`).join('')}
        </select>
      </div>
      <div class="popup-field">
        <label>시간</label>
        <select id="sched-hour">
          ${HOURS.map(h => `<option value="${h}">${h}시</option>`).join('')}
        </select>
      </div>`;

    showPopup(`${student.name} — 수업 추가 (${ym})`, body, [
      { label: '취소', cls: 'btn-secondary' },
      {
        label: '추가', cls: 'btn-primary',
        action: async () => {
          const dow  = parseInt($('sched-dow').value);
          const hour = parseInt($('sched-hour').value);
          showLoading();
          try {
            await setSchedule({ studentId: student.id, yearMonth: ym, dayOfWeek: dow, hour, paid: false });
            toast('수업 추가 완료');
            await loadMonthData();
            renderStudents();
          } finally { hideLoading(); }
        },
      },
    ]);
  }

  // Add student popup
  $('btn-add-student').onclick = () => {
    const ym = yearMonth();
    const body = `
      <div class="popup-field"><label>이름 *</label><input id="ns-name" placeholder="홍길동" /></div>
      <div class="popup-field"><label>연락처</label><input id="ns-phone" placeholder="010-0000-0000" /></div>
      <div class="popup-field"><label>등록일 (수업 시작일)</label><input id="ns-start" type="date" /></div>
      <div class="popup-field">
        <label>수업 요일</label>
        <div class="day-checkboxes">
          ${DAY_KR6.map((d, i) => `<label class="day-check-label"><input type="checkbox" class="ns-dow" value="${i + 1}" />${d}</label>`).join('')}
        </div>
      </div>
      <div class="popup-field">
        <label>수업 시간</label>
        <select id="ns-hour">
          ${HOURS.map(h => `<option value="${h}">${h}시</option>`).join('')}
        </select>
      </div>
      <div class="popup-field"><label>월 수업 횟수</label><input id="ns-monthly" type="number" min="1" max="31" placeholder="예: 8" /></div>`;

    showPopup('학생 추가', body, [
      { label: '취소', cls: 'btn-secondary' },
      {
        label: '추가', cls: 'btn-primary',
        action: async () => {
          const name = $('ns-name').value.trim();
          if (!name) { toast('이름을 입력하세요.'); return; }
          const selectedDays = [...document.querySelectorAll('.ns-dow:checked')].map(cb => parseInt(cb.value));
          const hour = parseInt($('ns-hour').value);
          const monthlyRaw = $('ns-monthly').value.trim();
          const monthlySessionCount = (parseInt(monthlyRaw) > 0) ? parseInt(monthlyRaw) : null;
          showLoading();
          try {
            const studentData = {
              name,
              phone:     $('ns-phone').value.trim(),
              startDate: $('ns-start').value || '',
            };
            if (monthlySessionCount !== null) studentData.monthlySessionCount = monthlySessionCount;
            const studentId = await addStudent(studentData);
            for (const dow of selectedDays) {
              await setSchedule({ studentId, yearMonth: ym, dayOfWeek: dow, hour, paid: false });
            }
            toast('학생 추가 완료');
            await loadMonthData();
            renderStudents();
          } finally { hideLoading(); }
        },
      },
    ]);
  };


  // ══════════════════════════════════════════════
  //  WEEK 5 SETTINGS VIEW
  // ══════════════════════════════════════════════
  let w5Selected = new Set();

  function renderWeek5() {
    $('week5-title').textContent = `5주차 설정 — ${state.year}년 ${state.month}월`;
    w5Selected = new Set(state.settings.disabledDates || []);
    buildW5Calendar();
    renderW5List();
  }

  function buildW5Calendar() {
    const cal      = $('week5-calendar');
    cal.innerHTML  = '';
    const total    = daysInMonth();
    const firstJsd = new Date(state.year, state.month - 1, 1).getDay();

    // Day-of-week labels
    ['일', '월', '화', '수', '목', '금', '토'].forEach((d, i) => {
      const cls = i === 0 ? 'w5-label sun' : i === 6 ? 'w5-label sat' : 'w5-label';
      cal.appendChild(el('div', cls, d));
    });

    // Empty leading cells
    for (let i = 0; i < firstJsd; i++) cal.appendChild(el('button', 'w5-day empty'));

    for (let d = 1; d <= total; d++) {
      const dStr = dateStr(d);
      const jd   = jsDay(d);
      let cls    = 'w5-day';
      if (jd === 0) cls += ' is-sun';
      if (jd === 6) cls += ' is-sat';
      if (w5Selected.has(dStr)) cls += ' selected';

      const btn       = el('button', cls, String(d));
      btn.dataset.date = dStr;
      btn.onclick      = () => toggleW5Day(btn, dStr);
      cal.appendChild(btn);
    }
  }

  function toggleW5Day(btn, dStr) {
    if (w5Selected.has(dStr)) {
      w5Selected.delete(dStr);
      btn.classList.remove('selected');
    } else {
      w5Selected.add(dStr);
      btn.classList.add('selected');
    }
    renderW5List();
  }

  function renderW5List() {
    const list = $('week5-disabled-list');
    list.innerHTML = '';
    if (w5Selected.size === 0) return;
    list.appendChild(el('h4', '', '선택된 비활성화 날짜:'));
    Array.from(w5Selected).sort().forEach(d => list.appendChild(el('span', 'disabled-tag', d)));
  }

  // Auto-select 5th week (5th occurrence of each day of week)
  $('btn-week5-auto').onclick = () => {
    const total = daysInMonth();
    const count = Array(7).fill(0); // count[jsDay] = occurrence count
    for (let d = 1; d <= total; d++) {
      const jd = jsDay(d);
      count[jd]++;
      if (count[jd] === 5) {
        w5Selected.add(dateStr(d));
      }
    }
    buildW5Calendar();
    renderW5List();
    toast('5주차 날짜가 자동 선택되었습니다.');
  };

  $('btn-save-week5').onclick = async () => {
    showLoading();
    try {
      const sorted = Array.from(w5Selected).sort();
      await saveSettings({ disabledDates: sorted });
      state.settings.disabledDates = sorted;
      toast('저장 완료');
      renderW5List();
    } catch (e) {
      toast('저장 실패: ' + e.message);
    } finally {
      hideLoading();
    }
  };


  // ══════════════════════════════════════════════
  //  EXPORT VIEW
  // ══════════════════════════════════════════════
  function renderExport() {
    $('export-desc').textContent =
      `${state.year}년 ${state.month}월 출석 데이터를 CSV 파일로 내보냅니다. ` +
      `Excel에서 바로 열 수 있습니다. (${state.students.length}명)`;
  }

  $('btn-export-csv').onclick = exportCSV;

  function exportCSV() {
    const total    = daysInMonth();
    const disabled = new Set(state.settings.disabledDates || []);
    const aMap     = attendanceMap();
    const ym       = yearMonth();

    // Build header row
    const header = ['학생명', '연락처'];
    for (let d = 1; d <= total; d++) {
      header.push(`${d}(${DAY_KR[jsDay(d)]})`);
    }
    header.push('출석 횟수', '수업 횟수', '보강 횟수', '납부 여부');

    const rows = [header];

    state.students.forEach(student => {
      const row       = [student.name, student.phone || ''];
      const schedDays = studentScheduledDays(student.id);
      const stSched   = state.schedules.filter(s => s.studentId === student.id);
      let pCnt = 0, sCnt = 0, mCnt = 0;

      for (let d = 1; d <= total; d++) {
        const dStr         = dateStr(d);
        const isDisab      = disabled.has(dStr);
        const isSched      = schedDays.has(d);
        const beforeStart  = student.startDate && dStr < student.startDate;
        const rec          = aMap[student.id]?.[dStr];

        if (beforeStart || isDisab) { row.push('-'); continue; }

        if (isSched) {
          sCnt++;
          if (rec?.status === 'present') { row.push('O'); pCnt++; }
          else                           { row.push('X'); }
        } else {
          if (rec?.status === 'makeup') { row.push('보강'); mCnt++; }
          else                           { row.push('');          }
        }
      }

      const isPaid = stSched.length > 0 && stSched.every(s => s.paid);
      row.push(pCnt, sCnt, mCnt, isPaid ? '납부' : '미납');
      rows.push(row);
    });

    const bom  = '﻿';
    const csv  = bom + rows.map(r =>
      r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `출석_${ym}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('CSV 다운로드 시작');
  }


  // ══════════════════════════════════════════════
  //  SETTINGS VIEW
  // ══════════════════════════════════════════════
  function renderSettings() {
    const cont  = $('settings-disabled-dates');
    cont.innerHTML = '';
    const dates = (state.settings.disabledDates || []).slice().sort();

    if (dates.length === 0) {
      cont.textContent = '비활성화된 날짜가 없습니다.';
      cont.style.color = 'var(--text-muted)';
      return;
    }

    dates.forEach(d => {
      const row = el('div', 'settings-date-row');
      row.appendChild(el('span', 'disabled-tag', d));
      const btn = el('button', 'btn-danger btn-sm', '제거');
      btn.onclick = async () => {
        showLoading();
        try {
          await removeDisabledDate(d);
          state.settings.disabledDates = state.settings.disabledDates.filter(x => x !== d);
          toast('날짜 제거 완료');
          renderSettings();
        } finally { hideLoading(); }
      };
      row.appendChild(btn);
      cont.appendChild(row);
    });
  }


  // ── Initialization ────────────────────────────────────────────
  async function init() {
    initPeriodSelectors();
    await loadMonthData();
    try {
      renderCurrentView();
    } catch (err) {
      console.error('렌더링 오류:', err);
      toast('화면 표시 오류: ' + err.message);
    }
  }

  init();

})();
