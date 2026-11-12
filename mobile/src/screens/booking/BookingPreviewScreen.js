import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { createBooking } from '@store/slices/bookingSlice';

export default function BookingPreviewScreen({ route, navigation }) {
  const { propertyId } = route.params;
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const dispatch = useDispatch();
  const { isLoading } = useSelector((state) => state.booking);
  const { selectedProperty } = useSelector((state) => state.property);

  const handleConfirm = () => {
    if (checkIn && checkOut) {
      dispatch(createBooking({ propertyId, checkIn, checkOut }));
      navigation.navigate('Bookings', { screen: 'BookingsList' });
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.propertyCard}>
        <Text style={styles.propertyIcon}>🏠</Text>
        <Text style={styles.propertyName}>{selectedProperty?.name}</Text>
        <Text style={styles.propertyPrice}>${selectedProperty?.pricePerNight}/night</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Booking Details</Text>
        <View style={styles.dateInputRow}>
          <View style={styles.dateInput}>
            <Text style={styles.label}>Check In</Text>
            <Text style={styles.dateValue}>{checkIn || 'Select date'}</Text>
          </View>
          <View style={styles.dateInput}>
            <Text style={styles.label}>Check Out</Text>
            <Text style={styles.dateValue}>{checkOut || 'Select date'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Summary</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Nightly Rate</Text>
          <Text style={styles.summaryValue}>${selectedProperty?.pricePerNight}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryValueBold}>${(selectedProperty?.pricePerNight || 0) * 3}</Text>
        </View>
      </View>

      <TouchableOpacity style={[styles.confirmButton, isLoading && styles.buttonDisabled]} onPress={handleConfirm} disabled={isLoading}>
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmButtonText}>Confirm Booking</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 20 },
  propertyCard: { backgroundColor: '#f9f9f9', borderRadius: 8, padding: 16, marginBottom: 24, alignItems: 'center' },
  propertyIcon: { fontSize: 40, marginBottom: 8 },
  propertyName: { fontSize: 16, fontWeight: '600', color: '#000', marginBottom: 4 },
  propertyPrice: { fontSize: 18, fontWeight: 'bold', color: '#0066cc' },
  section: { marginBottom: 24 },
  title: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: '#000' },
  dateInputRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dateInput: { flex: 1, marginRight: 12, backgroundColor: '#f9f9f9', borderRadius: 8, padding: 12 },
  label: { fontSize: 12, color: '#999', marginBottom: 6 },
  dateValue: { fontSize: 14, color: '#000', fontWeight: '500' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  summaryLabel: { fontSize: 14, color: '#666' },
  summaryValue: { fontSize: 14, fontWeight: '500', color: '#000' },
  summaryValueBold: { fontSize: 16, fontWeight: 'bold', color: '#0066cc' },
  confirmButton: { backgroundColor: '#0066cc', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginBottom: 24 },
  buttonDisabled: { opacity: 0.6 },
  confirmButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
