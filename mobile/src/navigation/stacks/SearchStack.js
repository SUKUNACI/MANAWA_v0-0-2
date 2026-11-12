import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SearchScreen from '@screens/search/SearchScreen';
import SearchResultsScreen from '@screens/search/SearchResultsScreen';
import PropertyDetailsScreen from '@screens/property/PropertyDetailsScreen';
import BookingPreviewScreen from '@screens/booking/BookingPreviewScreen';

const Stack = createNativeStackNavigator();

export default function SearchStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        cardStyle: { backgroundColor: '#fff' },
      }}
    >
      <Stack.Screen
        name="SearchHome"
        component={SearchScreen}
        options={{
          title: 'Search Properties',
          headerBackVisible: false,
          headerStyle: {
            backgroundColor: '#fff',
            elevation: 0,
            shadowOpacity: 0,
          },
        }}
      />
      <Stack.Screen
        name="SearchResults"
        component={SearchResultsScreen}
        options={{
          title: 'Results',
          headerBackTitle: 'Back',
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
