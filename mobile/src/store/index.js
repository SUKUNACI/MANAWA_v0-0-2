import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import thunk from 'redux-thunk';

import authReducer from './slices/authSlice';
import userReducer from './slices/userSlice';
import bookingReducer from './slices/bookingSlice';
import propertyReducer from './slices/propertySlice';
import networkReducer from './slices/networkSlice';

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['auth', 'user'],
  timeout: 12000,
};

const persistedAuthReducer = persistReducer(
  { ...persistConfig, key: 'auth' },
  authReducer
);

const persistedUserReducer = persistReducer(
  { ...persistConfig, key: 'user' },
  userReducer
);

export const store = configureStore({
  reducer: {
    auth: persistedAuthReducer,
    user: persistedUserReducer,
    booking: bookingReducer,
    property: propertyReducer,
    network: networkReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
      },
    }).concat(thunk),
});

export const persistor = persistStore(store);
export default store;
