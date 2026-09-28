// ==UserScript==
// @name         pStatIf 明文抓取（纯浏览器版）
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  捕获 pStatIf 明文对象，显示在面板并支持导出 JSON
// @match        https://byyxt.pupedu.cn/*
// @match        https://w.readoor.cn/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=pupedu.cn
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[pStatIf-dump]';
  const records = [];   // 所有捕获记录

  /* ================= 判断是否是 pStatIf 的明文对象 ================= */
  function isPStatIfPayload(v) {
    if (!v || typeof v !== 'object') return false;
    if (v.lesson_data && Array.isArray(v.lesson_data) && v.lesson_data.length > 0) {
      const L = v.lesson_data[0];
      if (L && typeof L.study_time === 'number') return true;
    }
    return false;
  }

  /* ================= hook JSON.stringify 拿明文 ================= */
  const origStringify = JSON.stringify;
  JSON.stringify = function (value, ...rest) {
    try {
      if (isPStatIfPayload(value)) {
        const plain = JSON.parse(origStringify.call(this, value));
        const rec = {
          time: new Date().toISOString(),
          page: location.href,
          payload: plain,
        };
        records.push(rec);
        addRecordToPanel(rec);
        console.log(TAG, '捕获到 pStatIf 明文：', plain);
      }
    } catch (e) {}
    return origStringify.apply(this, [value, ...rest]);
  };
  console.log(TAG, '已 hook JSON.stringify，等待 pStatIf 上报…');

  /* ================= 面板 ================= */
  const panel = document.createElement('div');
  panel.id = 'pStatIf-dump-panel';
  panel.style.cssText = `
    position: fixed; left: 12px; bottom: 12px; z-index: 2147483647;
    background: rgba(20,20,20,.95); color: #fff; padding: 10px 12px;
    border-radius: 8px; font: 12px/1.5 monospace; min-width: 320px; max-width: 420px;
    box-shadow: 0 2px 12px rgba(0,0,0,.5);
  `;
  panel.innerHTML = `
    <div style="font-weight:bold;margin-bottom:6px">
      📊 pStatIf 抓取 <span id="pst-count" style="color:#888;font-weight:normal">0 条</span>
    </div>
    <div id="pst-list" style="
      background:#111;padding:6px 8px;border-radius:4px;
      max-height:220px;overflow-y:auto;margin-bottom:8px;font-size:11px;
    "><div style="color:#666">等待捕获…</div></div>
    <div style="display:flex;gap:6px">
      <button id="pst-copy" style="flex:1;padding:5px 0;border:0;border-radius:4px;background:#2f7cf6;color:#fff;cursor:pointer">复制最新</button>
      <button id="pst-export" style="flex:1;padding:5px 0;border:0;border-radius:4px;background:#16a085;color:#fff;cursor:pointer">导出全部</button>
      <button id="pst-clear" style="padding:5px 8px;border:0;border-radius:4px;background:#555;color:#fff;cursor:pointer">清空</button>
    </div>
  `;
  document.body.appendChild(panel);

  const uiList  = panel.querySelector('#pst-list');
  const uiCount = panel.querySelector('#pst-count');

  function addRecordToPanel(rec) {
    if (uiList.querySelector('div[style*="666"]')) uiList.innerHTML = '';

    const p = rec.payload;
    const L = p.lesson_data && p.lesson_data[0] ? p.lesson_data[0] : {};
    const summary = `
      <div style="border-bottom:1px solid #333;padding:4px 0;">
        <div style="color:#9ad;">${new Date(rec.time).toLocaleTimeString()}</div>
        <div>study_time = <b style="color:#8f8">${L.study_time ?? '-'}</b> s</div>
        <div>start_time = ${L.start_time ?? '-'}</div>
        <div>end_time   = ${L.end_time ?? '-'}</div>
        <div>position   = ${L.position ?? '-'} / media_len = ${L.media_theory_length ?? '-'}</div>
        <div>session_id = ${String(L.session_id || '').slice(0, 12)}…</div>
        <div>sequence_id= ${L.sequence_id ?? '-'}</div>
      </div>
    `;
    uiList.insertAdjacentHTML('afterbegin', summary);
    uiCount.textContent = `${records.length} 条`;
  }

  /* ================= 按钮事件 ================= */
  panel.querySelector('#pst-copy').onclick = () => {
    if (!records.length) { alert('还没有捕获到数据'); return; }
    const latest = records[records.length - 1];
    const text = JSON.stringify(latest, null, 2);
    navigator.clipboard.writeText(text).then(
      () => alert('已复制最新一条到剪贴板'),
      () => alert('复制失败，请手动从控制台查看')
    );
  };

  panel.querySelector('#pst-export').onclick = () => {
    if (!records.length) { alert('还没有捕获到数据'); return; }
    const text = JSON.stringify(records, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pStatIf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  panel.querySelector('#pst-clear').onclick = () => {
    records.length = 0;
    uiList.innerHTML = '<div style="color:#666">等待捕获…</div>';
    uiCount.textContent = '0 条';
  };

  console.log(TAG, '面板已创建在左下角，播放视频等 60 秒即可捕获');
})();
// ==UserScript==
// @name         学习时长加速（双参数）
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  时间倍率 × 频率倍率，双参数控制 pStatIf 上报
// @match        https://byyxt.pupedu.cn/*
// @match        https://w.readoor.cn/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ================= 参数 ================= */
  const TIME_MULTIPLIER = 100;// ★ 时间倍率：study_time × N（每次上报计时的倍数）
  const FREQ_MULTIPLIER = 20.0;// ★ 频率倍率：Date.now() 加速，让上报更频繁
  const DRY_RUN = false;// ★ true = 只打印不改，确认逻辑后改 false
  const MAX_STUDY_TIME = 9999;// 单次 study_time 硬上限（视频长度），防越界

  const TAG = '[时长加速]';

  /* ================= 参数校验 ================= */
  if (TIME_MULTIPLIER <= 0) {
    console.warn(TAG, 'TIME_MULTIPLIER 必须 > 0，已重置为 1');
    TIME_MULTIPLIER = 1;
  }
  if (FREQ_MULTIPLIER < 1) {
    console.warn(TAG, 'FREQ_MULTIPLIER 必须 ≥ 1，已重置为 1');
    FREQ_MULTIPLIER = 1;
  }

  /* ================= 频率倍率：加速 Date.now() ================= */
  let dateHookInfo = null;
  if (FREQ_MULTIPLIER > 1 && !window.__pStatIfFreqHook) {
    const origNow = Date.now;
    const realStart = origNow.call(Date);
    const fakeStart = realStart;

    Date.now = function () {
      const realElapsed = origNow.call(Date) - realStart;
      return Math.floor(fakeStart + realElapsed * FREQ_MULTIPLIER);
    };

    // 顺便处理 new Date()（可选）
    const OrigDate = Date;
    function FakeDate(...args) {
      if (args.length === 0) {
        return new OrigDate(Date.now());
      }
      return new OrigDate(...args);
    }
    FakeDate.now = Date.now;
    FakeDate.parse = OrigDate.parse;
    FakeDate.UTC = OrigDate.UTC;
    FakeDate.prototype = OrigDate.prototype;
    window.Date = FakeDate;

    window.__pStatIfFreqHook = true;
    dateHookInfo = { realStart, fakeStart };
    console.log(`${TAG} ✅ Date.now() 已加速 ${FREQ_MULTIPLIER}×`);
  } else if (FREQ_MULTIPLIER > 1) {
    console.log(`${TAG} Date.now() 加速已存在，跳过重复安装`);
  }

  /* ================= 时间倍率：hook JSON.stringify ================= */
  if (!window.__pStatIfJsonHook) {
    const origStringify = JSON.stringify;

    function isPStatIfPayload(v) {
      return v
        && typeof v === 'object'
        && Array.isArray(v.lesson_data)
        && v.lesson_data.length > 0
        && typeof v.lesson_data[0].study_time === 'number';
    }

    JSON.stringify = function (value, ...rest) {
      if (!isPStatIfPayload(value)) {
        return origStringify.apply(this, [value, ...rest]);
      }

      let plain;
      try {
        plain = JSON.parse(origStringify.call(this, value));
      } catch (e) {
        return origStringify.apply(this, [value, ...rest]);
      }

      const L = plain.lesson_data[0];
      const origStudy = L.study_time;
      const origStart = L.start_time;
      const origEnd = L.end_time;
      const origStamp = plain.base_data.time_stamp;

      // 计算新的 study_time
      let newStudy = Math.floor(origStudy * TIME_MULTIPLIER);
      if (newStudy > MAX_STUDY_TIME) newStudy = MAX_STUDY_TIME;
      if (newStudy < 1) newStudy = origStudy;

      // end_time 不变，start_time 往前推，保证 end - start == study_time
      const newStart = origEnd - newStudy;

      // time_stamp 与 end_time 保持原有关系（不变）
      const newStamp = origStamp;

      console.log(
        `${TAG} 🔍 拦截 pStatIf\n` +
        `    seq=${L.sequence_id}  study=${origStudy} → ${newStudy}\n` +
        `    start=${origStart} → ${newStart}\n` +
        `    end=${origEnd}  stamp=${newStamp}\n` +
        `    position=${L.position} / media_len=${L.media_theory_length}`
      );

      if (!DRY_RUN) {
        L.study_time = newStudy;
        L.start_time = newStart;
        plain.base_data.time_stamp = newStamp;
      } else {
        console.log(`${TAG} ⚠️ DRY_RUN 模式：数据未修改`);
      }

      return origStringify.call(this, plain, ...rest);
    };

    window.__pStatIfJsonHook = true;
    console.log(`${TAG} ✅ JSON.stringify 已 hook`);
  } else {
    console.log(`${TAG} JSON.stringify hook 已存在，跳过`);
  }

  /* ================= 启动日志 ================= */
  console.log(
    `\n${TAG} ============================\n` +
    `  时间倍率 TIME_MULTIPLIER = ${TIME_MULTIPLIER}\n` +
    `  频率倍率 FREQ_MULTIPLIER = ${FREQ_MULTIPLIER}\n` +
    `  有效速率 = ${(TIME_MULTIPLIER * FREQ_MULTIPLIER).toFixed(2)}×\n` +
    `  DRY_RUN = ${DRY_RUN}\n` +
    `${TAG} ============================\n`
  );

  if (DRY_RUN) {
    console.log(`${TAG} 当前为观察模式，只打印不改。确认无误后请将 DRY_RUN 改为 false`);
  }

  /* ================= 提供给控制台的手动调节接口 ================= */
  window.__pStatIfControl = {
    setTimeMultiplier(n) {
      if (typeof n !== 'number' || n <= 0) return console.log('无效');
      console.log(`${TAG} 请刷新页面后生效：TIME_MULTIPLIER = ${n}`);
    },
    setFreqMultiplier(n) {
      if (typeof n !== 'number' || n < 1) return console.log('无效');
      console.log(`${TAG} 请刷新页面后生效：FREQ_MULTIPLIER = ${n}`);
    },
    getStatus() {
      return {
        TIME_MULTIPLIER,
        FREQ_MULTIPLIER,
        effectiveRate: TIME_MULTIPLIER * FREQ_MULTIPLIER,
        DRY_RUN,
        dateHooked: !!window.__pStatIfFreqHook,
        jsonHooked: !!window.__pStatIfJsonHook,
      };
    },
  };

  console.log(`${TAG} 控制台可用 window.__pStatIfControl.getStatus()`);
})();
