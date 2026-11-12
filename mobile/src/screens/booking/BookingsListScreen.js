import React, { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { fetchUserBookings } from '@store/slices/bookingSlice';
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_COLORS } from '@utils/constants';

export default function BookingsListScreen({ navigation }) {
  const dispatch = useDispatch();
  const { bookings, isLoading } = useSelector((state) => state.booking);

  useEffect(() => {
    dispatch(fetchUserBookings());
  }, [dispatch]);

  const handleBookingPress = (bookingId) => {
    navigation.navigate('BookingDetails', { bookingId });
  };

  return (
    <View style={styles.container}>
      {isLoading && <ActivityIndicator size="large" color="#0066cc" style={styles.loader} />}
      {!isLoading && bookings.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📅</Text>
          <Text style={styles.emptyText}>No bookings yet</Text>
        </View>
      )}
      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.bookingCard}
            onPress={() => handleBookingPress(item.id)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.propertyName} numberOfLines={1}>{item.propertyName}</Text>
              <View style={[styles.statusBadge, { backgroundColor: BOOKING_STATUS_COLORS[item.status] }]}>
                <Text style={styles.statusText}>{BOOKING_STATUS_LABELS[item.status]}</Text>
              </View>
            </View>
            <Text style={styles.dates}>{item.checkIn} - {item.checkOut}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.price}>${item.totalPrice}</Text>
              <Text style={styles.arrow}>›</Text>
            </View>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 16, color: '#666' },
  listContent: { paddingHorizontal: 16, paddingVertical: 12 },
  bookingCard: { marginBottom: 12, borderRadius: 8, backgroundColor: '#f9f9f9', padding: 16, borderLeftWidth: 4, borderLeftColor: '#0066cc' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  propertyName: { fontSize: 14, fontWeight: '600', color: '#000', flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  dates: { fontSize: 12, color: '#999', marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  price: { fontSize: 14, fontWeight: 'bold', color: '#0066cc' },
  arrow: { fontSize: 20, color: '#999' },
});
