import api from './api';

export const searchProperties = (searchParams = {}) => {
  const params = new URLSearchParams();

  if (searchParams.location) params.append('location', searchParams.location);
  if (searchParams.priceMin) params.append('priceMin', searchParams.priceMin);
  if (searchParams.priceMax) params.append('priceMax', searchParams.priceMax);
  if (searchParams.checkIn) params.append('checkIn', searchParams.checkIn);
  if (searchParams.checkOut) params.append('checkOut', searchParams.checkOut);
  if (searchParams.guests) params.append('guests', searchParams.guests);
  if (searchParams.page) params.append('page', searchParams.page);
  if (searchParams.limit) params.append('limit', searchParams.limit);
  if (searchParams.type) params.append('type', searchParams.type);

  return api.get(`/properties/search?${params.toString()}`);
};

export const getPropertyDetails = (propertyId) => {
  return api.get(`/properties/${propertyId}`);
};

export const getUserProperties = () => {
  return api.get('/users/properties');
};

export const createProperty = (propertyData) => {
  return api.post('/properties', propertyData);
};

export const updateProperty = (propertyId, propertyData) => {
  return api.put(`/properties/${propertyId}`, propertyData);
};

export const deleteProperty = (propertyId) => {
  return api.delete(`/properties/${propertyId}`);
};

export const uploadPropertyImages = async (propertyId, imageUris) => {
  const formData = new FormData();
  imageUris.forEach((uri, index) => {
    formData.append('images', {
      uri,
      type: 'image/jpeg',
      name: `property-${index}.jpg`,
    });
  });

  return api.post(`/properties/${propertyId}/images`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

export const getPropertyReviews = (propertyId) => {
  return api.get(`/properties/${propertyId}/reviews`);
};

export const addPropertyReview = (propertyId, review) => {
  return api.post(`/properties/${propertyId}/reviews`, review);
};

export const getFeaturedProperties = () => {
  return api.get('/properties/featured');
};

export const getNearbyProperties = (latitude, longitude, radius = 10) => {
  const params = new URLSearchParams({
    latitude,
    longitude,
    radius,
  });
  return api.get(`/properties/nearby?${params.toString()}`);
};
