import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { searchProperties } from '@store/slices/propertySlice';

export default function HomeScreen({ navigation }) {
  const dispatch = useDispatch();
  const { searchResults, isLoading } = useSelector((state) => state.property);

  useEffect(() => {
    dispatch(searchProperties({ limit: 10 }));
  }, [dispatch]);

  const handlePropertyPress = (propertyId) => {
    navigation.navigate('PropertyDetails', { propertyId });
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome to MANAWA</Text>
        <Text style={styles.subtext}>Find your perfect rental</Text>
      </View>

      <TouchableOpacity style={styles.searchCard} onPress={() => navigation.navigate('Search')}>
        <Text style={styles.searchIcon}>🔍</Text>
        <Text style={styles.searchText}>Where would you like to go?</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Featured Properties</Text>
        {isLoading ? (
          <Text style={styles.loadingText}>Loading...</Text>
        ) : (
          <FlatList
            data={searchResults.slice(0, 5)}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.propertyCard}
                onPress={() => handlePropertyPress(item.id)}
              >
                <View style={styles.propertyImage}>
                  <Text style={styles.imageIcon}>📷</Text>
                </View>
                <View style={styles.propertyInfo}>
                  <Text style={styles.propertyName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.propertyPrice}>${item.pricePerNight}/night</Text>
                </View>
              </TouchableOpacity>
            )}
            scrollEnabled={false}
          />
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Bookings', { screen: 'BookingsList' })}>
          <Text style={styles.actionIcon}>📅</Text>
          <Text style={styles.actionText}>My Bookings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Profile', { screen: 'ProfileHome' })}>
          <Text style={styles.actionIcon}>👤</Text>
          <Text style={styles.actionText}>My Profile</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20 },
  greeting: { fontSize: 24, fontWeight: 'bold', color: '#000', marginBottom: 4 },
  subtext: { fontSize: 14, color: '#666' },
  searchCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginBottom: 24, backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 14 },
  searchIcon: { fontSize: 20, marginRight: 12 },
  searchText: { flex: 1, fontSize: 14, color: '#999' },
  section: { paddingHorizontal: 24, marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12, color: '#000' },
  loadingText: { textAlign: 'center', color: '#999', paddingVertical: 20 },
  propertyCard: { flexDirection: 'row', marginBottom: 12, backgroundColor: '#f9f9f9', borderRadius: 8, padding: 12 },
  propertyImage: { width: 60, height: 60, borderRadius: 6, backgroundColor: '#e0e0e0', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  imageIcon: { fontSize: 24 },
  propertyInfo: { flex: 1, justifyContent: 'center' },
  propertyName: { fontSize: 14, fontWeight: '600', color: '#000' },
  propertyPrice: { fontSize: 12, color: '#0066cc', marginTop: 4 },
  actionButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12 },
  actionIcon: { fontSize: 20, marginRight: 12 },
  actionText: { fontSize: 14, fontWeight: '500', color: '#000' },
});
