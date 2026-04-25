/**
 * year-filter-patched.js
 * KPI card interactions: NG 筆數 hover → lot list, 異常追蹤 hover → anomaly list
 * Navigation: 前往 QC管理 → table1 with lot, 前往工作台 → IPQC rawdata
 */
(function () {
  'use strict';

  var API_BASE = '/qc-web-api/api';
  var STYLE_ID = 'kpi-card-patch-style';
  var MODAL_ID = 'kpi-hover-modal';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '[data-kpi-clickable] { cursor: pointer; transition: border-color .2s, box-shadow .2s; }',
      '[data-kpi-clickable]:hover { border-color: #4DA3FF !important; box-shadow: 0 0 12px rgba(77,163,255,.25); }',
      '#' + MODAL_ID + ' { position:fixed; z-index:9999; background:#121A2B; border:1px solid #2A3754; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.5); max-height:420px; width:400px; display:flex; flex-direction:column; overflow:hidden; }',
      '#' + MODAL_ID + ' .kpm-header { padding:12px 16px; border-bottom:1px solid #2A3754; display:flex; align-items:center; justify-content:space-between; }',
      '#' + MODAL_ID + ' .kpm-title { font-size:13px; font-weight:700; color:#EAF2FF; }',
      '#' + MODAL_ID + ' .kpm-close { background:none; border:none; color:#556A88; cursor:pointer; font-size:16px; }',
      '#' + MODAL_ID + ' .kpm-close:hover { color:#EAF2FF; }',
      '#' + MODAL_ID + ' .kpm-body { flex:1; overflow-y:auto; padding:8px; }',
      '#' + MODAL_ID + ' .kpm-row { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer; transition:background .15s; font-size:12px; }',
      '#' + MODAL_ID + ' .kpm-row:hover { background:#1A2438; }',
      '#' + MODAL_ID + ' .kpm-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }',
      '#' + MODAL_ID + ' .kpm-info { flex:1; min-width:0; }',
      '#' + MODAL_ID + ' .kpm-main { color:#EAF2FF; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '#' + MODAL_ID + ' .kpm-sub { color:#93A4C3; font-size:11px; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '#' + MODAL_ID + ' .kpm-date { color:#556A88; font-size:10px; flex-shrink:0; }',
      '#' + MODAL_ID + ' .kpm-empty { text-align:center; color:#556A88; padding:24px; font-size:12px; }',
      '#' + MODAL_ID + ' .kpm-loading { text-align:center; color:#93A4C3; padding:24px; font-size:12px; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function findKpiCard(target, labelText) {
    var el = target;
    for (var i = 0; i < 10 && el; i++) {
      if (el.getAttribute && el.getAttribute('data-kpi-clickable') === labelText) return el;
      el = el.parentElement;
    }
    return null;
  }

  function markKpiCards() {
    ['NG 筆數', '異常追蹤'].forEach(function (label) {
      var spans = document.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        if (spans[i].textContent && spans[i].textContent.trim() === label) {
          var el = spans[i];
          for (var j = 0; j < 6; j++) {
            el = el.parentElement;
            if (!el) break;
            if (el.classList && el.classList.contains('rounded-xl') && el.style && el.style.borderColor) {
              el.setAttribute('data-kpi-clickable', label);
              break;
            }
          }
          break;
        }
      }
    });
  }

  function removeModal() {
    var m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  function createModal(title, bodyHtml, cardEl) {
    removeModal();
    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    var rect = cardEl.getBoundingClientRect();
    var top = rect.bottom + 8;
    var left = rect.left;
    if (left + 400 > window.innerWidth) left = window.innerWidth - 416;
    if (top + 420 > window.innerHeight) top = rect.top - 428;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    modal.style.top = top + 'px';
    modal.style.left = left + 'px';
    modal.innerHTML =
      '<div class="kpm-header"><span class="kpm-title">' + title + '</span><button class="kpm-close">&times;</button></div>' +
      '<div class="kpm-body">' + bodyHtml + '</div>' +
      '';
    document.body.appendChild(modal);
    modal.querySelector('.kpm-close').addEventListener('click', removeModal);
    setTimeout(function () {
      document.addEventListener('mousedown', function handler(e) {
        var m = document.getElementById(MODAL_ID);
        if (!m || (!m.contains(e.target) && !cardEl.contains(e.target))) {
          removeModal();
          document.removeEventListener('mousedown', handler);
        }
      });
    }, 50);
    return modal;
  }

  function navigateToQcTable1(beadName, sheetName) {
    removeModal();
    if (typeof window.__navigateToQcLot === 'function') {
      window.__navigateToQcLot(beadName, sheetName);
    }
  }



  function renderRows(modal, rows, dotColor, descFn) {
    var bodyEl = modal.querySelector('.kpm-body');
    if (!rows || !rows.length) {
      bodyEl.innerHTML = '<div class="kpm-empty">目前沒有項目 🎉</div>';
      return;
    }
    bodyEl.innerHTML = rows.slice(0, 30).map(function (r) {
      var lot = [r.d_lot, r.bigD_lot, r.u_lot].filter(Boolean).join(' / ') || '';
      var desc = descFn(r);
      var color = typeof dotColor === 'function' ? dotColor(r) : dotColor;
      return '<div class="kpm-row" data-bead="' + (r.bead_name || '') + '" data-sheet="' + (r.sheet_name || '') + '">' +
        '<span class="kpm-dot" style="background:' + color + '"></span>' +
        '<div class="kpm-info"><div class="kpm-main">' + r.bead_name + ' / ' + r.sheet_name + '</div>' +
        '<div class="kpm-sub">' + (lot ? lot + (desc ? ' · ' : '') : '') + desc + '</div></div>' +
        '<span class="kpm-date">' + (r.insp_date ? r.insp_date.slice(0, 10) : '') + '</span></div>';
    }).join('');
    bodyEl.querySelectorAll('.kpm-row').forEach(function (row) {
      row.addEventListener('click', function () {
        navigateToQcTable1(row.getAttribute('data-bead'), row.getAttribute('data-sheet'));
      });
    });
    // footer buttons removed - row click navigates directly
  }

  function showNgLots(cardEl) {
    var modal = createModal('NG 批次清單', '<div class="kpm-loading">載入中…</div>', cardEl);
    fetch(API_BASE + '/drbeads/ng-lots')
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        renderRows(modal, rows, '#FF5C73', function (r) { return r.defect_desc || r.final_decision || ''; });
      })
      .catch(function () { modal.querySelector('.kpm-body').innerHTML = '<div class="kpm-empty">載入失敗</div>'; });
  }

  function showAnomalies(cardEl) {
    var modal = createModal('異常追蹤清單', '<div class="kpm-loading">載入中…</div>', cardEl);
    fetch(API_BASE + '/drbeads/anomaly-lots')
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        renderRows(modal, rows, function (r) {
          return (r.final_decision || '').toUpperCase().includes('HOLD') ? '#FFB84D' : '#A78BFA';
        }, function (r) {
          var isHold = (r.final_decision || '').toUpperCase().includes('HOLD');
          return isHold ? 'Hold' : '待判定';
        });
      })
      .catch(function () { modal.querySelector('.kpm-body').innerHTML = '<div class="kpm-empty">載入失敗</div>'; });
  }

  function installKpiCardActions() {
    document.addEventListener('click', function (e) {
      var ngCard = findKpiCard(e.target, 'NG 筆數');
      if (ngCard) { e.stopPropagation(); showNgLots(ngCard); return; }
      var anomalyCard = findKpiCard(e.target, '異常追蹤');
      if (anomalyCard) { e.stopPropagation(); showAnomalies(anomalyCard); return; }
    }, true);
  }

  function init() {
    injectStyles();
    installKpiCardActions();
    new MutationObserver(function () { markKpiCards(); }).observe(document.body, { childList: true, subtree: true });
    markKpiCards();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
