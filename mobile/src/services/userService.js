import api from './api';

export const getUserProfile = () => {
  return api.get('/users/profile');
};

export const updateUserProfile = (userData) => {
  return api.put('/users/profile', userData);
};

export const uploadProfileImage = async (imageUri) => {
  const formData = new FormData();
  formData.append('image', {
    uri: imageUri,
    type: 'image/jpeg',
    name: 'profile.jpg',
  });

  return api.post('/users/profile/image', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

export const getUserStats = () => {
  return api.get('/users/stats');
};

export const updateUserSettings = (settings) => {
  return api.put('/users/settings', settings);
};
