// ==UserScript==
// @name         北大劳动网课全自动速刷+测验 v5
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  一键刷课：视频16倍速+PPT+自动完成测验（含多选，不跳过考试）
// @author       You
// @match        https://byyxt.pupedu.cn/*/c/pc/viewer*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=pupedu.cn
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ================= 配置 ================= */
  const CONFIG = {
    // 视频
    SPEED: 16,
    SKIP_BEFORE_END_S: 8,
    AFTER_RATE_WAIT_MS: 500,
    // PPT
    PPT_AFTER_LOAD_MS: 500,
    PPT_MAX_WAIT_MS: 10000,
    // 目录
    NODE_SELECTOR: '.el-tree-node[data-key]',
    CONTENT_SELECTOR: '.el-tree-node__content',
    TITLE_SELECTOR: '.viewer-table-tree-node-title',
    VIDEO_CLASS_RE: /node-file-l-104/,
    PPT_CLASS_RE:   /node-file-l-114/,
    EXAM_CLASS_RE:  /node-file-l-118/,
    VIDEO_SELECTOR: 'video',
    // 测验
    PASS_SCORE: 60,
    ANSWER_KEY_PREFIX: 'quiz_answers_v5_',
    DONE_EXAMS_KEY: 'done_exams_v5',
    CLICK_OPTION_DELAY_MS: 80,
    OPTION_LABEL_SELECTOR: 'label.el-radio.radio-option, label.el-checkbox.check-option',
    // 等待
    EXPAND_DELAY_MS: 150,
    WAIT_META_TIMEOUT_MS: 30000,
    WAIT_END_TIMEOUT_MS: 120000,
    WAIT_SWITCH_TIMEOUT_MS: 30000,
    WAIT_EXAM_READY_TIMEOUT_MS: 20000,
    WAIT_RESULT_TIMEOUT_MS: 40000,
    WAIT_REDO_TIMEOUT_MS: 30000,
    DIALOG_WATCH_MS: 15000,
    EXAM_DIALOG_WATCH_MS: 15000,
    QUIET_EXIT_ROUNDS: 2,
    EMPTY_EXIT_ROUNDS: 4,
    POLL_MS: 500,
    CONFIRM_TEXTS: /^(确定|确认|好的|知道了|OK|Ok|ok)$/,
  };

  /* ================= 工具 ================= */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log('[刷课+测验]', ...a);

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 &&
      s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  /* ================= 面板 ================= */
  document.getElementById('course-auto-box')?.remove();

  const box = document.createElement('div');
  box.id = 'course-auto-box';
  box.style.cssText = `
    position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
    background: rgba(20,20,20,.94); color: #fff; padding: 12px 14px;
    border-radius: 8px; font: 13px/1.6 monospace; min-width: 340px; max-width: 420px;
    box-shadow: 0 2px 12px rgba(0,0,0,.5);
  `;
  box.innerHTML = `
    <div style="font-weight:bold;margin-bottom:6px">🎓 一键刷课 v5 <span id="ca-state" style="color:#888;font-weight:normal"></span></div>
    <div id="ca-status" style="color:#9ad;margin-bottom:6px">待启动</div>
    <div id="ca-cur"  style="color:#cfe;font-size:12px;margin-bottom:2px">当前：-</div>
    <div id="ca-next" style="color:#aaa;font-size:12px;margin-bottom:6px">下一：-</div>
    <div style="background:#111;padding:6px 8px;border-radius:4px;font-size:11px;color:#bbb;max-height:120px;overflow-y:auto;margin-bottom:8px">
      <div id="ca-log">-</div>
    </div>
    <div style="display:flex;gap:6px">
      <button id="ca-start" style="flex:1;padding:6px 0;border:0;border-radius:4px;background:#2f7cf6;color:#fff;cursor:pointer">一键刷课</button>
      <button id="ca-stop"  style="flex:1;padding:6px 0;border:0;border-radius:4px;background:#c0392b;color:#fff;cursor:pointer">停止</button>
    </div>
    <div style="margin-top:6px;display:flex;gap:6px">
      <button id="ca-expand" style="flex:1;padding:5px 0;border:0;border-radius:4px;background:#8e44ad;color:#fff;cursor:pointer">展开全部讲</button>
      <button id="ca-jump"   style="flex:1;padding:5px 0;border:0;border-radius:4px;background:#28a745;color:#fff;cursor:pointer">只跳下一节</button>
    </div>
    <div style="margin-top:6px;display:flex;gap:6px">
      <button id="ca-answers" style="flex:1;padding:5px 0;border:0;border-radius:4px;background:#555;color:#fff;cursor:pointer">显示已存答案</button>
      <button id="ca-clear"   style="flex:1;padding:5px 0;border:0;border-radius:4px;background:#555;color:#fff;cursor:pointer">清空考试记录</button>
    </div>
  `;
  document.body.appendChild(box);

  const uiStatus = box.querySelector('#ca-status');
  const uiCur    = box.querySelector('#ca-cur');
  const uiNext   = box.querySelector('#ca-next');
  const uiState  = box.querySelector('#ca-state');
  const uiLog    = box.querySelector('#ca-log');
  const btnStart = box.querySelector('#ca-start');
  const btnStop  = box.querySelector('#ca-stop');

  const logs = [];
  function pushLog(t) {
    const ts = new Date().toLocaleTimeString();
    logs.push(`[${ts}] ${t}`);
    if (logs.length > 50) logs.shift();
    uiLog.innerHTML = logs.map(x => `<div>${x}</div>`).join('');
    uiLog.parentElement.scrollTop = uiLog.parentElement.scrollHeight;
  }
  const setStatus = (t, c = '#9ad') => { uiStatus.textContent = t; uiStatus.style.color = c; };
  const setState  = t => { uiState.textContent = t; };
  const setCur    = t => { uiCur.textContent = `当前：${t}`; };
  const setNext   = t => { uiNext.textContent = `下一：${t}`; };

  /* ================= 节点工具 ================= */
  const titleOf = n => n?.querySelector(CONFIG.TITLE_SELECTOR)?.textContent.trim() || '(无标题)';
  const keyOf   = n => n?.dataset?.key || '';

  const isVideoNode = n => !!n && CONFIG.VIDEO_CLASS_RE.test(n.className);
  const isPptNode   = n => !!n && CONFIG.PPT_CLASS_RE.test(n.className);
  const isExamNode  = n => !!n && CONFIG.EXAM_CLASS_RE.test(n.className);

  const isPlayable = n => isVideoNode(n) || isPptNode(n) || isExamNode(n);

  function nodeType(n) {
    if (isVideoNode(n)) return 'video';
    if (isPptNode(n))   return 'ppt';
    if (isExamNode(n))  return 'exam';
    return 'other';
  }
  function typeLabel(t) {
    return t === 'video' ? '🎬 视频'
         : t === 'ppt'   ? '📊 PPT'
         : t === 'exam'  ? '📝 考试'
         : '❔ 未知';
  }

  /* ================= 已完成的考试 ================= */
  let doneExams = new Set();
  function loadDoneExams() {
    try { doneExams = new Set(JSON.parse(sessionStorage.getItem(CONFIG.DONE_EXAMS_KEY) || '[]')); }
    catch { doneExams = new Set(); }
  }
  function saveDoneExams() {
    try { sessionStorage.setItem(CONFIG.DONE_EXAMS_KEY, JSON.stringify([...doneExams])); } catch {}
  }
  loadDoneExams();

  /* ================= 防回拉补丁 ================= */
  if (!HTMLMediaElement.prototype.__ctPatched) {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      get() { return desc.get.call(this); },
      set(t) { if (t <= desc.get.call(this)) return; desc.set.call(this, t); },
    });
    HTMLMediaElement.prototype.__ctPatched = true;
    log('currentTime 防回拉补丁已生效');
  }

  /* ================= 展开折叠讲 ================= */
  async function expandAllFolders(maxRounds = 30) {
    for (let round = 0; round < maxRounds; round++) {
      const collapsed = $$('.el-tree-node').filter(n => {
        if (!isVisible(n)) return false;
        if (n.classList.contains('is-expanded')) return false;
        const icon = n.querySelector(':scope > .el-tree-node__content > .el-tree-node__expand-icon');
        if (!icon || icon.classList.contains('is-leaf')) return false;
        return true;
      });
      if (!collapsed.length) return;
      for (const n of collapsed) {
        const icon = n.querySelector(':scope > .el-tree-node__content > .el-tree-node__expand-icon');
        if (icon) { icon.click(); await sleep(CONFIG.EXPAND_DELAY_MS); }
      }
      await sleep(400);
    }
  }

  /* ================= 当前节点 ================= */
  function findCurrentNode() {
    const sel = document.querySelector('.el-tree-node.node-file-l-sel');
    if (sel && isVisible(sel)) return sel;
    const sel2 = $$(CONFIG.NODE_SELECTOR).find(n => isVisible(n) && /node-file-l-sel/.test(n.className));
    if (sel2) return sel2;
    const sp = new URL(location.href).searchParams;
    const guid = sp.get('section_guid') || sp.get('sectionId');
    if (guid) {
      const byKey = document.querySelector(`.el-tree-node[data-key="${guid}"]`);
      if (byKey && isVisible(byKey)) return byKey;
    }
    return null;
  }

  /* ================= 下一个可处理节点 ================= */
  function tryExpandAncestors(node) {
    let el = node.parentElement;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('el-tree-node')) {
        if (!el.classList.contains('is-expanded')) {
          const icon = el.querySelector(':scope > .el-tree-node__content > .el-tree-node__expand-icon');
          if (icon && !icon.classList.contains('is-leaf')) { icon.click(); return true; }
        }
      }
      el = el.parentElement;
    }
    return false;
  }

  function findNextPlayable(cur, skipDoneExams = true) {
    if (!cur) return null;
    const all = $$(CONFIG.NODE_SELECTOR);
    const idx = all.indexOf(cur);
    if (idx < 0) return null;
    for (let i = idx + 1; i < all.length; i++) {
      const n = all[i];
      if (!isPlayable(n)) continue;
      // 跳过已完成的考试
      if (skipDoneExams && isExamNode(n) && doneExams.has(keyOf(n))) continue;
      if (!isVisible(n)) {
        tryExpandAncestors(n);
        if (!isVisible(n)) continue;
      }
      return n;
    }
    return null;
  }

  async function findNextPlayableAsync(cur) {
    let next = findNextPlayable(cur);
    if (next) return next;
    log('当前 DOM 找不到下一节，展开所有讲…');
    await expandAllFolders();
    const cur2 = findCurrentNode() || cur;
    return findNextPlayable(cur2);
  }

  /* ================= 等待工具 ================= */
  function waitMetadata(v, timeout = CONFIG.WAIT_META_TIMEOUT_MS) {
    return new Promise(res => {
      if (v.readyState >= 1 && v.duration > 0) return res(true);
      const t = setTimeout(() => res(false), timeout);
      v.addEventListener('loadedmetadata', () => { clearTimeout(t); res(true); }, { once: true });
    });
  }
  function waitEnded(v, timeout = CONFIG.WAIT_END_TIMEOUT_MS) {
    return new Promise(res => {
      if (v.ended) return res(true);
      const onEnded = () => { clearTimeout(t); res(true); };
      const t = setTimeout(() => { v.removeEventListener('ended', onEnded); res(false); }, timeout);
      v.addEventListener('ended', onEnded, { once: true });
    });
  }
  async function waitSwitchTo(nextKey, prevSrc, timeout = CONFIG.WAIT_SWITCH_TIMEOUT_MS) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      await sleep(300);
      const cur = findCurrentNode();
      if (cur && keyOf(cur) === nextKey) return true;
      const v = $(CONFIG.VIDEO_SELECTOR);
      const src = v?.currentSrc || v?.src || '';
      if (src && src !== prevSrc) return true;
    }
    return false;
  }
  async function waitFor(fn, timeout, label = '') {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (fn()) return true;
      await sleep(CONFIG.POLL_MS);
    }
    if (label) log(`等待超时：${label}`);
    return false;
  }

  /* ================= 视频处理 ================= */
  async function processVideo(v, title) {
    setCur(`🎬 视频：${title}`);
    setStatus('🎬 等待视频元数据…', '#9ad');
    await waitMetadata(v);

    v.muted = true;
    setStatus('🎬 启动播放…', '#9ad');
    try { await v.play(); } catch (e) { log('play 被拒:', e.message); }

    setStatus(`🎬 设置 ${CONFIG.SPEED} 倍速…`, '#9ad');
    try { v.playbackRate = CONFIG.SPEED; } catch (e) {}

    await sleep(CONFIG.AFTER_RATE_WAIT_MS);

    const dur = v.duration || 0;
    if (dur > 0) {
      const target = Math.max(0, dur - CONFIG.SKIP_BEFORE_END_S);
      setStatus(`🎬 跳到 ${target.toFixed(1)}s / ${dur.toFixed(1)}s`, '#9ad');
      try { v.currentTime = target; } catch (e) {}
    }

    setStatus('🎬 等待视频结束…', '#9ad');
    await waitEnded(v);
    setStatus('🎬 视频结束', '#8f8');
  }

  /* ================= PPT 处理 ================= */
  async function processPpt(title) {
    setCur(`📊 PPT：${title}`);
    setStatus('📊 等待 PPT 加载…', '#f0ad4e');

    const iframe = document.querySelector('iframe');
    if (iframe) {
      await new Promise(res => {
        try { if (iframe.contentDocument?.readyState === 'complete') return res(); } catch {}
        const t = setTimeout(res, CONFIG.PPT_MAX_WAIT_MS);
        iframe.addEventListener('load', () => { clearTimeout(t); res(); }, { once: true });
      });
      await sleep(800);
    } else {
      await sleep(2000);
    }

    setStatus('📊 PPT 已加载，等待 0.5s…', '#f0ad4e');
    await sleep(CONFIG.PPT_AFTER_LOAD_MS);
    setStatus('📊 PPT 完成', '#8f8');
  }

  /* ================= 弹窗处理 ================= */
  function findVisibleDialogs() {
    const list = [];
    for (const sel of ['.van-dialog', '.van-popup--center', '.el-dialog', '.el-message-box']) {
      document.querySelectorAll(sel).forEach(d => { if (isVisible(d)) list.push(d); });
    }
    return list;
  }

  function findConfirmBtn(dialog) {
    const v = dialog.querySelector('.van-dialog__confirm');
    if (v && isVisible(v)) return v;
    const e = dialog.querySelector('.el-button--primary');
    if (e && isVisible(e)) return e;
    const btns = [...dialog.querySelectorAll('button, .van-button, .el-button')].filter(b => isVisible(b));
    return btns.find(b => {
      const t = b.textContent.trim();
      if (!CONFIG.CONFIRM_TEXTS.test(t)) return false;
      if (/cancel|取消/.test(b.className)) return false;
      return true;
    }) || null;
  }

  function closeAllVisibleDialogs() {
    let count = 0;
    for (const d of findVisibleDialogs()) {
      const btn = findConfirmBtn(d);
      if (!btn) continue;
      try { btn.click(); count++; } catch (e) {}
    }
    return count;
  }

  async function watchAndCloseDialogs(timeoutMs, label = '') {
    const end = Date.now() + timeoutMs;
    let total = 0, quietRounds = 0, sawFirst = false;
    while (Date.now() < end) {
      const n = closeAllVisibleDialogs();
      if (n > 0) {
        total += n; sawFirst = true; quietRounds = 0;
        if (label) pushLog(`${label} 关闭弹窗 ×${n}`);
        await sleep(300);
        continue;
      }
      quietRounds++;
      if (sawFirst && quietRounds >= CONFIG.QUIET_EXIT_ROUNDS) break;
      if (!sawFirst && quietRounds >= CONFIG.EMPTY_EXIT_ROUNDS) break;
      await sleep(CONFIG.POLL_MS);
    }
    return total;
  }

  /* ================= 测验工具 ================= */
  function getExamState() {
    if (document.querySelector('.table-answer-correct')) return 'result';
    if (document.querySelector('.test-box[id]')) return 'question';
    return 'unknown';
  }
  function getExamScore() {
    const el = document.querySelector('.detailScoreTitle1');
    if (!el) return null;
    const n = parseFloat(el.textContent.trim());
    return isNaN(n) ? null : n;
  }
  function getQuestionType(boxEl) {
    const q = boxEl.closest('.test-content.flex-column');
    if (!q) return 'unknown';
    if (q.querySelector('.el-radio-group.radio-group')) return 'single';
    if (q.querySelector('.el-checkbox-group.check-group')) return 'multi';
    return 'unknown';
  }
  function getOptionLabels(q) {
    return $$(CONFIG.OPTION_LABEL_SELECTOR, q);
  }
  function getLabelLetter(label) {
    const v = label.querySelector('.optionValue')?.textContent || '';
    return v.replace(/[.、\s]/g, '');
  }
  function isLabelChecked(label) {
    return label.classList.contains('is-checked')
        || label.classList.contains('checked')
        || label.querySelector('input')?.checked === true;
  }

  function readAnswersFromPage() {
    const answers = {};
    document.querySelectorAll('.test-box[id]').forEach(boxEl => {
      const qid = boxEl.id;
      const q = boxEl.closest('.test-content.flex-column');
      if (!q) return;
      const type = getQuestionType(boxEl);
      const stemEl = q.querySelector('.test-item-title .rich-text-content')
                  || q.querySelector('.rich-text-content');
      const stem = stemEl?.textContent.trim() || '';

      const correctLetters = [];
      q.querySelectorAll('.table-answer-correct').forEach(cell => {
        const raw = cell.textContent.trim();
        if (!raw) return;
        let parts = raw.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
        if (parts.length === 1 && parts[0].length > 1 && /^[A-Za-z]+$/.test(parts[0])) {
          parts = parts[0].split('');
        }
        parts.forEach(p => {
          p.split('').forEach(ch => { if (/[A-Za-z]/.test(ch)) correctLetters.push(ch.toUpperCase()); });
        });
      });

      const correctTexts = [...q.querySelectorAll(
        'label.el-radio.radio-option.correct, label.el-checkbox.check-option.correct'
      )].map(l => l.querySelector('.optionName')?.textContent.trim() || '');

      const options = getOptionLabels(q).map(o => ({
        letter: getLabelLetter(o),
        text: o.querySelector('.optionName')?.textContent.trim() || '',
        isCorrect: o.classList.contains('correct'),
        isWrong: o.classList.contains('wrong'),
        isSelected: isLabelChecked(o),
      }));

      answers[qid] = { qid, type, stem, correctLetters, correctTexts, options };
    });
    return answers;
  }

  function getAnswerKey(examKey) { return CONFIG.ANSWER_KEY_PREFIX + examKey; }
  function saveAnswers(examKey, answers) {
    try {
      localStorage.setItem(getAnswerKey(examKey), JSON.stringify(answers));
      log(`已保存 ${Object.keys(answers).length} 题答案 → ${getAnswerKey(examKey)}`);
    } catch (e) { log('保存答案失败', e); }
  }
  function loadAnswers(examKey) {
    try {
      const raw = localStorage.getItem(getAnswerKey(examKey));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function fillAllA() {
    setStatus('📝 全选 A…', '#e67e22');
    const boxes = $$('.test-box[id]');
    if (!boxes.length) return false;
    let filled = 0;
    for (const boxEl of boxes) {
      const q = boxEl.closest('.test-content.flex-column');
      if (!q) continue;
      const labels = getOptionLabels(q);
      if (!labels.length) continue;
      const aOpt = labels.find(l => getLabelLetter(l) === 'A') || labels[0];
      if (isLabelChecked(aOpt)) continue;
      aOpt.click();
      filled++;
      await sleep(CONFIG.CLICK_OPTION_DELAY_MS);
    }
    pushLog(`已全选 A（${filled} 题）`);
    return true;
  }

  async function answerWithSaved(examKey) {
    const saved = loadAnswers(examKey);
    if (!saved) { pushLog('❌ 无已存答案'); return false; }

    const boxes = $$('.test-box[id]');
    if (!boxes.length) return false;

    let filled = 0, missing = 0;
    for (const boxEl of boxes) {
      const qid = boxEl.id;
      const answer = saved[qid];
      if (!answer) { missing++; continue; }
      const q = boxEl.closest('.test-content.flex-column');
      if (!q) continue;
      const labels = getOptionLabels(q);
      if (!labels.length) continue;

      for (const letter of answer.correctLetters) {
        const opt = labels.find(l => getLabelLetter(l) === letter);
        if (!opt) continue;
        if (isLabelChecked(opt)) continue;
        opt.click();
        await sleep(CONFIG.CLICK_OPTION_DELAY_MS);
      }
      filled++;
    }
    pushLog(`按答案作答：填 ${filled} 题，缺答案 ${missing} 题`);
    return true;
  }

  async function clickExamSubmit() {
    const submit = $$('button, .el-button, .van-button')
      .find(b => /^交卷$/.test(b.textContent.trim()) && !b.closest('.van-dialog'));
    if (!submit) { pushLog('❌ 找不到交卷按钮'); return false; }
    submit.click();
    pushLog('已点击交卷');
    return true;
  }

  async function waitExamResult() {
    setStatus('⏳ 等待结果页…', '#e67e22');
    const end = Date.now() + CONFIG.WAIT_RESULT_TIMEOUT_MS;
    while (Date.now() < end) {
      closeAllVisibleDialogs();
      if (document.querySelector('.table-answer-correct')) {
        await sleep(200);
        closeAllVisibleDialogs();
        return true;
      }
      await sleep(CONFIG.POLL_MS);
    }
    pushLog('⚠️ 等待结果页超时');
    return false;
  }

  async function clickRedo() {
    setStatus('🔁 点击重做…', '#e67e22');
    const btn = document.querySelector('.reanswer-button button');
    if (!btn) { pushLog('❌ 找不到重做按钮'); return false; }
    btn.click();
    pushLog('已点击重做');
    await watchAndCloseDialogs(4000, '[重做]');
    const end = Date.now() + CONFIG.WAIT_REDO_TIMEOUT_MS;
    while (Date.now() < end) {
      if (document.querySelector('.test-box[id]') && !document.querySelector('.table-answer-correct')) {
        pushLog('✅ 已进入重做状态');
        return true;
      }
      closeAllVisibleDialogs();
      await sleep(500);
    }
    pushLog('⚠️ 等待进入重做状态超时');
    return false;
  }

  /* ================= 完整测验流程 ================= */
  async function processExam(examNode) {
    const examKey = keyOf(examNode);
    const examTitle = titleOf(examNode);
    setCur(`📝 考试：${examTitle}`);
    setStatus(`📝 处理测验：${examTitle}`, '#e67e22');
    pushLog(`开始处理测验 [${examKey}]`);

    const ready = await waitFor(() => {
      return document.querySelector('.test-box[id]') || document.querySelector('.table-answer-correct');
    }, CONFIG.WAIT_EXAM_READY_TIMEOUT_MS, '考试页就绪');
    if (!ready) { pushLog('❌ 考试页没有出现'); return false; }

    let state = getExamState();
    pushLog(`当前考试状态：${state}`);

    // 已经在结果页
    if (state === 'result') {
      const score = getExamScore();
      pushLog(`已有结果：${score} 分`);
      if (score !== null && score >= CONFIG.PASS_SCORE) {
        pushLog('✅ 已通过，跳过');
        return true;
      }
      const answers = readAnswersFromPage();
      if (Object.keys(answers).length) saveAnswers(examKey, answers);
      if (!await clickRedo()) return false;
      await answerWithSaved(examKey);
      await sleep(300);
      await clickExamSubmit();
      await watchAndCloseDialogs(CONFIG.EXAM_DIALOG_WATCH_MS, '[交卷]');
      await waitExamResult();
      const score2 = getExamScore();
      pushLog(`第二遍得分：${score2}`);
      return true;
    }

    // 作答页
    if (state === 'question') {
      await fillAllA();
      await sleep(400);
      await clickExamSubmit();
      await watchAndCloseDialogs(CONFIG.EXAM_DIALOG_WATCH_MS, '[交卷]');
      await waitExamResult();

      const score = getExamScore();
      pushLog(`第一遍得分：${score}`);
      if (score !== null && score >= CONFIG.PASS_SCORE) {
        pushLog('🎉 全选 A 通过，无需重做');
        return true;
      }

      const answers = readAnswersFromPage();
      if (!Object.keys(answers).length) {
        pushLog('❌ 没有读到答案');
        return false;
      }
      saveAnswers(examKey, answers);

      if (!await clickRedo()) return false;
      await answerWithSaved(examKey);
      await sleep(400);
      await clickExamSubmit();
      await watchAndCloseDialogs(CONFIG.EXAM_DIALOG_WATCH_MS, '[交卷]');
      await waitExamResult();

      const score2 = getExamScore();
      pushLog(`第二遍得分：${score2}`);
      return true;
    }

    pushLog('❌ 未知考试状态');
    return false;
  }

  /* ================= 主循环 ================= */
  let running = false;
  let stopped = false;

  async function main() {
    if (running) return;
    running = true; stopped = false;
    setState('· 运行中');
    pushLog('开始刷课（含测验）');

    while (!stopped) {
      const curNode = findCurrentNode();
      if (!curNode) {
        setStatus('⏳ 等待目录节点…');
        await sleep(500);
        continue;
      }

      const curType = nodeType(curNode);
      const curTitle = titleOf(curNode);
      const curKey = keyOf(curNode);

      const previewNext = findNextPlayable(curNode);
      setNext(previewNext ? `${typeLabel(nodeType(previewNext))} ${titleOf(previewNext)}` : '（无）');

      // 处理当前节点
      if (curType === 'video') {
        const v = $(CONFIG.VIDEO_SELECTOR);
        if (!v) { setStatus('🎬 等待视频元素…', '#9ad'); await sleep(500); continue; }
        await processVideo(v, curTitle);
      } else if (curType === 'ppt') {
        await processPpt(curTitle);
      } else if (curType === 'exam') {
        if (doneExams.has(curKey)) {
          pushLog(`📝 考试 [${curKey}] 已完成过，跳过`);
          setStatus('📝 考试已完成，跳过', '#8f8');
          await sleep(300);
        } else {
          const ok = await processExam(curNode);
          doneExams.add(curKey);
          saveDoneExams();
          if (ok) pushLog(`📝 考试 [${curKey}] 处理完成`);
          else pushLog(`⚠️ 考试 [${curKey}] 处理失败，标记为已完成避免死循环`);
        }
      } else {
        setStatus(`❔ 未知节点，跳过：${curTitle}`, '#fc8');
        await sleep(300);
      }

      if (stopped) break;

      // 找下一个
      setStatus('🔍 查找下一节…');
      const curNode2 = findCurrentNode() || curNode;
      const nextNode = await findNextPlayableAsync(curNode2);

      if (!nextNode) {
        setStatus('🎉 已全部完成', '#8f8');
        pushLog('所有节点已处理完');
        break;
      }

      const nextKey = keyOf(nextNode);
      const nextType = nodeType(nextNode);
      const nextTitle = titleOf(nextNode);
      setNext(`${typeLabel(nextType)} ${nextTitle}（key=${nextKey}）`);

      const vBefore = $(CONFIG.VIDEO_SELECTOR);
      const srcBefore = vBefore?.currentSrc || vBefore?.src || '';

      await sleep(600);
      const curAfter = findCurrentNode();
      if (curAfter && keyOf(curAfter) === nextKey) {
        log('网站已自动切到下一节');
        continue;
      }

      setStatus(`⏳ 等待网站加载（下一个是${typeLabel(nextType)}）…`, '#e67e22');
      (nextNode.querySelector(CONFIG.CONTENT_SELECTOR) || nextNode).click();

      const ok = await waitSwitchTo(nextKey, srcBefore, CONFIG.WAIT_SWITCH_TIMEOUT_MS);
      if (!ok) {
        log('第一次未检测到切换，重试…');
        (nextNode.querySelector(CONFIG.CONTENT_SELECTOR) || nextNode).click();
        await waitSwitchTo(nextKey, srcBefore, 15000);
      }

      if (stopped) break;
      setStatus('🔄 准备下一节…');
      await sleep(600);
    }

    running = false;
    setState(stopped ? '· 已停止' : '· 完成');
    setStatus(stopped ? '已停止' : '🎉 全部完成', stopped ? '#fc8' : '#8f8');
  }

  /* ================= 按钮绑定 ================= */
  btnStart.onclick = () => main();
  btnStop.onclick = () => { stopped = true; setStatus('⏹ 正在停止…', '#fc8'); pushLog('用户停止'); };

  box.querySelector('#ca-expand').onclick = async () => {
    setStatus('⏳ 展开全部讲…');
    await expandAllFolders();
    setStatus('✅ 已展开全部讲', '#8f8');
  };

  box.querySelector('#ca-jump').onclick = async () => {
    const cur = findCurrentNode();
    if (!cur) { setStatus('❌ 找不到当前节', '#f88'); return; }
    const next = await findNextPlayableAsync(cur);
    if (!next) { setStatus('⚠️ 没有下一节', '#fc8'); return; }
    setStatus(`⏩ 跳到：${typeLabel(nodeType(next))} ${titleOf(next)}`, '#e67e22');
    (next.querySelector(CONFIG.CONTENT_SELECTOR) || next).click();
  };

  box.querySelector('#ca-answers').onclick = () => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CONFIG.ANSWER_KEY_PREFIX));
    if (!keys.length) { pushLog('❌ 没有已存答案'); return; }
    keys.forEach(k => {
      try { console.log(k, JSON.parse(localStorage.getItem(k))); } catch {}
    });
    pushLog(`已存答案 ${keys.length} 份，详情见控制台`);
  };

  box.querySelector('#ca-clear').onclick = () => {
    if (!confirm('清空所有考试记录和已存答案？')) return;
    sessionStorage.removeItem(CONFIG.DONE_EXAMS_KEY);
    Object.keys(localStorage).filter(k => k.startsWith(CONFIG.ANSWER_KEY_PREFIX))
      .forEach(k => localStorage.removeItem(k));
    doneExams = new Set();
    pushLog('已清空考试记录和答案');
  };

  /* ================= 启动 ================= */
  setStatus('待启动，点「一键刷课」开始');
  pushLog('脚本已加载');
})();
