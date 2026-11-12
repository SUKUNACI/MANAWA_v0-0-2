export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const validatePassword = (password) => {
  return password && password.length >= 8;
};

export const validatePhoneNumber = (phone) => {
  const re = /^[\d\s\-\+\(\)]+$/;
  return phone && re.test(phone) && phone.replace(/\D/g, '').length >= 10;
};

export const validateUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export const validatePriceRange = (min, max) => {
  return min && max && Number(min) < Number(max) && Number(min) >= 0 && Number(max) > 0;
};

export const validateDateRange = (startDate, endDate) => {
  if (!startDate || !endDate) return false;
  return new Date(startDate) < new Date(endDate);
};

export const validateRequired = (value) => {
  return value !== null && value !== undefined && value !== '';
};

export const validateMinLength = (value, minLength) => {
  return value && value.toString().length >= minLength;
};

export const validateMaxLength = (value, maxLength) => {
  return !value || value.toString().length <= maxLength;
};

export const validateFileSize = (sizeInBytes, maxSizeInMB) => {
  return sizeInBytes <= maxSizeInMB * 1024 * 1024;
};

export const validateImageFormat = (uri) => {
  const validFormats = ['jpg', 'jpeg', 'png', 'webp'];
  const extension = uri.split('.').pop().toLowerCase();
  return validFormats.includes(extension);
};
