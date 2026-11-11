// PII Masking Rules Module - PII redaction configuration
import { apiCall } from './api.js';
import { showToast, openModal, escHtml } from './ui.js';

export async function loadPIIMaskingRules() {
  try {
    const res = await apiCall('/admin/security/pii-masking');
    const { rules = [] } = res;

    let html = rules.length === 0 ? '' : rules.map(r => {
      return `<tr onclick="window.PIIMasking.openRuleDetail('${r.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:12px;"><strong>${escHtml(r.fieldName)}</strong></td>
        <td style="padding:10px 12px;font-size:11px;">${escHtml(r.maskPattern || '***')}</td>
        <td style="padding:10px 12px;text-align:center;font-size:11px;">${r.enabled ? '✅' : '❌'}</td>
      </tr>`;
    }).join('');

    document.getElementById('pii-masking-tbody').innerHTML = html;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openRuleDetail(ruleId) {
  try {
    const res = await apiCall('/admin/security/pii-masking/' + ruleId);
    if (!res) return;

    const body = `<div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Champ</div>
      <div style="font-size:12px;font-weight:600;">${escHtml(res.fieldName)}</div>
    </div>
    <div style="background:var(--dark4);border-radius:10px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Pattern de masquage</div>
      <div style="font-size:12px;font-family:monospace;">${escHtml(res.maskPattern || '***')}</div>
    </div>`;

    document.getElementById('pii-masking-detail-modal-body').innerHTML = body;
    openModal('modal-pii-masking-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const PIIMasking = {
  loadPIIMaskingRules,
  openRuleDetail,
};
