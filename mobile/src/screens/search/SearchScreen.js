import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { useDispatch } from 'react-redux';
import { setFilters } from '@store/slices/propertySlice';

export default function SearchScreen({ navigation }) {
  const [location, setLocation] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const dispatch = useDispatch();

  const handleSearch = () => {
    if (location) {
      dispatch(setFilters({ location, priceMin, priceMax }));
      navigation.navigate('SearchResults');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Find Your Rental</Text>
      
      <View style={styles.form}>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Location</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter city or area"
            value={location}
            onChangeText={setLocation}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.formGroup, styles.halfWidth]}>
            <Text style={styles.label}>Min Price</Text>
            <TextInput
              style={styles.input}
              placeholder="$0"
              value={priceMin}
              onChangeText={setPriceMin}
              keyboardType="number-pad"
            />
          </View>
          <View style={[styles.formGroup, styles.halfWidth]}>
            <Text style={styles.label}>Max Price</Text>
            <TextInput
              style={styles.input}
              placeholder="$1000"
              value={priceMax}
              onChangeText={setPriceMax}
              keyboardType="number-pad"
            />
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
        <Text style={styles.searchButtonText}>Search</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Popular Destinations</Text>
        {['New York', 'Los Angeles', 'Miami', 'Chicago'].map((city) => (
          <TouchableOpacity
            key={city}
            style={styles.destinationItem}
            onPress={() => {
              setLocation(city);
              dispatch(setFilters({ location: city }));
              navigation.navigate('SearchResults');
            }}
          >
            <Text style={styles.destinationText}>{city}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 24, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 24, color: '#000' },
  form: { marginBottom: 24 },
  formGroup: { marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  halfWidth: { width: '48%' },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 8, color: '#000' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, backgroundColor: '#fafafa' },
  searchButton: { backgroundColor: '#0066cc', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginBottom: 32 },
  searchButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12, color: '#000' },
  destinationItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  destinationText: { fontSize: 14, color: '#0066cc', fontWeight: '500' },
});
