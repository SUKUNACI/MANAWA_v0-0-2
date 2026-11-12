import React, { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { fetchUserProperties } from '@store/slices/propertySlice';

export default function MyPropertiesScreen({ navigation }) {
  const dispatch = useDispatch();
  const { userProperties, isLoading } = useSelector((state) => state.property);

  useEffect(() => {
    dispatch(fetchUserProperties());
  }, [dispatch]);

  return (
    <View style={styles.container}>
      {isLoading && <ActivityIndicator size="large" color="#0066cc" style={styles.loader} />}
      {!isLoading && userProperties.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🏠</Text>
          <Text style={styles.emptyText}>No properties yet</Text>
          <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('Profile')}>
            <Text style={styles.addButtonText}>Add Property</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={userProperties}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.propertyCard}>
            <Text style={styles.propertyIcon}>🏠</Text>
            <View style={styles.propertyInfo}>
              <Text style={styles.propertyName}>{item.name}</Text>
              <Text style={styles.propertyLocation}>{item.location}</Text>
              <Text style={styles.propertyPrice}>${item.pricePerNight}/night</Text>
            </View>
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 16, color: '#666', marginBottom: 24 },
  addButton: { backgroundColor: '#0066cc', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8 },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  listContent: { paddingHorizontal: 16, paddingVertical: 12 },
  propertyCard: { flexDirection: 'row', marginBottom: 12, backgroundColor: '#f9f9f9', borderRadius: 8, padding: 12 },
  propertyIcon: { fontSize: 32, marginRight: 12, justifyContent: 'center' },
  propertyInfo: { flex: 1, justifyContent: 'center' },
  propertyName: { fontSize: 14, fontWeight: '600', color: '#000' },
  propertyLocation: { fontSize: 12, color: '#999', marginVertical: 4 },
  propertyPrice: { fontSize: 13, fontWeight: 'bold', color: '#0066cc' },
});
