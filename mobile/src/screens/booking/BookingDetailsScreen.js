import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { fetchBookingDetails } from '@store/slices/bookingSlice';

export default function BookingDetailsScreen({ route, navigation }) {
  const { bookingId } = route.params;
  const dispatch = useDispatch();
  const { selectedBooking, isLoading } = useSelector((state) => state.booking);

  useEffect(() => {
    dispatch(fetchBookingDetails(bookingId));
  }, [dispatch, bookingId]);

  if (isLoading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#0066cc" />
      </View>
    );
  }

  if (!selectedBooking) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Booking not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Booking Details</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{selectedBooking.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Property</Text>
        <Text style={styles.text}>{selectedBooking.propertyName}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Check In & Check Out</Text>
        <Text style={styles.text}>{selectedBooking.checkIn}</Text>
        <Text style={styles.text}>{selectedBooking.checkOut}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Price Breakdown</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Nightly Rate</Text>
          <Text style={styles.value}>${selectedBooking.pricePerNight}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Number of Nights</Text>
          <Text style={styles.value}>{selectedBooking.nights}</Text>
        </View>
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>${selectedBooking.totalPrice}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('BookingMessages', { bookingId })}>
        <Text style={styles.actionButtonText}>Message Host</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24 },
  loaderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: '#666' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#000' },
  statusBadge: { backgroundColor: '#0066cc', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8, color: '#666' },
  text: { fontSize: 14, color: '#000', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  label: { fontSize: 14, color: '#666' },
  value: { fontSize: 14, fontWeight: '600', color: '#000' },
  totalRow: { borderTopWidth: 1, borderTopColor: '#f0f0f0', marginTop: 8, paddingTop: 12 },
  totalLabel: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  totalValue: { fontSize: 16, fontWeight: 'bold', color: '#0066cc' },
  actionButton: { backgroundColor: '#0066cc', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginVertical: 24 },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
