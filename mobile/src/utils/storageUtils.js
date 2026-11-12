import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEYS = {
  AUTH_TOKEN: 'authToken',
  REFRESH_TOKEN: 'refreshToken',
  USER_DATA: 'userData',
  SEARCH_HISTORY: 'searchHistory',
  FAVORITES: 'favorites',
  SETTINGS: 'settings',
  CACHE_PROPERTIES: 'cachedProperties',
  CACHE_BOOKINGS: 'cachedBookings',
  LAST_SYNC: 'lastSync',
};

export const saveToStorage = async (key, data) => {
  try {
    const value = typeof data === 'string' ? data : JSON.stringify(data);
    await AsyncStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`Error saving to storage: ${key}`, error);
    return false;
  }
};

export const getFromStorage = async (key) => {
  try {
    const value = await AsyncStorage.getItem(key);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    console.error(`Error reading from storage: ${key}`, error);
    return null;
  }
};

export const removeFromStorage = async (key) => {
  try {
    await AsyncStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error(`Error removing from storage: ${key}`, error);
    return false;
  }
};

export const clearStorage = async () => {
  try {
    await AsyncStorage.clear();
    return true;
  } catch (error) {
    console.error('Error clearing storage', error);
    return false;
  }
};

export const addToArray = async (key, item) => {
  try {
    let items = await getFromStorage(key);
    items = Array.isArray(items) ? items : [];
    items.unshift(item);
    await saveToStorage(key, items);
    return true;
  } catch (error) {
    console.error(`Error adding to array: ${key}`, error);
    return false;
  }
};

export const removeFromArray = async (key, itemId) => {
  try {
    let items = await getFromStorage(key);
    items = Array.isArray(items) ? items.filter((item) => item.id !== itemId) : [];
    await saveToStorage(key, items);
    return true;
  } catch (error) {
    console.error(`Error removing from array: ${key}`, error);
    return false;
  }
};

export const getStorageKeys = () => STORAGE_KEYS;
