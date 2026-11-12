import React, { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { searchProperties } from '@store/slices/propertySlice';

export default function SearchResultsScreen({ navigation }) {
  const dispatch = useDispatch();
  const { searchResults, isLoading, filters } = useSelector((state) => state.property);

  useEffect(() => {
    dispatch(searchProperties({ ...filters }));
  }, [dispatch, filters]);

  const handlePropertyPress = (propertyId) => {
    navigation.navigate('PropertyDetails', { propertyId });
  };

  return (
    <View style={styles.container}>
      {isLoading && <ActivityIndicator size="large" color="#0066cc" style={styles.loader} />}
      {!isLoading && searchResults.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyText}>No properties found</Text>
        </View>
      )}
      <FlatList
        data={searchResults}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.propertyCard}
            onPress={() => handlePropertyPress(item.id)}
          >
            <View style={styles.cardContent}>
              <View style={styles.imageContainer}>
                <Text style={styles.imageIcon}>🏠</Text>
              </View>
              <View style={styles.infoContainer}>
                <Text style={styles.propertyName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.propertyLocation}>{item.location}</Text>
                <View style={styles.ratingRow}>
                  <Text style={styles.rating}>⭐ {item.rating || 'N/A'}</Text>
                  <Text style={styles.price}>${item.pricePerNight}/night</Text>
                </View>
              </View>
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
  propertyCard: { marginBottom: 12, borderRadius: 8, backgroundColor: '#f9f9f9', overflow: 'hidden' },
  cardContent: { flexDirection: 'row', padding: 12 },
  imageContainer: { width: 80, height: 80, borderRadius: 6, backgroundColor: '#e0e0e0', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  imageIcon: { fontSize: 32 },
  infoContainer: { flex: 1, justifyContent: 'space-between' },
  propertyName: { fontSize: 14, fontWeight: '600', color: '#000' },
  propertyLocation: { fontSize: 12, color: '#999', marginVertical: 4 },
  ratingRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rating: { fontSize: 12, color: '#FFA500' },
  price: { fontSize: 13, fontWeight: 'bold', color: '#0066cc' },
});
