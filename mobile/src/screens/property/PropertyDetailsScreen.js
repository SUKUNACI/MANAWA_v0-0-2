import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { fetchPropertyDetails } from '@store/slices/propertySlice';

export default function PropertyDetailsScreen({ route, navigation }) {
  const { propertyId } = route.params;
  const dispatch = useDispatch();
  const { selectedProperty, isLoading } = useSelector((state) => state.property);

  useEffect(() => {
    dispatch(fetchPropertyDetails(propertyId));
  }, [dispatch, propertyId]);

  if (isLoading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#0066cc" />
      </View>
    );
  }

  if (!selectedProperty) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Property not found</Text>
      </View>
    );
  }

  const handleBooking = () => {
    navigation.navigate('BookingPreview', { propertyId });
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.imageSection}>
        <Text style={styles.imageIcon}>🏠</Text>
        <Text style={styles.imagePlaceholder}>View full gallery</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{selectedProperty.name}</Text>
        <Text style={styles.location}>{selectedProperty.location}</Text>
        
        <View style={styles.ratingRow}>
          <Text style={styles.rating}>⭐ {selectedProperty.rating || 'New'}</Text>
          <Text style={styles.price}>${selectedProperty.pricePerNight}/night</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{selectedProperty.description}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Amenities</Text>
          <View style={styles.amenitiesContainer}>
            {selectedProperty.amenities?.map((amenity, index) => (
              <Text key={index} style={styles.amenity}>{amenity}</Text>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Host</Text>
          <View style={styles.hostInfo}>
            <Text style={styles.hostIcon}>👤</Text>
            <View style={styles.hostDetails}>
              <Text style={styles.hostName}>{selectedProperty.hostName}</Text>
              <Text style={styles.hostSince}>Joined {selectedProperty.hostSince}</Text>
            </View>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.bookButton} onPress={handleBooking}>
        <Text style={styles.bookButtonText}>Book Now</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loaderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: '#666' },
  imageSection: { height: 250, backgroundColor: '#e0e0e0', justifyContent: 'center', alignItems: 'center' },
  imageIcon: { fontSize: 60, marginBottom: 12 },
  imagePlaceholder: { fontSize: 14, color: '#999' },
  content: { paddingHorizontal: 24, paddingVertical: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#000', marginBottom: 4 },
  location: { fontSize: 14, color: '#666', marginBottom: 12 },
  ratingRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  rating: { fontSize: 14, fontWeight: '600', color: '#FFA500' },
  price: { fontSize: 18, fontWeight: 'bold', color: '#0066cc' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: '#000' },
  description: { fontSize: 14, color: '#666', lineHeight: 20 },
  amenitiesContainer: { flexDirection: 'row', flexWrap: 'wrap' },
  amenity: { backgroundColor: '#f0f0f0', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, marginRight: 8, marginBottom: 8, fontSize: 12, color: '#666' },
  hostInfo: { flexDirection: 'row', alignItems: 'center' },
  hostIcon: { fontSize: 32, marginRight: 12 },
  hostDetails: { flex: 1 },
  hostName: { fontSize: 14, fontWeight: '600', color: '#000' },
  hostSince: { fontSize: 12, color: '#999', marginTop: 4 },
  bookButton: { backgroundColor: '#0066cc', paddingVertical: 14, marginHorizontal: 24, marginBottom: 24, borderRadius: 8, alignItems: 'center' },
  bookButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
