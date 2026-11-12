export const PROPERTY_TYPES = [
  { id: 'apartment', label: 'Apartment' },
  { id: 'house', label: 'House' },
  { id: 'villa', label: 'Villa' },
  { id: 'cottage', label: 'Cottage' },
  { id: 'room', label: 'Room' },
  { id: 'studio', label: 'Studio' },
];

export const AMENITIES = [
  { id: 'wifi', label: 'WiFi', icon: 'wifi' },
  { id: 'ac', label: 'Air Conditioning', icon: 'snow' },
  { id: 'heating', label: 'Heating', icon: 'flame' },
  { id: 'kitchen', label: 'Kitchen', icon: 'restaurant' },
  { id: 'parking', label: 'Parking', icon: 'car' },
  { id: 'pool', label: 'Swimming Pool', icon: 'water' },
  { id: 'gym', label: 'Gym', icon: 'barbell' },
  { id: 'laundry', label: 'Laundry', icon: 'tshirt' },
];

export const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
};

export const BOOKING_STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  rejected: 'Rejected',
};

export const BOOKING_STATUS_COLORS = {
  pending: '#FFA500',
  confirmed: '#4CAF50',
  cancelled: '#F44336',
  completed: '#2196F3',
  rejected: '#9E9E9E',
};

export const DATE_FORMAT = 'DD/MM/YYYY';
export const TIME_FORMAT = 'HH:mm';
export const DATETIME_FORMAT = 'DD/MM/YYYY HH:mm';

export const CURRENCY = 'USD';
export const CURRENCY_SYMBOL = '$';

export const DEFAULT_PAGINATION_LIMIT = 20;
export const DEFAULT_SEARCH_RADIUS = 50;

export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network connection failed. Please check your connection.',
  UNAUTHORIZED: 'Authentication failed. Please log in again.',
  VALIDATION_ERROR: 'Please fill in all required fields.',
  SERVER_ERROR: 'Server error. Please try again later.',
  NOT_FOUND: 'Resource not found.',
};

export const SUCCESS_MESSAGES = {
  LOGIN_SUCCESS: 'Logged in successfully!',
  REGISTER_SUCCESS: 'Account created successfully!',
  LOGOUT_SUCCESS: 'Logged out successfully!',
  PROFILE_UPDATED: 'Profile updated successfully!',
  BOOKING_CREATED: 'Booking created successfully!',
  BOOKING_CANCELLED: 'Booking cancelled successfully!',
};
