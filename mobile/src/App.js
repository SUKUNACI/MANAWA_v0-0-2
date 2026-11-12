import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import NetInfo from '@react-native-community/netinfo';
import { useSelector, useDispatch } from 'react-redux';

import store, { persistor } from '@store/index';
import RootNavigator from '@navigation/RootNavigator';
import SplashScreen from '@screens/auth/SplashScreen';
import { setNetworkStatus } from '@store/slices/networkSlice';
import { ActivityIndicator, View } from 'react-native';

const AppContent = () => {
  const dispatch = useDispatch();
  const { isLoading } = useSelector((state) => state.auth);

  useEffect(() => {
    // Monitor network connectivity
    const unsubscribe = NetInfo.addEventListener((state) => {
      dispatch(
        setNetworkStatus({
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
        })
      );
    });

    return () => unsubscribe();
  }, [dispatch]);

  if (isLoading) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>
  );
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <PersistGate
          loading={
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color="#0066cc" />
            </View>
          }
          persistor={persistor}
        >
          <StatusBar barStyle="dark-content" backgroundColor="#fff" />
          <AppContent />
        </PersistGate>
      </Provider>
    </GestureHandlerRootView>
  );
}
