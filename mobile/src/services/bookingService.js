import api from './api';

export const getUserBookings = (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.page) params.append('page', filters.page);
  if (filters.limit) params.append('limit', filters.limit);

  return api.get(`/bookings?${params.toString()}`);
};

export const getBookingDetails = (bookingId) => {
  return api.get(`/bookings/${bookingId}`);
};

export const createBooking = (bookingData) => {
  return api.post('/bookings', bookingData);
};

export const updateBooking = (bookingId, bookingData) => {
  return api.put(`/bookings/${bookingId}`, bookingData);
};

export const cancelBooking = (bookingId) => {
  return api.post(`/bookings/${bookingId}/cancel`);
};

export const getBookingMessages = (bookingId) => {
  return api.get(`/bookings/${bookingId}/messages`);
};

export const sendBookingMessage = (bookingId, message) => {
  return api.post(`/bookings/${bookingId}/messages`, { message });
};

export const getPropertyAvailability = (propertyId, startDate, endDate) => {
  const params = new URLSearchParams({
    startDate,
    endDate,
  });
  return api.get(`/properties/${propertyId}/availability?${params.toString()}`);
};
