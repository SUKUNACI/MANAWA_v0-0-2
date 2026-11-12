import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import BookingsListScreen from '@screens/booking/BookingsListScreen';
import BookingDetailsScreen from '@screens/booking/BookingDetailsScreen';
import BookingMessagesScreen from '@screens/booking/BookingMessagesScreen';

const Stack = createNativeStackNavigator();

export default function BookingStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        cardStyle: { backgroundColor: '#fff' },
      }}
    >
      <Stack.Screen
        name="BookingsList"
        component={BookingsListScreen}
        options={{
          title: 'My Bookings',
          headerBackVisible: false,
          headerStyle: {
            backgroundColor: '#fff',
            elevation: 0,
            shadowOpacity: 0,
          },
        }}
      />
      <Stack.Screen
        name="BookingDetails"
        component={BookingDetailsScreen}
        options={{
          title: 'Booking Details',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="BookingMessages"
        component={BookingMessagesScreen}
        options={{
          title: 'Messages',
          headerBackTitle: 'Back',
        }}
      />
    </Stack.Navigator>
  );
}
