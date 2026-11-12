import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '@screens/home/HomeScreen';
import PropertyDetailsScreen from '@screens/property/PropertyDetailsScreen';
import BookingPreviewScreen from '@screens/booking/BookingPreviewScreen';

const Stack = createNativeStackNavigator();

export default function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        cardStyle: { backgroundColor: '#fff' },
      }}
    >
      <Stack.Screen
        name="HomeScreen"
        component={HomeScreen}
        options={{
          title: 'MANAWA',
          headerBackVisible: false,
          headerStyle: {
            backgroundColor: '#fff',
            elevation: 0,
            shadowOpacity: 0,
          },
        }}
      />
      <Stack.Screen
        name="PropertyDetails"
        component={PropertyDetailsScreen}
        options={{
          title: 'Property Details',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="BookingPreview"
        component={BookingPreviewScreen}
        options={{
          title: 'Confirm Booking',
          headerBackTitle: 'Back',
        }}
      />
    </Stack.Navigator>
  );
}
