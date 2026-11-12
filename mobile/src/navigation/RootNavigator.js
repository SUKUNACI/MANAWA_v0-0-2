import React from 'react';
import { useSelector } from 'react-redux';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';

export default function RootNavigator() {
  const { isAuthenticated } = useSelector((state) => state.auth);

  return isAuthenticated ? <AppNavigator /> : <AuthNavigator />;
}
