import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { register } from '@store/slices/authSlice';

export default function RegisterScreen({ navigation }) {
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const dispatch = useDispatch();
  const { isLoading, error: authError } = useSelector((state) => state.auth);

  const handleRegister = () => {
    if (formData.password !== formData.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }
    dispatch(register({
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      password: formData.password,
    }));
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create Account</Text>
      {authError && <View style={styles.errorContainer}><Text style={styles.errorText}>{authError}</Text></View>}
      <TextInput style={styles.input} placeholder="First Name" value={formData.firstName} onChangeText={(v) => setFormData({...formData, firstName: v})} editable={!isLoading} />
      <TextInput style={styles.input} placeholder="Last Name" value={formData.lastName} onChangeText={(v) => setFormData({...formData, lastName: v})} editable={!isLoading} />
      <TextInput style={styles.input} placeholder="Email" value={formData.email} onChangeText={(v) => setFormData({...formData, email: v})} keyboardType="email-address" editable={!isLoading} />
      <TextInput style={styles.input} placeholder="Password" value={formData.password} onChangeText={(v) => setFormData({...formData, password: v})} secureTextEntry editable={!isLoading} />
      <TextInput style={[styles.input, errors.confirmPassword && { borderColor: '#f44336' }]} placeholder="Confirm Password" value={formData.confirmPassword} onChangeText={(v) => setFormData({...formData, confirmPassword: v})} secureTextEntry editable={!isLoading} />
      {errors.confirmPassword && <Text style={styles.fieldError}>{errors.confirmPassword}</Text>}
      <TouchableOpacity style={[styles.button, isLoading && styles.buttonDisabled]} onPress={handleRegister} disabled={isLoading}>
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign Up</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Login')}>
        <Text style={styles.link}>Already have an account? Sign In</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 40, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 24, color: '#000' },
  errorContainer: { backgroundColor: '#fee', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, marginBottom: 20, borderLeftWidth: 4, borderLeftColor: '#f44336' },
  errorText: { color: '#c62828', fontSize: 14 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, marginBottom: 16, backgroundColor: '#fafafa' },
  fieldError: { color: '#f44336', fontSize: 12, marginBottom: 8 },
  button: { backgroundColor: '#0066cc', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, marginBottom: 24 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  link: { textAlign: 'center', color: '#0066cc', fontSize: 14, fontWeight: '500' },
});
