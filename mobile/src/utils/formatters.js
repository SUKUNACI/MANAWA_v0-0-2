import moment from 'moment';
import numeral from 'numeral';

export const formatDate = (date, format = 'DD/MM/YYYY') => {
  return moment(date).format(format);
};

export const formatDateTime = (date, format = 'DD/MM/YYYY HH:mm') => {
  return moment(date).format(format);
};

export const formatTime = (date, format = 'HH:mm') => {
  return moment(date).format(format);
};

export const formatPrice = (price, currency = '$') => {
  return `${currency}${numeral(price).format('0,0.00')}`;
};

export const formatDistance = (meters) => {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
};

export const formatDuration = (days) => {
  if (days === 1) return '1 night';
  return `${days} nights`;
};

export const formatPhoneNumber = (phone) => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
};

export const truncateText = (text, length = 50) => {
  if (!text) return '';
  return text.length > length ? `${text.substring(0, length)}...` : text;
};

export const capitalizeFirstLetter = (string) => {
  if (!string) return '';
  return string.charAt(0).toUpperCase() + string.slice(1);
};

export const formatRating = (rating) => {
  return numeral(rating).format('0.0');
};

export const getRelativeTime = (date) => {
  return moment(date).fromNow();
};

export const getDayOfWeek = (date) => {
  return moment(date).format('dddd');
};

export const getMonthName = (date) => {
  return moment(date).format('MMMM');
};
