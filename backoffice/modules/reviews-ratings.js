// Reviews & Ratings Module - Gestion avis clients
import { apiCall } from './api.js';
import { showToast, openModal, escHtml, formatDate } from './ui.js';

export async function loadReviews(page = 1, rating = '') {
  try {
    let url = '/admin/reviews?page=' + page;
    if (rating) url += '&rating=' + rating;

    const res = await apiCall(url);
    const { reviews = [], total = 0, pages = 0 } = res;

    let html = reviews.length === 0 ? '' : reviews.map(r => {
      const stars = '⭐'.repeat(r.rating) + ('☆'.repeat(5 - r.rating));
      const flagged = r.flagged ? '🚩' : '';

      return `<tr onclick="window.ReviewsRatings.openReviewDetail('${r.id}')" style="cursor:pointer;">
        <td style="padding:10px 12px;font-size:11px;"><strong>${escHtml(r.author?.firstName || '')}</strong></td>
        <td style="padding:10px 12px;text-align:center;">${stars}</td>
        <td style="padding:10px 12px;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.text || '—')}</td>
        <td style="padding:10px 12px;text-align:center;">${flagged}</td>
        <td style="padding:10px 12px;font-size:10px;">${formatDate(r.createdAt)}</td>
      </tr>`;
    }).join('');

    document.getElementById('reviews-tbody').innerHTML = html;
    document.getElementById('reviews-total').textContent = total;
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export async function openReviewDetail(reviewId) {
  try {
    const res = await apiCall('/admin/reviews/' + reviewId);
    if (!res) return;

    const stars = '⭐'.repeat(res.rating) + ('☆'.repeat(5 - res.rating));
    const flagged = res.flagged ? '🚩 Signalé' : 'Visible';

    const body = `<div style="font-size:16px;margin-bottom:16px;">${stars}</div>
      <div style="background:var(--dark4);border-radius:10px;padding:12px;margin-bottom:16px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px;"><strong>${escHtml(res.author?.firstName || '')}</strong></div>
        <div style="font-size:12px;line-height:1.5;">${escHtml(res.text || '')}</div>
      </div>
      <div style="font-size:11px;color:${flagged.includes('Signalé') ? '#EF4444' : '#22C55E'};">${flagged}</div>`;

    document.getElementById('reviews-detail-modal-body').innerHTML = body;
    openModal('modal-reviews-detail');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
}

export const ReviewsRatings = {
  loadReviews,
  openReviewDetail,
};
