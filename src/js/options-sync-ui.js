/* Astral Chrome Sync settings UI */
'use strict';
(async () => {
  const el = id => document.getElementById(id);
  const status = el('astral-sync-status');
  const box = status.closest('.sync-intro');
  const toggle = el('astral-sync-enable');
  const recoveryButton = el('astral-sync-pull');
  let busy = false;
  let desiredToggle = null; // Keep the user's requested position while async enable runs.
  const descriptions = {
    off: '', 'waiting-cloud': '等待云端配置', pending: '待同步', syncing: '同步中…',
    synced: '', error: '同步失败',
    conflict: '配置冲突'
  };
  async function render() {
    const s = await AstralSync.state();
    toggle.checked = desiredToggle === null ? !!s.enabled : desiredToggle;
    el('astral-sync-switch-label').textContent = busy ? '处理中…' : s.enabled ? '已开启' : '已关闭';
    const kind = s.status || 'off';
    box.dataset.status = kind;
    status.textContent = descriptions[kind] ?? ('状态：' + kind);
    el('astral-sync-pending').hidden = !s.pending;
    el('astral-sync-time').textContent = s.lastSuccess
      ? '上次提交：' + new Date(s.lastSuccess).toLocaleString()
      : (kind === 'waiting-cloud' ? '当前未发现云端配置；检测到数据后将自动恢复' : (kind === 'synced' ? '暂无提交记录' : ''));
    el('astral-sync-retry-info').textContent = s.nextRetry && (kind === 'error')
      ? '预计重试：' + new Date(s.nextRetry).toLocaleString() : '';
    const details = [s.error, s.conflicts?.length ? '冲突字段：' + s.conflicts.join('、') : ''].filter(Boolean);
    const detail = el('astral-sync-detail');
    detail.hidden = !details.length;
    detail.textContent = details.join('\n');
    recoveryButton.disabled = busy; // Cloud restore must work before enabling sync.
    recoveryButton.textContent = '从云端恢复';
    ['astral-sync-push','astral-sync-retry'].forEach(id => {
      el(id).disabled = busy || (id !== 'astral-sync-push' && !s.enabled);
    });
    toggle.disabled = busy;
  }
  async function action(fn, requestedToggle = null) {
    if (busy) return;
    busy = true;
    desiredToggle = requestedToggle;
    try {
      await render();
      await fn();
    } catch (e) {
      const message = e?.message || String(e);
      // Persist errors in the visible UI even if enable() failed before it could save state.
      const previous = await chrome.storage.local.get('__astralSync');
      await chrome.storage.local.set({ __astralSync: {
        ...(previous.__astralSync || {}),
        enabled: false, status: 'error', error: message, pending: false
      }});
      console.error('Astral Sync:', e);
    } finally {
      busy = false;
      desiredToggle = null;
      await render();
    }
  }
  toggle.addEventListener('change', () => {
    const requested = toggle.checked;
    return action(async () => {
      if (!requested) { await AstralSync.disable(); return; }
      await AstralSync.enable('explicit-enable');
    }, requested);
  });
  el('astral-sync-push').addEventListener('click', () => action(async () => {
    if (confirm('以本机同步字段覆盖云端？请确认本机网站列表完整并已导出备份。')) { await AstralSync.enable('local'); await AstralSync.forceUpload(); }
  }));
  el('astral-sync-pull').addEventListener('click', () => action(async () => {
    if (confirm('从云端恢复会替换本机的设置、网址和样式。系统将先自动备份当前本机配置。确定继续？')) {
      await AstralSync.forceDownload(); location.reload();
    }
  }));
  el('astral-sync-retry').addEventListener('click', () => action(() => AstralSync.run()));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!busy && area === 'local' && '__astralSync' in changes) render().catch(() => {});
  });
  await render();
})();
